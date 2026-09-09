import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { createDXFFileAdapter } from '../src/dxf-adapter.js'

test('modern DXF writes physical units and measurement independently without rescaling coordinates', async () => {
  for (const [units, code, canonical] of [['millimeter',4,'millimeter'],['mm',4,'millimeter'],['meter',6,'meter'],['inch',1,'inch'],['foot',2,'foot'],['unitless',0,'unitless'],['us-survey-foot',21,'us-survey-foot']]) {
    const sdk=createKJDrawSDK(), drawing=sdk.createDocument({ units, measurement:'imperial' })
    await sdk.executeCommand('CREATE',{type:'CIRCLE',payload:{center:[20,30,0],radius:3}})
    for (const version of ['2000','2004','2018','2024']) {
      const dxf=await sdk.writeDocument(drawing,{format:'DXF',version})
      assert.ok(dxf.includes(`$INSUNITS\r\n70\r\n${code}\r\n`))
      assert.ok(dxf.includes('$MEASUREMENT\r\n70\r\n0\r\n'))
      const reopened=await createKJDrawSDK().readDocument(dxf,{format:'DXF'})
      assert.equal(reopened.snapshot().header.units,canonical)
      assert.equal(reopened.snapshot().header.measurement,'imperial')
      assert.deepEqual(reopened.listEntities()[0].payload.center,[20,30,0])
      assert.equal(reopened.listEntities()[0].payload.radius,3)
    }
  }
})

test('absent insertion units remain unitless and invalid unit codes fail explicitly', async () => {
  const adapter=createDXFFileAdapter()
  const file=value=>`0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n${value}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n`
  assert.equal((await adapter.read(file(''))).snapshot().header.units,'unitless')
  for (const value of ['25','-1','4.5','oops']) await assert.rejects(adapter.read(file(`9\n$INSUNITS\n70\n${value}\n`)))
  const sdk=createKJDrawSDK(), drawing=sdk.createDocument({units:'unrecognized-length'})
  assert.throws(()=>adapter.write(drawing,{version:'2018'}),/unrecognized drawing units/)
})
