#!/usr/bin/env python3
import json
import os
from pathlib import Path

BASE = Path(__file__).resolve().parent
DEFAULT_WORKSPACE = BASE.parent
WORKSPACE = Path(os.environ.get('WORKSPACE_ROOT', str(DEFAULT_WORKSPACE))).expanduser()
HISTORY_DIR = Path(os.environ.get('ZENITH_HISTORY_DIR', str(WORKSPACE / 'zenith-history'))).expanduser()
OUT = Path(os.environ.get('ZENITH_HISTORY_INDEX_PATH', str(BASE / 'history_index.json'))).expanduser()


def normalize_calculation_version(data):
    """Make pre-v2 snapshots use the current EOT-is-randomized definition."""
    if data.get('calculation_version', 1) >= 2:
        return data

    totals = data.get('totals', {})
    totals['Randomized'] = totals.get('Randomized', 0) + totals.get('End of Treatment', 0)
    for row in data.get('countries', []):
        row['randomized'] = row.get('randomized', 0) + row.get('eot', 0)
    return data

rows = []
if HISTORY_DIR.exists():
    for p in sorted(HISTORY_DIR.glob('*.json')):
        try:
            data = normalize_calculation_version(json.loads(p.read_text()))
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
