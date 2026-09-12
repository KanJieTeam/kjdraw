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

test('independent ezdxf reads the exported attribute sequence without repairs and with exact native text properties',async t=>{
  const adapter=createDXFFileAdapter(), document=await adapter.read(fixture()), source=adapter.write(document,{version:'2018'})
  const script=String.raw`
import io,json,sys,os
if os.environ.get('KJDRAW_EZDXF_PATH'):sys.path.append(os.environ['KJDRAW_EZDXF_PATH'])
import ezdxf
p=os.environ.get('KJDRAW_FILE_STDIN_PATH');source=open(p,encoding='utf-8').read() if p else sys.stdin.read()
d=ezdxf.read(io.StringIO(source));insert=d.entitydb['A100'];attrs=insert.attribs
assert len(attrs)==2 and [a.dxf.handle for a in attrs]==['A101','A102']
assert all(a.dxf.owner=='A100' for a in attrs)
assert insert.seqend.dxf.handle=='A103' and d.entitydb['A103'] is insert.seqend
a=attrs[0];assert tuple(a.dxf.insert)==(23,34,0) and tuple(a.dxf.align_point)==(24,35,0)
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
