import test from 'node:test'
import assert from 'node:assert/strict'
import { createDXFFileAdapter, createKJDrawSDK } from '../src/index.js'
import { DXF_VIEWPORT_METADATA_KEY } from '../src/dxf-viewport-metadata.js'

// Standard synthetic viewport/extension graph, unrelated to private projects.
const fixture = () => [0,'SECTION',2,'HEADER',9,'$ACADVER',1,'AC1015',0,'ENDSEC',
  0,'SECTION',2,'ENTITIES',0,'TEXT',5,'10',8,'0',10,1,20,2,40,2,1,'SYNTHETIC',
  0,'VIEWPORT',5,'20',102,'{ACAD_XDICTIONARY',360,'30',102,'}',8,'0',67,1,
  10,50,20,50,30,0,40,90,41,80,68,1,69,2,12,0,22,0,16,0,26,0,36,1,17,0,27,0,37,0,45,80,90,0,0,'ENDSEC',
  0,'SECTION',2,'OBJECTS',
  0,'DICTIONARY',5,'30',330,'20',100,'AcDbDictionary',281,1,3,'SYNTHETIC_DATA',360,'31',
  0,'XRECORD',5,'31',330,'30',100,'AcDbXrecord',280,1,1,'opaque annotation data',340,'41',
  0,'SCALE',5,'41',330,'40',100,'AcDbScale',300,'1:100',140,1,141,100,290,0,
  0,'DICTIONARY',5,'40',330,'50',100,'AcDbDictionary',281,1,3,'SYNTHETIC_SCALE',350,'41',
  0,'DICTIONARY',5,'50',330,'0',100,'AcDbDictionary',281,1,3,'ACAD_SCALELIST',350,'40',
  0,'ENDSEC',0,'EOF',''].join('\n')
const records = text => {
  const lines = text.trimEnd().split(/\r?\n/), result = []; let record
  for (let i=0;i<lines.length;i+=2) {
    if (Number(lines[i])===0) { record={type:lines[i+1],tags:[]};result.push(record) }
    else record?.tags.push({code:Number(lines[i]),value:lines[i+1]})
  }
  return result
}

test('DXF viewport extension dictionaries, records and registered scales survive annotation edits and DXF reopen', async () => {
  const adapter=createDXFFileAdapter(),sdk=createKJDrawSDK()
  let document=await adapter.read(fixture())
  assert.ok(document.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY])
  const label=document.listEntities({type:'TEXT'})[0]
  await sdk.executeCommand('TEXTEDIT',{changes:[{id:label.id,expectedText:'SYNTHETIC',text:'EDITED'}]},{document})
  for(let round=0;round<3;round++){
    const output=adapter.write(document), data=records(output)
    assert.match(output,/\$ACADVER\r\n1\r\nAC1015/)
    const graph=data.filter(r=>['30','31','40','41'].includes(r.tags.find(t=>t.code===5)?.value))
    assert.equal(graph.length,4)
    assert.deepEqual(graph.map(r=>r.type),['DICTIONARY','XRECORD','SCALE','DICTIONARY'])
    assert.equal(data.filter(r=>r.type==='DICTIONARY').some(r=>r.tags.some(t=>t.code===3&&t.value==='ACAD_SCALELIST')),true)
    const viewport=data.find(r=>r.type==='VIEWPORT')
    assert.ok(viewport.tags.some(t=>t.code===360&&t.value==='30'))
    document=await adapter.read(output)
    assert.equal(document.listEntities({type:'TEXT'})[0].payload.text,'EDITED')
    assert.ok(document.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY])
  }
})

test('opaque viewport graphs reject format conversion, stale geometry, forged records and missing reference targets', async () => {
  const adapter=createDXFFileAdapter(), document=await adapter.read(fixture())
  assert.throws(()=>adapter.write(document,{version:'2018'}),/source DXF format/)
  const viewport=document.listEntities({type:'VIEWPORT'})[0]
  await document.transact('change viewport geometry',tx=>tx.updateObject(viewport.id,{payload:{viewHeight:75}}))
  assert.throws(()=>adapter.write(document),/viewport changed/)
  await document.undo()
  const original=document.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY]
  const forged=structuredClone(original);forged.records[0].tags.push({code:360,value:'DEAD'})
  await document.transact('simulate malformed metadata',tx=>tx.putOpaquePayload(DXF_VIEWPORT_METADATA_KEY,forged))
  assert.throws(()=>adapter.write(document),/reference is unresolved/)
  const incomplete = await adapter.read(fixture().replace('360\n31','360\nDEAD'))
  assert.equal(incomplete.listEntities({type:'VIEWPORT'}).length,1)
  assert.throws(()=>adapter.write(incomplete),/unsupported source metadata/)
})

test('unknown source formats cannot export opaque viewport metadata through a default format fallback', async () => {
  const adapter = createDXFFileAdapter()
  const document = await adapter.read(fixture().replace('AC1015', 'AC9999'))
  assert.throws(() => adapter.write(document), /known source DXF format/)
})

test('DXF 2007 source code is recognized and preserved, not implicitly converted to 2018', async () => {
  const adapter = createDXFFileAdapter()
  let document = await adapter.read(new TextEncoder().encode(fixture().replace('AC1015', 'AC1021').replace('SYNTHETIC', '合成 UTF-8')))
  assert.equal(document.snapshot().header.sourceVersion, '2007')
  for (let round = 0; round < 3; round++) {
    const output = adapter.write(document)
    assert.match(output, /\$ACADVER\r\n1\r\nAC1021/)
    assert.equal(document.listEntities({type:'TEXT'})[0].payload.text, '合成 UTF-8')
    document = await adapter.read(new TextEncoder().encode(output))
  }
  assert.throws(() => adapter.write(document, { version: '2018' }), /source DXF format/)
})

test('a viewport visual style and its root dictionary registration survive DXF annotation edits', async () => {
  const source=fixture().replace('90\n0\n0\nENDSEC','90\n0\n348\n61\n0\nENDSEC')
    .replace('3\nACAD_SCALELIST\n350\n40','3\nACAD_SCALELIST\n350\n40\n3\nACAD_VISUALSTYLE\n350\n60')
    .replace('0\nENDSEC\n0\nEOF','0\nDICTIONARY\n5\n60\n330\n50\n100\nAcDbDictionary\n281\n1\n3\nSYNTHETIC_STYLE\n350\n61\n0\nVISUALSTYLE\n5\n61\n330\n60\n100\nAcDbVisualStyle\n2\nSynthetic\n70\n0\n291\n0\n0\nENDSEC\n0\nEOF')
  const adapter=createDXFFileAdapter(),document=await adapter.read(source)
  const output=adapter.write(document)
  assert.match(output,/348\r\n61/)
  assert.equal(records(output).filter(r=>r.type==='VISUALSTYLE').length,1)
  const reopened=await adapter.read(output)
  assert.equal(reopened.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY].records.filter(r=>r.type==='VISUALSTYLE').length,1)
})
