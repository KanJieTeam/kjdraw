import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready') })

for (const pixelRatio of [1, 2]) test(`capture produces real model XY PNG without changing drawing or camera at DPR ${pixelRatio}`, async ({ page }, testInfo) => {
  const result = await page.evaluate(async ratio => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { KJCanvasRenderer } = await import('/packages/kjdraw-sdk/src/canvas-renderer.js')
    const { captureDrawingView } = await import('/packages/kjdraw-sdk/src/drawing-image.js')
    const drawing = createKJDrawSDK().createDocument({ units: 'meter' })
    await drawing.transact('capture geometry', tx => {
      tx.createEntity('LINE', { start: [2,3,0], end: [8,3,0], trueColor: 0xff0000 })
      tx.createEntity('CIRCLE', { center: [5,7,0], radius: 1, trueColor: 0x0000ff })
    })
    const workbenchCanvas = document.createElement('canvas')
    workbenchCanvas.style.cssText = 'width:80px;height:60px'; document.body.append(workbenchCanvas)
    const workbench = new KJCanvasRenderer(workbenchCanvas, { document: drawing, pixelRatio: 1 })
    // Let this independent host's initial ResizeObserver delivery settle before the baseline.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    workbench.resize(80,60); Object.assign(workbench.camera, { centerX: -11, centerY: 20, scale: 2 }); workbench.render()
    const camera = JSON.stringify(workbench.camera), originalPng = workbenchCanvas.toDataURL(), before = drawing.serialize(), elements = document.querySelectorAll('canvas').length
    const image = await captureDrawingView(drawing, { bounds: [0,0,10,10], width: 240, height: 160, pixelRatio: ratio, theme: 'light' })
    const decoded = new Image(); decoded.src = image.dataUrl; await decoded.decode()
    const canvas = document.createElement('canvas'); canvas.width = decoded.width; canvas.height = decoded.height
    const context = canvas.getContext('2d'); context.drawImage(decoded,0,0)
    const sample = ([x,y]) => {
      const [left,bottom,right,top] = image.viewBounds
      const px = Math.round((x-left)/(right-left)*decoded.width), py = Math.round((top-y)/(top-bottom)*decoded.height)
      const pixels = Array.from(context.getImageData(px-2,py-2,5,5).data)
      return { red: pixels.some((v,i) => i%4 === 0 && v > pixels[i+1] + 60 && v > pixels[i+2] + 60), blue: pixels.some((v,i) => i%4 === 2 && v > pixels[i-1] + 60 && v > pixels[i-2] + 60) }
    }
    const unchanged = { document: drawing.serialize() === before, camera: JSON.stringify(workbench.camera) === camera, pixels: originalPng === workbenchCanvas.toDataURL() }
    const detached = elements === document.querySelectorAll('canvas').length
    workbench.dispose()
    workbenchCanvas.remove()
    return { ...image, decoded: [decoded.width, decoded.height], line: sample([5,3]), circle: sample([6,7]), blank: sample([0,0]), unchanged, detached }
  }, pixelRatio)
  expect(result.unchanged).toEqual({document:true,camera:true,pixels:true}); expect(result.detached).toBe(true)
  expect(result.decoded).toEqual([240*pixelRatio,160*pixelRatio])
  expect([result.pixelWidth,result.pixelHeight]).toEqual(result.decoded)
  expect(result.bounds).toEqual([0,0,10,10]); expect(result.viewBounds).toEqual([-2.5,0,12.5,10])
  expect(result.coordinateSystem).toBe('modelXY'); expect(result.units).toBe('meter'); expect(result.revision).toBe(1)
  expect(result.line.red).toBe(true); expect(result.circle.blue).toBe(true); expect(result.blank).toEqual({red:false,blue:false})
  expect(result.renderReport).toMatchObject({ total:2, rendered:2, approximated:0, unsupported:0 })
  const png = Buffer.from(result.dataUrl.split(',')[1], 'base64')
  expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]))
  await mkdir('.cache/drawing-image', { recursive:true })
  await writeFile(`.cache/drawing-image/model-xy-dpr${pixelRatio}.png`, png)
  await testInfo.attach(`model-xy-dpr${pixelRatio}`, { body:png, contentType:'image/png' })
})

test('capture exposes real approximation and unsupported diagnostics', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { captureDrawingView } = await import('/packages/kjdraw-sdk/src/drawing-image.js')
    const drawing = createKJDrawSDK().createDocument()
    await drawing.transact('diagnostic objects', tx => {
      tx.createEntity('TEXT', { text:'Measured by geometry, not pixels', position:[1,2,0], height:1 })
      tx.createEntity('UNSUPPORTED_IMAGE_TEST', { position:[3,3,0] })
    })
    return (await captureDrawingView(drawing, { bounds:[0,0,20,10], width:320, height:160 })).renderReport
  })
  expect(result).toMatchObject({ total:2, approximated:1, unsupported:1 })
  expect(result.approximateTypes).toContain('TEXT'); expect(result.unsupportedTypes).toContain('UNSUPPORTED_IMAGE_TEST')
})

test('layout PNG export uses configured plot bounds and refuses incomplete rendering by default', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { exportDrawingPng } = await import('/packages/kjdraw-sdk/src/drawing-image.js')
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units:'millimeter' })
    await sdk.executeCommand('CREATE', { type:'LINE', payload:{ start:[0,0], end:[10,10] } })
    const layoutId = drawing.snapshot().spaces.activeLayoutId
    await sdk.executeCommand('PAGESETUP', { layoutId, dxf:{ paperWidth:420, paperHeight:297, paperUnits:1, rotation:0, flags:0, plotType:4, scaleNumerator:1, scaleDenominator:1, marginLeft:10, marginRight:10, marginTop:10, marginBottom:10, originX:0, originY:0, printerName:'', styleSheet:'', shadeMode:0, windowMinX:0, windowMinY:0, windowMaxX:10, windowMaxY:10 } })
    const revision = drawing.revision, image = await exportDrawingPng(drawing, { layoutId })
    await drawing.transact('unsupported', transaction => transaction.createEntity('UNSUPPORTED_IMAGE_TEST', { position:[3,3,0] }))
    let strictError = ''
    try { await exportDrawingPng(drawing, { layoutId }) } catch (error) { strictError = error.message }
    const partial = await exportDrawingPng(drawing, { layoutId, allowPartial:true, maxEdge:400 })
    return { layoutId:image.layoutId, spaceId:image.spaceId, bounds:image.bounds, width:image.pixelWidth, height:image.pixelHeight, revisionUnchanged:image.revision===revision, strictError, partialUnsupported:partial.renderReport.unsupported }
  })
  expect(result).toMatchObject({ bounds:[0,0,10,10], width:1400, height:1400, revisionUnchanged:true, partialUnsupported:1 })
  expect(result.layoutId).toBeTruthy(); expect(result.spaceId).toBeTruthy(); expect(result.strictError).toContain('incomplete')
})

test('capture rejects changed revisions during real asynchronous PNG encoding', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { captureDrawingView } = await import('/packages/kjdraw-sdk/src/drawing-image.js')
    const drawing = createKJDrawSDK().createDocument(), native = HTMLCanvasElement.prototype.toBlob
    let mutated = false
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      return native.call(this, async blob => {
        await drawing.transact('concurrent user edit', tx => tx.createEntity('CIRCLE', { center:[0,0,0], radius:2 }))
        mutated = true; callback(blob)
      }, ...args)
    }
    try {
      await captureDrawingView(drawing, { bounds:[-5,-5,5,5], width:100, height:100 })
      return { accepted:true }
    } catch (error) { return { code:error.code, expected:error.expected, actual:error.actual, mutated, entities:Object.values(drawing.snapshot().objects).filter(object => object.kind === 'entity' && !object.erased).length } }
    finally { HTMLCanvasElement.prototype.toBlob = native }
  })
  expect(result).toEqual({ code:'KJDOCUMENT_REVISION_CONFLICT', expected:0, actual:1, mutated:true, entities:1 })
})

test('capture enforces dimensions, physical pixel budget, bounds and PNG data URL limit', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { captureDrawingView } = await import('/packages/kjdraw-sdk/src/drawing-image.js')
    const drawing = createKJDrawSDK().createDocument(), base = {bounds:[0,0,10,10],width:100,height:100}
    const bad = [{width:0},{height:1601},{width:1.5},{width:1600,height:1600},{width:900,pixelRatio:2},{pixelRatio:0},{pixelRatio:Infinity},{bounds:[0,0,0,10]},{bounds:[10,0,0,10]},{bounds:[0,0,NaN,10]},{bounds:[0,0,10]},{theme:'bogus'}]
    const errors = []
    for (const options of bad) {
      try { await captureDrawingView(drawing, {...base,...options}); errors.push('accepted') }
      catch (error) { errors.push(error.code) }
    }
    const native = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback) { callback(new Blob([new Uint8Array(800000)], {type:'image/png'})) }
    let overflow
    try { await captureDrawingView(drawing,base); overflow = 'accepted' }
    catch (error) { overflow = error.message }
    finally { HTMLCanvasElement.prototype.toBlob = native }
    const fractional = await captureDrawingView(drawing, {...base,width:101,height:77,pixelRatio:1.25})
    return {errors,overflow, fractional:[fractional.pixelWidth,fractional.pixelHeight], revision:drawing.revision}
  })
  expect(result.errors).toEqual(Array(12).fill('KJDOCUMENT_INVALID'))
  expect(result.overflow).toContain('1 MiB'); expect(result.fractional).toEqual([126,96]); expect(result.revision).toBe(0)
})


test('paper capture projects model content and identifies paper coordinates without relabeling them as model meters', async ({page}) => {
  const result=await page.evaluate(async()=>{
    const {createKJDrawSDK}=await import('/packages/kjdraw-sdk/src/sdk.js')
    const {captureDrawingView}=await import('/packages/kjdraw-sdk/src/drawing-image.js')
    const sdk=createKJDrawSDK(), drawing=sdk.createDocument({units:'meter'})
    await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[-100,100],end:[300,100],trueColor:0xff0000}})
    const layout=await sdk.executeCommand('LAYOUT',{operation:'create',name:'Capture sheet'})
    await sdk.executeCommand('VIEWPORT',{layoutId:layout.id,center:[50,50],width:40,height:20,viewCenter:[100,100],viewHeight:40})
    await drawing.transact('explicit paper unit',tx=>tx.updateObject(layout.id,{payload:{plotSettings:{paperUnits:1}}}))
    const before=drawing.serialize(),spaceId=layout.payload.blockRecordId
    const image=await captureDrawingView(drawing,{spaceId,bounds:[0,0,100,100],width:400,height:400,theme:'light'})
    const decoded=new Image();decoded.src=image.dataUrl;await decoded.decode()
    const canvas=document.createElement('canvas');canvas.width=400;canvas.height=400
    const ctx=canvas.getContext('2d');ctx.drawImage(decoded,0,0)
    const red=(x,y)=>{const data=ctx.getImageData(x-2,y-2,5,5).data;for(let i=0;i<data.length;i+=4)if(data[i]>200&&data[i]>data[i+1]+80&&data[i]>data[i+2]+80)return true;return false}
    const failures=[]
    for(const id of ['missing',drawing.getTable('layers').currentId])try{await captureDrawingView(drawing,{spaceId:id,bounds:[0,0,100,100],width:100,height:100});failures.push('accepted')}catch(e){failures.push(e.code)}
    return {coordinateSystem:image.coordinateSystem,units:image.units,documentUnits:image.documentUnits,spaceIdMatches:image.spaceId===spaceId,report:image.renderReport,center:red(200,200),outside:red(320,200),unchanged:drawing.serialize()===before,failures}
  })
  expect(result).toMatchObject({coordinateSystem:'paperXY',units:'millimeter',documentUnits:'meter',spaceIdMatches:true,center:true,outside:false,unchanged:true,failures:['KJDOCUMENT_INVALID','KJDOCUMENT_INVALID']})
  expect(result.report.unsupported).toBe(0)
  expect(result.report.viewportDiagnostics).toHaveLength(1)
  expect(result.report.viewportDiagnostics[0].rendered).toBe(1)
})
