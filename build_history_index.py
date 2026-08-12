#!/usr/bin/env python3
import json
import os
from pathlib import Path

BASE = Path(__file__).resolve().parent
DEFAULT_WORKSPACE = BASE.parent
WORKSPACE = Path(os.environ.get('WORKSPACE_ROOT', str(DEFAULT_WORKSPACE))).expanduser()
HISTORY_DIR = Path(os.environ.get('ZENITH_HISTORY_DIR', str(WORKSPACE / 'zenith-history'))).expanduser()
OUT = Path(os.environ.get('ZENITH_HISTORY_INDEX_PATH', str(BASE / 'history_index.json'))).expanduser()

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
