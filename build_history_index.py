#!/usr/bin/env python3
import json
from pathlib import Path

HISTORY_DIR = Path('/Users/bolo/.openclaw/workspace/zenith-history')
OUT = Path('/Users/bolo/.openclaw/workspace/zenith-dashboard-requests/history_index.json')

rows = []
if HISTORY_DIR.exists():
    for p in sorted(HISTORY_DIR.glob('*.json')):
        try:
            data = json.loads(p.read_text())
            rows.append({
                'date': p.stem,
                'updated_at': data.get('updated_at'),
                'totals': data.get('totals', {}),
                'countries': data.get('countries', []),
                'established_cvd': data.get('established_cvd', {}),
            })
        except Exception:
            pass
OUT.write_text(json.dumps(rows, indent=2))
print(OUT)
