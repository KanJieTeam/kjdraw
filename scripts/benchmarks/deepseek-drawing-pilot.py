"""Explicit opt-in DeepSeek paired drawing pilot. No model output is executed as code."""
import io
import os
import json
import math
import subprocess
import sys
import time
from pathlib import Path

import ezdxf
REPO = Path(__file__).resolve().parents[2]
NODE = os.environ.get('KJDRAW_BENCH_NODE', 'node')
HELPER = REPO / 'scripts/benchmarks/model-drawing-pilot.mjs'

def node(mode, data=None):
    result = subprocess.run([NODE, str(HELPER), mode], input=None if data is None else json.dumps(data), text=True, encoding='utf-8', capture_output=True, cwd=REPO, timeout=30)
    if result.returncode: raise RuntimeError('Benchmark helper failed; no raw process output disclosed')
    return json.loads(result.stdout)

def xy(p): return [float(p[0]), float(p[1])]
def segment(a,b): return ['line', *sorted([xy(a), xy(b)])]
def expected_shapes(data):
    shapes = [segment((l['start']['x'],l['start']['y']), (l['end']['x'],l['end']['y'])) for l in data['lines']]
    shapes += [['circle', [c['center']['x'],c['center']['y']],c['radius']] for c in data['circles']]
    shapes += [['arc', [a['center']['x'],a['center']['y']],a['radius'],a['startDegrees']%360,a['endDegrees']%360] for a in data['arcs']]
    for p in data['polylines']:
        pts = [[v['x'],v['y']] for v in p['vertices']]
        shapes += [segment(pts[i],pts[i+1]) for i in range(len(pts)-1)]
        if p['closed']: shapes.append(segment(pts[-1],pts[0]))
    return shapes

def near(a,b):
    if isinstance(a,list): return isinstance(b,list) and len(a)==len(b) and all(near(x,y) for x,y in zip(a,b))
    if isinstance(a,str): return a==b
    return isinstance(b,(float,int)) and math.isfinite(b) and abs(a-b)<=1e-6

def validate(dxf, expected):
    try:
        doc = ezdxf.read(io.StringIO(dxf, newline=None))
        units = int(doc.header.get('$INSUNITS',0)) == 4
        audit = doc.audit()
        shapes=[]
        for e in doc.modelspace():
            kind=e.dxftype()
            if kind=='LINE': shapes.append(segment(e.dxf.start,e.dxf.end))
            elif kind=='CIRCLE': shapes.append(['circle',xy(e.dxf.center),float(e.dxf.radius)])
            elif kind=='ARC': shapes.append(['arc',xy(e.dxf.center),float(e.dxf.radius),float(e.dxf.start_angle)%360,float(e.dxf.end_angle)%360])
            elif kind=='LWPOLYLINE':
                pts=list(e.get_points('xyb'))
                if any(abs(p[2])>1e-12 for p in pts): return {'passed':False,'reason':'Unexpected bulged polyline representation'}
                shapes += [segment(pts[i],pts[i+1]) for i in range(len(pts)-1)]
                if e.closed: shapes.append(segment(pts[-1],pts[0]))
            else: return {'passed':False,'reason':'Unexpected entity type '+kind}
        remaining=shapes[:]
        for shape in expected_shapes(expected):
            index=next((i for i,actual in enumerate(remaining) if near(shape,actual)),None)
            if index is None: return {'passed':False,'reason':'Missing or inaccurate geometry','unitsCorrect':units}
            remaining.pop(index)
        return {'passed':units and not remaining and not audit.errors and not audit.fixes,'unitsCorrect':units,'extraShapes':len(remaining),'auditErrors':len(audit.errors),'auditFixes':len(audit.fixes),'entities':len(doc.modelspace())}
    except Exception as error: return {'passed':False,'reason':'DXF validator '+type(error).__name__}

def main():
    import httpx
    prepared=node('prepare')
    if '--live' not in sys.argv: raise RuntimeError('Use --self-test or explicitly opt in with --live')
    model=os.environ.get('KJDRAW_BENCH_MODEL','')
    key=os.environ.get('KJDRAW_BENCH_API_KEY','')
    if model!='deepseek-v4-flash' or not key: raise RuntimeError('Set the explicit DeepSeek model and API key for this pilot')
    output_root=os.environ.get('KJDRAW_BENCH_OUTPUT','')
    if not output_root: raise RuntimeError('Set an explicit artifact output directory')
    endpoint_url='https://api.deepseek.com/chat/completions'
    output=Path(output_root).resolve()/time.strftime('%Y%m%d-%H%M%S')
    output.mkdir(parents=True,exist_ok=False)
    report={'model':model,'protocol':'chat-completions','thinking':'disabled','temperature':0,'maxOutputTokens':4096,'maxRequests':6,'repetitions':1,'baseline':'Direct ASCII DXF, not an alternative CAD library','independentValidator':'ezdxf '+ezdxf.__version__,'tolerance':1e-6,'cost':None,'runs':[]}
    (output/'tasks.json').write_text(json.dumps(prepared,ensure_ascii=False,indent=2),encoding='utf-8')
    with httpx.Client(timeout=httpx.Timeout(120,connect=20),follow_redirects=False) as client:
        for index,task in enumerate(prepared['tasks']):
            for arm in (['kjdraw','direct-dxf'] if index%2==0 else ['direct-dxf','kjdraw']):
                common='Create a 2D engineering drawing from the following fully specified synthetic request. All coordinates and lengths are millimeters, model XY at z=0. The drawing is empty, revision 0. No text, dimensions, hatch, construction lines or additional geometry. '+task['prompt']
                system=('Use exactly one cad_propose_drawing tool call. The current units and revision have already been supplied. Return the requested editable geometry for synthetic benchmark review.' if arm=='kjdraw' else 'Return only a complete, valid ASCII DXF file, no markdown or commentary. Use DXF AC1027 or newer and set $INSUNITS to 4 (millimeters). Use LINE, CIRCLE, ARC and/or straight LWPOLYLINE entities. Do not use any CAD library or tool.')
                body={'model':model,'messages':[{'role':'system','content':system},{'role':'user','content':common}],'temperature':0,'thinking':{'type':'disabled'},'max_tokens':4096,'stream':False}
                if arm=='kjdraw': body.update(tools=[prepared['tool']],tool_choice={'type':'function','function':{'name':'cad_propose_drawing'}})
                run={'task':task['id'],'arm':arm,'startedAt':time.strftime('%Y-%m-%dT%H:%M:%S%z')}
                (output/(task['id']+'-'+arm+'-request.json')).write_text(json.dumps(body,ensure_ascii=False,indent=2),encoding='utf-8')
                start=time.perf_counter()
                try:
                    with client.stream('POST',endpoint_url,json=body,headers={'Authorization':'Bearer '+key}) as response:
                        response.raise_for_status()
                        raw=bytearray()
                        for chunk in response.iter_bytes():
                            raw.extend(chunk)
                            if len(raw)>2097152: raise RuntimeError('Response too large')
                    data=json.loads(raw)
                    run['modelSeconds']=round(time.perf_counter()-start,3)
                    run['usage']=data.get('usage')
                    run['returnedModel']=data.get('model')
                    run['finishReason']=data['choices'][0]['finish_reason']
                    # Retain final output and usage, not hidden reasoning or headers.
                    message=data['choices'][0]['message']
                    safe={'model':data.get('model'),'usage':data.get('usage'),'choices':[{'finish_reason':run['finishReason'],'message':{k:message[k] for k in ('role','content','tool_calls') if k in message}}]}
                    (output/(task['id']+'-'+arm+'-response.json')).write_text(json.dumps(safe,ensure_ascii=False,indent=2),encoding='utf-8')
                    if arm=='kjdraw':
                        materialized=node('materialize',{'response':data})
                        if not materialized['ok']: raise RuntimeError('KJDraw proposal rejected')
                        dxf=materialized['dxf']
                    else:
                        dxf=message.get('content') or ''
                        if run['finishReason']!='stop' or '```' in dxf: raise RuntimeError('Incomplete or wrapped DXF output')
                    (output/(task['id']+'-'+arm+'.dxf')).write_text(dxf,encoding='utf-8')
                    run['validation']=validate(dxf,task['expected'])
                    run['totalSeconds']=round(time.perf_counter()-start,3)
                except Exception as error:
                    run['totalSeconds']=round(time.perf_counter()-start,3)
                    run['error']=type(error).__name__
                    run['validation']={'passed':False}
                    if isinstance(error,httpx.HTTPStatusError): run['httpStatus']=error.response.status_code
                    if isinstance(error,(httpx.RequestError,httpx.HTTPStatusError)):
                        report['runs'].append(run)
                        report['stopped']='Transport/authentication failure; no automatic retries or additional spending'
                        (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
                        print(json.dumps({'output':str(output),'run':run,'stopped':report['stopped']}),flush=True)
                        return
                report['runs'].append(run)
                (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
                print(json.dumps(run),flush=True)
    print(json.dumps({'output':str(output),'completed':len(report['runs'])}),flush=True)

if __name__=='__main__':
    try:
        if '--self-test' in sys.argv:
            for task in node('prepare')['tasks']:
                response={'model':'offline-fixture','choices':[{'finish_reason':'tool_calls','message':{'role':'assistant','content':None,'tool_calls':[{'type':'function','id':'fixture','function':{'name':'cad_propose_drawing','arguments':json.dumps(task['expected'])}}]}}]}
                result=node('materialize',{'response':response})
                checked=validate(result['dxf'],task['expected']) if result['ok'] else result
                print(json.dumps({'task':task['id'],'validation':checked}),flush=True)
                if not checked.get('passed'): sys.exit(1)
        else: main()
    except Exception as error:
        print(json.dumps({'error':type(error).__name__,'message':'Benchmark setup failed; check opt-in and explicit environment configuration. No credential details disclosed'}))
        sys.exit(1)
