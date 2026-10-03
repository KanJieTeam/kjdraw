import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/index.js'
import { spawnSyncWithFileStdin } from '../scripts/spawn-file-stdin.mjs'

// Original public synthetic geometry. Independent ezdxf creates and checks
// the source; it is never repaired to make a KJDraw export pass.
const python = String.raw`
import io,json,os,ezdxf
data=json.loads(open(os.environ['KJDRAW_FILE_STDIN_PATH'],encoding='utf-8').read())
if data['mode']=='create':
 d=ezdxf.new('R2018');d.units=4;m=d.modelspace()
 b=d.blocks.new('ANNOTATION_SYMBOL')
 b.add_lwpolyline([(0,0),(2,0),(2,2),(0,2)],close=True)
 b.add_attdef('LABEL',insert=(1,1),text='DEFAULT',dxfattribs={'height':1.5})
 notes=[m.add_mtext(r'NOTE\PAPPROVED',dxfattribs={'insert':(30,5,0),'char_height':2.5,'width':12}),
  m.new_entity('TOLERANCE',{'insert':(30,15,0),'content':'{\\Fgdt;j}%%v0.05%%vA','dimstyle':'Standard','x_axis_vector':(.6,.8,0)}),
  m.add_blockref('ANNOTATION_SYMBOL',(30,25,0),dxfattribs={'rotation':30,'xscale':1.25,'yscale':.75})]
 notes[2].add_auto_attribs({'LABEL':'SYNTHETIC A-101'})
 for a in notes[2].attribs:a.dxf.owner=notes[2].dxf.handle
 for i,n in enumerate(notes):
  l=m.add_leader([(0,5+i*10,0),(10,7+i*10,0),(25,7+i*10,0)],dxfattribs={'annotation_type':i,'annotation_handle':n.dxf.handle})
  l.dxf.horizontal_direction=(.6,.8,0)
  l.dxf.leader_offset_block_ref=(1,2,0);l.dxf.leader_offset_annotation_placement=(3,4,0)
  l.dxf.text_height=2.5;l.dxf.text_width=12
  if i==0:l.dxf.normal_vector=(0,.6,.8)
 m.add_leader([(0,40,0),(10,40,0)],dxfattribs={'annotation_type':3})
 null_leader=m.add_leader([(0,45,0),(10,45,0)],dxfattribs={'annotation_type':3,'annotation_handle':'0'})
 m.add_line((100,100,0),(110,105,0),dxfattribs={'color':3})
 d.layouts.new('ANNOTATION_PAPER').add_mtext('PAPER NOTE',dxfattribs={'insert':(20,20,0),'char_height':2.5})
 s=io.StringIO();d.write(s);source=s.getvalue()
 # ezdxf omits default-valued hook flags and null references when writing.
 # Make this fixture's values explicit so their actual stored tags are tested.
 lines=source.splitlines();tags=[(int(lines[i]),lines[i+1]) for i in range(0,len(lines)-1,2)];out=[];i=0
 while i<len(tags):
  end=i+1
  if tags[i]==(0,'LEADER'):
   while end<len(tags) and tags[end][0]!=0:end+=1
   record=tags[i:end];out+=record+[(74,'1'),(75,'1')]
   if (5,null_leader.dxf.handle) in record:out.append((340,'0'))
   i=end
  else:out.append(tags[i]);i+=1
 source=''.join(str(code)+'\n'+value+'\n' for code,value in out)
 d=ezdxf.read(io.StringIO(source,newline=None))
else:source=data['source'];d=ezdxf.read(io.StringIO(source,newline=None))
def position(e):return list(e.dxf.insert) if e.dxftype() in ['MTEXT','TOLERANCE','INSERT'] else None
entities=[e for layout in d.layouts for e in layout]
leaders=[]
for l in [e for e in entities if e.dxftype()=='LEADER']:
 h=l.dxf.get('annotation_handle','0');n=d.entitydb.get(h)
 leaders.append({'handle':l.dxf.handle,'flag':l.dxf.annotation_type,'annotation':h,'handlePresent':l.dxf.hasattr('annotation_handle'),'target':n.dxftype() if n else None,
  'sameOwner':l.dxf.owner==n.dxf.owner if n else True,'vertices':[list(v) for v in l.vertices],
  'arrow':l.dxf.has_arrowhead,'path':l.dxf.path_type,'hookDirection':l.dxf.hookline_direction,'hook':l.dxf.has_hookline,'height':l.dxf.text_height,'width':l.dxf.text_width,
  'normal':list(l.dxf.normal_vector),'horizontal':list(l.dxf.horizontal_direction),
  'blockOffset':list(l.dxf.leader_offset_block_ref),'annotationOffset':list(l.dxf.leader_offset_annotation_placement),
  'position':position(n) if n else None})
notes=[]
for e in [e for e in entities if e.dxftype() in ['MTEXT','TOLERANCE','INSERT']]:
 k=e.dxftype();row={'handle':e.dxf.handle,'type':k,'position':position(e)}
 if k=='MTEXT':row.update(text=e.text,height=e.dxf.char_height,width=e.dxf.get('width',0))
 elif k=='TOLERANCE':row.update(text=e.dxf.content,normal=list(e.dxf.extrusion),xAxis=list(e.dxf.x_axis_vector))
 else:row.update(block=e.dxf.name,rotation=e.dxf.rotation,scale=[e.dxf.xscale,e.dxf.yscale,e.dxf.zscale],attributes=[{'handle':a.dxf.handle,'tag':a.dxf.tag,'text':a.dxf.text,'position':list(a.dxf.insert),'height':a.dxf.height,'sameOwner':a.dxf.owner==e.dxf.handle} for a in e.attribs])
 notes.append(row)
lines=[{'handle':e.dxf.handle,'start':list(e.dxf.start),'end':list(e.dxf.end),'color':e.dxf.color} for e in d.modelspace().query('LINE')]
blocks={b.name:[{'handle':e.dxf.handle,'type':e.dxftype(),'points':list(e.get_points('xyb')) if e.dxftype()=='LWPOLYLINE' else None,'closed':e.closed if e.dxftype()=='LWPOLYLINE' else None,'tag':e.dxf.tag if e.dxftype()=='ATTDEF' else None,'text':e.dxf.text if e.dxftype()=='ATTDEF' else None,'position':list(e.dxf.insert) if e.dxftype()=='ATTDEF' else None} for e in b] for b in d.blocks if b.name=='ANNOTATION_SYMBOL'}
audit=d.audit()
print(json.dumps({'source':source if data['mode']=='create' else None,'version':ezdxf.__version__,'errors':len(audit.errors),'fixes':len(audit.fixes),'leaders':sorted(leaders,key=lambda r:r['handle']),'notes':sorted(notes,key=lambda r:r['handle']),'lines':lines,'blocks':blocks}))
`
function oracle(data) {
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-B', '-c', python], JSON.stringify(data), { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONPATH: process.env.KJDRAW_EZDXF_PATH || process.env.PYTHONPATH || '' } })
  assert.equal(result.status, 0, result.error?.message || result.stderr)
  const observed = JSON.parse(result.stdout)
  assert.equal(observed.version, '1.4.4'); assert.equal(observed.errors, 0); assert.equal(observed.fixes, 0)
  return observed
}
let generated
const sourceFixture = () => generated ??= oracle({ mode: 'create' })
const state = document => ({ json: document.toJSON(), serialized: document.serialize(), revision: document.revision, history: document.history })
const findHandle = (document, handle) => document.listEntities().find(e => e.handle === handle)
const semantic = ({ source, version, ...observed }) => observed
// KJD is JSON: optional JavaScript properties whose value is undefined are
// omitted by serialization. Retain every actual source/payload value.
const json = value => JSON.parse(JSON.stringify(value))
function assertInterop(actual, expected) {
  for (const row of actual.notes.filter(note => note.type === 'INSERT')) {
    const source = expected.notes.find(note => note.handle === row.handle)
    // DXF stores degrees while the native model stores radians.
    assert.ok(Math.abs(row.rotation - source.rotation) <= 1e-12)
    row.rotation = source.rotation
  }
  assert.deepEqual(actual, expected)
}
function changeLeader(source, handle, changes) {
  const lines = source.replaceAll('\r\n', '\n').split('\n'), tags = []
  for (let i = 0; i + 1 < lines.length; i += 2) tags.push({ code: Number(lines[i].trim()), value: lines[i + 1] })
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].code !== 0 || tags[i].value.trim() !== 'LEADER') continue
    let end = i + 1; while (end < tags.length && tags[end].code !== 0) end++
    const record = tags.slice(i, end)
    if (record.find(t => t.code === 5)?.value.trim() !== handle) continue
    const output = record.filter(t => !Object.hasOwn(changes, t.code)).concat(Object.entries(changes).filter(([, value]) => value !== null).map(([code, value]) => ({ code: Number(code), value: String(value) })))
    tags.splice(i, record.length, ...output); break
  }
  return tags.map(t => `${t.code}\n${t.value}`).join('\n') + '\n'
}

test('all three legal annotation categories preserve group 73/340, handles, geometry and attributes through two KJD/DXF rounds', async () => {
  const original = sourceFixture(), sdk = createKJDrawSDK()
  let document = await sdk.readDocument(original.source, { format: 'DXF' })
  const expected = semantic(original)
  for (let round = 0; round < 2; round++) {
    const before = state(document)
    for (const native of document.listEntities({ type: 'LEADER' })) {
      if (native.payload.annotationType === 3) { assert.equal(native.payload.annotationId, null); assert.equal(native.payload.unresolvedLeaderAnnotation, undefined); continue }
      const note = document.getObject(native.payload.annotationId)
      assert.equal(note.type, ['MTEXT', 'TOLERANCE', 'INSERT'][native.payload.annotationType]); assert.equal(native.ownerId, note.ownerId)
      assert.deepEqual(native.payload.textPosition, note.payload.position)
      assert.equal(native.payload.unresolvedLeaderAnnotation, undefined); assert.equal(native.payload.ownsAnnotation, false)
    }
    const kjd = await sdk.writeDocument(document, { format: 'KJD' })
    assert.deepEqual(state(document), before)
    const saved = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
    assert.deepEqual(saved.toJSON().objects, json(document.toJSON().objects))
    const savedState = state(saved), dxf = await sdk.writeDocument(saved, { format: 'DXF', version: '2018' })
    assert.deepEqual(state(saved), savedState)
    assertInterop(semantic(oracle({ mode: 'inspect', source: String(dxf) })), expected)
    document = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
    assert.equal(document.listEntities({ type: 'LEADER' }).length, 5)
    assert.equal(document.listEntities({ type: 'ATTRIB' }).length, 1)
    const explicitNull = original.leaders.find(l => l.flag === 3 && l.handlePresent)
    assert.equal(findHandle(document, explicitNull.handle).payload.annotationHandle, '0')
    const absentNull = original.leaders.find(l => l.flag === 3 && !l.handlePresent)
    assert.equal(findHandle(document, absentNull.handle).payload.annotationHandle, null)
  }
})

test('TOLERANCE and INSERT associations do not become owned MTEXT or gain text-edit/grip authority', async () => {
  const original = sourceFixture(), sdk = createKJDrawSDK(), document = await sdk.readDocument(original.source, { format: 'DXF' })
  for (const native of document.listEntities({ type: 'LEADER' }).filter(l => [1, 2].includes(l.payload.annotationType))) {
    const before = state(document)
    await assert.rejects(sdk.executeCommand('LEADEREDIT', { id: native.id, text: 'must not convert' }, { document }), /MTEXT|annotation/i)
    await assert.rejects(sdk.executeCommand('GRIPEDIT', { id: native.id, gripId: 'text', point: [99, 99, 0] }, { document }), /MTEXT|annotation/i)
    assert.deepEqual(state(document), before)
  }
})

test('native MTEXT creation and edit retain the existing coupled text sizing and reference behavior', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const pair = await sdk.executeCommand('LEADER', { vertices: [[0, 0, 0], [10, 5, 0]], text: 'A', textHeight: 3 }, { document })
  await sdk.executeCommand('LEADEREDIT', { id: pair.leader.id, text: 'B', textHeight: 4 }, { document })
  const exported = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await sdk.readDocument(exported, { format: 'DXF' }), leader = reopened.listEntities({ type: 'LEADER' })[0], note = reopened.getObject(leader.payload.annotationId)
  assert.equal(note.type, 'MTEXT'); assert.equal(note.payload.text, 'B'); assert.equal(note.payload.height, 4)
  assert.equal(leader.payload.annotationType, 0); assert.equal(leader.payload.textHeight, 4)
  const observed = oracle({ mode: 'inspect', source: String(exported) })
  assert.equal(observed.leaders[0].flag, 0); assert.equal(observed.leaders[0].annotation, observed.notes[0].handle)
})

test('missing, wrong-type, different-owner and flag-mismatched source references stay diagnosed and cannot be exported', async () => {
  const original = sourceFixture(), sdk = createKJDrawSDK(), annotated = original.leaders.find(l => l.flag === 0)
  const foreign = original.notes.find(n => n.type === 'MTEXT' && n.position[0] === 20), line = original.lines[0]
  for (const [name, changes, pattern] of [
    ['missing target', { 340: 'DEAD' }, /DEAD/],
    ['missing handle', { 340: null }, /missing-annotation/],
    ['null annotated handle', { 340: '0' }, /missing-annotation/],
    ['unsupported target', { 340: line.handle }, new RegExp(line.handle)],
    ['different owner', { 340: foreign.handle }, /wrong-owner/],
    ['annotation flag mismatch', { 73: 1 }, /annotation-type-mismatch/],
    ['no-annotation flag with target', { 73: 3 }, /annotation-type-mismatch/],
  ]) {
    const source = changeLeader(original.source, annotated.handle, changes), document = await sdk.readDocument(source, { format: 'DXF' }), native = findHandle(document, annotated.handle)
    assert.ok(native, name); assert.equal(native.type, 'LEADER'); assert.match(native.payload.unresolvedLeaderAnnotation, pattern)
    assert.equal(native.payload.annotationHandle, changes[340] === null ? null : changes[340] ?? annotated.annotation)
    assert.equal(native.payload.annotationType, changes[73] ?? annotated.flag)
    const before = state(document), reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
    assert.deepEqual(reopened.getObject(native.id), json(native))
    await assert.rejects(sdk.writeDocument(document, { format: 'DXF', version: '2018' }), error => /unresolved annotation/.test(error.cause?.message ?? error.message), name)
    await assert.rejects(sdk.writeDocument(reopened, { format: 'DXF', version: '2018' }), error => /unresolved annotation/.test(error.cause?.message ?? error.message), name)
    assert.deepEqual(state(document), before)
  }
})

test('native stale/erased/wrong-owner/wrong-category references and inconsistent no-annotation flags fail without mutation', async () => {
  for (const variant of ['missing', 'erased', 'wrong-owner', 'wrong-type', 'flag-mismatch', 'no-target-flag', 'unresolved-handle']) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    const note = await sdk.executeCommand('CREATE', { type: variant === 'wrong-type' ? 'CIRCLE' : 'TOLERANCE', payload: variant === 'wrong-type' ? { center: [20, 5, 0], radius: 2 } : { position: [20, 5, 0], text: 'SYNTHETIC FCF' } }, { document })
    const leader = await document.transact('Original synthetic reference', tx => tx.createEntity('LEADER', { vertices: [[0, 0, 0], [10, 5, 0]], annotationId: variant === 'missing' ? 'missing-id' : ['no-target-flag', 'unresolved-handle'].includes(variant) ? null : note.id, annotationType: variant === 'flag-mismatch' ? 0 : variant === 'unresolved-handle' ? 3 : 1, ...(variant === 'unresolved-handle' ? { annotationHandle: 'DEAD' } : {}) }))
    if (variant === 'erased') await document.transact('Erase note explicitly', tx => tx.eraseObject(note.id))
    if (variant === 'wrong-owner') await document.transact('Other space', tx => { const block = tx.createObject({ kind: 'block-record', type: 'BLOCK_RECORD', name: 'OTHER', payload: { entityIds: [] } }); tx.reparentObject(note.id, block.id) })
    const before = state(document)
    await assert.rejects(sdk.writeDocument(document, { format: 'DXF', version: '2018' }), error => /LEADER/.test(error.cause?.message ?? error.message), variant)
    assert.deepEqual(state(document), before)
  }
})
