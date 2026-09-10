import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

test('SVG millimeter pens retain actual 1 mm raster width on paper and through a 1:100 viewport',async({page})=>{
  await page.goto('/')
  const measured=await page.evaluate(async()=>{
    const {createKJDrawSDK}=await import('/packages/kjdraw-sdk/src/sdk.js')
    const {exportDrawingSvg}=await import('/packages/kjdraw-sdk/src/svg-export.js')
    const sdk=createKJDrawSDK(),drawing=sdk.createDocument({units:'millimeter'}),layoutId=drawing.snapshot().spaces.layoutIds[1]
    const ownerId=drawing.getObject(layoutId).payload.blockRecordId,model=drawing.snapshot().spaces.modelSpaceId
    await sdk.executeCommand('PLOTSETUP',{layoutId,dxf:{paperWidth:100,paperHeight:100,paperUnits:1,plotType:5,flags:0,scaleNumerator:1,scaleDenominator:1}})
    await drawing.transact('physical 1mm pens',tx=>{
      tx.createEntity('LINE',{start:[20,20],end:[80,20],lineweight:100},{ownerId})
      tx.createEntity('LINE',{start:[-2000,0],end:[2000,0],lineweight:100},{ownerId:model})
    })
    await sdk.executeCommand('VIEWPORT',{layoutId,center:[50,50],width:60,height:40,viewCenter:[0,0],viewHeight:4000})
    const exported=exportDrawingSvg(drawing,{layoutId}),blob=new Blob([exported.svg],{type:'image/svg+xml'}),url=URL.createObjectURL(blob)
    const image=new Image();image.src=url;await image.decode()
    const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1000
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,1000,1000);context.drawImage(image,0,0,1000,1000);URL.revokeObjectURL(url)
    const scan=y=>{
      const pixels=context.getImageData(500,y-30,1,60).data;let covered=0,solid=0
      for(let i=0;i<pixels.length;i+=4){covered+=1-(pixels[i]+pixels[i+1]+pixels[i+2])/(3*255);if(pixels[i]<16&&pixels[i+1]<16&&pixels[i+2]<16)solid++}
      return {covered,solid}
    }
    document.body.replaceChildren(canvas)
    return {paper:scan(800),viewport:scan(500),report:exported.report}
  })
  expect(measured.report.status).toBe('complete')
  for(const width of [measured.paper,measured.viewport]){
    expect(width.covered).toBeGreaterThan(9.5);expect(width.covered).toBeLessThan(10.5)
    expect(width.solid).toBeGreaterThanOrEqual(9)
  }
  await mkdir('.cache/svg-export',{recursive:true})
  await page.screenshot({path:'.cache/svg-export/physical-1mm-pens.png',fullPage:true})
})