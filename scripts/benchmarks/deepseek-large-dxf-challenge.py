"""One-request large-output sensitivity check for an existing paired direct-DXF run."""
import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
VALIDATOR=ROOT/'scripts/benchmarks/manufacturing-model-validator.py'
spec=importlib.util.spec_from_file_location('manufacturing_validator',VALIDATOR)
validator=importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--live',action='store_true')
    parser.add_argument('--api-key-stdin',action='store_true')
    parser.add_argument('--proxy',default=None)
    parser.add_argument('--paired-run',type=Path,required=True)
    parser.add_argument('--max-output-tokens',type=int,default=131072)
    parser.add_argument('--output',type=Path,default=ROOT/'.cache'/'manufacturing-highcap')
    args=parser.parse_args()
    if not args.live or not args.api_key_stdin or args.max_output_tokens!=131072:
        raise RuntimeError('Explicit one-request 131072-token sensitivity protocol required')
    key=sys.stdin.readline().strip()
    if not key: raise RuntimeError('Empty API key')
    prior=args.paired_run.resolve()
    original=json.loads((prior/'report.json').read_text(encoding='utf-8'))
    if original['taskSuite']!='manufacturing' or original['model']!='deepseek-flash': raise RuntimeError('Expected original manufacturing DeepSeek run')
    request=json.loads((prior/'high-density-fixture-plate-a2-direct-dxf-1-request.json').read_text(encoding='utf-8'))
    if request['max_tokens']!=32768: raise RuntimeError('Unexpected original output cap')
    request['max_tokens']=args.max_output_tokens
    output=args.output.resolve()/time.strftime('%Y%m%d-%H%M%S')
    output.mkdir(parents=True,exist_ok=False)
    (output/'request.json').write_text(json.dumps(request,ensure_ascii=False,indent=2),encoding='utf-8')
    report={'kind':'single direct-DXF output-cap sensitivity; not a repeated paired result',
            'sourcePairedRun':prior.name,'model':'deepseek-flash','maxOutputTokens':args.max_output_tokens,
            'requestCount':1,'validator':'independent ezdxf manufacturing contract'}
    import httpx
    start=time.perf_counter()
    try:
        with httpx.Client(proxy=args.proxy,timeout=httpx.Timeout(300,connect=25),follow_redirects=False) as client:
            with client.stream('POST','https://api.deepseek.com/chat/completions',json=request,headers={'Authorization':'Bearer '+key}) as response:
                report['httpStatus']=response.status_code
                response.raise_for_status()
                raw=bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw)>20_000_000: raise RuntimeError('Response exceeded 20 MB safety cap')
        data=json.loads(raw)
        report['seconds']=round(time.perf_counter()-start,2)
        report['usage']=data.get('usage',{})
        report['finishReason']=data['choices'][0]['finish_reason']
        message=data['choices'][0]['message']
        (output/'response.json').write_text(json.dumps({'model':data.get('model'),'usage':report['usage'],
            'finish_reason':report['finishReason'],'message':{'content':message.get('content')}},ensure_ascii=False,indent=2),encoding='utf-8')
        dxf=message.get('content') or ''
        (output/'drawing.dxf').write_text(dxf,encoding='utf-8')
        report['validation']=validator.validate(dxf,original['tasks'][0]['expected'])
    except Exception as error:
        report['seconds']=round(time.perf_counter()-start,2)
        report['error']=type(error).__name__
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'finishReason':report.get('finishReason'),
                      'passed':report.get('validation',{}).get('passed',False),
                      'tokens':report.get('usage',{}).get('total_tokens'), 'error':report.get('error')}),flush=True)

if __name__=='__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'error':type(error).__name__,'message':'Sensitivity check stopped; no credential details disclosed'}),flush=True)
        sys.exit(1)
