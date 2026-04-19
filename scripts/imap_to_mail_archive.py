#!/usr/bin/env python3
"""
Pull mail from IMAP (e.g. Amazon WorkMail) and store raw RFC822 in S3 + metadata in DynamoDB.

Requirements: Python 3.10+, boto3 (pip install -r scripts/requirements-imap-sync.txt)

Environment:
  AWS_REGION              (default: ca-central-1)
  MAIL_ARCHIVE_BUCKET     (e.g. data.cmail.cirak.ca)
  MAIL_METADATA_TABLE     (Terraform output mail_metadata_table_name)
  IMAP_HOST               (WorkMail: often imap.mail.<region>.awsapps.com — confirm in console)
  IMAP_USER               full email
  IMAP_PASSWORD
  MAILBOX_ID              optional stable id for S3 prefix (default: IMAP_USER)

Optional:
  STATE_FILE              path to JSON last-sync state (default: ./.imap_mail_state.json)
  SKIP_DYNAMODB           set to 1 to only upload to S3
  IMAP_TIMEOUT_SEC        TCP timeout for connect/commands (default: 120)
  IMAP_USE_LIST           set to 1 to auto-discover folders via IMAP LIST (some servers hang)
  IMAP_FOLDERS            comma-separated folder names when not using LIST (see defaults below)
"""

from __future__ import annotations

import email
import imaplib
import json
import os
import re
import socket
import sys
import time
from email.header import decode_header
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

# WorkMail / Outlook-style defaults when LIST is skipped (non-existent folders are skipped on SELECT)
_DEFAULT_FOLDER_CANDIDATES = (
    "INBOX,Sent Items,Sent,Drafts,Deleted Items,Trash,Junk Email,Junk,Archive"
)


def _env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if v is None or v.strip() == "":
        raise SystemExit(f"Missing required environment variable: {name}")
    return v.strip()


def _optional_env(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v.strip() if v and v.strip() else default


def _optional_env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw or not raw.strip():
        return default
    try:
        return max(10, int(raw.strip()))
    except ValueError:
        return default


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.stderr.flush()


def _decode_maybe(header_val: str) -> str:
    if not header_val:
        return ""
    parts = []
    for chunk, enc in decode_header(header_val):
        if isinstance(chunk, bytes):
            parts.append(chunk.decode(enc or "utf-8", errors="replace"))
        else:
            parts.append(str(chunk))
    return "".join(parts).strip()


def _sanitize_folder(name: str) -> str:
    s = name.replace('"', "").strip()
    s = re.sub(r"[^\w\-./]+", "_", s, flags=re.UNICODE)
    s = s.replace("/", "_").strip("_") or "INBOX"
    return s[:180]


def _load_state(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"folders": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"folders": {}}


def _save_state(path: Path, state: dict[str, Any]) -> None:
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def main() -> None:
    region = _optional_env("AWS_REGION", "ca-central-1")
    bucket = _env("MAIL_ARCHIVE_BUCKET")
    table_name = os.environ.get("MAIL_METADATA_TABLE", "").strip()
    skip_ddb = os.environ.get("SKIP_DYNAMODB", "").strip() in ("1", "true", "yes")

    imap_host = _env("IMAP_HOST")
    imap_user = _env("IMAP_USER")
    imap_pw = _env("IMAP_PASSWORD")
    mailbox_id = _optional_env("MAILBOX_ID", imap_user)
    safe_mailbox = re.sub(r"[^\w@.-]+", "_", mailbox_id)[:200]
    state_file = Path(_optional_env("STATE_FILE", str(Path.cwd() / ".imap_mail_state.json")))

    import boto3

    s3 = boto3.client("s3", region_name=region)
    ddb = None if skip_ddb or not table_name else boto3.client("dynamodb", region_name=region)

    state = _load_state(state_file)
    folder_state: dict[str, Any] = state.setdefault("folders", {})

    timeout_sec = _optional_env_int("IMAP_TIMEOUT_SEC", 120)
    _log(f"Connecting IMAP SSL {imap_host}:993 (timeout {timeout_sec}s) …")
    try:
        conn = imaplib.IMAP4_SSL(imap_host, port=993, timeout=timeout_sec)
    except socket.timeout:
        raise SystemExit(
            f"IMAP connection timed out ({timeout_sec}s). Check firewall / VPN / egress IP "
            "or raise IMAP_TIMEOUT_SEC."
        ) from None
    except OSError as e:
        raise SystemExit(f"IMAP connection error ({imap_host}:993): {e}") from e

    _log("TLS connected, logging in…")
    try:
        conn.login(imap_user, imap_pw)
    except imaplib.IMAP4.error as e:
        try:
            conn.logout()
        except Exception:
            pass
        raise SystemExit(f"IMAP login rejected: {e}") from e

    use_list = os.environ.get("IMAP_USE_LIST", "").strip().lower() in ("1", "true", "yes")
    folders_csv = os.environ.get("IMAP_FOLDERS", "").strip()

    def folder_from_list_line(raw: bytes) -> str | None:
        """
        Parse * LIST (flags) delimiter mailbox-name
        Skip \\Noselect entries and hierarchy-only rows whose mailbox name is '/'.
        imaplib may return lines with or without '* LIST ' prefix.
        """
        line = raw.decode("utf-8", errors="replace").strip()
        if not line:
            return None
        m = re.match(r"^\*\s+LIST\s+\(([^)]*)\)\s+(\"[^\"]*\"|\S+)\s+(.*)$", line, re.IGNORECASE)
        if not m:
            m = re.match(r"^\(([^)]*)\)\s+(\"[^\"]*\"|\S+)\s+(.*)$", line)
        if not m:
            return None
        flags, _delim_token, tail = m.group(1), m.group(2), m.group(3).strip()
        if r"\Noselect" in flags:
            return None
        tail = tail.strip()
        if not tail or tail.startswith("{"):
            # bracketed literal — not handled here
            return None
        if tail.startswith('"'):
            mq = re.match(r'"((?:\\.|[^"])*)"', tail)
            name = mq.group(1).replace('\\"', '"').replace("\\\\", "\\") if mq else tail.strip('"')
        else:
            name = tail.split()[0].strip('"')
        name = name.strip()
        if not name or name == "/":
            return None
        return name

    folders: list[str] = []
    seen_folder_names: set[str] = set()

    if use_list:
        _log("Folder discovery via LIST (if slow or stuck, use IMAP_USE_LIST=0)…")
        typ, data = conn.list()
        if typ != "OK" or not data:
            _log("LIST failed; falling back to IMAP_FOLDERS / default folder names.")
            typ, data = "NO", []
        if typ == "OK" and data:
            for raw in data:
                if not raw:
                    continue
                name = folder_from_list_line(raw if isinstance(raw, bytes) else bytes(str(raw), "utf-8"))
                if name and name not in seen_folder_names:
                    seen_folder_names.add(name)
                    folders.append(name)
    else:
        src = folders_csv if folders_csv else _DEFAULT_FOLDER_CANDIDATES
        for part in src.split(","):
            name = part.strip()
            if name and name not in seen_folder_names:
                seen_folder_names.add(name)
                folders.append(name)
        _log(
            f"LIST skipped; trying {len(folders)} folder(s) "
            f"({'from IMAP_FOLDERS' if folders_csv else 'default name list'})."
        )

    if not folders:
        folders = ["INBOX"]

    uploaded = 0
    for folder in folders:
        folder_safe = _sanitize_folder(folder)
        try:
            typ, _ = conn.select(f'"{folder}"' if " " in folder else folder, readonly=True)
        except Exception:
            try:
                typ, _ = conn.select(folder, readonly=True)
            except Exception as e:
                _log(f"SKIP folder {folder!r}: {e}")
                continue
        if typ != "OK":
            _log(f"SKIP select {folder!r}")
            continue

        typ, uid_data = conn.uid("SEARCH", None, "ALL")
        if typ != "OK" or not uid_data or not uid_data[0]:
            continue
        uids = [x for x in uid_data[0].decode().split() if x.isdigit()]
        seen = set(folder_state.get(folder_safe, {}).get("uids", []))
        _log(f"Folder {folder!r}: {len(uids)} UID(s), uploading new messages…")

        for uid in uids:
            if uid in seen:
                continue
            typ, msg_data = conn.uid("FETCH", uid, "(RFC822)")
            if typ != "OK" or not msg_data or not isinstance(msg_data[0], tuple):
                continue
            raw_body = msg_data[0][1]
            if isinstance(raw_body, str):
                raw_body = raw_body.encode("utf-8", errors="replace")

            key = f"raw/{safe_mailbox}/{folder_safe}/{uid}.eml"
            s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=raw_body,
                ContentType="message/rfc822",
                ServerSideEncryption="AES256",
                Metadata={
                    "imap-folder": folder_safe[:255],
                    "imap-uid": uid[:32],
                    "source": "imap-import",
                },
            )

            msg = email.message_from_bytes(raw_body)
            subj = _decode_maybe(msg.get("Subject", ""))
            msg_id = (msg.get("Message-ID") or "")[:1024]
            frm = _decode_maybe(msg.get("From", ""))
            date_hdr = msg.get("Date") or ""
            try:
                sort_ts = int(parsedate_to_datetime(date_hdr).timestamp()) if date_hdr else int(time.time())
            except Exception:
                sort_ts = int(time.time())

            if ddb:
                pk = f"MAILBOX#{safe_mailbox}"
                sk = f"MSG#{folder_safe}#{uid}"
                item = {
                    "pk": {"S": pk},
                    "sk": {"S": sk},
                    "s3_key": {"S": key},
                    "subject": {"S": subj[:900]},
                    "from_addr": {"S": frm[:900]},
                    "imap_uid": {"S": uid},
                    "folder": {"S": folder_safe},
                    "sort_ts": {"N": str(sort_ts)},
                }
                if msg_id:
                    item["message_id"] = {"S": msg_id}
                ddb.put_item(TableName=table_name, Item=item)

            seen.add(uid)
            uploaded += 1

        folder_state[folder_safe] = {"uids": sorted(seen, key=lambda x: int(x) if x.isdigit() else 0)}

    _save_state(state_file, state)
    conn.logout()

    print(f"Done. Uploaded {uploaded} new message(s) to s3://{bucket}/raw/{safe_mailbox}/")


if __name__ == "__main__":
    main()
