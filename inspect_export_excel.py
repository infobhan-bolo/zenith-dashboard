#!/usr/bin/env python3
import json
import re
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin
import zipfile
import xml.etree.ElementTree as ET

import requests

WORKSPACE = Path('/Users/bolo/.openclaw/workspace')
CREDS_PATH = WORKSPACE / 'CREDENTIALS.md'
OUT_PATH = WORKSPACE / 'zenith-dashboard-requests' / 'export_probe.json'
EXPORT_URL = 'https://irt-prod0.suvoda.com/Alnylam_ALN-AGT01-008/Reports/Report/ExportToExcel/1547f779-d6da-41a5-965d-3bf29660942d'
LOGIN_URL = 'https://prod001.suvoda.com/Suvoda/?app=ALN-AGT01-008&ReturnUrl=%2fAlnylam_ALN-AGT01-008%2fReports%2fEnrollmentSummary'
BASE = 'https://prod001.suvoda.com'
APP_NAME = 'ALN-AGT01-008'


def extract_field(text, field):
    m = re.search(rf'- {re.escape(field)}: `([^`]+)`', text)
    if not m:
        raise RuntimeError(f'Missing {field} in credentials file')
    return m.group(1)


def login_session():
    creds = CREDS_PATH.read_text()
    username = extract_field(creds, 'Username')
    password = extract_field(creds, 'Password')

    s = requests.Session()
    s.headers.update({'User-Agent': 'Mozilla/5.0'})

    r = s.get(LOGIN_URL, timeout=30)
    r.raise_for_status()
    token_match = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', r.text)
    if not token_match:
        raise RuntimeError('Could not find request verification token on login page')
    token = token_match.group(1)

    form_action_match = re.search(r'<form[^>]+action="([^"]+)"[^>]+method="post"', r.text, re.I)
    action = form_action_match.group(1) if form_action_match else LOGIN_URL
    post_url = urljoin(BASE, action)

    r2 = s.post(post_url, data={
        'username': username,
        'password': password,
        '__RequestVerificationToken': token,
        'LanguageId': 'en-US',
    }, timeout=30, allow_redirects=True)

    lower_blob = f"{r2.url}\n{r2.text}".lower()
    if 'password expired' in lower_blob and 'enrollmentsummary' not in lower_blob and 'blinded enrollment summary' not in lower_blob:
        raise RuntimeError('Suvoda appears to be on the dedicated expired-password page. Stop automation and ask Ishir to update the password.')

    apps_res = s.post(urljoin(BASE, '/Suvoda/Home/Applications_Read'), data={
        'searchText': '',
        '__RequestVerificationToken': token,
    }, headers={
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
    }, timeout=30)
    apps_res.raise_for_status()
    apps = apps_res.json()
    target = None
    for item in apps.get('Data', []):
        if item.get('Name') == APP_NAME or APP_NAME in (item.get('Url') or ''):
            target = item
            break
    if not target or not target.get('Url'):
        raise RuntimeError(f'Could not locate {APP_NAME} application URL in Applications_Read response')

    app_url = target['Url']
    landing = s.get(app_url, timeout=30, allow_redirects=True)
    landing.raise_for_status()
    return s


def col_letter(ref):
    m = re.match(r'([A-Z]+)', ref)
    return m.group(1) if m else ref


def shared_strings(zf):
    shared_path = 'xl/sharedStrings.xml'
    if shared_path not in zf.namelist() and 'xl\\sharedStrings.xml' in zf.namelist():
        shared_path = 'xl\\sharedStrings.xml'
    try:
        root = ET.fromstring(zf.read(shared_path))
    except KeyError:
        return []
    ns = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    vals = []
    for si in root.findall('x:si', ns):
        text = ''.join(t.text or '' for t in si.findall('.//x:t', ns))
        vals.append(text)
    return vals


def parse_sheet(zf, sheet_path, shared):
    actual_path = sheet_path
    if actual_path not in zf.namelist():
        alt = actual_path.replace('/', '\\')
        if alt in zf.namelist():
            actual_path = alt
    root = ET.fromstring(zf.read(actual_path))
    ns = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    rows = []
    for row in root.findall('.//x:sheetData/x:row', ns):
        current = {}
        for c in row.findall('x:c', ns):
            ref = c.attrib.get('r', '')
            col = col_letter(ref)
            cell_type = c.attrib.get('t')
            v = c.find('x:v', ns)
            if v is None:
                value = ''
            else:
                value = v.text or ''
                if cell_type == 's':
                    value = shared[int(value)] if value.isdigit() and int(value) < len(shared) else value
            current[col] = value
        rows.append(current)
    return rows


def workbook_sheets(zf):
    ns = {
        'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
        'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    }
    rel_ns = {'r': 'http://schemas.openxmlformats.org/package/2006/relationships'}
    wb = ET.fromstring(zf.read('xl/workbook.xml'))
    rels = ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'))
    rel_map = {rel.attrib['Id']: rel.attrib['Target'] for rel in rels.findall('r:Relationship', rel_ns)}
    sheets = []
    for sheet in wb.findall('x:sheets/x:sheet', ns):
        rid = sheet.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        target = rel_map.get(rid)
        if target:
            target_path = target.lstrip('/')
            if not target_path.startswith('xl/'):
                target_path = 'xl/' + target_path
            sheets.append((sheet.attrib.get('name'), target_path))
    return sheets


def main():
    s = login_session()
    r = s.get(EXPORT_URL, timeout=60, allow_redirects=True)
    r.raise_for_status()
    content_type = r.headers.get('Content-Type', '')
    disposition = r.headers.get('Content-Disposition', '')

    out = {
        'url': r.url,
        'status_code': r.status_code,
        'content_type': content_type,
        'content_disposition': disposition,
        'content_length': len(r.content),
    }

    if not zipfile.is_zipfile(BytesIO(r.content)):
        out['error'] = 'Response is not an xlsx zip file'
        out['text_head'] = r.text[:1000]
        OUT_PATH.write_text(json.dumps(out, indent=2))
        print(json.dumps(out, indent=2))
        return

    with zipfile.ZipFile(BytesIO(r.content)) as zf:
        out['zip_entries_head'] = zf.namelist()[:40]
        shared = shared_strings(zf)
        sheets = workbook_sheets(zf)
        out['sheets'] = []
        for name, path in sheets:
            rows = parse_sheet(zf, path, shared)
            nonempty = [row for row in rows if any(v != '' for v in row.values())]
            out['sheets'].append({
                'name': name,
                'path': path,
                'row_count': len(nonempty),
                'sample_rows': nonempty[:12],
            })

    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
