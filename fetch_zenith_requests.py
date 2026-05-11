#!/usr/bin/env python3
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo
import csv

import requests

WORKSPACE = Path('/Users/bolo/.openclaw/workspace')
DASH_DIR = WORKSPACE / 'zenith-dashboard-requests'
HISTORY_DIR = WORKSPACE / 'zenith-history'
DATA_PATH = DASH_DIR / 'data.json'
CREDS_PATH = WORKSPACE / 'CREDENTIALS.md'
IGNORE_IDS_PATH = Path('/Users/bolo/ids_to_ignore.csv')
TZ = ZoneInfo('America/New_York')
LOGIN_URL = 'https://prod001.suvoda.com/Suvoda/?app=ALN-AGT01-008&ReturnUrl=%2fAlnylam_ALN-AGT01-008%2fReports%2fEnrollmentSummary'
BASE = 'https://prod001.suvoda.com'
APP_NAME = 'ALN-AGT01-008'
EXPORT_URL = 'https://irt-prod0.suvoda.com/Alnylam_ALN-AGT01-008/Reports/Report/ExportToExcel/1547f779-d6da-41a5-965d-3bf29660942d'


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


def shared_strings(zf):
    path = 'xl/sharedStrings.xml'
    if path not in zf.namelist() and 'xl\\sharedStrings.xml' in zf.namelist():
        path = 'xl\\sharedStrings.xml'
    try:
        root = ET.fromstring(zf.read(path))
    except KeyError:
        return []
    ns = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    vals = []
    for si in root.findall('x:si', ns):
        vals.append(''.join(t.text or '' for t in si.findall('.//x:t', ns)))
    return vals


def col_letter(ref):
    m = re.match(r'([A-Z]+)', ref or '')
    return m.group(1) if m else ''


def parse_sheet_rows(blob):
    with zipfile.ZipFile(BytesIO(blob)) as zf:
        sheet_path = 'xl/worksheets/sheet.xml'
        if sheet_path not in zf.namelist() and 'xl\\worksheets\\sheet.xml' in zf.namelist():
            sheet_path = 'xl\\worksheets\\sheet.xml'
        shared = shared_strings(zf)
        root = ET.fromstring(zf.read(sheet_path))
    ns = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    rows = []
    for row in root.findall('.//x:sheetData/x:row', ns):
        row_num = int(row.attrib.get('r', '0') or '0')
        cells = {}
        for c in row.findall('x:c', ns):
            ref = c.attrib.get('r', '')
            col = col_letter(ref)
            cell_type = c.attrib.get('t')
            v = c.find('x:v', ns)
            is_node = c.find('x:is', ns)
            if is_node is not None:
                value = ''.join(t.text or '' for t in is_node.findall('.//x:t', ns))
            else:
                value = '' if v is None else (v.text or '')
                if cell_type == 's' and value.isdigit() and int(value) < len(shared):
                    value = shared[int(value)]
            cells[col] = value
        rows.append((row_num, cells))
    return rows


def load_ecvd_ignore_ids():
    ids = set()
    if not IGNORE_IDS_PATH.exists():
        return ids
    with IGNORE_IDS_PATH.open(newline='') as f:
        reader = csv.reader(f)
        for row in reader:
            if not row:
                continue
            value = str(row[0]).strip()
            if not value or value.lower() == 'subject number':
                continue
            ids.add(value)
    return ids


def parse_workbook(blob):
    rows = parse_sheet_rows(blob)
    if not rows:
        raise RuntimeError('Workbook did not contain any rows')
    data_rows = [cells for row_num, cells in rows if row_num >= 6]

    by_country = {}
    by_site = {}
    overall = {
        'Screened': 0,
        'Randomized': 0,
        'In Screening': 0,
        'Screen Failed': 0,
        'End of Treatment': 0,
    }
    established_cvd = {
        'Randomized': {'yes': 0, 'total': 0},
        'In Screening': {'yes': 0, 'total': 0},
    }
    ignored_subject_ids = load_ecvd_ignore_ids()
    previous_subject_refs = {
        str(row.get('A', '')).strip()
        for row in data_rows
        if str(row.get('A', '')).strip()
    }

    for row in data_rows:
        previous_subject_number = str(row.get('A', '')).strip()
        subject_number = str(row.get('B', '')).strip()
        if subject_number and subject_number in previous_subject_refs:
            continue
        exclude_from_ecvd = subject_number in ignored_subject_ids
        site = str(row.get('C', '')).strip()
        country = str(row.get('G', '')).strip()
        status = str(row.get('H', '')).strip()
        cvd_value = str(row.get('P', '')).strip()
        if not country or not status:
            continue

        cvd_is_yes = cvd_value == 'Established CVD'

        if country not in by_country:
            by_country[country] = {
                'country': country,
                'screened': 0,
                'randomized': 0,
                'screening': 0,
                'failed': 0,
                'eot': 0,
                'ecvd_randomized_yes': 0,
                'ecvd_randomized_total': 0,
                'ecvd_screening_yes': 0,
                'ecvd_screening_total': 0,
            }
        rec = by_country[country]

        site_key = (country, site or 'Unknown Site')
        if site_key not in by_site:
            by_site[site_key] = {
                'country': country,
                'site': site or 'Unknown Site',
                'screened': 0,
                'randomized': 0,
                'screening': 0,
                'failed': 0,
                'eot': 0,
                'ecvd_randomized_yes': 0,
                'ecvd_randomized_total': 0,
                'ecvd_screening_yes': 0,
                'ecvd_screening_total': 0,
            }
        site_rec = by_site[site_key]

        if status == 'Screened':
            overall['In Screening'] += 1
            rec['screening'] += 1
            rec['screened'] += 1
            site_rec['screening'] += 1
            site_rec['screened'] += 1
            if not exclude_from_ecvd:
                established_cvd['In Screening']['total'] += 1
                rec['ecvd_screening_total'] += 1
                site_rec['ecvd_screening_total'] += 1
                if cvd_is_yes:
                    established_cvd['In Screening']['yes'] += 1
                    rec['ecvd_screening_yes'] += 1
                    site_rec['ecvd_screening_yes'] += 1
        elif status == 'Screen Failed':
            overall['Screen Failed'] += 1
            rec['failed'] += 1
            rec['screened'] += 1
            site_rec['failed'] += 1
            site_rec['screened'] += 1
        elif status == 'Randomized':
            overall['Randomized'] += 1
            rec['randomized'] += 1
            rec['screened'] += 1
            site_rec['randomized'] += 1
            site_rec['screened'] += 1
            if not exclude_from_ecvd:
                established_cvd['Randomized']['total'] += 1
                rec['ecvd_randomized_total'] += 1
                site_rec['ecvd_randomized_total'] += 1
                if cvd_is_yes:
                    established_cvd['Randomized']['yes'] += 1
                    rec['ecvd_randomized_yes'] += 1
                    site_rec['ecvd_randomized_yes'] += 1
        elif status == 'End of Treatment':
            overall['End of Treatment'] += 1
            rec['eot'] += 1
            rec['screened'] += 1
            site_rec['eot'] += 1
            site_rec['screened'] += 1

    overall['Screened'] = overall['In Screening'] + overall['Screen Failed'] + overall['Randomized'] + overall['End of Treatment']
    cvd_summary = {
        key: {
            'yes': vals['yes'],
            'total': vals['total'],
            'percent': round((vals['yes'] / vals['total']) * 100) if vals['total'] else None,
        }
        for key, vals in established_cvd.items()
    }
    countries = []
    for rec in by_country.values():
        rec['ecvd_randomized_percent'] = round((rec['ecvd_randomized_yes'] / rec['ecvd_randomized_total']) * 100) if rec['ecvd_randomized_total'] else None
        rec['ecvd_screening_percent'] = round((rec['ecvd_screening_yes'] / rec['ecvd_screening_total']) * 100) if rec['ecvd_screening_total'] else None
        countries.append(rec)
    countries.sort(key=lambda r: (-r['randomized'], r['country']))

    sites = []
    for rec in by_site.values():
        rec['ecvd_randomized_percent'] = round((rec['ecvd_randomized_yes'] / rec['ecvd_randomized_total']) * 100) if rec['ecvd_randomized_total'] else None
        rec['ecvd_screening_percent'] = round((rec['ecvd_screening_yes'] / rec['ecvd_screening_total']) * 100) if rec['ecvd_screening_total'] else None
        sites.append(rec)
    sites.sort(key=lambda r: (r['country'], -r['randomized'], r['site']))
    return overall, countries, sites, cvd_summary


def write_dashboard(totals, rows, sites, cvd_summary):
    payload = {
        'updated_at': datetime.now(TZ).isoformat(),
        'totals': totals,
        'countries': rows,
        'sites': sites,
        'established_cvd': cvd_summary,
    }
    DATA_PATH.write_text(json.dumps(payload, indent=2))
    return payload


def store_snapshot(payload):
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(TZ).strftime('%Y-%m-%d')
    out = HISTORY_DIR / f'{stamp}.json'
    out.write_text(json.dumps(payload, indent=2))
    import subprocess
    subprocess.check_call(['python3', str(DASH_DIR / 'build_history_index.py')])
    return out


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'refresh'
    try:
        s = login_session()
        r = s.get(EXPORT_URL, timeout=60)
        r.raise_for_status()
        totals, rows, sites, cvd_summary = parse_workbook(r.content)
        payload = write_dashboard(totals, rows, sites, cvd_summary)
        if mode == 'store':
            out = store_snapshot(payload)
            print(json.dumps({'status': 'ok', 'mode': mode, 'stored': str(out), 'data': str(DATA_PATH)}))
        else:
            print(json.dumps({'status': 'ok', 'mode': mode, 'data': str(DATA_PATH), 'totals': totals, 'countries': len(rows), 'sites': len(sites)}))
    except Exception as e:
        print(json.dumps({'status': 'error', 'mode': mode, 'error': str(e)}))
        raise


if __name__ == '__main__':
    main()
