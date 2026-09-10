import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test('paper viewport paints clipped model pixels, twist and viewport-only layer freezing after native save/reopen', async ({page},testInfo)=>{
  await page.goto('/');await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  const result=await page.evaluate(async()=>{
    const {createKJDrawSDK}=await import('/packages/kjdraw-sdk/src/sdk.js')
    const {KJCanvasRenderer}=await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const sdk=createKJDrawSDK(), drawing=sdk.createDocument({units:'millimeter'})
    const model=await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[-100,100],end:[300,100],trueColor:0xff0000}})
    const layout=await sdk.executeCommand('LAYOUT',{operation:'create',name:'Viewport pixel sheet'})
    const viewport=await sdk.executeCommand('VIEWPORT',{layoutId:layout.id,center:[50,50],width:40,height:20,viewCenter:[100,100],viewHeight:40})
    await drawing.transact('independent paper geometry',tx=>tx.createEntity('LINE',{start:[70,60],end:[90,60],trueColor:0x0000ff},{ownerId:layout.payload.blockRecordId}))
    const canvas=document.createElement('canvas');canvas.style.cssText='width:400px;height:300px';document.body.append(canvas)
    const renderer=new KJCanvasRenderer(canvas,{document:drawing,spaceId:layout.payload.blockRecordId,grid:false,pixelRatio:2,theme:'light'})
    renderer.resize(400,300);Object.assign(renderer.camera,{centerX:50,centerY:50,scale:4})
    const sample=(canvas,x,y)=>{
      const data=canvas.getContext('2d').getImageData(x*2-2,y*2-2,5,5).data
      let red=false,blue=false
      for(let i=0;i<data.length;i+=4){red ||= data[i]>200&&data[i]>data[i+1]+80&&data[i]>data[i+2]+80;blue ||= data[i+2]>200&&data[i+2]>data[i]+80}
      return {red,blue}
    }
    const capture=name=>{
      const report=renderer.render(), pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
      let redCount=0,minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1
      for(let i=0;i<pixels.length;i+=4) if(pixels[i]>200&&pixels[i]>pixels[i+1]+80&&pixels[i]>pixels[i+2]+80){
        const x=(i/4)%canvas.width,y=Math.floor(i/4/canvas.width);redCount++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)
      }
      return {name,report,png:canvas.toDataURL(),redCount,redBounds:redCount?[minX,minY,maxX,maxY]:null,center:sample(canvas,200,150),outside:sample(canvas,290,150),vertical:sample(canvas,200,130),horizontal:sample(canvas,220,150),paper:sample(canvas,300,110),camera:{...renderer.camera}}
    }
    const original=capture('original'), modelBefore=JSON.stringify(drawing.getObject(model.id).payload)
    const dxf=await sdk.writeDocument(drawing,{format:'DXF',version:'2018'}), reopened=await createKJDrawSDK().readDocument(dxf,{format:'DXF'})
    const reopenedLayout=reopened.listObjects({kind:'layout'}).find(item=>item.name==='Viewport pixel sheet')
    const other=document.createElement('canvas');other.style.cssText='width:400px;height:300px';document.body.append(other)
    const reopenedRenderer=new KJCanvasRenderer(other,{document:reopened,spaceId:reopenedLayout.payload.blockRecordId,grid:false,pixelRatio:2,theme:'light'})
    reopenedRenderer.resize(400,300);Object.assign(reopenedRenderer.camera,{centerX:50,centerY:50,scale:4});const reopenedReport=reopenedRenderer.render(), reopenedCenter=sample(other,200,150)
    reopenedRenderer.dispose();other.remove()
    await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch:{twistAngle:Math.PI/2,viewCenter:[-100,100,0]}})
    const twisted=capture('twisted')
    await sdk.executeCommand('VIEWPORT',{operation:'update',id:viewport.id,patch:{frozenLayerIds:[model.payload.layerId]}})
    const frozen=capture('frozen')
    const unchangedModel=modelBefore===JSON.stringify(drawing.getObject(model.id).payload)
    renderer.dispose();canvas.remove()
    return {original,twisted,frozen,reopenedReport,reopenedCenter,unchangedModel}
  })
  expect(result.original.center.red).toBe(true);expect(result.original.outside.red).toBe(false)
  expect(result.twisted.vertical.red).toBe(true);expect(result.twisted.horizontal.red).toBe(false)
  expect(result.frozen.center.red).toBe(false);expect(result.frozen.vertical.red).toBe(false)
  expect(result.frozen.report.viewportDiagnostics[0].hidden).toBe(1)
  expect(result.original.redCount).toBeGreaterThan(200)
  expect(result.original.redBounds[0]).toBeGreaterThanOrEqual(238);expect(result.original.redBounds[2]).toBeLessThanOrEqual(562)
  expect(result.original.redBounds[1]).toBeGreaterThanOrEqual(298);expect(result.original.redBounds[3]).toBeLessThanOrEqual(302)
  expect(result.twisted.redCount).toBeGreaterThan(100)
  expect(result.twisted.redBounds[0]).toBeGreaterThanOrEqual(398);expect(result.twisted.redBounds[2]).toBeLessThanOrEqual(402)
  expect(result.twisted.redBounds[1]).toBeGreaterThanOrEqual(218);expect(result.twisted.redBounds[3]).toBeLessThanOrEqual(382)
  expect(result.frozen.redCount).toBe(0)
  expect(result.reopenedCenter.red).toBe(true);expect(result.reopenedReport.unsupported).toBe(0)
  expect(result.unchangedModel).toBe(true)
  await mkdir('.cache/paper-viewports',{recursive:true})
  for(const image of [result.original,result.twisted,result.frozen]){
    expect(image.paper.blue).toBe(true);expect(image.report.unsupported).toBe(0)
    expect(image.camera).toEqual({centerX:50,centerY:50,scale:4})
    const png=Buffer.from(image.png.split(',')[1],'base64')
    await writeFile(`.cache/paper-viewports/${testInfo.project.name}-${image.name}.png`,png)
    await testInfo.attach(image.name,{body:png,contentType:'image/png'})
  }
})
