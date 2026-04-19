"""
S3 trigger: SES receipt rule stores raw MIME under ses-inbound/ — copy to raw/{mailbox}/INBOX/
and index in DynamoDB (same shape as IMAP sync).
"""

from __future__ import annotations

import hashlib
import os
import re
import time
import urllib.parse
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime

import boto3

METADATA_TABLE = os.environ["METADATA_TABLE"]
MAIL_BUCKET = os.environ["MAIL_BUCKET"]
DOMAINS = [d.strip().lower() for d in os.environ.get("MAIL_ACCEPT_DOMAINS", "cirak.ca").split(",") if d.strip()]
INBOUND_PREFIX = os.environ.get("SES_INBOUND_PREFIX", "ses-inbound/")


def _safe_mailbox(email: str) -> str:
    return re.sub(r"[^\w@.-]+", "_", email)[:200]


def _pk(email: str) -> str:
    return f"MAILBOX#{_safe_mailbox(email)}"


def _pick_recipient(msg) -> str | None:
    """First address whose domain is allowed."""
    raw_headers: list[str] = []
    for hdr in ("To", "Cc", "Delivered-To", "Envelope-To"):
        for v in msg.get_all(hdr, []) or []:
            raw_headers.append(str(v))
    pairs = getaddresses(raw_headers)
    seen: set[str] = set()
    for _, addr in pairs:
        addr = (addr or "").strip().lower()
        if not addr or "@" not in addr:
            continue
        if addr in seen:
            continue
        seen.add(addr)
        dom = addr.split("@", 1)[-1]
        if dom in DOMAINS:
            return addr
    return None


def _decode_maybe(header_val: str) -> str:
    if not header_val:
        return ""
    return str(header_val)


def process_object(bucket: str, key: str) -> None:
    key = urllib.parse.unquote_plus(key)
    if not key.startswith(INBOUND_PREFIX):
        return

    s3 = boto3.client("s3")
    ddb = boto3.client("dynamodb")

    obj = s3.get_object(Bucket=bucket, Key=key)
    raw = obj["Body"].read()
    msg = BytesParser(policy=policy.default).parsebytes(raw)

    recipient = _pick_recipient(msg)
    if not recipient:
        return

    mid = (msg.get("Message-ID") or "").strip() or key
    uid = hashlib.sha256(f"{recipient}:{mid}".encode()).hexdigest()[:24]

    safe = _safe_mailbox(recipient)
    folder_safe = "INBOX"
    dest_key = f"raw/{safe}/{folder_safe}/{uid}.eml"
    sk = f"MSG#{folder_safe}#{uid}"

    subj = _decode_maybe(msg.get("Subject", ""))
    frm = _decode_maybe(msg.get("From", ""))
    date_hdr = msg.get("Date") or ""
    try:
        sort_ts = int(parsedate_to_datetime(date_hdr).timestamp()) if date_hdr else int(time.time())
    except Exception:
        sort_ts = int(time.time())

    pk = _pk(recipient)

    # Idempotent: same sk → overwrite body ok
    s3.put_object(
        Bucket=bucket,
        Key=dest_key,
        Body=raw,
        ContentType="message/rfc822",
        ServerSideEncryption="AES256",
        Metadata={
            "source": "ses-inbound",
            "ses-key": key[:900],
        },
    )

    ddb.put_item(
        TableName=METADATA_TABLE,
        Item={
            "pk": {"S": pk},
            "sk": {"S": sk},
            "s3_key": {"S": dest_key},
            "subject": {"S": subj[:900]},
            "from_addr": {"S": frm[:900]},
            "imap_uid": {"S": uid},
            "folder": {"S": folder_safe},
            "sort_ts": {"N": str(int(sort_ts))},
        },
    )

    try:
        s3.delete_object(Bucket=bucket, Key=key)
    except Exception:
        pass


def lambda_handler(event, context):
    for rec in event.get("Records", []):
        if rec.get("eventSource") != "aws:s3":
            continue
        b = rec["s3"]["bucket"]["name"]
        k = rec["s3"]["object"]["key"]
        process_object(b, k)
    return {"statusCode": 200, "body": "ok"}
