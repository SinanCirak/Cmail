"""DynamoDB Streams -> full-text index. Failed records retry in source order."""
import os
import logging
import boto3
import mail_index

def _record_unindexable(ddb, key, item, reason):
    owner, sk = key['pk']['S'], key['sk']['S']
    # Only derived index data is removed; source metadata and raw mail are untouched.
    mail_index.remove(owner, sk)
    ddb.put_item(TableName=os.environ['METADATA_TABLE'], Item={
        'pk': {'S': f'INDEXISSUE#{owner}'},
        'sk': {'S': mail_index.document_id(owner, sk)},
        'source_pk': key['pk'], 'source_sk': key['sk'],
        'reason': {'S': reason}, 'status': {'S': 'needs_review'},
        'source_attributes': {'L': [{'S': field} for field in sorted(item)]},
    })
    logging.warning('Index skipped %s: %s', sk, reason)
    return {'status': 'skipped', 'reason': reason, 'sourceKey': key}


def sync_key(key):
    if not key['pk']['S'].startswith('MAILBOX#') or not key['sk']['S'].startswith('MSG#'):
        return {'status': 'ignored'}
    ddb = boto3.client('dynamodb')
    item = ddb.get_item(TableName=os.environ['METADATA_TABLE'], Key=key, ConsistentRead=True).get('Item')
    if not item:
        mail_index.remove(key['pk']['S'], key['sk']['S'])
        return
    s3_key = item.get('s3_key', {}).get('S')
    if not s3_key:
        if set(item) <= {'pk', 'sk', 'read', 'starred'}:
            return _record_unindexable(ddb, key, item, 'incomplete_state_only_record')
        raise ValueError('Message metadata has no s3_key; review source record before continuing')
    s3 = boto3.client('s3')
    try:
        raw = s3.get_object(Bucket=os.environ['MAIL_BUCKET'], Key=s3_key)['Body'].read()
    except s3.exceptions.NoSuchKey as exc:
        headers = exc.response.get('ResponseMetadata', {}).get('HTTPHeaders', {})
        if str(headers.get('x-amz-delete-marker', '')).lower() == 'true':
            return _record_unindexable(ddb, key, item, 'current_s3_version_is_delete_marker')
        # Missing files without a confirmed delete marker are not silently skipped.
        raise
    mail_index.upsert(item, raw)

def lambda_handler(event, context):
    if event.get('action') in ('backfill', 'backfill_status'):
        import mail_backfill
        return mail_backfill.run(event, context, sync_key)
    for record in event.get('Records', []):
        key = record['dynamodb']['Keys']
        if not key['pk']['S'].startswith('MAILBOX#') or not key['sk']['S'].startswith('MSG#'):
            continue
        try:
            sync_key(key)
        except Exception:
            logging.exception("Mail index update failed")
            # Stop at first failure so an older event cannot overwrite a newer one.
            return {'batchItemFailures': [{'itemIdentifier': record['dynamodb']['SequenceNumber']}]}
    return {'batchItemFailures': []}
