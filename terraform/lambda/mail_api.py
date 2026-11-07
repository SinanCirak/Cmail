"""
HTTP API Lambda: mail list + raw content from DynamoDB + S3 (.eml).
JWT claims must include email (Cognito) matching MAILBOX#... partition.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import time
import urllib.parse
import uuid
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage, Message
from email.parser import BytesParser
from email.utils import parseaddr

import boto3
import mail_index
import mail_rules

METADATA_TABLE = os.environ["METADATA_TABLE"]
MAIL_BUCKET = os.environ["MAIL_BUCKET"]
_AWS_REGION = os.environ.get("AWS_REGION", "ca-central-1")

ddb = boto3.client("dynamodb")
s3 = boto3.client("s3")
ses = boto3.client("ses", region_name=_AWS_REGION)

# DynamoDB `folder` (imap _sanitize_folder) -> UI nav id. WorkMail may use "Sent Messages"
# or "Deleted Messages" → Sent_Messages / Deleted_Messages; not only Sent_Items / Deleted_Items.
FOLDER_TO_NAV: dict[str, str] = {
    "INBOX": "inbox",
    "Sent_Items": "sent",
    "Sent_Messages": "sent",
    "Sent": "sent",
    "Drafts": "drafts",
    "Archive": "archive",
    "Junk_Email": "spam",
    "Junk": "spam",
    "Deleted_Items": "trash",
    "Deleted_Messages": "trash",
    "Trash": "trash",
}


def _store_prefixes_for_nav(nav: str) -> list[str]:
    nav = (nav or "inbox").lower()
    keys = sorted({k for k, v in FOLDER_TO_NAV.items() if v == nav})
    return keys


def _safe_mailbox(email: str) -> str:
    return re.sub(r"[^\w@.-]+", "_", email)[:200]


def _pk(email: str) -> str:
    return f"MAILBOX#{_safe_mailbox(email)}"


# Canonical `folder` / sk segment for mutations (matches IMAP sanitize for these names).
NAV_PRIMARY_STORE: dict[str, str] = {
    "inbox": "INBOX",
    "sent": "Sent_Items",
    "drafts": "Drafts",
    "archive": "Archive",
    "spam": "Junk_Email",
    "trash": "Deleted_Items",
}

# User prefs (same table as mail metadata; does not collide with MSG# / FOLDER# sk).
PREFS_TRUSTED_IMAGE_DOMAINS_SK = "PREFS#TRUSTED_IMAGE_DOMAINS"


def _folder_uid_from_sk(sk: str) -> tuple[str, str]:
    if not sk.startswith("MSG#"):
        raise ValueError("invalid sk")
    rest = sk[4:]
    if "#" not in rest:
        raise ValueError("invalid sk")
    folder_safe, uid = rest.rsplit("#", 1)
    return folder_safe, uid


def _default_read_for_folder(store_folder: str) -> bool:
    return store_folder != "INBOX"


def _parse_json_body(event: dict) -> dict:
    try:
        raw = event.get("body") or "{}"
        if isinstance(raw, str):
            if event.get("isBase64Encoded"):
                raw = base64.b64decode(raw).decode("utf-8")
            return json.loads(raw or "{}")
        return {}
    except Exception:
        return {}


def _json_headers() -> dict[str, str]:
    # Browsers may cache anonymous GET /mail/messages without this — stale list after delete/move + F5.
    return {
        "content-type": "application/json",
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        "pragma": "no-cache",
        "vary": "Authorization",
    }


def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": _json_headers(),
        "body": json.dumps(body, default=str),
    }


def _claims(event) -> dict:
    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )


def _user_email(event) -> str | None:
    c = _claims(event)
    email_claim = (c.get("email") or "").strip()
    if email_claim:
        return email_claim.lower()
    for k in ("username", "cognito:username"):
        raw = (c.get(k) or "").strip()
        if raw and "@" in raw:
            return raw.lower()
    return None


def list_folders(user_email: str) -> dict:
    counts = mail_index.page(_pk(user_email), "inbox")['counts']
    return _response(200, {"counts": counts, "folders": [{"id": key, "count": value} for key, value in counts.items()]})


def _parse_email(from_line: str) -> str:
    m = re.search(r"<([^>]+)>", from_line)
    if m:
        return m.group(1).strip()
    if "@" in from_line:
        return from_line.strip()
    return ""


def _folder_store_segment(folder_id: str) -> str:
    hexonly = re.sub(r"[^a-fA-F0-9]", "", (folder_id or "").strip())
    if len(hexonly) < 32:
        raise ValueError("invalid folder id")
    return "UF" + hexonly[:32]


def _contact_one(msg: Message, header: str) -> dict | None:
    raw = msg.get(header)
    if not raw:
        return None
    name, addr = parseaddr(str(raw))
    if not addr or "@" not in addr:
        return None
    nm = (name.strip() if name else "") or addr.split("@", 1)[0]
    return {"name": nm[:240], "email": addr.lower()[:500]}


def _contact_list(msg: Message, header: str) -> list[dict]:
    out: list[dict] = []
    parts = msg.get_all(header)
    if not parts:
        parts = []
    if not isinstance(parts, list):
        parts = [parts]
    block = ";".join(str(p) for p in parts if p)
    for seg in block.replace(",", ";").split(";"):
        seg = seg.strip()
        if not seg:
            continue
        name, addr = parseaddr(seg)
        if addr and "@" in addr:
            nm = (name.strip() if name else "") or addr.split("@", 1)[0]
            out.append({"name": nm[:240], "email": addr.lower()[:500]})
    return out


def _to_display_contacts(msg: Message) -> list[dict]:
    """Prefer To; many inbound mails (SES BCC, lists) only set Delivered-To / X-Original-To."""
    for header in (
        "To",
        "Delivered-To",
        "X-Original-To",
        "Envelope-To",
        "X-Envelope-To",
        "X-Delivered-To",
    ):
        got = _contact_list(msg, header)
        if got:
            return got
    return []


def _extract_mail_body(msg: Message) -> tuple[str, bool]:
    """Return (body, is_html). Prefer HTML; skip attachment parts (fixes wrong/plain-only picks)."""
    if not msg.is_multipart():
        try:
            payload = msg.get_payload(decode=True)
            if isinstance(payload, bytes):
                charset = msg.get_content_charset() or "utf-8"
                text = payload.decode(charset, errors="replace")
            else:
                text = str(payload or "")
            return text, msg.get_content_type() == "text/html"
        except Exception:
            return "", False

    html_part = ""
    plain_part = ""
    for part in msg.walk():
        disp = (part.get_content_disposition() or "").lower()
        if disp == "attachment":
            continue
        ctype = part.get_content_type()
        if ctype == "text/html" and not html_part:
            try:
                html_part = part.get_content()
            except Exception:
                pass
        elif ctype == "text/plain" and not plain_part:
            try:
                plain_part = part.get_content()
            except Exception:
                pass

    if html_part.strip():
        return html_part, True
    if plain_part.strip():
        return plain_part, False
    return "", False


def _body_looks_like_html(text: str) -> bool:
    """Senders sometimes label HTML as text/plain; clients need isHtml true for rendering."""
    t = (text or "").lstrip("\ufeff").strip()
    if not t.startswith("<"):
        return False
    if re.search(r"</[a-z][a-z0-9.-]*\s*>", t, re.I):
        return True
    if re.search(r"<(?:p|div|span|table|html|body|ul|ol|li|a|br)\b", t, re.I):
        return True
    return False


def _b64_decode_attachment(b64: str) -> bytes:
    """Browser/FileReader base64 may lack padding; strict validate=False avoids PDF decode failures."""
    s = re.sub(r"\s+", "", (b64 or "").strip())
    pad = (-len(s)) % 4
    if pad:
        s += "=" * pad
    return base64.b64decode(s, validate=False)


def _normalize_cid_header(val: str) -> str:
    s = (val or "").strip()
    if s.startswith("<"):
        s = s[1:]
    if s.endswith(">"):
        s = s[:-1]
    return s.strip().lower()


def _extract_inline_images(msg: Message) -> list[dict]:
    """Image parts with Content-ID for <img src=cid:...> (multipart/related)."""
    out: list[dict] = []
    total_bytes = 0
    max_total = 6 * 1024 * 1024
    max_one = 2 * 1024 * 1024
    seen: set[str] = set()

    for part in msg.walk():
        ctype = (part.get_content_type() or "").lower()
        if not ctype.startswith("image/"):
            continue
        cid_raw = part.get("Content-ID")
        cid_str = str(cid_raw).strip() if cid_raw else ""
        fname = (part.get_filename() or "").strip()
        disp = (part.get_content_disposition() or "").lower()
        if cid_str:
            norm = _normalize_cid_header(cid_str)
        elif fname and disp == "inline":
            norm = _normalize_cid_header(fname)
        else:
            continue
        if not norm or norm in seen:
            continue
        try:
            payload = part.get_payload(decode=True)
        except Exception:
            continue
        if not isinstance(payload, bytes) or not payload:
            continue
        if len(payload) > max_one:
            continue
        if total_bytes + len(payload) > max_total:
            break
        try:
            b64 = base64.b64encode(payload).decode("ascii")
        except Exception:
            continue
        total_bytes += len(payload)
        seen.add(norm)
        out.append({"cid": norm, "contentType": ctype, "contentBase64": b64})

    return out


def get_content(user_email: str, s3_key: str) -> dict:
    safe = _safe_mailbox(user_email)
    prefix = f"raw/{safe}/"
    if not s3_key.startswith(prefix):
        return _response(403, {"error": "invalid key"})
    obj = s3.get_object(Bucket=MAIL_BUCKET, Key=s3_key)
    raw = obj["Body"].read()
    msg = BytesParser(policy=policy.default).parsebytes(raw)

    body_out, use_html = _extract_mail_body(msg)
    if not use_html and _body_looks_like_html(body_out):
        use_html = True

    attachments: list[dict] = []
    if msg.is_multipart():
        for part in msg.walk():
            disp = part.get_content_disposition()
            if disp == "attachment":
                fname = part.get_filename() or "attachment"
                ctype = (part.get_content_type() or "application/octet-stream").strip().lower()
                try:
                    payload = part.get_payload(decode=True)
                except Exception:
                    payload = None
                if isinstance(payload, bytes) and payload:
                    attachments.append(
                        {
                            "name": fname,
                            "contentType": ctype,
                            "contentBase64": base64.b64encode(payload).decode("ascii"),
                            "size": len(payload),
                        },
                    )
                else:
                    attachments.append({"name": fname, "contentType": ctype})

    from_c = _contact_one(msg, "From")
    inline_images = _extract_inline_images(msg)
    pk = _pk(user_email)
    trusted_image_domains = _read_trusted_image_domains_list(pk)
    return _response(
        200,
        {
            "body": body_out,
            "isHtml": use_html,
            "attachments": attachments,
            "inlineImages": inline_images,
            "from": from_c,
            "to": _to_display_contacts(msg),
            "cc": _contact_list(msg, "Cc"),
            "bcc": _contact_list(msg, "Bcc"),
            # Same-tab race fix: client applies this with the message body so DB-trusted
            # domains take effect before rendering CID images.
            "trustedImageDomains": trusted_image_domains,
        },
    )


def delete_message(user_email: str, sk: str) -> dict:
    pk = _pk(user_email)
    item = ddb.get_item(TableName=METADATA_TABLE, Key={"pk": {"S": pk}, "sk": {"S": sk}}).get(
        "Item",
    )
    if not item:
        return _response(404, {"error": "not found"})
    s3_key = item.get("s3_key", {}).get("S", "")
    if not s3_key.startswith(f"raw/{_safe_mailbox(user_email)}/"):
        return _response(403, {"error": "invalid key"})
    try:
        if s3_key:
            s3.delete_object(Bucket=MAIL_BUCKET, Key=s3_key)
        ddb.delete_item(TableName=METADATA_TABLE, Key={"pk": {"S": pk}, "sk": {"S": sk}})
    except Exception as e:
        return _response(500, {"error": str(e)})
    return _response(200, {"ok": True})


def move_message(user_email: str, sk: str, target_nav: str) -> dict:
    raw_target = (target_nav or "").strip()
    lower = raw_target.lower()
    new_store: str | None = None
    if lower.startswith("custom:"):
        fid = lower.split(":", 1)[1].strip()
        try:
            new_store = _folder_store_segment(fid)
        except ValueError:
            return _response(400, {"error": "invalid custom folder"})
    else:
        new_store = NAV_PRIMARY_STORE.get(lower)
        if not new_store:
            return _response(400, {"error": "unknown folder"})

    pk = _pk(user_email)
    safe = _safe_mailbox(user_email)

    item = ddb.get_item(TableName=METADATA_TABLE, Key={"pk": {"S": pk}, "sk": {"S": sk}}, ConsistentRead=True).get(
        "Item",
    )
    if not item:
        return _response(404, {"error": "not found"})

    old_key = item.get("s3_key", {}).get("S", "")
    if not old_key.startswith(f"raw/{safe}/"):
        return _response(403, {"error": "invalid key"})

    try:
        _, uid = _folder_uid_from_sk(sk)
    except ValueError:
        return _response(400, {"error": "invalid sk"})

    new_sk = f"MSG#{new_store}#{uid}"
    new_key = f"raw/{safe}/{new_store}/{uid}.eml"

    if new_sk == sk:
        return _response(200, {"ok": True, "sk": sk, "s3Key": old_key})

    if ddb.get_item(TableName=METADATA_TABLE, Key={'pk': {'S': pk}, 'sk': {'S': new_sk}}, ConsistentRead=True).get('Item'):
        return _response(409, {'error': 'A message with this identifier already exists in the destination'})

    try:
        s3.copy_object(
            Bucket=MAIL_BUCKET,
            CopySource={"Bucket": MAIL_BUCKET, "Key": old_key},
            Key=new_key,
            MetadataDirective="COPY",
        )
    except Exception as e:
        return _response(500, {"error": f"s3: {e}"})

    try:
        item2 = dict(item)
        item2["sk"] = {"S": new_sk}
        item2["s3_key"] = {"S": new_key}
        item2["folder"] = {"S": new_store}
        if "read" not in item2:
            item2["read"] = {"BOOL": _default_read_for_folder(new_store)}
        # keep subject, from_addr, sort_ts, imap_uid, etc.
        ddb.transact_write_items(TransactItems=[
            {'Put': {'TableName': METADATA_TABLE, 'Item': item2, 'ConditionExpression': 'attribute_not_exists(pk)'}},
            {'Delete': {'TableName': METADATA_TABLE, 'Key': {'pk': {'S': pk}, 'sk': {'S': sk}},
                        'ConditionExpression': 's3_key = :old', 'ExpressionAttributeValues': {':old': {'S': old_key}}}},
        ])
    except Exception:
        logging.exception('Message metadata move failed; original source retained')
        return _response(500, {'error': 'Could not move message; original message retained'})
    try:
        s3.delete_object(Bucket=MAIL_BUCKET, Key=old_key)
    except Exception:
        logging.exception('Moved message saved; old raw copy cleanup failed')

    return _response(200, {"ok": True, "sk": new_sk, "s3Key": new_key, "folder": target_nav})


def _parse_address_list_field(s: str) -> list[str]:
    out: list[str] = []
    for part in (s or "").replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        _, addr = parseaddr(part)
        if addr and "@" in addr:
            out.append(addr.lower())
    return out


def set_read_state(user_email: str, sks: list[str], read: bool) -> dict:
    if not sks:
        return _response(400, {"error": "sks required"})
    pk = _pk(user_email)
    updated = 0
    for raw in sks:
        sk = urllib.parse.unquote(str(raw or "").strip())
        if not sk.startswith("MSG#"):
            continue
        try:
            ddb.update_item(
                TableName=METADATA_TABLE,
                Key={"pk": {"S": pk}, "sk": {"S": sk}},
                ConditionExpression="attribute_exists(pk) AND attribute_exists(sk)",
                UpdateExpression="SET #r = :v",
                ExpressionAttributeNames={"#r": "read"},
                ExpressionAttributeValues={":v": {"BOOL": bool(read)}},
            )
            updated += 1
        except Exception:
            continue
    return _response(200, {"ok": True, "updated": updated})


def set_starred_state(user_email: str, sk: str, starred: bool) -> dict:
    if not sk.startswith("MSG#"):
        return _response(400, {"error": "invalid sk"})
    try:
        ddb.update_item(
            TableName=METADATA_TABLE,
            Key={"pk": {"S": _pk(user_email)}, "sk": {"S": sk}},
            UpdateExpression="SET starred = :v",
            ExpressionAttributeValues={":v": {"BOOL": starred}},
            ConditionExpression="attribute_exists(pk) AND attribute_exists(sk)",
        )
    except ddb.exceptions.ConditionalCheckFailedException:
        return _response(404, {"error": "not found"})
    return _response(200, {"ok": True, "starred": starred})


def _save_sent_copy(user_email: str, msg: EmailMessage, raw: bytes, subject: str) -> None:
    mid_hdr = (msg.get("Message-ID") or "").strip()
    uid = hashlib.sha256(mid_hdr.encode("utf-8") if mid_hdr else raw[:256]).hexdigest()[:24]
    safe = _safe_mailbox(user_email)
    folder_safe = "Sent_Items"
    pk = _pk(user_email)
    sk = f"MSG#{folder_safe}#{uid}"
    key = f"raw/{safe}/{folder_safe}/{uid}.eml"
    s3.put_object(
        Bucket=MAIL_BUCKET,
        Key=key,
        Body=raw,
        ContentType="message/rfc822",
        ServerSideEncryption="AES256",
        Metadata={"source": "cmail-send"},
    )
    ts = int(time.time())
    ddb.put_item(
        TableName=METADATA_TABLE,
        Item={
            "pk": {"S": pk},
            "sk": {"S": sk},
            "s3_key": {"S": key},
            "subject": {"S": (subject or "(No subject)")[:900]},
            "from_addr": {"S": user_email[:900]},
            "imap_uid": {"S": uid},
            "folder": {"S": folder_safe},
            "read": {"BOOL": True},
            "sort_ts": {"N": str(ts)},
        },
    )


def send_outbound(user_email: str, payload: dict) -> dict:
    """Send via SES (From = signed-in user). Requires verified identity/domain in SES."""
    to_raw = (payload.get("to") or "").strip()
    cc_raw = (payload.get("cc") or "").strip()
    bcc_raw = (payload.get("bcc") or "").strip()
    subject = (payload.get("subject") or "").strip()
    body_text = payload.get("body") or ""
    if not to_raw:
        return _response(400, {"error": "to required"})
    dests = _parse_address_list_field(to_raw)
    dests += _parse_address_list_field(cc_raw)
    dests += _parse_address_list_field(bcc_raw)
    if not dests:
        return _response(400, {"error": "no valid recipient addresses"})
    msg = EmailMessage()
    msg["From"] = user_email
    msg["To"] = to_raw
    if cc_raw:
        msg["Cc"] = cc_raw
    if bcc_raw:
        msg["Bcc"] = bcc_raw
    msg["Subject"] = subject or "(No subject)"
    dom = user_email.split("@", 1)[-1] if "@" in user_email else "local"
    msg["Message-ID"] = f"<{uuid.uuid4().hex}@{dom}>"
    t = body_text.strip()
    if t.startswith("<") and "</" in t:
        msg.set_content("HTML message — use an HTML-capable mail client.", subtype="plain", charset="utf-8")
        msg.add_alternative(body_text, subtype="html", charset="utf-8")
    else:
        msg.set_content(body_text if body_text else "(empty)", subtype="plain", charset="utf-8")

    total_att = 0
    inline_images = payload.get("inlineImages") or []
    if not isinstance(inline_images, list):
        return _response(400, {"error": "inlineImages must be an array"})
    html_part = msg.get_body(preferencelist=("html",))
    seen_cids: set[str] = set()
    for image in inline_images:
        if not isinstance(image, dict):
            return _response(400, {"error": "invalid inline image"})
        cid = _normalize_cid_header(str(image.get("cid") or ""))
        ctype = str(image.get("contentType") or "image/png").lower()
        if not cid or len(cid) > 200 or re.search(r"[\r\n<>]", cid) or not ctype.startswith("image/") or html_part is None:
            return _response(400, {"error": "invalid inline image metadata"})
        if cid in seen_cids:
            continue
        try:
            data = _b64_decode_attachment(str(image.get("contentBase64") or ""))
        except Exception:
            return _response(400, {"error": "invalid inline image data"})
        total_att += len(data)
        if not data or total_att > 15 * 1024 * 1024:
            return _response(400, {"error": "inline images too large or empty"})
        html_part.add_related(data, maintype="image", subtype=ctype.split("/", 1)[1], cid=f"<{cid}>", disposition="inline")
        seen_cids.add(cid)

    attachments_in = payload.get("attachments") or []
    if not isinstance(attachments_in, list):
        attachments_in = []
    for item in attachments_in:
        if not isinstance(item, dict):
            continue
        fn = (item.get("filename") or item.get("name") or "attachment").strip() or "attachment"
        b64 = (item.get("contentBase64") or item.get("data") or "").strip()
        if not b64:
            continue
        try:
            raw_att = _b64_decode_attachment(b64)
        except Exception as e:
            return _response(400, {"error": f"invalid base64 attachment {fn[:80]}: {e}"})
        total_att += len(raw_att)
        if total_att > 15 * 1024 * 1024:
            return _response(400, {"error": "attachments too large (max 15MB total)"})
        ctype = (item.get("contentType") or item.get("mime") or "application/octet-stream").strip()
        if "/" in ctype:
            main_t, sub_t = ctype.split("/", 1)
        else:
            main_t, sub_t = "application", "octet-stream"
        if fn.lower().endswith(".pdf") and main_t == "application" and sub_t in ("octet-stream", "x-unknown"):
            sub_t = "pdf"
        msg.add_attachment(raw_att, maintype=main_t, subtype=sub_t, filename=fn[:500])

    raw = msg.as_bytes(policy=policy.SMTP)
    uniq_dest = list(dict.fromkeys(dests))
    try:
        out = ses.send_raw_email(
            Source=user_email,
            Destinations=uniq_dest,
            RawMessage={"Data": raw},
        )
    except Exception as e:
        return _response(500, {"error": str(e)})
    ses_mid = out.get("MessageId", "")
    try:
        _save_sent_copy(user_email, msg, raw, subject)
    except Exception:
        pass
    return _response(200, {"ok": True, "sesMessageId": ses_mid})


def list_user_folders(user_email: str) -> dict:
    pk = _pk(user_email)
    out: list[dict] = []
    start_key = None
    while True:
        kw: dict = {
            "TableName": METADATA_TABLE,
            "ConsistentRead": True,
            "KeyConditionExpression": "pk = :pk AND begins_with(sk, :pre)",
            "ExpressionAttributeValues": {":pk": {"S": pk}, ":pre": {"S": "FOLDER#"}},
        }
        if start_key:
            kw["ExclusiveStartKey"] = start_key
        resp = ddb.query(**kw)
        for item in resp.get("Items", []):
            sk = item["sk"]["S"]
            if not sk.startswith("FOLDER#"):
                continue
            fid = sk[7:]
            name = item.get("name", {}).get("S", "")
            out.append({"id": fid, "name": name, "senders": [v["S"] for v in item.get("senders", {}).get("L", [])]})
        start_key = resp.get("LastEvaluatedKey")
        if not start_key:
            break
    out.sort(key=lambda x: (x["name"] or "").lower())
    return _response(200, {"folders": out})


def create_user_folder(user_email: str, payload: dict) -> dict:
    name = payload.get('name')
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 500:
        return _response(400, {'error': 'Folder name must be between 1 and 500 characters'})
    name = name.strip()
    try:
        senders = mail_rules.addresses(payload.get('senders', []))
        fid = str(uuid.UUID(payload['requestId'])) if payload.get('requestId') else str(uuid.uuid4())
    except (ValueError, TypeError, AttributeError):
        return _response(400, {'error': 'Enter email addresses or domain rules (maximum 20)'})
    pk = _pk(user_email)
    existing = ddb.get_item(TableName=METADATA_TABLE, Key={'pk': {'S': pk}, 'sk': {'S': f'FOLDER#{fid}'}}, ConsistentRead=True).get('Item')
    if existing:
        old_senders = [v['S'] for v in existing.get('senders', {}).get('L', [])]
        if existing['name']['S'] == name and set(old_senders) == set(senders):
            return _response(200, {'id': fid, 'name': name, 'senders': senders})
        return _response(409, {'error': 'This folder request was already used; close and reopen the form'})
    item = {'pk': {'S': pk}, 'sk': {'S': f'FOLDER#{fid}'}, 'name': {'S': name},
            'created_ts': {'N': str(int(time.time()))}, 'senders': {'L': [{'S': v} for v in senders]}}
    writes = [{'Put': {'TableName': METADATA_TABLE, 'Item': item, 'ConditionExpression': 'attribute_not_exists(pk)'}}]
    for sender in senders:
        writes.append({'Put': {'TableName': METADATA_TABLE, 'Item': {
            'pk': {'S': pk}, 'sk': {'S': 'RULE#FROM#' + sender}, 'folder_id': {'S': fid}},
            'ConditionExpression': 'attribute_not_exists(pk)'}})
    try:
        ddb.transact_write_items(TransactItems=writes)
    except ddb.exceptions.TransactionCanceledException as exc:
        if any(r.get('Code') == 'ConditionalCheckFailed' for r in exc.response.get('CancellationReasons', [])):
            return _response(409, {'error': 'A sender rule is already linked to another folder'})
        raise
    return _response(200, {'id': fid, 'name': name, 'senders': senders})


def update_folder_senders(user_email: str, payload: dict) -> dict:
    try:
        fid = str(uuid.UUID(payload.get('folderId', '')))
        senders = mail_rules.addresses(payload.get('senders'))
    except (ValueError, TypeError, AttributeError):
        return _response(400, {'error': 'Enter a valid folder and up to 20 email or domain rules'})
    pk = _pk(user_email)
    key = {'pk': {'S': pk}, 'sk': {'S': 'FOLDER#' + fid}}
    folder = ddb.get_item(TableName=METADATA_TABLE, Key=key, ConsistentRead=True).get('Item')
    if not folder:
        return _response(404, {'error': 'Folder not found'})
    name = payload.get('name', folder['name']['S'])
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 500:
        return _response(400, {'error': 'Folder name must be between 1 and 500 characters'})
    name = name.strip()
    if 'expectedName' in payload and payload['expectedName'] != folder['name']['S']:
        return _response(409, {'error': 'The folder name changed elsewhere. Refresh and retry.'})
    previous = {v['S'] for v in folder.get('senders', {}).get('L', [])}
    values = {':new': {'L': [{'S': address} for address in senders]}}
    condition = 'attribute_exists(pk) AND attribute_not_exists(senders)'
    if 'senders' in folder:
        values[':old'] = folder['senders']
        condition = 'attribute_exists(pk) AND senders = :old'
    values.update({':newName': {'S': name}, ':oldName': folder['name']})
    condition += ' AND #n = :oldName'
    writes = [{'Update': {'TableName': METADATA_TABLE, 'Key': key,
        'UpdateExpression': 'SET senders = :new, #n = :newName', 'ExpressionAttributeNames': {'#n': 'name'},
        'ExpressionAttributeValues': values, 'ConditionExpression': condition}}]
    for address in sorted(set(senders) - previous):
        writes.append({'Put': {'TableName': METADATA_TABLE, 'Item': {
            'pk': {'S': pk}, 'sk': {'S': 'RULE#FROM#' + address}, 'folder_id': {'S': fid}},
            'ConditionExpression': 'attribute_not_exists(pk)'}})
    for address in sorted(previous - set(senders)):
        writes.append({'Delete': {'TableName': METADATA_TABLE,
            'Key': {'pk': {'S': pk}, 'sk': {'S': 'RULE#FROM#' + address}},
            'ConditionExpression': 'attribute_not_exists(pk) OR folder_id = :fid',
            'ExpressionAttributeValues': {':fid': {'S': fid}}}})
    try:
        ddb.transact_write_items(TransactItems=writes)
    except ddb.exceptions.TransactionCanceledException as exc:
        if any(r.get('Code') == 'ConditionalCheckFailed' for r in exc.response.get('CancellationReasons', [])):
            return _response(409, {'error': 'A sender rule is already linked to another folder, or these rules changed. Reload and retry.'})
        raise
    return _response(200, {'id': fid, 'name': name, 'senders': senders})


def apply_folder_rule(user_email: str, payload: dict) -> dict:
    """Bounded, resumable Inbox-only batch; never scan or move another mailbox."""
    try:
        fid = str(uuid.UUID(payload.get('folderId', '')))
    except (ValueError, TypeError, AttributeError):
        return _response(400, {'error': 'Invalid folder id'})
    pk = _pk(user_email)
    folder = ddb.get_item(TableName=METADATA_TABLE, Key={'pk': {'S': pk}, 'sk': {'S': f'FOLDER#{fid}'}}, ConsistentRead=True).get('Item')
    if not folder:
        return _response(404, {'error': 'Folder not found'})
    senders = {v['S'] for v in folder.get('senders', {}).get('L', [])}
    if not senders:
        return _response(400, {'error': 'This folder has no sender rules'})
    cursor = payload.get('cursor')
    if cursor is not None and (not isinstance(cursor, str) or len(cursor) > 1024 or not cursor.startswith('MSG#INBOX#')):
        return _response(400, {'error': 'Invalid Inbox cursor'})
    kw = dict(TableName=METADATA_TABLE, KeyConditionExpression='pk = :p AND begins_with(sk, :s)',
              ExpressionAttributeValues={':p': {'S': pk}, ':s': {'S': 'MSG#INBOX#'}}, ConsistentRead=True, Limit=10)
    if cursor:
        kw['ExclusiveStartKey'] = {'pk': {'S': pk}, 'sk': {'S': cursor}}
    result = ddb.query(**kw)
    moved = 0
    checkpoint = cursor
    for item in result.get('Items', []):
        sk = item['sk']['S']
        header = item.get('from_addr', {}).get('S', '')
        if mail_rules.matches(senders, header) and mail_rules.target_folder(ddb, METADATA_TABLE, pk, header) == fid:
            response = move_message(user_email, sk, 'custom:' + fid)
            if response['statusCode'] != 200:
                return _response(200, {'moved': moved, 'nextCursor': checkpoint, 'complete': False,
                    'error': json.loads(response['body']).get('error', 'Could not move message')})
            moved += 1
        checkpoint = sk
    next_cursor = result.get('LastEvaluatedKey', {}).get('sk', {}).get('S')
    return _response(200, {'moved': moved, 'nextCursor': next_cursor, 'complete': next_cursor is None})


def delete_user_folder(user_email: str, folder_id: str) -> dict:
    fid = urllib.parse.unquote((folder_id or "").strip())
    if not fid:
        return _response(400, {"error": "folder id required"})
    try:
        store = _folder_store_segment(fid)
    except ValueError:
        return _response(400, {"error": "invalid folder id"})
    pk = _pk(user_email)
    prefix = f"MSG#{store}#"
    sks: list[str] = []
    start_key = None
    while True:
        kw = {
            "TableName": METADATA_TABLE,
            "KeyConditionExpression": "pk = :pk AND begins_with(sk, :pre)",
            "ExpressionAttributeValues": {":pk": {"S": pk}, ":pre": {"S": prefix}},
        }
        if start_key:
            kw["ExclusiveStartKey"] = start_key
        resp = ddb.query(**kw)
        for item in resp.get("Items", []):
            sks.append(item["sk"]["S"])
        start_key = resp.get("LastEvaluatedKey")
        if not start_key:
            break
    for sk in sks:
        mv = move_message(user_email, sk, "inbox")
        if mv.get("statusCode") != 200:
            return mv
    folder = ddb.get_item(TableName=METADATA_TABLE, Key={'pk': {'S': pk}, 'sk': {'S': f'FOLDER#{fid}'}}, ConsistentRead=True).get('Item', {})
    folder_delete = {'TableName': METADATA_TABLE, 'Key': {'pk': {'S': pk}, 'sk': {'S': f'FOLDER#{fid}'}}}
    if 'senders' in folder:
        folder_delete.update(ConditionExpression='senders = :old', ExpressionAttributeValues={':old': folder['senders']})
    else:
        folder_delete['ConditionExpression'] = 'attribute_not_exists(senders)'
    deletes = [{'Delete': folder_delete}]
    for sender in folder.get('senders', {}).get('L', []):
        deletes.append({'Delete': {'TableName': METADATA_TABLE, 'Key': {'pk': {'S': pk}, 'sk': {'S': 'RULE#FROM#' + sender['S']}}}})
    try:
        ddb.transact_write_items(TransactItems=deletes)
    except ddb.exceptions.TransactionCanceledException as exc:
        if any(r.get('Code') == 'ConditionalCheckFailed' for r in exc.response.get('CancellationReasons', [])):
            return _response(409, {'error': 'Folder rules changed during deletion. Moved messages are in Inbox; retry deleting the folder.'})
        raise
    return _response(200, {"ok": True})


def _normalize_trusted_image_domain(raw: str) -> str | None:
    s = (raw or "").strip().lower().lstrip("@")
    s = re.sub(r"\s+", "", s)
    if not s or len(s) > 253:
        return None
    labels = s.split(".")
    if not labels:
        return None
    for lab in labels:
        if not lab or len(lab) > 63:
            return None
        if not re.fullmatch(r"[a-z0-9-]+", lab):
            return None
        if lab.startswith("-") or lab.endswith("-"):
            return None
    return s


def _read_trusted_image_domains_list(pk: str) -> list[str]:
    item = ddb.get_item(
        TableName=METADATA_TABLE,
        Key={"pk": {"S": pk}, "sk": {"S": PREFS_TRUSTED_IMAGE_DOMAINS_SK}},
    ).get("Item")
    if not item:
        return []
    dom_attr = item.get("domains")
    if not dom_attr or "L" not in dom_attr:
        return []
    out: list[str] = []
    for x in dom_attr.get("L", []):
        s = (x.get("S") or "").strip().lower()
        if s:
            out.append(s)
    return sorted(set(out))


def _write_trusted_image_domains_list(pk: str, domains: list[str]) -> None:
    uniq = sorted({d for d in domains if d})
    key = {"pk": {"S": pk}, "sk": {"S": PREFS_TRUSTED_IMAGE_DOMAINS_SK}}
    if not uniq:
        try:
            ddb.delete_item(TableName=METADATA_TABLE, Key=key)
        except Exception:
            pass
        return
    ddb.put_item(
        TableName=METADATA_TABLE,
        Item={
            "pk": key["pk"],
            "sk": key["sk"],
            "domains": {"L": [{"S": d} for d in uniq]},
            "updated_ts": {"N": str(int(time.time()))},
        },
    )


def get_trusted_image_domains(user_email: str) -> dict:
    pk = _pk(user_email)
    domains = _read_trusted_image_domains_list(pk)
    return _response(200, {"domains": domains})


def add_trusted_image_domain(user_email: str, payload: dict) -> dict:
    dom = _normalize_trusted_image_domain(str(payload.get("domain") or ""))
    if not dom:
        return _response(400, {"error": "invalid domain"})
    pk = _pk(user_email)
    existing = _read_trusted_image_domains_list(pk)
    if dom not in existing:
        existing.append(dom)
        _write_trusted_image_domains_list(pk, existing)
        existing = _read_trusted_image_domains_list(pk)
    return _response(200, {"domains": existing})


def remove_trusted_image_domain(user_email: str, domain_raw: str) -> dict:
    dom = _normalize_trusted_image_domain(str(domain_raw or ""))
    if not dom:
        return _response(400, {"error": "invalid domain"})
    pk = _pk(user_email)
    existing = [d for d in _read_trusted_image_domains_list(pk) if d != dom]
    _write_trusted_image_domains_list(pk, existing)
    return _response(200, {"domains": existing})


def set_trusted_image_domains(user_email: str, payload: dict) -> dict:
    raw = payload.get("domains")
    if not isinstance(raw, list):
        return _response(400, {"error": "domains array required"})
    out: list[str] = []
    for x in raw:
        d = _normalize_trusted_image_domain(str(x) if x is not None else "")
        if d:
            out.append(d)
    pk = _pk(user_email)
    _write_trusted_image_domains_list(pk, out)
    return _response(200, {"domains": _read_trusted_image_domains_list(pk)})


def lambda_handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = event.get("rawPath", "") or ""

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": _json_headers(), "body": ""}

    user_email = _user_email(event)
    if not user_email:
        return _response(403, {"error": "missing email claim"})

    qs = event.get("queryStringParameters") or {}

    if path == "/mail/folders" and method == "GET":
        return list_folders(user_email)

    if path == "/mail/messages" and method == "GET":
        folder = qs.get("folder", "inbox")
        if folder not in {*NAV_PRIMARY_STORE, "starred", "all"} and not folder.startswith("custom:"):
            return _response(400, {"error": "unknown folder"})
        try:
            # Keep the old frontend's folder-only request compatible during rollout.
            legacy = not any(name in qs for name in ("q", "unread", "includeExcluded", "cursor"))
            options = dict(query=qs.get("q", "").strip(), unread=qs.get("unread") == "true",
                           include_excluded=qs.get("includeExcluded") == "true", limit=25)
            data = mail_index.page(_pk(user_email), folder, cursor=qs.get("cursor"), **options)
            if legacy:
                messages = list(data['messages'])
                cursor = data['nextCursor']
                while cursor:
                    next_page = mail_index.page(_pk(user_email), folder, cursor=cursor, **options)
                    messages.extend(next_page['messages'])
                    cursor = next_page['nextCursor']
                data.update(messages=messages, nextCursor=None, start=1 if messages else 0, end=len(messages))
            return _response(200, data)
        except ValueError as exc:
            return _response(400, {"error": str(exc)})
        except Exception:
            return _response(503, {"error": "Mail index is temporarily unavailable. Please retry."})

    if path == "/mail/content" and method == "GET":
        sk = qs.get("s3_key") or qs.get("s3Key")
        if not sk:
            return _response(400, {"error": "s3_key required"})
        sk = urllib.parse.unquote(sk)
        return get_content(user_email, sk)

    body = _parse_json_body(event)

    if path == "/mail/user-folders" and method == "GET":
        return list_user_folders(user_email)

    if path == "/mail/trusted-image-domains" and method == "GET":
        return get_trusted_image_domains(user_email)

    if path == "/mail/trusted-image-domains" and method == "POST":
        return add_trusted_image_domain(user_email, body)

    if path == "/mail/trusted-image-domains" and method == "PUT":
        return set_trusted_image_domains(user_email, body)

    if path == "/mail/trusted-image-domains" and method == "DELETE":
        dom_q = (qs.get("domain") or body.get("domain") or "").strip()
        return remove_trusted_image_domain(user_email, dom_q)

    if path == "/mail/user-folders" and method == "POST":
        if body.get("action") == "updateSenderRule":
            return update_folder_senders(user_email, body)
        if body.get("action") == "applySenderRule":
            return apply_folder_rule(user_email, body)
        return create_user_folder(user_email, body)

    if method == "DELETE" and path.startswith("/mail/user-folders/"):
        tail = path[len("/mail/user-folders/") :].strip("/")
        if tail:
            return delete_user_folder(user_email, tail)

    if path == "/mail/messages/star" and method == "PATCH":
        sk = body.get("sk")
        starred = body.get("starred")
        if not isinstance(sk, str) or not isinstance(starred, bool):
            return _response(400, {"error": "sk and starred(boolean) required"})
        return set_starred_state(user_email, sk, starred)

    if path == "/mail/message" and method == "PATCH":
        sk_raw = body.get("sk") or qs.get("sk")
        folder = body.get("folder") or qs.get("folder")
        if not sk_raw:
            return _response(400, {"error": "sk required"})
        sk_raw = urllib.parse.unquote(str(sk_raw))
        if not folder:
            return _response(400, {"error": "folder required"})
        return move_message(user_email, sk_raw, str(folder))

    if path == "/mail/messages/read" and method == "PATCH":
        sks = body.get("sks")
        read_val = body.get("read")
        if not isinstance(sks, list):
            one = body.get("sk")
            sks = [one] if one else []
        if not isinstance(read_val, bool):
            return _response(400, {"error": "read(boolean) required"})
        return set_read_state(user_email, sks, read_val)

    if path == "/mail/message" and method == "DELETE":
        sk_raw = qs.get("sk") or body.get("sk")
        if not sk_raw:
            return _response(400, {"error": "sk required"})
        sk_raw = urllib.parse.unquote(str(sk_raw))
        return delete_message(user_email, sk_raw)

    if path == "/mail/send" and method == "POST":
        return send_outbound(user_email, body)

    return _response(404, {"error": "not found"})
