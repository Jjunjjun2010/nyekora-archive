#!/usr/bin/env python3
import json
import re
from pathlib import Path
from collections import Counter

ROOT = Path('.')
SRC_HTML = ROOT / 'nyekora-archive (1).html'
ENTRIES_JSON = ROOT / 'entries(2).json'
SOURCES_JSON = ROOT / 'sources(1).json'
CATEGORIES_JSON = ROOT / 'categories.json'
OUT_DIR = ROOT / 'stage3'

WORK_HTML = OUT_DIR / 'nyekora-archive.stage3.work.html'
RELEASE_HTML = OUT_DIR / 'nyekora-archive.stage3.release.html'
DATA_JS = OUT_DIR / 'nyekora-data.js'
APP_CORE_JS = OUT_DIR / 'nyekora-app-core.js'
VALIDATION = OUT_DIR / 'VALIDATION_STAGE3.txt'


def to_app_shape(entry: dict) -> dict:
    obj = {
        'id': entry['id'],
        't': entry['title'],
        'c': entry['category'],
        's': entry['status'],
        'v': 1 if entry['verification'] == 'primary_source' else 2,
        'claim': entry['claim'],
        'src': [[s['sourceId'], s['locator']] for s in entry['sources']],
        'tags': entry['tags'],
    }
    if 'lang' in entry:
        obj['lg'] = entry['lang']
    if 'examples' in entry:
        obj['ex'] = entry['examples']
    if 'sourceHint' in entry:
        obj['hint'] = entry['sourceHint']
    if 'decision' in entry and isinstance(entry['decision'], dict) and 'note' in entry['decision']:
        obj['dec'] = entry['decision']['note']
    if 'revisionRequest' in entry:
        obj['rq'] = entry['revisionRequest']
    if 'conflict' in entry and isinstance(entry['conflict'], dict):
        obj['conf'] = [[p['claim'], p['sourceId']] for p in entry['conflict'].get('positions', [])]
        resolution = entry['conflict'].get('resolution')
        if isinstance(resolution, dict) and 'note' in resolution:
            obj['res'] = resolution['note']
    return obj



def main():
    OUT_DIR.mkdir(exist_ok=True)

    html = SRC_HTML.read_text(encoding='utf-8')
    entries = json.loads(ENTRIES_JSON.read_text(encoding='utf-8'))
    sources = json.loads(SOURCES_JSON.read_text(encoding='utf-8'))
    cats_raw = json.loads(CATEGORIES_JSON.read_text(encoding='utf-8'))

    script_match = re.search(r'<script>\n(.*)</script>', html, re.S)
    if not script_match:
        raise RuntimeError('Could not find inline <script> block in source HTML.')
    full_js = script_match.group(1)

    marker = 'let E=SEED.slice();'
    idx = full_js.index(marker)
    app_core = full_js[idx:]
    APP_CORE_JS.write_text(app_core + '\n', encoding='utf-8')

    cats = {c['id']: c['name'] for c in cats_raw['categories']}
    catnote = {c['id']: c.get('note', '') for c in cats_raw['categories']}
    src_map = {s['id']: (s.get('label') or s.get('title') or s['id']) for s in sources}
    if 'creator-decision-app' not in src_map:
        src_map['creator-decision-app'] = '작성자 결정 (기록관 편집 기능)'

    seed = [to_app_shape(e) for e in entries]

    resolved_notes = [
        e.get('conflict', {}).get('resolution', {}).get('note')
        for e in entries
        if isinstance(e.get('conflict'), dict) and isinstance(e['conflict'].get('resolution'), dict)
    ]
    resolved_notes = [n for n in resolved_notes if isinstance(n, str) and n.strip()]
    res_value = Counter(resolved_notes).most_common(1)[0][0] if resolved_notes else ''

    data_js = '\n'.join([
        'const CATS=' + json.dumps(cats, ensure_ascii=False, separators=(',', ':')) + ';',
        'const CATNOTE=' + json.dumps(catnote, ensure_ascii=False, separators=(',', ':')) + ';',
        'const SRC=' + json.dumps(src_map, ensure_ascii=False, separators=(',', ':')) + ';',
        'const RES=' + json.dumps(res_value, ensure_ascii=False) + ';',
        'const SEED=' + json.dumps(seed, ensure_ascii=False, separators=(',', ':')) + ';',
        '',
    ])
    DATA_JS.write_text(data_js, encoding='utf-8')

    replacement = '<script src="./nyekora-data.js"></script>\n<script src="./nyekora-app-core.js"></script>'
    work_html = html[:script_match.start()] + replacement + html[script_match.end():]
    WORK_HTML.write_text(work_html, encoding='utf-8')

    release_inline = f'<script>\n{data_js}{app_core}\n</script>'
    release_html = html[:script_match.start()] + release_inline + html[script_match.end():]
    RELEASE_HTML.write_text(release_html, encoding='utf-8')

    # ---- validation
    checks = []
    def chk(name: str, ok: bool, detail=''):
        checks.append(('PASS ' if ok else 'FAIL ') + name + (f' | {detail}' if detail != '' else ''))

    chk('entries count = 133', len(entries) == 133, len(entries))
    chk('SEED count = 133', len(seed) == 133, len(seed))
    chk('SEED order equals entries(2).json order', [e['id'] for e in seed] == [e['id'] for e in entries])
    chk('CATS count = 6', len(cats) == 6, len(cats))
    chk('CATNOTE count = 6', len(catnote) == 6, len(catnote))
    chk('generated SRC includes creator-decision-app', 'creator-decision-app' in src_map)

    source_ids = {s['id'] for s in sources}
    missing = sorted({s['sourceId'] for e in entries for s in e['sources']} - source_ids)
    chk('all entry sourceId exist in sources(1).json', not missing, missing[:5])

    conflict_missing = sorted({p['sourceId'] for e in entries for p in e.get('conflict', {}).get('positions', [])} - source_ids)
    chk('all conflict sourceId exist in sources(1).json', not conflict_missing, conflict_missing[:5])

    core = APP_CORE_JS.read_text(encoding='utf-8')
    chk('localStorage key preserved', 'const KEY="nyekora-archive:v1:db"' in core)
    chk('approve/reject/resolve actions preserved', all(x in core for x in ['approve', 'reject', 'resolve', 'restore', 'doImp', 'doReset']))
    chk('app core extracted from original without logic edits', core.strip() == app_core.strip())
    chk('data JS safe for embed (no </script or <!--)', ('</script' not in data_js.lower()) and ('<!--' not in data_js))

    chk('work html generated', WORK_HTML.exists())
    chk('release html generated', RELEASE_HTML.exists())

    fails = sum(1 for c in checks if c.startswith('FAIL'))
    VALIDATION.write_text('\n'.join(checks) + f'\n\nFAILS: {fails}\n', encoding='utf-8')

    print('\n'.join(checks))
    print('FAILS:', fails)
    print('Generated:', WORK_HTML, RELEASE_HTML, DATA_JS, APP_CORE_JS, VALIDATION)


if __name__ == '__main__':
    main()
