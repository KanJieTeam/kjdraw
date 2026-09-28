"""Read-only audit of captured manufacturing benchmark evidence.

Checks saved request/response/DXF hashes and independently revalidates each
materialized DXF with ezdxf. This does not call a model or rematerialize a tool
response, so it must not be described as a fresh model run.
"""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path


VALIDATOR = Path(__file__).with_name('manufacturing-model-validator.py')
SPEC = importlib.util.spec_from_file_location('manufacturing_validator', VALIDATOR)
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


def digest(content):
    return hashlib.sha256(content).hexdigest()


def audit(folder, allow_stopped=False):
    report = json.loads((folder / 'report.json').read_text(encoding='utf-8'))
    if report.get('schema') != 'com.kanjie.kjdraw.benchmark.paired-model@1' or report.get('taskSuite') != 'manufacturing-30':
        raise ValueError('not a manufacturing-30 paired benchmark')
    tasks = {task['id']: task for task in report['tasks']}
    if len(tasks) != len(report['tasks']):
        raise ValueError('duplicate-task evidence')
    status = report.get('status')
    if status != 'complete' and not (allow_stopped and status == 'stopped' and report.get('stopReason')):
        raise ValueError('incomplete evidence; use --allow-stopped only for an explicitly stopped run')
    if report['attemptedRequests'] + report['unexecutedRequests'] != report['plannedRequests']:
        raise ValueError('planned request accounting mismatch')
    counts = {'kjdraw-tool': {'attempted': 0, 'passed': 0}, 'direct-dxf': {'attempted': 0, 'passed': 0}}
    for run in report['runs']:
        arm = run['arm']
        if arm not in counts or run['taskId'] not in tasks:
            raise ValueError('unknown arm or task')
        task = tasks[run['taskId']]
        if run['taskVersion'] != task['version'] or run['inputSha256'] != task['inputSha256']:
            raise ValueError('task version or input hash mismatch')
        counts[arm]['attempted'] += 1
        for kind in ('request', 'response', 'dxf'):
            filename = run.get('files', {}).get(kind)
            expected_hash = run.get(f'{kind}Sha256')
            if filename is None:
                if expected_hash is not None:
                    raise ValueError(f'missing {kind} with declared hash')
                continue
            if Path(filename).name != filename or not expected_hash:
                raise ValueError(f'unsafe or unhashed {kind} path')
            if digest((folder / filename).read_bytes()) != expected_hash:
                raise ValueError(f'{kind} SHA-256 mismatch: {filename}')
        if run.get('files', {}).get('dxf'):
            dxf = (folder / run['files']['dxf']).read_text(encoding='utf-8')
            try:
                result = validator.validate(dxf, task['expected'])
            except Exception as error:
                result = {'passed': False, 'reason': 'DXF_VALIDATION_' + type(error).__name__}
            if result['passed'] != (run['status'] == 'passed'):
                raise ValueError(f'independent DXF verdict mismatch: {run["taskId"]} {arm}')
            if not result['passed'] and result.get('reason') != run.get('validation', {}).get('reason'):
                raise ValueError(f'independent DXF failure reason mismatch: {run["taskId"]} {arm}')
            if result['passed']:
                counts[arm]['passed'] += 1
        elif run['status'] == 'passed':
            raise ValueError('passed run has no DXF')
        if run['status'] == 'failed' and run.get('finishReason') == 'length':
            response_name = run.get('files', {}).get('response')
            if not response_name:
                raise ValueError('length failure without saved response')
            response = json.loads((folder / response_name).read_text(encoding='utf-8'))
            if not any(choice.get('finish_reason') == 'length' for choice in response.get('choices', [])):
                raise ValueError('length failure not supported by response')
    if sum(row['attempted'] for row in counts.values()) != report['attemptedRequests']:
        raise ValueError('attempted request count mismatch')
    return {'kind': 'captured manufacturing evidence audit', 'freshModelCalls': 0, 'taskSuite': report['taskSuite'], 'status': status, 'unexecutedRequests': report['unexecutedRequests'], 'stopReason': report.get('stopReason'), 'counts': counts}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence_directory', type=Path)
    parser.add_argument('--allow-stopped', action='store_true', help='Audit a stopped report without treating it as a completed suite')
    args = parser.parse_args()
    print(json.dumps(audit(args.evidence_directory, args.allow_stopped), indent=2))
