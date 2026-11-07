"""Manual-console, resumable mailbox indexing. Never edits source messages/folders."""
import json
import logging
import re
import time
import uuid

import mail_index

MAX_PER_RUN = 50
BUDGET_SECONDS = 45

def run(event, context, sync_key):
    mailbox = str(event.get('mailbox') or '').strip().lower()
    job_id = str(event.get('jobId') or '')
    if not re.fullmatch(r'[^\s@]+@[^\s@]+', mailbox) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', job_id):
        raise ValueError('Valid mailbox and jobId are required')
    owner = 'MAILBOX#' + re.sub(r'[^\w@.-]+', '_', mailbox)[:200]
    ddb, table, _ = mail_index.resources()
    job_key = {'pk': {'S': f'INDEXJOB#{owner}'}, 'sk': {'S': 'BACKFILL#v1'}}
    stored = ddb.get_item(TableName=table, Key=job_key, ConsistentRead=True).get('Item', {})
    state = json.loads(stored.get('state', {}).get('S', '{}')) or {
        'jobId': job_id, 'mailbox': mailbox, 'processedTotal': 0, 'cursor': None, 'status': 'ready',
    }
    if state['jobId'] != job_id:
        raise ValueError('A different backfill job already exists for this mailbox; use its original jobId')
    skipped_run = 0
    def result(status, processed=0, **extra):
        return {'status': status, 'mailbox': mailbox, 'jobId': job_id,
                'processedThisRun': processed, 'processedTotal': state['processedTotal'],
                'skippedThisRun': skipped_run, 'skippedTotal': state.get('skippedTotal', 0),
                'indexedTotal': state['processedTotal'] - state.get('skippedTotal', 0), **extra}
    if event.get('action') == 'backfill_status':
        return result(state['status'])
    if state.get('status') == 'complete':
        return result('complete')
    lease = uuid.uuid4().hex
    remaining_ms = context.get_remaining_time_in_millis() if context else 120000
    try:
        ddb.update_item(TableName=table, Key=job_key,
            UpdateExpression='SET lease_owner = :owner, lease_until = :until',
            ConditionExpression='attribute_not_exists(lease_until) OR lease_until < :now',
            ExpressionAttributeValues={':owner': {'S': lease}, ':until': {'N': str(int(time.time()) + int(remaining_ms / 1000) + 30)}, ':now': {'N': str(int(time.time()))}})
    except ddb.exceptions.ConditionalCheckFailedException:
        return result('in_progress')
    # Re-read under the lease: another run may have completed between initial read/acquire.
    locked = ddb.get_item(TableName=table, Key=job_key, ConsistentRead=True).get('Item', {})
    state = json.loads(locked.get('state', {}).get('S', '{}')) or state
    processed = 0
    deadline = time.monotonic() + BUDGET_SECONDS
    failed_key = None
    def checkpoint():
        ddb.update_item(TableName=table, Key=job_key,
            UpdateExpression='SET #state = :value', ConditionExpression='lease_owner = :owner',
            ExpressionAttributeNames={'#state': 'state'},
            ExpressionAttributeValues={':value': {'S': json.dumps(state)}, ':owner': {'S': lease}})
    try:
        if state['jobId'] != job_id:
            raise ValueError('Job ID changed; use the original jobId')
        if state.get('status') == 'complete':
            return result('complete')
        state['status'] = 'running'
        checkpoint()
        while processed < MAX_PER_RUN and time.monotonic() < deadline:
            if context and context.get_remaining_time_in_millis() < 15000:
                break
            options = {'TableName': table,
                'KeyConditionExpression': 'pk = :p AND begins_with(sk, :s)',
                'ExpressionAttributeValues': {':p': {'S': owner}, ':s': {'S': 'MSG#'}},
                'ProjectionExpression': 'pk, sk', 'ConsistentRead': True, 'Limit': 10}
            if state['cursor']:
                options['ExclusiveStartKey'] = state['cursor']
            page = ddb.query(**options)
            items = page.get('Items', [])
            for item in items:
                if processed >= MAX_PER_RUN or time.monotonic() >= deadline or (context and context.get_remaining_time_in_millis() < 15000):
                    state['status'] = 'more'
                    checkpoint()
                    return result('more', processed)
                failed_key = {'pk': item['pk'], 'sk': item['sk']}
                outcome = sync_key(failed_key)
                if outcome and outcome.get('status') == 'skipped':
                    skipped_run += 1
                    state['skippedTotal'] = state.get('skippedTotal', 0) + 1
                state['processedTotal'] += 1
                processed += 1
                state['cursor'] = failed_key
                checkpoint()
                failed_key = None
            if not page.get('LastEvaluatedKey'):
                state['status'] = 'complete'
                checkpoint()
                return result('complete', processed)
            state['cursor'] = page['LastEvaluatedKey']
            checkpoint()
        state['status'] = 'more'
        checkpoint()
        return result('more', processed)
    except Exception as exc:
        logging.exception('Manual mail backfill failed')
        state['status'] = 'error'
        checkpoint()
        return result('error', processed, failedKey=failed_key, error=str(exc))
    finally:
        try:
            ddb.update_item(TableName=table, Key=job_key,
                UpdateExpression='REMOVE lease_owner, lease_until', ConditionExpression='lease_owner = :owner',
                ExpressionAttributeValues={':owner': {'S': lease}})
        except Exception:
            logging.exception('Backfill lease release failed; lease will expire automatically')
