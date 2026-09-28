"""Offline verification of saved paired model outputs. Never calls a provider or alters the original report."""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT/'scripts/benchmarks/deepseek-drawing-pilot.py'
HELPER = ROOT/'scripts/benchmarks/model-drawing-pilot.mjs'
spec = importlib.util.spec_from_file_location('paired_pilot',PILOT)
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)

def sha256(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('directory',type=Path)
    parser.add_argument('--assert-original',action='store_true',help='fail if replay pass/fail decisions differ from the saved original run')
    args=parser.parse_args()
    directory=args.directory.resolve()
    original=json.loads((directory/'report.json').read_text(encoding='utf-8'))
    expected={item['id']:item['expected'] for item in json.loads((directory/'expected.json').read_text(encoding='utf-8'))}
    results=[]
    for row in original['results']:
        stem=f'{row["repeat"]:02d}-{row["task"]}-{row["arm"]}'
        response_path=directory/(stem+'-response.json')
        item={'repeat':row['repeat'],'task':row['task'],'arm':row['arm'],'originalPassed':row['validation']['passed']}
        if response_path.exists():
            response=json.loads(response_path.read_text(encoding='utf-8'))
            item['responseSha256']=sha256(response_path)
            if row['arm']=='kjdraw-json':
                result=pilot.node('materialize-json',{'response':{'choices':[{'message':response['message']}]}})
            elif row['arm'] in ('kjdraw','kjdraw-compact'):
                result=pilot.node('materialize',{'response':{'model':response['model'],'choices':[{'finish_reason':response['finish_reason'],'message':response['message']}]}})
            else:
                content=response['message'].get('content') or ''
                # Match the live runner: a truncated or markdown-wrapped DXF is
                # not a complete deliverable even if its prefix parses.
                complete=response['finish_reason']=='stop' and '```' not in content
                result={'ok':complete,'dxf':content}
            reason='Incomplete or markdown-wrapped DXF' if row['arm']=='direct-dxf' else 'Engine materialization rejected'
            item['replay']=pilot.validate(result['dxf'],expected[row['task']]) if result['ok'] else {'passed':False,'reason':reason}
        else: item['replay']={'passed':False,'reason':'Saved response missing'}
        results.append(item)
    audit={'kind':'offline replay; original report untouched','sourceReportSha256':sha256(directory/'report.json'),
           'helperSha256':sha256(HELPER),'validatorSha256':sha256(PILOT),'results':results}
    path=directory/'replay-report.json'
    path.write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    summary={arm:{'passed':sum(item['replay']['passed'] for item in results if item['arm']==arm),
                  'count':sum(item['arm']==arm for item in results)} for arm in sorted({item['arm'] for item in results})}
    print(json.dumps({'audit':str(path),'summary':summary}),flush=True)
    if args.assert_original and any(item['originalPassed'] != item['replay']['passed'] for item in results):
        print('Offline replay changed one or more original pass/fail decisions',file=sys.stderr)
        raise SystemExit(1)

if __name__=='__main__': main()
