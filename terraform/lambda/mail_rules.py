"""Mailbox-scoped exact email, @domain, and *.subdomain sender rules."""
import re
from email.utils import getaddresses


def _domain(value):
    if not isinstance(value, str) or len(value) > 253 or '.' not in value:
        raise ValueError('Use a complete domain such as linkedin.com')
    labels = value.lower().split('.')
    if any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in labels):
        raise ValueError('Invalid domain')
    if not re.fullmatch(r'[a-z]{2,63}', labels[-1]):
        raise ValueError('Invalid domain suffix')
    return '.'.join(labels)


def _email(value):
    if not isinstance(value, str) or len(value) > 254 or value.count('@') != 1:
        raise ValueError('Invalid sender address')
    local, domain = value.lower().split('@')
    if not re.fullmatch(r"[a-z0-9.!#$%&'+/=?^_`{|}~-]+", local) or local.startswith('.') or local.endswith('.') or '..' in local:
        raise ValueError('Invalid sender address')
    return local + '@' + _domain(domain)


def addresses(values):
    """Retain the existing field/key format for backward-compatible rule storage."""
    if not isinstance(values, list) or len(values) > 20:
        raise ValueError('Enter up to 20 email or domain rules')
    result = []
    for value in values:
        if not isinstance(value, str):
            raise ValueError('Sender rules must be text')
        value = value.strip().lower()
        if value.startswith('*.'):
            rule = '*.' + _domain(value[2:])
        elif value.startswith('@'):
            rule = '@' + _domain(value[1:])
        elif '@' in value:
            rule = _email(value)
        else:
            rule = '@' + _domain(value)
        if rule not in result:
            result.append(rule)
    return result


def sender_address(header):
    pairs = getaddresses([str(header or '')])
    if len(pairs) != 1:
        return ''
    try:
        return _email(pairs[0][1])
    except ValueError:
        return ''


def candidates(header):
    """Exact address, exact domain, then nearest wildcard parent first."""
    sender = sender_address(header)
    if not sender:
        return []
    domain = sender.split('@')[1]
    labels = domain.split('.')
    return [sender, '@' + domain] + ['*.' + '.'.join(labels[i:]) for i in range(1, len(labels) - 1)]


def matches(rules, header):
    return bool(set(rules) & set(candidates(header)))


def target_folder(ddb, table, owner, header):
    for candidate in candidates(header):
        rule = ddb.get_item(TableName=table, Key={'pk': {'S': owner}, 'sk': {'S': 'RULE#FROM#' + candidate}}, ConsistentRead=True).get('Item', {})
        fid = rule.get('folder_id', {}).get('S', '')
        if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', fid):
            continue
        folder = ddb.get_item(TableName=table, Key={'pk': {'S': owner}, 'sk': {'S': 'FOLDER#' + fid}}, ConsistentRead=True).get('Item')
        if folder and candidate in {v['S'] for v in folder.get('senders', {}).get('L', [])}:
            return fid
    return None
