"""Five-repeat, three-task paired generation study; key from stdin only, no hidden retries."""
import argparse
import hashlib
import importlib.util
import json
import queue
import subprocess
import sys
import threading
import time
from contextlib import ExitStack
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT/'scripts/benchmarks/deepseek-drawing-pilot.py'
spec = importlib.util.spec_from_file_location('paired_pilot', PILOT)
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)

class PersistentKJDrawHost:
    """One Node process, but a fresh SDK document and proposal per response."""
    def __enter__(self):
        self.process = subprocess.Popen([pilot.NODE, str(pilot.HELPER), 'serve-json'], cwd=ROOT,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, text=True, encoding='utf-8', bufsize=1)
        self.lines = queue.Queue(maxsize=1)
        def read_lines():
            for line in self.process.stdout: self.lines.put(line)
            self.lines.put(None)
        threading.Thread(target=read_lines, daemon=True).start()
        return self

    def call(self, response):
        if self.process.poll() is not None: raise RuntimeError('KJDraw host stopped unexpectedly')
        request = json.dumps({'response':response},ensure_ascii=False)
        if len(request)>2_097_152: raise RuntimeError('KJDraw host request exceeds limit')
        self.process.stdin.write(request+'\n')
        self.process.stdin.flush()
        try: line=self.lines.get(timeout=30)
        except queue.Empty: raise RuntimeError('KJDraw host did not respond within 30 seconds') from None
        if line is None: raise RuntimeError('KJDraw host exited without a response')
        return json.loads(line)

    def __exit__(self, *_):
        if self.process.poll() is None:
            self.process.stdin.close()
            try: self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--live',action='store_true')
    parser.add_argument('--api-key-stdin',action='store_true')
    parser.add_argument('--proxy',default=None)
    parser.add_argument('--model',default='deepseek-flash')
    parser.add_argument('--drawing-tool',choices=['standard','compact','json'],default='standard')
    parser.add_argument('--repetitions',type=int,default=5)
    parser.add_argument('--output',default=str(ROOT/'.cache'/'deepseek-oneshot'))
    args = parser.parse_args()
    if not args.live or not args.api_key_stdin or args.repetitions != 5:
        raise RuntimeError('This published protocol requires --live --api-key-stdin and exactly five repetitions')
    key = sys.stdin.readline().strip()
    if not key: raise RuntimeError('Empty API key')
    import httpx
    prepared = pilot.node('prepare-compact' if args.drawing_tool in ('compact','json') else 'prepare')
    kj_arm = {'standard':'kjdraw','compact':'kjdraw-compact','json':'kjdraw-json'}[args.drawing_tool]
    tasks = prepared['tasks']
    output = Path(args.output).resolve()/time.strftime('%Y%m%d-%H%M%S')
    output.mkdir(parents=True,exist_ok=False)
    report = {'kind':'paired synthetic one-shot study','model':args.model,'temperature':0,'thinking':'disabled',
              'sourceSha256':{'study':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'pilot':hashlib.sha256(PILOT.read_bytes()).hexdigest(),'host':hashlib.sha256(pilot.HELPER.read_bytes()).hexdigest()},
              'drawingTool':prepared['tool']['function']['name'],'modelInterface':('compact JSON without tool schema; persistent KJDraw host injects revision and units, with a fresh document per request' if args.drawing_tool=='json' else 'function calling'),
              'repetitions':args.repetitions,'maxRequests':len(tasks)*2*args.repetitions,
              'timingDefinition':'modelSeconds measures the provider request. totalSeconds starts before that request and ends after CAD materialization, DXF writing and independent validation for either arm; it excludes setup and report writing.',
              'tasks':[{'id':task['id'],'prompt':task['prompt']} for task in tasks],
              'baseline':'Direct full ASCII DXF without a CAD library',
              'validator':'independent ezdxf, exact geometry plus units/audit',
              'approval':'synthetic harness approval, not human review','results':[],
              'usage':{kj_arm:{'prompt_tokens':0,'completion_tokens':0},'direct-dxf':{'prompt_tokens':0,'completion_tokens':0}}}
    (output/'expected.json').write_text(json.dumps([{'id':task['id'],'expected':task['expected']} for task in tasks],indent=2),encoding='utf-8')
    stopped = False
    with ExitStack() as stack:
        host = stack.enter_context(PersistentKJDrawHost()) if args.drawing_tool=='json' else None
        client = stack.enter_context(httpx.Client(proxy=args.proxy,timeout=httpx.Timeout(120,connect=25),follow_redirects=False))
        for repeat in range(1,args.repetitions+1):
            for task in tasks:
                order = (kj_arm,'direct-dxf') if (repeat+tasks.index(task))%2 else ('direct-dxf',kj_arm)
                for arm in order:
                    run = {'repeat':repeat,'task':task['id'],'arm':arm}
                    common = 'Create a 2D engineering drawing from this fully specified synthetic request. All coordinates and lengths are millimeters, model XY at z=0. The drawing is empty, revision 0. No extra geometry. '+task['prompt']
                    system = ('Return only one JSON object with arrays lines [[x1,y1,x2,y2]], circles [[x,y,r]], arcs [[x,y,r,startDeg,endDeg]], polylines [{"points":[[x,y],...],"closed":true|false}]. Omit unused groups or use empty arrays. Do not return DXF or commentary. The trusted host supplies revision and units and validates every entity before applying.' if arm==kj_arm and args.drawing_tool=='json' else
                              'Call exactly one '+prepared['tool']['function']['name']+' tool to propose editable geometry for synthetic benchmark review.' if arm==kj_arm else
                              'Return only a complete valid ASCII DXF file, no markdown or commentary. Set $INSUNITS to 4 (millimeters). Use LINE, CIRCLE, ARC or straight LWPOLYLINE. Do not use any CAD library or tool.')
                    body = {'model':args.model,'messages':[{'role':'system','content':system},{'role':'user','content':common}],
                            'temperature':0,'thinking':{'type':'disabled'},'max_tokens':6000,'stream':False}
                    if arm==kj_arm and args.drawing_tool!='json': body.update(tools=[prepared['tool']],tool_choice={'type':'function','function':{'name':prepared['tool']['function']['name']}})
                    stem=f'{repeat:02d}-{task["id"]}-{arm}'
                    (output/(stem+'-request.json')).write_text(json.dumps(body,ensure_ascii=False,indent=2),encoding='utf-8')
                    start=time.perf_counter()
                    try:
                        response=client.post('https://api.deepseek.com/chat/completions',json=body,headers={'Authorization':'Bearer '+key})
                        run['httpStatus']=response.status_code
                        response.raise_for_status()
                        if len(response.content)>2_000_000: raise RuntimeError('Response too large')
                        data=response.json()
                        run['modelSeconds']=round(time.perf_counter()-start,2)
                        run['finishReason']=data['choices'][0]['finish_reason']
                        run['usage']=data.get('usage',{})
                        for field in ('prompt_tokens','completion_tokens'):
                            report['usage'][arm][field]+=int(run['usage'].get(field,0))
                        message=data['choices'][0]['message']
                        safe={'model':data.get('model'),'usage':run['usage'],'finish_reason':run['finishReason'],
                              'message':{field:message.get(field) for field in ('content','tool_calls')}}
                        (output/(stem+'-response.json')).write_text(json.dumps(safe,ensure_ascii=False,indent=2),encoding='utf-8')
                        if arm==kj_arm:
                            result=host.call(data) if host else pilot.node('materialize',{'response':data})
                            if not result['ok']: raise RuntimeError('KJDraw proposal rejected')
                            dxf=result['dxf']
                        else:
                            dxf=message.get('content') or ''
                            if run['finishReason']!='stop' or '```' in dxf: raise RuntimeError('Incomplete or wrapped DXF')
                        (output/(stem+'.dxf')).write_bytes(dxf.encode('utf-8'))
                        run['validation']=pilot.validate(dxf,task['expected'])
                    except Exception as error:
                        run['error']=type(error).__name__
                        run['validation']={'passed':False}
                        if isinstance(error,(httpx.HTTPStatusError,httpx.RequestError)):
                            stopped=True
                            report['stopped']='Transport/authentication failure; no retry or further spending'
                    finally:
                        run['totalSeconds']=round(time.perf_counter()-start,3)
                    report['results'].append(run)
                    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
                    print(json.dumps({'repeat':repeat,'task':task['id'],'arm':arm,
                                      'passed':run['validation']['passed'],'tokens':run.get('usage',{}).get('total_tokens'),
                                      'error':run.get('error')}),flush=True)
                    if stopped: break
                if stopped: break
            if stopped: break
    print(json.dumps({'output':str(output),'completed':len(report['results']),
                      'planned':report['maxRequests'],'usage':report['usage'],'stopped':report.get('stopped')}),flush=True)

if __name__=='__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'error':type(error).__name__,'message':'Study stopped; no credential details disclosed'}),flush=True)
        sys.exit(1)
