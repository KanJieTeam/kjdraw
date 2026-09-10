import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test.use({bypassCSP:true})

test('SDK workbench switches model and read-only paper layouts with real viewport pixels and safe return to model editing',async({page},testInfo)=>{
  test.setTimeout(120_000)
  await page.setViewportSize({width:1280,height:900})
  await page.goto('/')
  await page.evaluate(async()=>{
    const {createKJDrawSDK}=await import('/packages/kjdraw-sdk/src/sdk.js')
    const {mountKJDrawWorkbench}=await import('/packages/kjdraw-sdk/src/workbench.js')
    document.body.replaceChildren();document.body.style.margin='0'
    const host=document.createElement('div');host.style.cssText='width:1240px;height:820px';document.body.append(host)
    const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'workbench-paper-test',units:'millimeter'})
    const model=await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[0,0,0],end:[40,0,0],trueColor:0xff0000}})
    const layout=await sdk.executeCommand('LAYOUT',{operation:'create',name:'Review sheet A'})
    await sdk.executeCommand('VIEWPORT',{layoutId:layout.id,center:[50,50],width:80,height:40,viewCenter:[20,0],viewHeight:20})
    const paper=await drawing.transact('native paper line',tx=>tx.createEntity('LINE',{start:[20,75,0],end:[80,75,0],trueColor:0x0000ff},{ownerId:layout.payload.blockRecordId}))
    const workbench=mountKJDrawWorkbench(host,{sdk,document:drawing,locale:'en',theme:'light',grid:false,showLayers:false})
    await workbench.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    workbench.renderer.resize();workbench.renderer.fit()
    await workbench.execute('SELECT',{ids:[model.id]})
    workbench.setTool('line')
    window.paperWorkbench={sdk,workbench,drawing,layout,paper,model,source:drawing.serialize(),history:drawing.history}
  })
  const root=page.locator('.kjwb'),space=root.locator('[data-drawing-layout]')
  const canvasPoint=async world=>page.evaluate(world=>{
    const {workbench}=window.paperWorkbench,rect=workbench.root.querySelector('[data-canvas]').getBoundingClientRect(),p=workbench.renderer.worldToScreen(world)
    return {x:rect.left+p[0],y:rect.top+p[1]}
  },world)
  const first=await canvasPoint([5,-5]);await page.mouse.click(first.x,first.y)
  const layoutId=await page.evaluate(()=>window.paperWorkbench.layout.id)
  await space.selectOption(layoutId)
  await expect(root).toHaveAttribute('data-drawing-space','paper')
  await expect(root.locator('[data-paper-preview]')).toContainText('return to Model to edit')
  await expect(root.locator('[data-tool="line"]')).toBeDisabled()
  await expect(root.locator('[data-command]')).toBeDisabled()
  const paperState=await page.evaluate(async()=>{
    const state=window.paperWorkbench,{drawing,workbench}=state
    let rejection=''
    try{await workbench.execute('CREATE',{type:'POINT',payload:{position:[1,2]}})}catch(error){rejection=error.message}
    const beforeSelection=workbench.snapshot().selectedIds
    let crossSelection=''
    try{await workbench.execute('SELECT',{ids:[state.model.id]})}catch(error){crossSelection=error.message}
    return {snapshot:workbench.snapshot(),beforeSelection,rejection,crossSelection,unchanged:drawing.serialize()===state.source,historyUnchanged:JSON.stringify(drawing.history)===JSON.stringify(state.history)}
  })
  expect(paperState.unchanged).toBe(true);expect(paperState.historyUnchanged).toBe(true)
  expect(paperState.beforeSelection).toEqual([]);expect(paperState.snapshot.paperPreview).toBe(true)
  expect(paperState.rejection).toContain('Paper preview');expect(paperState.crossSelection).toContain('displayed paper space')
  expect(paperState.snapshot.tool).toBe('select')
  const paperPoint=await canvasPoint([50,75]);await page.mouse.click(paperPoint.x,paperPoint.y)
  const selected=await page.evaluate(()=>{
    const {workbench,drawing}=window.paperWorkbench
    return workbench.snapshot().selectedIds.map(id=>({id,ownerId:drawing.getObject(id).ownerId}))
  })
  expect(selected).toEqual([{id:await page.evaluate(()=>window.paperWorkbench.paper.id),ownerId:paperState.snapshot.spaceId}])
  await root.focus()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+Shift+z')
  await page.keyboard.press('Control+a')
  const shortcuts=await page.evaluate(()=>{
    const {workbench,drawing,source,history}=window.paperWorkbench
    return {
      unchanged:drawing.serialize()===source,
      historyUnchanged:JSON.stringify(drawing.history)===JSON.stringify(history),
      owners:workbench.snapshot().selectedIds.map(id=>drawing.getObject(id).ownerId),
    }
  })
  expect(shortcuts.unchanged).toBe(true);expect(shortcuts.historyUnchanged).toBe(true)
  expect(shortcuts.owners).toEqual([paperState.snapshot.spaceId,paperState.snapshot.spaceId])
  const image=await page.evaluate(()=>{
    const {workbench}=window.paperWorkbench,canvas=workbench.root.querySelector('[data-canvas]'),context=canvas.getContext('2d')
    const ratio=canvas.width/canvas.getBoundingClientRect().width
    const sample=world=>{
      const p=workbench.renderer.worldToScreen(world),pixels=context.getImageData(Math.round(p[0]*ratio)-2,Math.round(p[1]*ratio)-2,5,5).data
      let red=false,blue=false
      for(let i=0;i<pixels.length;i+=4){red ||= pixels[i]>180&&pixels[i]>pixels[i+1]+70&&pixels[i]>pixels[i+2]+70;blue ||= pixels[i+2]>180&&pixels[i+2]>pixels[i]+70}
      return {red,blue}
    }
    // Deselect so the independently colored paper entity remains blue in the capture.
    workbench.sdk.getSelectionManager(workbench.document.id).active.clear()
    return {png:canvas.toDataURL(),modelProjection:sample([50,50]),paperLine:sample([50,75]),report:workbench.renderer.report}
  })
  expect(image.modelProjection.red).toBe(true);expect(image.paperLine.blue).toBe(true)
  expect(image.report.viewportDiagnostics[0].rendered).toBeGreaterThan(0)
  expect(image.report.unsupported).toBe(0)
  await mkdir('.cache/workbench-paper-space',{recursive:true})
  const png=Buffer.from(image.png.split(',')[1],'base64')
  await writeFile('.cache/workbench-paper-space/paper-preview.png',png)
  await testInfo.attach('paper-preview',{body:png,contentType:'image/png'})
  await root.locator('[data-action="language"]').click()
  await expect(space).toHaveAttribute('aria-label','图纸空间')
  await expect(root.locator('[data-paper-preview]')).toContainText('返回模型后编辑')
  await root.locator('[data-action="language"]').click()
  const reopen=await page.evaluate(async()=>{
    const {workbench,drawing}=window.paperWorkbench,{createKJDrawSDK}=await import('/packages/kjdraw-sdk/src/sdk.js')
    const original=drawing.serialize(),checks=[];let kjd
    for(const format of ['KJD','DXF']){
      const raw=await workbench.save(format,{download:false}),other=await createKJDrawSDK().readDocument(raw,{format})
      const layout=other.listObjects({kind:'layout'}).find(item=>item.name==='Review sheet A')
      checks.push({format,paper:other.listEntities({ownerId:layout.payload.blockRecordId}).map(item=>item.type).sort(),model:other.listEntities({ownerId:other.snapshot().spaces.modelSpaceId}).length})
      if(format==='KJD')kjd=raw
    }
    const unchanged=drawing.serialize()===original
    await workbench.open(kjd,{format:'KJD',fileName:'paper-review.kjd'})
    window.paperWorkbench.drawing=workbench.document
    return {checks,unchanged,paperPreview:workbench.paperPreview,selected:workbench.snapshot().selectedIds}
  })
  expect(reopen.unchanged).toBe(true);expect(reopen.paperPreview).toBe(false);expect(reopen.selected).toEqual([])
  for(const check of reopen.checks)expect(check).toMatchObject({paper:['LINE','VIEWPORT'],model:1})
  await space.selectOption(layoutId)
  expect(await page.evaluate(()=>window.paperWorkbench.workbench.renderer.report.viewportDiagnostics[0].rendered)).toBeGreaterThan(0)
  // Native select keyboard navigation returns to Model, with the readonly controls restored.
  await space.focus();await space.press('Home');await space.press('Enter')
  await expect(root).toHaveAttribute('data-drawing-space','model')
  await expect(root.locator('[data-tool="line"]')).toBeEnabled()
  const beforeIds=await page.evaluate(()=>window.paperWorkbench.drawing.listEntities().map(entity=>entity.id))
  await root.locator('[data-tool="line"]').click()
  for(const world of [[5,-5],[15,-5]]){const point=await canvasPoint(world);await page.mouse.click(point.x,point.y)}
  await expect.poll(()=>page.evaluate(()=>window.paperWorkbench.drawing.listEntities().length)).toBe(beforeIds.length+1)
  const created=await page.evaluate(ids=>{
    const {drawing}=window.paperWorkbench
    return {modelSpaceId:drawing.snapshot().spaces.modelSpaceId,entities:drawing.listEntities().filter(entity=>!ids.includes(entity.id)).map(entity=>({ownerId:entity.ownerId,type:entity.type}))}
  },beforeIds)
  expect(created.entities).toEqual([{ownerId:created.modelSpaceId,type:'LINE'}])
  const extra=await page.evaluate(async()=>{
    const {sdk}=window.paperWorkbench
    return (await sdk.executeCommand('LAYOUT',{operation:'create',name:'Sheet B'})).id
  })
  await expect(space.locator(`option[value="${extra}"]`)).toHaveText('Sheet B')
  await space.selectOption(extra)
  await page.evaluate(async id=>{await window.paperWorkbench.sdk.executeCommand('LAYOUT',{operation:'update',id,newName:'改名布局'})},extra)
  await expect(space.locator(`option[value="${extra}"]`)).toHaveText('改名布局')
  await page.evaluate(async id=>{await window.paperWorkbench.drawing.transact('host removes layout',tx=>tx.eraseObject(id))},extra)
  await expect(root).toHaveAttribute('data-drawing-space','model')
  await expect(space.locator(`option[value="${extra}"]`)).toHaveCount(0)
  await space.selectOption(layoutId)
  await page.evaluate(async()=>{
    const {sdk,workbench}=window.paperWorkbench
    await workbench.setDocument(sdk.createDocument({documentId:'second-layout-document'}))
  })
  await expect(root).toHaveAttribute('data-drawing-space','model')
  await expect(space.locator(`option[value="${layoutId}"]`)).toHaveCount(0)
  expect(await page.evaluate(()=>window.paperWorkbench.workbench.snapshot().selectedIds)).toEqual([])
})
