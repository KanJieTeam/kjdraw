"""Paired 10-edit DeepSeek pilot. Synthetic input only; API key is read from stdin and never persisted."""
import argparse
import importlib.util
import json
import math
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / 'scripts/benchmarks/multiturn-kjdraw-helper.mjs'
VALIDATOR = ROOT / 'scripts/benchmarks/deepseek-drawing-pilot.py'
spec = importlib.util.spec_from_file_location('drawing_validator', VALIDATOR)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)

STEPS = [
    ('move', 'Move only the circular hole currently centered at (10,10) exactly 2 mm right.', 'bottom-left', 2, 0),
    ('move', 'Move only the circular hole currently centered at (110,10) exactly 5 mm up.', 'bottom-right', 0, 5),
    ('circle', 'Add exactly one circular hole of radius 4 mm centered at (60,30).', 'center', 60, 30, 4),
    ('move', 'Move only the radius-4 center hole currently centered at (60,30) exactly 5 mm right.', 'center', 5, 0),
    ('line', 'Add exactly one horizontal line from (20,30) to (100,30).', 'guide', 20, 30, 100, 30),
    ('move', 'Move only the horizontal line currently from (20,30) to (100,30) exactly 5 mm up.', 'guide', 0, 5),
    ('move', 'Move only the circular hole currently centered at (110,50) exactly 3 mm left.', 'top-right', -3, 0),
    ('circle', 'Add exactly one circle of radius 2 mm centered at (80,20).', 'small', 80, 20, 2),
    ('move', 'Move only the radius-2 circle currently centered at (80,20) exactly 4 mm up.', 'small', 0, 4),
    ('move', 'Move only the circular hole currently centered at (10,50) exactly 2 mm down.', 'top-left', 0, -2),
]

def node(payload):
    run = subprocess.run(['node', str(HELPER)], input=json.dumps(payload), text=True, encoding='utf-8',
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=ROOT, timeout=45)
    if run.returncode or not run.stdout: raise RuntimeError('Local KJDraw helper failed')
    result = json.loads(run.stdout)
    if not result.get('ok'): raise RuntimeError('Local KJDraw rejected benchmark operation')
    return result

def initial_expected():
    return {
        'plate-bottom': ('line', [0,0], [120,0]),
        'plate-right': ('line', [120,0], [120,60]),
        'plate-top': ('line', [120,60], [0,60]),
        'plate-left': ('line', [0,60], [0,0]),
        'bottom-left': ('circle', [10,10], 3),
        'bottom-right': ('circle', [110,10], 3),
        'top-right': ('circle', [110,50], 3),
        'top-left': ('circle', [10,50], 3),
    }

def advance(expected, step):
    kind, _, label, *values = step
    if kind == 'move':
        dx, dy = values
        current = expected[label]
        if current[0] == 'circle': expected[label] = ('circle', [current[1][0]+dx,current[1][1]+dy], current[2])
        else: expected[label] = ('line', [current[1][0]+dx,current[1][1]+dy], [current[2][0]+dx,current[2][1]+dy])
    elif kind == 'circle': expected[label] = ('circle', [values[0], values[1]], values[2])
    else: expected[label] = ('line', [values[0],values[1]], [values[2],values[3]])

def as_validator_data(expected):
    return {'lines': [{'start': {'x': item[1][0], 'y': item[1][1]}, 'end': {'x': item[2][0], 'y': item[2][1]}}
                      for item in expected.values() if item[0] == 'line'],
            'circles': [{'center': {'x': item[1][0], 'y': item[1][1]}, 'radius': item[2]}
                        for item in expected.values() if item[0] == 'circle'],
            'arcs': [], 'polylines': []}

def find_id(entities, shape):
    matches = []
    for entity in entities:
        payload = entity['payload']
        if shape[0] == 'circle' and entity['type'] == 'CIRCLE':
            if all(math.isclose(payload['center'][i], shape[1][i], abs_tol=1e-6) for i in range(2)) and math.isclose(payload['radius'], shape[2], abs_tol=1e-6):
                matches.append(entity['id'])
        if shape[0] == 'line' and entity['type'] == 'LINE':
            actual = [payload.get('start'), payload.get('end')]
            if actual[0] and (all(math.isclose(actual[j][i], shape[j+1][i], abs_tol=1e-6) for j in range(2) for i in range(2)) or
                              all(math.isclose(actual[1-j][i], shape[j+1][i], abs_tol=1e-6) for j in range(2) for i in range(2))):
                matches.append(entity['id'])
    return matches[0] if len(matches) == 1 else None

def tool_for(step, expected, state):
    kind, _, label, *values = step
    common = {'expectedRevision': state['revision'], 'units': 'millimeter'}
    point = {'type': 'object', 'properties': {'x': {'type':'number'}, 'y': {'type':'number'}}, 'required':['x','y']}
    if kind == 'move':
        target = find_id(state['entities'], expected[label])
        if target is None: raise RuntimeError('Target is missing or ambiguous')
        name = 'cad_propose_move'
        fields = {'expectedRevision': {'type':'integer'}, 'units': {'type':'string'}, 'ids': {'type':'array','items':{'type':'string'}}, 'dx': {'type':'number'}, 'dy': {'type':'number'}}
        hint = 'The exact ID of the sole target is '+target+'. Preserve all other objects.'
    elif kind == 'circle':
        name = 'cad_propose_circles'
        fields = {'expectedRevision': {'type':'integer'}, 'units': {'type':'string'}, 'circles': {'type':'array','items':{'type':'object','properties':{'center':point,'radius':{'type':'number'}},'required':['center','radius']}}}
        hint = 'Add only the requested circle. Preserve existing objects.'
    else:
        name = 'cad_propose_lines'
        fields = {'expectedRevision': {'type':'integer'}, 'units': {'type':'string'}, 'lines': {'type':'array','items':{'type':'object','properties':{'start':point,'end':point},'required':['start','end']}}}
        hint = 'Add only the requested line. Preserve existing objects.'
    schema = {'type':'object','properties':fields,'required':list(fields)}
    tool = {'type':'function','function':{'name':name,'description':'Propose one exact editable CAD operation; host review follows.', 'parameters':schema}}
    context = {'revision':state['revision'],'units':'millimeter', 'entities':state['entities']}
    return tool, hint, context

def request_body(model, arm, step, expected, state, direct_dxf, full_tools=None):
    instruction = step[1] + ' Keep every other entity exactly unchanged. Units are millimeters. No extra geometry.'
    if arm == 'kjdraw':
        tool, hint, context = tool_for(step, expected, state)
        if full_tools: tool = next(item for item in full_tools if item['function']['name'] == tool['function']['name'])
        user = instruction+'\n'+hint+'\nCurrent editable drawing state: '+json.dumps(context,separators=(',',':'))
        system = 'You edit a persistent 2D CAD drawing. Call the one provided proposal tool exactly once with the exact current revision and units. Return no direct DXF.'
    else:
        user = instruction+'\nCurrent complete ASCII DXF:\n'+direct_dxf
        system = 'Edit the supplied persistent drawing and return the entire updated ASCII DXF, with no markdown or explanation. Preserve $INSUNITS=4, all unrelated entities, and valid DXF structure. Do not call a CAD tool or library.'
    body = {'model':model,'messages':[{'role':'system','content':system},{'role':'user','content':user}],
            'thinking':{'type':'disabled'}, 'temperature':0, 'max_tokens':6000, 'stream':False}
    if arm == 'kjdraw': body.update(tools=[tool],tool_choice={'type':'function','function':{'name':tool['function']['name']}})
    return body

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--api-key-stdin', action='store_true')
    parser.add_argument('--proxy', default=None)
    parser.add_argument('--model', default='deepseek-flash')
    parser.add_argument('--schema', choices=['compact','production'], default='compact')
    parser.add_argument('--output', default=str(ROOT/'.cache'/'deepseek-multiturn'))
    args = parser.parse_args()
    seed = node({'mode':'init'})
    full_tools = node({'mode':'definitions'})['tools'] if args.schema == 'production' else None
    expected = initial_expected()
    assert validator.validate(seed['dxf'], as_validator_data(expected))['passed']
    if args.self_test:
        tool, _, _ = tool_for(STEPS[0], expected, seed)
        target = find_id(seed['entities'], expected['bottom-left'])
        changed = node({'mode':'step','kjd':seed['kjd'],'tool':tool['function']['name'],
                        'args':{'expectedRevision':seed['revision'],'units':'millimeter','ids':[target],'dx':2,'dy':0}})
        advance(expected, STEPS[0])
        assert validator.validate(changed['dxf'],as_validator_data(expected))['passed']
        print(json.dumps({'selfTest':'passed','seedEntities':len(seed['entities']),'reopenedRevision':changed['revision']}),flush=True)
        return
    if not args.live or not args.api_key_stdin: raise RuntimeError('Live run requires explicit --live --api-key-stdin')
    key = sys.stdin.readline().strip()
    if not key: raise RuntimeError('Empty API key')
    import httpx
    output = Path(args.output).resolve()/time.strftime('%Y%m%d-%H%M%S')
    output.mkdir(parents=True, exist_ok=False)
    report = {'kind':'exploratory synthetic paired pilot','model':args.model,'rounds':10,'repeats':1,
              'toolSchema':args.schema,
              'baseline':'Direct full ASCII DXF re-emission without a CAD library','validator':'independent ezdxf, exact geometry plus units/audit',
              'approval':'synthetic harness approval, not human review','seedRevision':seed['revision'],
              'seedValidation':validator.validate(seed['dxf'],as_validator_data(expected)),
              'results':[], 'usage':{'kjdraw':{'prompt_tokens':0,'completion_tokens':0},'direct-dxf':{'prompt_tokens':0,'completion_tokens':0}}}
    (output/'seed.dxf').write_bytes(seed['dxf'].encode('utf-8'))
    states = {'kjdraw':seed, 'direct-dxf':seed['dxf']}
    stopped = False
    with httpx.Client(proxy=args.proxy,timeout=httpx.Timeout(120,connect=25),follow_redirects=False) as client:
        for round_no, step in enumerate(STEPS,1):
            for arm in (('kjdraw','direct-dxf') if round_no%2 else ('direct-dxf','kjdraw')):
                run = {'round':round_no,'arm':arm,'instruction':step[1]}
                try:
                    body = request_body(args.model,arm,step,expected,states['kjdraw'],states['direct-dxf'],full_tools)
                    (output/f'{round_no:02d}-{arm}-request.json').write_text(json.dumps(body,ensure_ascii=False,indent=2),encoding='utf-8')
                    start = time.perf_counter()
                    response = client.post('https://api.deepseek.com/chat/completions',json=body,
                                           headers={'Authorization':'Bearer '+key})
                    run['httpStatus'] = response.status_code
                    response.raise_for_status()
                    if len(response.content)>2_000_000: raise RuntimeError('Response too large')
                    data = response.json()
                    message = data['choices'][0]['message']
                    run['modelSeconds'] = round(time.perf_counter()-start,2)
                    run['finishReason'] = data['choices'][0]['finish_reason']
                    run['usage'] = data.get('usage',{})
                    for field in ('prompt_tokens','completion_tokens'):
                        report['usage'][arm][field] += int(run['usage'].get(field,0))
                    safe = {'model':data.get('model'),'usage':run['usage'],'finish_reason':run['finishReason'],
                            'message':{field:message.get(field) for field in ('content','tool_calls')}}
                    (output/f'{round_no:02d}-{arm}-response.json').write_text(json.dumps(safe,ensure_ascii=False,indent=2),encoding='utf-8')
                    if arm == 'kjdraw':
                        calls = message.get('tool_calls') or []
                        required = body['tools'][0]['function']['name']
                        if len(calls)!=1 or calls[0]['function']['name']!=required: raise RuntimeError('Expected one exact tool call')
                        arguments = json.loads(calls[0]['function']['arguments'])
                        state = node({'mode':'step','kjd':states['kjdraw']['kjd'],'tool':required,'args':arguments})
                        states['kjdraw'] = state
                        dxf = state['dxf']
                        run['revision'] = state['revision']
                    else:
                        dxf = message.get('content') or ''
                        if run['finishReason']!='stop' or '```' in dxf: raise RuntimeError('Incomplete or wrapped DXF')
                        # A parseable wrong drawing persists, making drift visible in later rounds.
                        import ezdxf, io
                        ezdxf.read(io.StringIO(dxf,newline=None))
                        states['direct-dxf'] = dxf
                    (output/f'{round_no:02d}-{arm}.dxf').write_bytes(dxf.encode('utf-8'))
                    run['producedArtifact'] = True
                except Exception as error:
                    run['error'] = type(error).__name__
                    run['producedArtifact'] = False
                    if isinstance(error,(httpx.HTTPStatusError,httpx.RequestError)):
                        stopped = True
                        report['stopped']='Transport/authentication failure; no retry or further spending'
                report['results'].append(run)
                if stopped: break
            if stopped: break
            advance(expected,step)
            for arm in ('kjdraw','direct-dxf'):
                run = next(item for item in report['results'] if item['round']==round_no and item['arm']==arm)
                dxf = states['kjdraw']['dxf'] if arm=='kjdraw' else states['direct-dxf']
                run['validation'] = validator.validate(dxf,as_validator_data(expected))
                print(json.dumps({'round':round_no,'arm':arm,'passed':run['validation']['passed'],
                                  'tokens':run.get('usage',{}).get('total_tokens'),'error':run.get('error')}),flush=True)
            (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(output),'completedRounds':max((x['round'] for x in report['results']),default=0),
                      'usage':report['usage'],'stopped':report.get('stopped')}),flush=True)

if __name__=='__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'error':type(error).__name__,'message':'Pilot stopped; no credential details disclosed'}),flush=True)
        sys.exit(1)
