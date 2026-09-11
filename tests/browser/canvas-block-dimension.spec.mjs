import {test,expect} from '@playwright/test'
test.use({bypassCSP:true})
test('native block dimensions retain values under nested anisotropic reflection on a real canvas',async({page},testInfo)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  globalThis.document.body.replaceChildren();globalThis.document.body.style.margin='0';const canvas=globalThis.document.createElement('canvas');canvas.width=1100;canvas.height=720;canvas.style.cssText='width:1100px;height:720px';globalThis.document.body.append(canvas)
  const [{createKJDrawSDK},{KJCanvasRenderer},{projectDimension},{multiply3,translation3,rotation3,scale3},{selectEntitiesByFence}]=await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'),import('/packages/kjdraw-sdk/src/canvas-renderer.js'),import('/packages/kjdraw-sdk/src/geometry/annotation.js'),import('/packages/kjdraw-sdk/src/geometry/matrix3.js'),import('/packages/kjdraw-sdk/src/selection-geometry.js')])
  const sdk=createKJDrawSDK(),document=sdk.createDocument({units:'millimeter'});let angular,insert
  await document.transact('render real nested annotation instances',tx=>{
   const a=tx.upsertTableRecord('blockRecords',{name:'inner',type:'BLOCK_RECORD',payload:{basePoint:[2,3,0]}}),b=tx.upsertTableRecord('blockRecords',{name:'outer',type:'BLOCK_RECORD',payload:{basePoint:[-4,6,0]}})
   tx.createEntity('DIMENSION',{dimensionType:'ALIGNED',definitionPoints:[[0,10],[0,0],[50,0]],textHeight:1.2},{ownerId:a.id})
   angular=tx.createEntity('DIMENSION',{dimensionType:'ANGULAR_3_POINT',definitionPoints:[[60,10],[80,20],[70,30],[70,20]],textHeight:1.2},{ownerId:a.id})
   tx.createEntity('INSERT',{blockRecordId:a.id,position:[4,5],rotation:Math.PI/6,scale:[1.5,.75,1]},{ownerId:b.id})
   insert=tx.createEntity('INSERT',{blockRecordId:b.id,position:[40,30],rotation:Math.PI/5,scale:[-2,3,1]})
  })
  const renderer=new KJCanvasRenderer(canvas,{document,theme:'light',grid:false,pixelRatio:1,padding:60});renderer.fit()
  const context=canvas.getContext('2d'),labels=[],native=context.fillText.bind(context);context.fillText=(text,...args)=>{labels.push(String(text));native(text,...args)}
  const before=document.serialize(),report=renderer.render(),m=multiply3(multiply3(translation3(40,30),multiply3(rotation3(Math.PI/5),multiply3(scale3(-2,3),translation3(4,-6)))),multiply3(translation3(4,5),multiply3(rotation3(Math.PI/6),multiply3(scale3(1.5,.75),translation3(-2,-3)))))
  const map=p=>[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]],arc=projectDimension(angular.payload).arcs[0],t=arc.startAngle+(arc.endAngle-arc.startAngle)*.4,u=[Math.cos(t),Math.sin(t)],p=[arc.center[0]+u[0]*arc.radius,arc.center[1]+u[1]*arc.radius],q=renderer.worldToScreen(map(p))
  const background=context.getImageData(0,0,1,1).data,pixels=context.getImageData(Math.round(q[0])-3,Math.round(q[1])-3,7,7).data;let ink=false
  for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-background[0])+Math.abs(pixels[i+1]-background[1])+Math.abs(pixels[i+2]-background[2])>80)ink=true
  const a=map([p[0]-u[0]*.1,p[1]-u[1]*.1]),b=map([p[0]+u[0]*.1,p[1]+u[1]*.1]),selected=selectEntitiesByFence(document,[a,b])
  window.blockDimensionRenderer=renderer
  return{labels,unsupported:report.unsupported,ink,selected:selected.includes(insert.id),unchanged:before===document.serialize()}
 })
 expect(result).toEqual({labels:['50','270°'],unsupported:0,ink:true,selected:true,unchanged:true})
 await page.screenshot({path:testInfo.outputPath('nested-reflected-dimensions.png')})
})
