import test from 'node:test'
import assert from 'node:assert/strict'
import { createDXFFileAdapter } from '../src/dxf-adapter.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

// Synthetic standard DXF, not copied from customer drawings. The attribute is
// already in the containing space despite the INSERT's nontrivial transform.
function fixture({ badOwner = false, missingEnd = false, multiline = false } = {}) {
  return [0,'SECTION',2,'HEADER',9,'$ACADVER',1,'AC1032',0,'ENDSEC',
    0,'SECTION',2,'BLOCKS',0,'BLOCK',5,'B100',2,'TAGGED',70,0,10,1,20,2,30,0,
    0,'LINE',5,'B101',8,'0',10,0,20,0,11,3,21,4,0,'ENDBLK',5,'B102',0,'ENDSEC',
    0,'SECTION',2,'ENTITIES',0,'INSERT',5,'A100',8,'0',100,'AcDbBlockReference',66,1,2,'TAGGED',10,20,20,30,41,2,42,2,43,1,50,30,
    0,'ATTRIB',5,'A101',330,badOwner?'A999':'A100',8,'0',100,'AcDbText',10,23,20,34,30,0,40,2.2,1,'EL %%p 12.35',41,.8,50,15,51,10,71,1,72,1,11,24,21,35,31,0,
    100,'AcDbAttribute',2,'ELEVATION',70,0,74,2,...(multiline?[100,'AcDbMText',1,'hidden multiline source']:[]),
    0,'ATTRIB',5,'A102',330,'A100',8,'0',100,'AcDbText',10,28,20,35,40,2.2,1,'PRIVATE VALUE',41,.7,71,2,100,'AcDbAttribute',2,'INTERNAL',70,9,
    ...(missingEnd?[]:[0,'SEQEND',5,'A103',330,'A100',8,'0']),0,'ENDSEC',0,'EOF',''].join('\n')
}
const message = error => [error.message,error.cause?.message,error.cause?.cause?.message].join(' ')
function attributes(document) {
  const insert=document.listEntities({type:'INSERT'})[0]
  return {insert, values:insert.payload.attributeIds.map(id=>document.getObject(id)), end:document.getObject(insert.payload.sequenceEndId)}
}
function rawRecords(text) {
  const lines=String(text).trimEnd().split(/\r?\n/), records=[]; let record
  for(let i=0;i<lines.length;i+=2){const code=Number(lines[i]),value=lines[i+1];if(code===0){record={type:value,tags:[]};records.push(record)}else record?.tags.push([code,value])}
  return records
}
const tag=(record,code)=>record.tags.find(pair=>pair[0]===code)?.[1]

test('DXF attached attributes retain native sequence, identity, text and containing-space coordinates through KJD and DXF',async()=>{
  const adapter=createDXFFileAdapter(), document=await adapter.read(fixture())
  const {insert,values,end}=attributes(document)
  assert.equal(insert.handle,'A100');assert.deepEqual(values.map(a=>a.handle),['A101','A102']);assert.equal(end.handle,'A103')
  assert.equal(end.kind,'custom');assert.equal(end.ownerId,insert.id);assert.equal(end.payload.dxfOwnerMode,'insert')
  assert.equal(document.listEntities({type:'SEQEND'}).length,0)
  for(const value of values){assert.equal(value.ownerId,insert.ownerId);assert.equal(value.payload.parentInsertId,insert.id)}
  assert.deepEqual(values[0].payload.position,[23,34,0]);assert.deepEqual(values[0].payload.alignmentPoint,[24,35,0])
  assert.equal(values[0].payload.text,'EL ± 12.35');assert.equal(values[0].payload.widthFactor,.8);assert.equal(values[0].payload.generationFlags,1)
  assert.equal(values[0].payload.horizontalAlignment,1);assert.equal(values[0].payload.verticalAlignment,2);assert.equal(values[1].payload.flags,9)
  const sdk=createKJDrawSDK(), kjd=await sdk.writeDocument(document,{format:'KJD'}), saved=await sdk.readDocument(kjd,{format:'KJD'})
  assert.deepEqual(attributes(saved),JSON.parse(JSON.stringify({insert,values,end})))
  const before=saved.serialize()
  for(const version of ['2000','2018','2024']){
    const output=adapter.write(saved,{version}), all=rawRecords(output), index=all.findIndex(record=>tag(record,5)==='A100')
    assert.deepEqual(all.slice(index,index+4).map(record=>record.type),['INSERT','ATTRIB','ATTRIB','SEQEND'])
    assert.equal(tag(all[index],66),'1');assert.equal(tag(all[index+1],330),'A100');assert.equal(tag(all[index+3],330),'A100')
    assert.equal(tag(all[index+1],1),'EL %%p 12.35');assert.equal(tag(all[index+1],41),'0.8');assert.equal(tag(all[index+1],74),'2')
    assert.equal(all.filter(record=>record.type==='ATTRIB').length,2)
    const reopened=await adapter.read(output), next=attributes(reopened)
    assert.deepEqual(next.values.map(value=>value.payload.position),values.map(value=>value.payload.position));assert.deepEqual(next.values.map(value=>value.handle),['A101','A102']);assert.equal(next.end.handle,'A103')
  }
  assert.equal(saved.serialize(),before)
})

test('DXF attribute sequences reject broken ownership, missing termination, unsupported embedded MTEXT and count-budget bypasses',async()=>{
  const adapter=createDXFFileAdapter()
  for(const [options,expected] of [[{badOwner:true},/different owner/],[{missingEnd:true},/missing SEQEND/],[{multiline:true},/multiline/]]) await assert.rejects(adapter.read(fixture(options)),error=>expected.test(message(error)))
  await assert.rejects(adapter.read(fixture(),{maxEntities:4}),error=>/entity count/.test(message(error)))
})

test('ATTRIB subclass codes never override AcDbText generation or alignment and opaque scalar fields survive export',async()=>{
  const source=fixture().replace('51\n10\n71\n1\n72','51\n10\n72').replace('70\n0\n74\n2','70\n0\n74\n2\n71\n1\n72\n0')
  const adapter=createDXFFileAdapter(),document=await adapter.read(source),attribute=attributes(document).values[0]
  assert.equal(attribute.payload.generationFlags,0);assert.equal(attribute.payload.horizontalAlignment,1)
  assert.deepEqual(attribute.payload.dxfAttributeExtraTags,[{code:71,value:'1'},{code:72,value:'0'}])
  const reopened=await adapter.read(adapter.write(document,{version:'2018'})),next=attributes(reopened).values[0]
  assert.equal(next.payload.generationFlags,0);assert.equal(next.payload.horizontalAlignment,1)
  assert.deepEqual(next.payload.dxfAttributeExtraTags,attribute.payload.dxfAttributeExtraTags)
})

test('attribute scalar XDATA tails remain intact with an exact registered APPID', async () => {
  const tail = '1001\nSYNTHETIC_SURVEY\n1070\n7\n1071\n123456\n1005\n0'
  const source = fixture().replace('70\n0\n74\n2', '70\n0\n74\n2\n' + tail)
  const adapter = createDXFFileAdapter(), document = await adapter.read(source)
  const attribute = attributes(document).values[0], output = adapter.write(document)
  const appids = rawRecords(output).filter(record => record.type === 'APPID').map(record => tag(record, 2))
  assert.ok(appids.includes('SYNTHETIC_SURVEY'))
  const next = attributes(await adapter.read(output)).values[0]
  assert.deepEqual(next.payload.dxfAttributeExtraTags, attribute.payload.dxfAttributeExtraTags)
  assert.equal(next.payload.horizontalAlignment, attribute.payload.horizontalAlignment)
  assert.equal(next.payload.generationFlags, attribute.payload.generationFlags)
  const invalid = await adapter.read(source.replace('1005\n0', '1005\nDEAD'))
  assert.throws(() => adapter.write(invalid), /metadata cannot be exported without loss/)
})

test('redundant attribute subclass alignment points preserve exact source tags and transform with their canonical point', async () => {
  const adapter = createDXFFileAdapter()
  const source = fixture().replace('70\n0\n74\n2', '70\n0\n74\n2\n11\n24.000\n21\n3.5e1\n31\n0.0')
  const document = await adapter.read(source), original = attributes(document).values[0]
  const saved = await adapter.read(adapter.write(document))
  assert.deepEqual(attributes(saved).values[0].payload.dxfAttributeExtraTags, original.payload.dxfAttributeExtraTags)
  const sdk = createKJDrawSDK()
  await sdk.executeCommand('MOVE', { ids: [original.payload.parentInsertId], dx: 5, dy: -2 }, { document })
  const moved = attributes(document).values[0]
  assert.deepEqual(moved.payload.alignmentPoint, [29, 33, 0])
  assert.deepEqual(moved.payload.dxfAttributeExtraTags.map(tag => Number(tag.value)), [29, 33, 0])
  const reopened = attributes(await adapter.read(adapter.write(document))).values[0]
  assert.deepEqual(reopened.payload.alignmentPoint, moved.payload.alignmentPoint)
  assert.deepEqual(reopened.payload.dxfAttributeExtraTags, moved.payload.dxfAttributeExtraTags)
})

test('attribute alignment tail guards reject unknown, incomplete, stale or XDATA coordinate interpretations', async () => {
  const adapter = createDXFFileAdapter()
  for (const tail of ['11\n999\n21\n35\n31\n0', '11\n24\n31\n0', '11\n24\n21\nNaN\n31\n0',
    '11\n24\n21\n35\n31\n0\n11\n24\n21\n35\n31\n0',
    '1001\nSYNTHETIC_APP\n1011\n24\n1021\n35\n1031\n0']) {
    const document = await adapter.read(fixture().replace('70\n0\n74\n2', '70\n0\n74\n2\n' + tail))
    assert.throws(() => adapter.write(document), /metadata cannot be exported without loss/)
  }
})

test('MOVE cannot launder unsupported hexadecimal or binary alignment tags into exportable decimal coordinates', async () => {
  const adapter = createDXFFileAdapter(), sdk = createKJDrawSDK()
  for (const value of ['0x18', '0b11000']) {
    const document = await adapter.read(fixture().replace('70\n0\n74\n2', `70\n0\n74\n2\n11\n${value}\n21\n35\n31\n0`))
    const before = attributes(document).values[0].payload.dxfAttributeExtraTags
    assert.throws(() => adapter.write(document), /metadata cannot be exported without loss/)
    await sdk.executeCommand('MOVE', { ids: [attributes(document).insert.id], dx: 5, dy: -2 }, { document })
    assert.deepEqual(attributes(document).values[0].payload.dxfAttributeExtraTags, before)
    assert.throws(() => adapter.write(document), /metadata cannot be exported without loss/)
  }
})

test('one attribute cannot export duplicate case-insensitive APPID segments that independent readers would overwrite', async () => {
  const adapter = createDXFFileAdapter()
  for (const name of ['SYNTHETIC_APP', 'synthetic_app']) {
    const tail = `1001\nSYNTHETIC_APP\n1070\n7\n1001\n${name}\n1070\n9`
    const document = await adapter.read(fixture().replace('70\n0\n74\n2', '70\n0\n74\n2\n' + tail))
    assert.throws(() => adapter.write(document), /duplicate APPID segment/)
  }
})

test('different ATTRIB entities cannot export conflicting case-insensitive APPID spellings', async () => {
  const adapter = createDXFFileAdapter()
  for (const [firstName, secondName] of [
    ['SYNTHETIC_SURVEY', 'synthetic_survey'],
    ['synthetic_survey', 'SYNTHETIC_SURVEY'],
    ['Synthetic_Survey', 'SYNTHETIC_SURVEY'],
  ]) {
    const source = fixture()
      .replace('70\n0\n74\n2', `70\n0\n74\n2\n1001\n${firstName}\n1070\n7`)
      .replace('70\n9\n0\nSEQEND', `70\n9\n1001\n${secondName}\n1070\n9\n0\nSEQEND`)
    const document = await adapter.read(source), before = document.serialize()
    assert.deepEqual(attributes(document).values.map(entity => entity.payload.dxfAttributeExtraTags
      .find(entry => entry.code === 1001).value), [firstName, secondName])
    assert.throws(() => adapter.write(document), /conflicting APPID spelling/)
    assert.equal(document.serialize(), before, 'a rejected global APPID collision cannot mutate either attribute')
  }
})

test('different ATTRIB entities may share one exact APPID without losing their independent scalar XDATA', async () => {
  const source = fixture()
    .replace('70\n0\n74\n2', '70\n0\n74\n2\n1001\nSYNTHETIC_SURVEY\n1070\n7')
    .replace('70\n9\n0\nSEQEND', '70\n9\n1001\nSYNTHETIC_SURVEY\n1070\n9\n0\nSEQEND')
  const adapter = createDXFFileAdapter(), document = await adapter.read(source)
  const originals = attributes(document).values, output = adapter.write(document)
  const applications = rawRecords(output).filter(record => record.type === 'APPID' && tag(record, 2) === 'SYNTHETIC_SURVEY')
  assert.equal(applications.length, 1)
  const reopened = attributes(await adapter.read(output)).values
  assert.deepEqual(reopened.map(entity => entity.handle), ['A101', 'A102'])
  assert.deepEqual(reopened.map(entity => entity.payload.dxfAttributeExtraTags),
    originals.map(entity => entity.payload.dxfAttributeExtraTags))
  assert.deepEqual(reopened.map(entity => entity.payload.dxfAttributeExtraTags.find(entry => entry.code === 1070).value), ['7', '9'])
})

test('default left-baseline attributes preserve inactive zero subclass points without creating or moving canonical alignment', async () => {
  const adapter = createDXFFileAdapter(), sdk = createKJDrawSDK()
  const source = fixture().replace('72\n1\n11\n24\n21\n35\n31\n0', '72\n0')
    .replace('74\n2', '74\n0\n11\n0.0\n21\n0.0\n31\n0.0')
  const document = await adapter.read(source), original = attributes(document).values[0]
  assert.equal(original.payload.alignmentPoint, undefined)
  await sdk.executeCommand('MOVE', { ids: [attributes(document).insert.id], dx: 5, dy: -2 }, { document })
  const moved = attributes(document).values[0]
  assert.deepEqual(moved.payload.position, [28, 32, 0])
  assert.equal(moved.payload.alignmentPoint, undefined)
  assert.deepEqual(moved.payload.dxfAttributeExtraTags, original.payload.dxfAttributeExtraTags)
  const reopened = attributes(await adapter.read(adapter.write(document))).values[0]
  assert.deepEqual(reopened.payload.dxfAttributeExtraTags, original.payload.dxfAttributeExtraTags)
  assert.equal(reopened.payload.alignmentPoint, undefined)
  for (const invalid of [source.replace('11\n0.0', '11\n1.0'), source.replace('72\n0\n100', '72\n1\n100')]) {
    const unsupported = await adapter.read(invalid)
    assert.throws(() => adapter.write(unsupported), /metadata cannot be exported without loss/)
  }
})

test('native sequences preserve block and secondary-paper ownership, including space-owned SEQEND',async()=>{
  const adapter=createDXFFileAdapter()
  for(const scope of ['block','paper']){
    const document=await adapter.read(fixture()), original=attributes(document)
    await document.transact('relocate complete synthetic insert',tx=>{
      const owner=scope==='block'?tx.upsertTableRecord('blockRecords',{name:'ASSEMBLY',payload:{basePoint:[5,7,0],entityIds:[]}}).id:tx.createLayout({name:'Detail sheet'}).payload.blockRecordId
      tx.reparentObject(original.insert.id,owner)
      tx.updateObject(original.end.id,{payload:{dxfOwnerMode:'space'}})
      if(scope==='block')tx.createEntity('INSERT',{blockRecordId:owner,position:[100,200,0],scale:[3,3,1],rotation:.5})
    })
    const output=adapter.write(document,{version:'2018'}), reopened=await adapter.read(output)
    const insert=reopened.listEntities({type:'INSERT'}).find(entity=>entity.handle==='A100')
    const owner=reopened.getObject(insert.ownerId), end=reopened.getObject(insert.payload.sequenceEndId)
    if(scope==='block')assert.equal(owner.name,'ASSEMBLY')
    else assert.ok(reopened.snapshot().spaces.paperSpaceIds.includes(owner.id))
    assert.equal(end.payload.dxfOwnerMode,'space');assert.equal(end.handle,'A103')
    assert.deepEqual(insert.payload.attributeIds.map(id=>reopened.getObject(id).payload.position),[[23,34,0],[28,35,0]])
    const sequence=rawRecords(output).find(record=>record.type==='SEQEND'&&tag(record,5)==='A103')
    assert.equal(tag(sequence,330),document.getObject(document.getObject(original.insert.id).ownerId).handle)
  }
})

for (const redundant of [false, true]) test(`independent ezdxf reads the exported attribute sequence without repairs, redundant alignment=${redundant}`,async t=>{
  const adapter=createDXFFileAdapter()
  const tail = redundant ? '\n11\n24.000\n21\n3.5e1\n31\n0.0\n1001\nSYNTHETIC_SURVEY\n1070\n7\n1005\n0' : ''
  const document=await adapter.read(fixture().replace('70\n0\n74\n2', '70\n0\n74\n2' + tail))
  if (redundant) await createKJDrawSDK().executeCommand('MOVE', { ids: [attributes(document).insert.id], dx: 5, dy: -2 }, { document })
  const source=adapter.write(document,{version:'2018'})
  const script=String.raw`
import io,json,sys,os
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source));insert=d.entitydb['A100'];attrs=insert.attribs
assert len(attrs)==2 and [a.dxf.handle for a in attrs]==['A101','A102']
assert all(a.dxf.owner=='A100' for a in attrs)
assert insert.seqend.dxf.handle=='A103' and d.entitydb['A103'] is insert.seqend
a=attrs[0];shift=(5,-2,0) if a.has_xdata('SYNTHETIC_SURVEY') else (0,0,0)
assert tuple(a.dxf.insert)==tuple(v+s for v,s in zip((23,34,0),shift)) and tuple(a.dxf.align_point)==tuple(v+s for v,s in zip((24,35,0),shift))
if any(shift):assert [(tag.code,tag.value) for tag in a.get_xdata('SYNTHETIC_SURVEY')]==[(1070,7),(1005,'0')]
assert a.dxf.text=='EL %%p 12.35' and a.dxf.width==.8 and a.dxf.halign==1 and a.dxf.valign==2 and a.dxf.text_generation_flag==1
assert attrs[1].dxf.flags==9 and attrs[1].is_invisible
audit=d.audit();assert not audit.errors and not audit.fixes,([str(e) for e in audit.errors],[str(e) for e in audit.fixes])
out=io.StringIO();d.write(out);print(json.dumps({'dxf':out.getvalue(),'handles':[a.dxf.handle for a in attrs]}))
`
  const result=spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON??'python',['-c',script],source,{encoding:'utf8',timeout:30000,env:{...process.env,PYTHONIOENCODING:'utf-8'}})
  if(result.error?.code==='ENOENT'||/No module named 'ezdxf'/.test(result.stderr)){if(process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED==='1')assert.fail(result.stderr||result.error.message);t.skip('ezdxf required');return}
  assert.equal(result.status,0,result.stderr);const native=JSON.parse(result.stdout), reopened=await adapter.read(native.dxf)
  assert.deepEqual(attributes(reopened).values.map(a=>a.handle),native.handles)
})

for (const move of [false, true]) test(`independent ezdxf preserves inactive zero attribute anchors and native sequence without repairs, moved=${move}`, async t => {
  const adapter = createDXFFileAdapter()
  const source = fixture().replace('72\n1\n11\n24\n21\n35\n31\n0', '72\n0')
    .replace('74\n2', '74\n0\n11\n0.0\n21\n0.0\n31\n0.0')
  const document = await adapter.read(source), original = attributes(document).values[0]
  assert.equal(original.payload.alignmentPoint, undefined)
  if (move) await createKJDrawSDK().executeCommand('MOVE', {
    ids: [attributes(document).insert.id], dx: 5, dy: -2,
  }, { document })
  const output = adapter.write(document, { version: '2018' })
  const attribute = rawRecords(output).find(record => record.type === 'ATTRIB' && tag(record, 5) === 'A101')
  const subclassStart = attribute.tags.findIndex(([code, value]) => code === 100 && value === 'AcDbAttribute')
  assert.ok(subclassStart > 0)
  assert.equal(attribute.tags.slice(0, subclassStart).some(([code]) => [11, 21, 31].includes(code)), false,
    'inactive zero metadata cannot invent a canonical AcDbText alignment anchor')
  assert.deepEqual(attribute.tags.slice(subclassStart).filter(([code]) => [11, 21, 31].includes(code)),
    [[11, '0.0'], [21, '0.0'], [31, '0.0']])
  const script = String.raw`
import io, json, os, sys
if os.environ.get('KJDRAW_EZDXF_PATH'): sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
with open(os.environ['KJDRAW_FILE_STDIN_PATH'], encoding='utf-8') as source:
    document = ezdxf.read(io.StringIO(source.read()))
insert = document.entitydb['A100']
attrs = insert.attribs
assert [entity.dxf.handle for entity in attrs] == ['A101', 'A102']
assert all(entity.dxf.owner == 'A100' for entity in attrs)
assert insert.seqend.dxf.handle == 'A103' and document.entitydb['A103'] is insert.seqend
first = attrs[0]
assert first.dxf.halign == 0 and first.dxf.valign == 0
assert first.dxf.align_point is None and not first.dxf.hasattr('align_point')
assert first.dxf.text == 'EL %%p 12.35'
assert first.dxf.width == .8 and first.dxf.text_generation_flag == 1
assert attrs[1].dxf.flags == 9 and attrs[1].is_invisible
audit = document.audit()
assert not audit.errors and not audit.fixes, ([str(error) for error in audit.errors], [str(fix) for fix in audit.fixes])
print(json.dumps({'reader': ezdxf.__version__, 'handles': [entity.dxf.handle for entity in attrs],
    'positions': [list(entity.dxf.insert) for entity in attrs],
    'canonicalAlignment': first.dxf.align_point,
    'hasCanonicalAlignment': first.dxf.hasattr('align_point'),
    'errors': len(audit.errors), 'fixes': len(audit.fixes)}))
`
  const result = spawnSyncWithFileStdin(process.env.KJDRAW_PYTHON ?? 'python', ['-c', script], output, {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  if (result.error?.code === 'ENOENT' || /No module named ['"]ezdxf/.test(result.stderr ?? '')) {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail(result.stderr || result.error.message)
    return t.skip('ezdxf required for the independent native attribute validator')
  }
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  const native = JSON.parse(result.stdout)
  const shift = move ? [5, -2, 0] : [0, 0, 0]
  assert.deepEqual(native.handles, ['A101', 'A102'])
  assert.deepEqual(native.positions, [[23, 34, 0], [28, 35, 0]].map(position =>
    position.map((coordinate, axis) => coordinate + shift[axis])))
  assert.equal(native.canonicalAlignment, null)
  assert.equal(native.hasCanonicalAlignment, false)
  assert.equal(native.errors, 0)
  assert.equal(native.fixes, 0)
  const restored = attributes(await adapter.read(output)).values[0]
  assert.equal(restored.payload.alignmentPoint, undefined)
  assert.deepEqual(restored.payload.dxfAttributeExtraTags, original.payload.dxfAttributeExtraTags)
  t.diagnostic('ezdxf ' + native.reader + ': inactive zero subclass anchor and sequence handles retained; zero audit errors/fixes')
})
