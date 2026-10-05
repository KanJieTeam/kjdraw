"""Offline hash and independent DXF audit for captured paired pilot evidence.

This reads saved artifacts only. It never makes a model request or retries a run.
"""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path


HERE = Path(__file__).resolve().parent


def load_module(filename, name):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bridge = load_module('paired-model-validator.py', 'pilot_bridge')
validator = load_module('deepseek-drawing-pilot.py', 'pilot_validator')


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(folder, allow_stopped=False):
    folder = folder.resolve()
    report = json.loads((folder / 'report.json').read_text(encoding='utf-8'))
    if report.get('schema') != 'com.kanjie.kjdraw.benchmark.paired-model@1' or report.get('taskSuite') != 'pilot':
        raise ValueError('not paired pilot evidence')
    status = report.get('status')
    if status != 'complete' and not (allow_stopped and status == 'stopped' and report.get('stopReason')):
        raise ValueError('incomplete evidence; --allow-stopped requires an explicit stop reason')
    if report['attemptedRequests'] + report['unexecutedRequests'] != report['plannedRequests']:
        raise ValueError('planned request accounting mismatch')
    tasks = {task['id']: task for task in report['tasks']}
    if len(tasks) != len(report['tasks']):
        raise ValueError('duplicate task')
    counts = {'kjdraw-tool': {'attempted': 0, 'passed': 0}, 'direct-dxf': {'attempted': 0, 'passed': 0}}
    for run in report['runs']:
        arm = run['arm']
        task = tasks.get(run['taskId'])
        if arm not in counts or task is None:
            raise ValueError('unknown arm or task')
        if run.get('taskVersion') != task.get('version') or run.get('inputSha256') != task.get('inputSha256'):
            raise ValueError('task metadata mismatch')
        counts[arm]['attempted'] += 1
        for kind in ('request', 'response', 'dxf'):
            filename = run.get('files', {}).get(kind)
            expected_hash = run.get(kind + 'Sha256')
            if filename is None:
                if expected_hash is not None:
                    raise ValueError('declared hash without file')
                continue
            if Path(filename).name != filename or not expected_hash:
                raise ValueError('unsafe or unhashed evidence path')
            if sha256(folder / filename) != expected_hash:
                raise ValueError(f'{kind} hash mismatch: {filename}')
        dxf_name = run.get('files', {}).get('dxf')
        if dxf_name:
            dxf = (folder / dxf_name).read_text(encoding='utf-8')
            failure = bridge.contract_failure(dxf, validator.ezdxf)
            result = {'passed': False, 'reason': failure} if failure else validator.validate(dxf, task['expected'])
            if result['passed'] != (run['status'] == 'passed'):
                raise ValueError('independent DXF verdict mismatch')
            if not result['passed'] and result.get('reason') != run.get('validation', {}).get('reason'):
                raise ValueError('independent DXF failure reason mismatch')
            if result['passed']:
                counts[arm]['passed'] += 1
        elif run['status'] == 'passed':
            raise ValueError('passed run has no DXF')
        if run['status'] == 'failed' and run.get('finishReason') == 'length':
            response_name = run.get('files', {}).get('response')
            if not response_name:
                raise ValueError('length failure without response')
            response = json.loads((folder / response_name).read_text(encoding='utf-8'))
            if not any(choice.get('finish_reason') == 'length' for choice in response.get('choices', [])):
                raise ValueError('length failure without matching model response')
    if sum(item['attempted'] for item in counts.values()) != report['attemptedRequests']:
        raise ValueError('attempted request count mismatch')
    return {'kind': 'captured paired pilot evidence audit', 'freshModelCalls': 0,
            'status': status, 'unexecutedRequests': report['unexecutedRequests'],
            'stopReason': report.get('stopReason'), 'counts': counts}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence_directory', type=Path)
    parser.add_argument('--allow-stopped', action='store_true')
    args = parser.parse_args()
    print(json.dumps(audit(args.evidence_directory, args.allow_stopped), indent=2))
