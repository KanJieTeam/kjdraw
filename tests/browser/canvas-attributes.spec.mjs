import {test,expect} from '@playwright/test'

test('attached attributes render once in their owner coordinates, preserve text transforms and select the parent',async({page})=>{
 await page.goto('/')
 const result=await page.evaluate(async()=>{
  const [{createKJDrawSDK},{KJCanvasRenderer},{exportDrawingSvg}]=await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'),import('/packages/kjdraw-sdk/src/canvas-renderer.js'),import('/packages/kjdraw-sdk/src/svg-export.js')])
  document.body.replaceChildren();document.body.style.margin='0'
  const canvas=document.createElement('canvas');canvas.style.cssText='width:1000px;height:650px';document.body.append(canvas)
  const context=canvas.getContext('2d',{willReadFrequently:true}),sdk=createKJDrawSDK(),drawing=sdk.createDocument({units:'millimeter'})
  await drawing.transact('native attribute fixture',tx=>{
   const symbol=tx.upsertTableRecord('blockRecords',{id:'symbol',name:'Instrument',payload:{basePoint:[0,0,0]}})
   tx.createEntity('CIRCLE',{center:[0,0],radius:2},{id:'shape',ownerId:symbol.id})
   tx.createEntity('ATTDEF',{position:[0,4],tag:'TAG',text:'PLACEHOLDER',height:2,flags:0},{id:'definition',ownerId:symbol.id})
   tx.createEntity('INSERT',{blockRecordId:symbol.id,position:[20,30],scale:[3,3,1],rotation:Math.PI/2},{id:'root'})
   tx.createEntity('ATTRIB',{position:[100,50],alignmentPoint:[100,50],horizontalAlignment:1,verticalAlignment:2,text:'AB',tag:'TAG',height:10,widthFactor:.7,parentInsertId:'root'},{id:'attribute'})
   tx.createEntity('ATTRIB',{position:[-500,-500],text:'SECRET',tag:'HIDDEN',height:10,flags:1,parentInsertId:'root'},{id:'hidden'})
   tx.createObject({id:'root-end',kind:'custom',type:'SEQEND',ownerId:'root',payload:{dxfOwnerMode:'insert'}})
    tx.updateObject('root',{payload:{attributeIds:['attribute','hidden'],sequenceEndId:'root-end'}})
   const outer=tx.upsertTableRecord('blockRecords',{id:'outer',name:'Outer',payload:{basePoint:[5,8,0]}})
   tx.createEntity('INSERT',{blockRecordId:symbol.id,position:[12,16],rotation:Math.PI/2,scale:[3,3,1]},{id:'nested',ownerId:outer.id})
   tx.createEntity('ATTRIB',{position:[50,20],text:'NESTED',tag:'TAG',height:4,parentInsertId:'nested'},{id:'nested-attribute',ownerId:outer.id})
   tx.createObject({id:'nested-end',kind:'custom',type:'SEQEND',ownerId:'nested',payload:{dxfOwnerMode:'insert'}})
    tx.updateObject('nested',{payload:{attributeIds:['nested-attribute'],sequenceEndId:'nested-end'}})
   tx.createEntity('INSERT',{blockRecordId:outer.id,position:[250,40],scale:[2,2,1]},{id:'outer-insert'})
  })
  const renderer=new KJCanvasRenderer(canvas,{document:drawing,theme:'light',grid:false,pixelRatio:1})
  renderer.camera.centerX=190;renderer.camera.centerY=50;renderer.camera.scale=2;renderer.resize(1000,650)
  let calls=[];const fill=context.fillText.bind(context)
  context.fillText=(value,x,y,...rest)=>{const m=context.getTransform();calls.push({text:String(value),matrix:[m.a,m.b,m.c,m.d,m.e,m.f],x,y,font:context.font});fill(value,x,y,...rest)}
  const before=drawing.serialize();renderer.render();const labels=calls.slice(),parentHit=renderer.hitTest(renderer.worldToScreen([100,50]),2)?.entity.id,nestedHit=renderer.hitTest(renderer.worldToScreen([344,67]),2)?.entity.id
  const inkAt=p=>{const q=renderer.worldToScreen(p),pixels=context.getImageData(Math.round(q[0])-15,Math.round(q[1])-15,30,30).data;let ink=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<180&&pixels[i+1]<180&&pixels[i+2]<180)ink++;return ink}
  const ink=[inkAt([100,50]),inkAt([347,67])],unchanged=drawing.serialize()===before
  renderer.fit();const fitCamera={...renderer.camera},fitPoint=renderer.worldToScreen([360,72]),width=canvas.width,height=canvas.height
  const layoutId=drawing.snapshot().spaces.layoutIds[0]
  await sdk.executeCommand('PLOTSETUP',{layoutId,dxf:{paperWidth:420,paperHeight:297,paperUnits:1,plotType:4,flags:0,windowMinX:0,windowMinY:0,windowMaxX:400,windowMaxY:200,scaleNumerator:1,scaleDenominator:1}},{document:drawing})
  const exported=exportDrawingSvg(drawing,{layoutId}),host=document.createElement('div');host.innerHTML=exported.svg;document.body.append(host)
  const glyphs=[...host.querySelectorAll('text')].map(e=>{const m=host.querySelector('svg').getCTM().inverse().multiply(e.getCTM());return{text:e.textContent,matrix:[m.a,m.b,m.c,m.d,m.e,m.f]}})
  await drawing.transact('reflect ancestor',tx=>tx.updateObject('outer-insert',{payload:{scale:[-2,1.5,1]}}));calls=[];renderer.render()
  const reflected=calls.find(c=>c.text==='NESTED'),reflectedOrigin=renderer.worldToScreen([160,58]),reflectedHit=renderer.hitTest(renderer.worldToScreen([154,60]),2)?.entity.id
  await drawing.transact('hide parent',tx=>tx.updateObject('root',{payload:{visible:false}}));calls=[];renderer.render()
  return {reflected,reflectedOrigin,reflectedHit,labels,parentHit,nestedHit,ink,unchanged,fitInside:fitPoint[0]>0&&fitPoint[0]<width&&fitPoint[1]>0&&fitPoint[1]<height,fitCamera,glyphs,hiddenLabels:calls.map(c=>c.text),hiddenHit:renderer.hitTest(renderer.worldToScreen([100,50]),2)?.entity.id??null,svgDiagnostics:exported.report.diagnostics}
 })
 expect(result.labels.map(c=>c.text)).toEqual(['AB','NESTED'])
 result.labels[0].matrix.forEach((value,i)=>expect(value).toBeCloseTo([.7,0,0,1,320,325][i],6))
 result.labels[1].matrix.forEach((value,i)=>expect(value).toBeCloseTo([2,0,0,2,800,297][i],6))
 expect(result.parentHit).toBe('root');expect(result.nestedHit).toBe('outer-insert')
 expect(result.ink.every(value=>value>5)).toBe(true);expect(result.unchanged).toBe(true);expect(result.fitInside).toBe(true)
 expect(result.glyphs.map(c=>c.text)).toEqual(['AB','NESTED']);expect(result.svgDiagnostics).toEqual([])
 result.glyphs[0].matrix.forEach((value,i)=>expect(value).toBeCloseTo([.7,0,0,1,100,247][i],5))
 result.glyphs[1].matrix.forEach((value,i)=>expect(value).toBeCloseTo([2,0,0,2,340,233][i],5))
 result.reflected.matrix.forEach((value,i)=>expect(value).toBeCloseTo(Math.fround([-2,0,0,1.5,...result.reflectedOrigin][i]),6))
 expect(result.reflectedHit).toBe('outer-insert')
 expect(result.hiddenLabels).toEqual(['NESTED']);expect(result.hiddenHit).toBeNull()
})
