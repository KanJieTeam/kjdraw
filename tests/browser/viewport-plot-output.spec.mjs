import { test, expect } from '@playwright/test'

test('physical PNG and SVG plot clipped model content through a no-plot viewport without leaking no-plot geometry',async({page})=>{
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const {createKJDrawSDK}=await import('/packages/kjdraw-sdk/src/sdk.js')
    const {exportDrawingSvg}=await import('/packages/kjdraw-sdk/src/svg-export.js')
    const {exportDrawingPng}=await import('/packages/kjdraw-sdk/src/drawing-image.js')
    const sdk=createKJDrawSDK(),drawing=sdk.createDocument({units:'millimeter'}),model=drawing.spaces.modelSpaceId
    let layout,viewport
    await drawing.transact('physical no-plot viewport',tx=>{
      const continuous=drawing.getTable('linetypes').records.find(record=>record.name==='CONTINUOUS').id
      const noPlot=tx.upsertTableRecord('layers',{name:'VP-NOPLOT',type:'LAYER',payload:{color:3,linetypeId:continuous,visible:true,plottable:false}})
      tx.createEntity('LINE',{start:[-100,0],end:[100,0],trueColor:0x0000ff},{ownerId:model})
      tx.createEntity('LINE',{start:[0,-100],end:[0,100],trueColor:0xff0000,layerId:noPlot.id},{ownerId:model})
      layout=tx.createLayout({name:'Raster sheet'})
      viewport=tx.createEntity('VIEWPORT',{center:[50,50,0],width:40,height:20,viewCenter:[0,0,0],viewHeight:20,viewTarget:[0,0,0],viewDirection:[0,0,1],flags:16384,layerId:noPlot.id},{ownerId:layout.payload.blockRecordId})
      tx.updateObject(layout.id,{payload:{viewportIds:[viewport.id]}})
      tx.createEntity('TEXT',{position:[10,10,0],text:'PAPER NOTE',height:3},{ownerId:layout.payload.blockRecordId})
      tx.createEntity('LINE',{start:[5,70],end:[95,70],trueColor:0xff0000,layerId:noPlot.id},{ownerId:layout.payload.blockRecordId})
    })
    await sdk.executeCommand('PAGESETUP',{layoutId:layout.id,dxf:{paperWidth:100,paperHeight:100,paperUnits:1,plotType:5,flags:0,scaleNumerator:1,scaleDenominator:1,marginLeft:0,marginRight:0,marginTop:0,marginBottom:0,originX:0,originY:0,printerName:'',styleSheet:'',shadeMode:0}},{document:drawing})
    const before=drawing.serialize(),svg=exportDrawingSvg(drawing,{layoutId:layout.id}),png=await exportDrawingPng(drawing,{layoutId:layout.id,maxEdge:400,theme:'light'})
    const image=new Image();image.src=png.dataUrl;await image.decode()
    const canvas=document.createElement('canvas');canvas.width=400;canvas.height=400;const context=canvas.getContext('2d');context.drawImage(image,0,0)
    const pixels=context.getImageData(0,0,400,400).data
    let blue=0,red=0,green=0,dark=0,minBlueX=400,maxBlueX=-1,minBlueY=400,maxBlueY=-1
    for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2],x=(i/4)%400,y=Math.floor(i/4/400)
      if(b>180&&b>r+80&&b>g+80){blue++;minBlueX=Math.min(minBlueX,x);maxBlueX=Math.max(maxBlueX,x);minBlueY=Math.min(minBlueY,y);maxBlueY=Math.max(maxBlueY,y)}
      if(r>180&&r>g+80&&r>b+80)red++
      if(g>100&&g>r+60&&g>b+60)green++
      if(r<80&&g<80&&b<80)dark++
    }
    return {blue,red,green,dark,blueBounds:[minBlueX,minBlueY,maxBlueX,maxBlueY],svgHasText:svg.svg.includes('PAPER NOTE'),svgRects:(svg.svg.match(/<rect\b/g)??[]).length,svgReport:svg.report,pngReport:png.renderReport,unchanged:drawing.serialize()===before}
  })
  expect(result.blue).toBeGreaterThan(100);expect(result.blueBounds[0]).toBeGreaterThanOrEqual(118);expect(result.blueBounds[2]).toBeLessThanOrEqual(282)
  expect(result.blueBounds[1]).toBeGreaterThanOrEqual(198);expect(result.blueBounds[3]).toBeLessThanOrEqual(202)
  expect(result.red).toBe(0);expect(result.green).toBe(0);expect(result.dark).toBeGreaterThan(10)
  expect(result.svgHasText).toBe(true);expect(result.svgRects).toBe(2);expect(result.unchanged).toBe(true)
  expect(result.svgReport.viewports).toHaveLength(1);expect(result.svgReport.hidden).toBe(2)
  expect(result.pngReport.viewportDiagnostics[0]).toMatchObject({rendered:1,hidden:1,unsupported:0})
  expect(result.pngReport.hidden).toBe(1);expect(result.pngReport.unsupported).toBe(0)
})
