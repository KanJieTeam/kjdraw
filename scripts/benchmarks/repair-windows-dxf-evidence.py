"""One-time, byte-audited repair of published DXFs saved with CR-CR-LF on Windows.

Only the nine named historical ZIPs are eligible. No model request, report,
response or direct-DXF entry is regenerated; originals are backed up in .cache.
"""

import argparse
import hashlib
import os
import shutil
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARCHIVES = (
    '2026-09-28-deepseek-flash/oneshot-standard.zip',
    '2026-09-28-deepseek-flash/oneshot-compact-tool.zip',
    '2026-09-28-deepseek-flash/oneshot-json-harness-failure.zip',
    '2026-09-28-deepseek-flash/oneshot-json-corrected.zip',
    '2026-09-28-deepseek-flash/multiturn-compact.zip',
    '2026-09-28-deepseek-flash/multiturn-production.zip',
    '2026-09-29-deepseek-flash/oneshot-json-repeat-a.zip',
    '2026-09-29-deepseek-flash/oneshot-json-spawn-timing.zip',
    '2026-09-29-deepseek-flash/oneshot-json-persistent-timing.zip',
)
BASE = ROOT / 'docs/benchmarks/evidence'
BACKUP = ROOT / '.cache/benchmark-evidence-before-newline-repair'
BAD = b'\r\r\n'
GOOD = b'\r\n'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def repair(path, apply):
    with zipfile.ZipFile(path) as source:
        records = [(entry, source.read(entry)) for entry in source.infolist()]
        source_comment = source.comment
    changes = [(entry.filename, data.count(BAD)) for entry, data in records
               if entry.filename.lower().endswith('.dxf') and BAD in data]
    before = digest(path)
    if not changes or not apply:
        return {'archive': str(path.relative_to(BASE)), 'files': len(changes),
                'lineEndings': sum(count for _, count in changes), 'oldSha256': before,
                'newSha256': before, 'applied': False}

    backup = BACKUP / path.relative_to(BASE)
    backup.parent.mkdir(parents=True, exist_ok=True)
    if backup.exists():
        if digest(backup) != before:
            raise RuntimeError(f'Backup differs from source: {backup}')
    else:
        shutil.copy2(path, backup)

    descriptor, temporary_name = tempfile.mkstemp(prefix='.newline-repair-', suffix='.zip', dir=path.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary, 'w') as target:
            target.comment = source_comment
            for entry, data in records:
                fixed = data.replace(BAD, GOOD) if entry.filename.lower().endswith('.dxf') else data
                target.writestr(entry, fixed)
        with zipfile.ZipFile(temporary) as target:
            repaired = [(entry.filename, target.read(entry)) for entry in target.infolist()]
        if len(repaired) != len(records) or any(
            name != original.filename or data != (
                old.replace(BAD, GOOD) if name.lower().endswith('.dxf') else old
            )
            for (name, data), (original, old) in zip(repaired, records)
        ):
            raise RuntimeError(f'ZIP verification failed: {path}')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return {'archive': str(path.relative_to(BASE)), 'files': len(changes),
            'lineEndings': sum(count for _, count in changes), 'oldSha256': before,
            'newSha256': digest(path), 'applied': True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='back up originals and replace only eligible ZIPs')
    args = parser.parse_args()
    for name in ARCHIVES:
        print(repair(BASE / name, args.apply), flush=True)


if __name__ == '__main__':
    main()
