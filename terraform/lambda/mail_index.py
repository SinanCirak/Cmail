"""DynamoDB inverted word index and date-ordered mailbox views; no search server."""
import base64
import gzip
import hashlib
import json
import os
import re
import time
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser

import boto3

FOLDERS = {"INBOX": "inbox", "Sent_Items": "sent", "Sent_Messages": "sent", "Sent": "sent", "Drafts": "drafts", "Archive": "archive", "Junk_Email": "spam", "Junk": "spam", "Deleted_Items": "trash", "Deleted_Messages": "trash", "Trash": "trash"}

class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

def document_id(owner, sk):
    return hashlib.sha256(f"{owner}:{sk}".encode()).hexdigest()

def words(text):
    import unicodedata
    normalized = ''.join(c for c in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(c))
    return set(re.findall(r"[^\W_]+", normalized, re.UNICODE))

def make_document(item, raw):
    get = lambda field, default="": item.get(field, {}).get("S", default)
    owner, sk, store = get("pk"), get("sk"), get("folder")
    if not sk.startswith("MSG#"):
        return
    folder = FOLDERS.get(store, "custom:" + store[2:].lower() if store.startswith("UF") else "")
    if not folder:
        return
    msg = BytesParser(policy=policy.default).parsebytes(raw)
    part = msg.get_body(preferencelist=("html", "plain"))
    body = ""
    if part:
        try:
            body = part.get_content()
            if part.get_content_type() == "text/html":
                parser = PlainText()
                parser.feed(body)
                body = " ".join(parser.parts)
        except (LookupError, UnicodeError):
            body = ""
    subject, sender = get("subject"), get("from_addr")
    ts = int(item.get("sort_ts", {}).get("N", "0"))
    starred = bool(item.get("starred", {}).get("BOOL", False))
    read = bool(item.get("read", {}).get("BOOL", store != "INBOX"))
    from email.utils import parseaddr
    from datetime import datetime, timezone
    name, address = parseaddr(sender)
    identity = document_id(owner, sk)
    row = {"id": sk, "folder": folder, "subject": subject or "(No subject)", "snippet": " ".join(body.split())[:160],
           "from": {"name": name or address, "email": address}, "sentAt": datetime.fromtimestamp(ts, timezone.utc).isoformat(),
           "read": read, "starred": starred, "s3Key": get("s3_key"),
           "hasAttachment": any(p.get_content_disposition() == "attachment" for p in msg.walk())}
    text = " ".join([subject, sender, str(msg.get("To", "")), str(msg.get("Cc", "")), str(msg.get("Bcc", "")), body])
    doc = {"id": identity, "owner": owner, "folder": folder, "ts": ts, "starred": starred, "unread": not read, "text": text, "row": row}
    return doc

_clients = None

def resources():
    global _clients
    if _clients is None:
        _clients = (boto3.client('dynamodb'), os.environ['METADATA_TABLE'], boto3.client('s3'))
    return _clients

def manifest_key(identity):
    return f"search-index/{identity}.json.gz"

def read_manifest(identity):
    _, _, s3 = resources()
    try:
        raw = s3.get_object(Bucket=os.environ['MAIL_BUCKET'], Key=manifest_key(identity))['Body'].read()
        return json.loads(gzip.decompress(raw))
    except s3.exceptions.NoSuchKey:
        return {'terms': [], 'views': []}

def write_manifest(identity, value):
    _, _, s3 = resources()
    s3.put_object(Bucket=os.environ['MAIL_BUCKET'], Key=manifest_key(identity),
                  Body=gzip.compress(json.dumps(value).encode()), ContentType='application/gzip', ServerSideEncryption='AES256')

def term_pk(owner, term):
    return f"TERM#{owner}#" + hashlib.sha256(term.encode()).hexdigest()

def batch_write(requests):
    ddb, table, _ = resources()
    for offset in range(0, len(requests), 25):
        pending = {table: requests[offset:offset + 25]}
        for attempt in range(9):
            pending = ddb.batch_write_item(RequestItems=pending).get('UnprocessedItems', {})
            if not pending:
                break
            time.sleep(min(0.05 * 2 ** attempt, 2))
        if pending:
            raise RuntimeError('Search index writes throttled; retry required')

def view_key(owner, view, sort_key):
    return {'pk': {'S': f'VIEW#{owner}#{view}'}, 'sk': {'S': sort_key}}

def update_view(owner, view, sort_key, doc=None):
    ddb, table, _ = resources()
    key = view_key(owner, view, sort_key)
    change = 1 if doc else -1
    operation = {'Put': {'TableName': table, 'Item': {**key, 'doc': {'S': json.dumps(doc)}},
                         'ConditionExpression': 'attribute_not_exists(pk)'}} if doc else {
        'Delete': {'TableName': table, 'Key': key, 'ConditionExpression': 'attribute_exists(pk)'}}
    try:
        ddb.transact_write_items(TransactItems=[operation, {'Update': {
            'TableName': table, 'Key': {'pk': {'S': f'COUNT#{owner}'}, 'sk': {'S': view}},
            'UpdateExpression': 'ADD #n :delta', 'ExpressionAttributeNames': {'#n': 'total'},
            'ExpressionAttributeValues': {':delta': {'N': str(change)}},
        }}])
    except ddb.exceptions.TransactionCanceledException as exc:
        reasons = exc.response.get('CancellationReasons', [])
        if not reasons or reasons[0].get('Code') != 'ConditionalCheckFailed' or any(r.get('Code') not in ('None', 'ConditionalCheckFailed') for r in reasons):
            raise
        if doc:
            # Existing membership: update metadata without incrementing the counter twice.
            ddb.put_item(TableName=table, Item={**key, 'doc': {'S': json.dumps(doc)}})

def upsert(item, raw):
    doc = make_document(item, raw)
    if not doc:
        return
    owner, identity = doc['owner'], doc['id']
    old = read_manifest(identity)
    terms = sorted(words(doc.pop('text')))
    folder = doc['folder']
    scopes = {folder, 'all+'}
    if folder not in ('spam', 'trash'):
        scopes.add('all')
        if doc['starred']:
            scopes.add('starred')
    if doc['unread']:
        scopes |= {scope + ':unread' for scope in scopes.copy()}
    sort_key = f"{doc['ts']:020d}#{identity}"
    views = [[scope, sort_key] for scope in sorted(scopes)]
    # Save recovery information BEFORE changing memberships. Retrying repairs partial writes.
    staged = {'terms': sorted(set(old['terms']) | set(terms)),
              'views': [list(pair) for pair in set(map(tuple, old['views'])) | set(map(tuple, views))], 'owner': owner}
    write_manifest(identity, staged)
    requests = [{'PutRequest': {'Item': {'pk': {'S': term_pk(owner, term)}, 'sk': {'S': identity}}}} for term in terms]
    requests += [{'DeleteRequest': {'Key': {'pk': {'S': term_pk(owner, term)}, 'sk': {'S': identity}}}} for term in set(old['terms']) - set(terms)]
    ddb, table, _ = resources()
    ddb.put_item(TableName=table, Item={'pk': {'S': f'DOC#{owner}'}, 'sk': {'S': identity}, 'doc': {'S': json.dumps(doc)}})
    batch_write(requests)
    for view, key in views:
        update_view(owner, view, key, doc)
    for view, key in set(map(tuple, old['views'])) - set(map(tuple, views)):
        update_view(owner, view, key)
    write_manifest(identity, {'terms': terms, 'views': views, 'owner': owner})

def remove(owner, sk):
    identity = document_id(owner, sk)
    old = read_manifest(identity)
    batch_write([{'DeleteRequest': {'Key': {'pk': {'S': term_pk(owner, term)}, 'sk': {'S': identity}}}} for term in old['terms']])
    for view, key in old['views']:
        update_view(owner, view, key)
    ddb, table, s3 = resources()
    ddb.delete_item(TableName=table, Key={'pk': {'S': f'DOC#{owner}'}, 'sk': {'S': identity}})
    s3.delete_object(Bucket=os.environ['MAIL_BUCKET'], Key=manifest_key(identity))

def query_all(pk):
    ddb, table, _ = resources()
    kwargs = {'TableName': table, 'KeyConditionExpression': 'pk = :p', 'ExpressionAttributeValues': {':p': {'S': pk}}, 'ConsistentRead': True}
    while True:
        result = ddb.query(**kwargs)
        yield from result.get('Items', [])
        if not result.get('LastEvaluatedKey'):
            break
        kwargs['ExclusiveStartKey'] = result['LastEvaluatedKey']

def documents(owner, identities):
    ddb, table, _ = resources()
    keys = [{'pk': {'S': f'DOC#{owner}'}, 'sk': {'S': identity}} for identity in identities]
    for offset in range(0, len(keys), 100):
        pending = {table: {'Keys': keys[offset:offset + 100], 'ConsistentRead': True}}
        for attempt in range(9):
            response = ddb.batch_get_item(RequestItems=pending)
            for item in response.get('Responses', {}).get(table, []):
                yield json.loads(item['doc']['S'])
            pending = response.get('UnprocessedKeys', {})
            if not pending:
                break
            time.sleep(min(0.05 * 2 ** attempt, 2))
        if pending:
            raise RuntimeError('Search reads throttled; retry required')

def page(owner, folder, query='', unread=False, include_excluded=False, cursor=None, limit=25):
    if folder.startswith('custom:'):
        folder_id = folder[7:].replace('-', '').lower()
        if not re.fullmatch(r'[0-9a-f]{32}', folder_id):
            raise ValueError('Invalid custom folder id')
        folder = 'custom:' + folder_id
    if len(query) > 300:
        raise ValueError('Search is limited to 300 characters')
    fingerprint = hashlib.sha256(json.dumps([owner, folder, query, unread, include_excluded, limit]).encode()).hexdigest()
    after, offset = None, 0
    if cursor:
        try:
            if len(cursor) > 2048:
                raise ValueError()
            value = json.loads(base64.urlsafe_b64decode(cursor))
            after, offset = value['after'], value['offset']
            if value['query'] != fingerprint or type(offset) is not int or offset < 0 or not re.fullmatch(r'[0-9]{20}#[0-9a-f]{64}', after):
                raise ValueError()
        except Exception as exc:
            raise ValueError('Invalid pagination cursor') from exc
    counter_rows = list(query_all(f'COUNT#{owner}'))
    counters = {row['sk']['S']: int(row.get('total', {}).get('N', '0')) for row in counter_rows}
    counts = {key: count for key, count in counters.items() if key not in ('all', 'all+') and not key.endswith(':unread')}
    unread_counts = {key[:-7]: count for key, count in counters.items() if key.endswith(':unread')}
    scope = 'all+' if folder == 'all' and include_excluded else folder
    if unread:
        scope += ':unread'
    ddb, table, _ = resources()
    if query.strip():
        terms = sorted(words(query))
        candidates = None
        # Each Query reads only postings for a search word, never the whole mailbox.
        for term in terms:
            postings = {row['sk']['S'] for row in query_all(term_pk(owner, term))}
            candidates = postings if candidates is None else candidates & postings
            if not candidates:
                break
        matches = []
        for doc in documents(owner, candidates or set()):
            if doc['owner'] != owner:
                continue
            if folder == 'starred' and (not doc['starred'] or doc['folder'] in ('spam', 'trash')):
                continue
            if folder not in ('all', 'starred') and doc['folder'] != folder:
                continue
            if folder == 'all' and not include_excluded and doc['folder'] in ('spam', 'trash'):
                continue
            if unread and not doc['unread']:
                continue
            matches.append(doc)
        matches.sort(key=lambda doc: (doc['ts'], doc['id']), reverse=True)
        total = len(matches)
        if after:
            matches = [doc for doc in matches if f"{doc['ts']:020d}#{doc['id']}" < after]
        docs = matches[:limit + 1]
    else:
        total = counters.get(scope, 0)
        values = {':p': {'S': f'VIEW#{owner}#{scope}'}}
        condition = 'pk = :p'
        if after:
            condition += ' AND sk < :after'
            values[':after'] = {'S': after}
        result = ddb.query(TableName=table, KeyConditionExpression=condition, ExpressionAttributeValues=values,
                           ScanIndexForward=False, Limit=limit + 1, ConsistentRead=True)
        docs = [json.loads(row['doc']['S']) for row in result.get('Items', [])]
    has_more = len(docs) > limit
    docs = docs[:limit]
    next_cursor = None
    if has_more:
        last = docs[-1]
        next_cursor = base64.urlsafe_b64encode(json.dumps({'query': fingerprint, 'after': f"{last['ts']:020d}#{last['id']}", 'offset': offset + len(docs)}).encode()).decode()
    return {'messages': [doc['row'] for doc in docs], 'total': total, 'nextCursor': next_cursor,
            'start': offset + 1 if docs else 0, 'end': offset + len(docs) if docs else 0,
            'counts': counts, 'unreadCounts': unread_counts, 'unreadInbox': counters.get('inbox:unread', 0)}
