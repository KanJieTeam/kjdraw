import { createRoadDesignFixture, roadDrawingFixtureOptions } from '../../packages/kjdraw-sdk/examples/fixtures/road-design.mjs'
import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

test('tabulated 600 m road produces editable plan, profile, thirteen sections and quantities after explicit recompilation', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  const result = await page.evaluate(async ({fixture,roadDrawingFixtureOptions}) => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { buildRoadDrawing } = await import('/packages/kjdraw-sdk/src/road-drawing.js')
    const { captureDrawingView } = await import('/packages/kjdraw-sdk/src/drawing-image.js')
    const createRoadDesignFixture=()=>structuredClone(fixture)
    const input = createRoadDesignFixture(), images = [], versions = []
    const original = JSON.stringify(input)
    for (const name of ['original', 'wider-left', 'raised-profile']) {
      if (name === 'wider-left') input.pavement.leftWidth += .75
      if (name === 'raised-profile') input.profile.forEach(point => { point.elevation += 1.25 })
      // Each build is an explicit complete recompilation into a fresh review document.
      // This deliberately does not pretend that modifying a parameter updates a live document.
      const compiled = buildRoadDrawing(input, roadDrawingFixtureOptions)
      const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'meter' })
      await sdk.executeCommand('CREATEBATCH', { resources: compiled.resources, entities: compiled.entities })
      const before = drawing.serialize()
      const dxf = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
      const kjd = await sdk.writeDocument(drawing, { format: 'KJD' })
      const reopened = []
      for (const [format, raw] of [['DXF', dxf], ['KJD', kjd]]) {
        const document = await createKJDrawSDK().readDocument(raw, { format })
        reopened.push({ format, units: document.snapshot().header.units, entities: document.listEntities({ ownerId: document.snapshot().spaces.modelSpaceId }).length, types: [...new Set(document.listEntities().map(e => e.type))].sort() })
      }
      const frame = key => compiled.frames.find(frame => frame.key === key).bounds
      const profile = frame('profile-tables'), sections = frame('sections')
      const p = compiled.projections.sections[0]
      const detailEntities = compiled.entities.filter(e => e.key.startsWith('sections/station/0/'))
      const coords = detailEntities.flatMap(e => e.type === 'LWPOLYLINE' ? e.payload.vertices : e.type === 'LINE' ? [e.payload.start, e.payload.end] : [e.payload.position, [e.payload.position[0] + e.payload.text.length * e.payload.height * 1.2, e.payload.position[1] + e.payload.height, 0]])
      const sectionDetail = [Math.min(...coords.map(p => p[0]))-6, Math.min(...coords.map(p => p[1]))-6, Math.max(...coords.map(p => p[0]))+6, Math.max(...coords.map(p => p[1]))+6]
      const tableCells = compiled.entities.filter(e => e.type === 'TEXT' && (e.key.startsWith('profile/station-table/') || e.key.startsWith('profile/volume-table/')))
      const tableDetail = [profile[0]+10, Math.min(...tableCells.map(e => e.payload.position[1]))-8, Math.max(...tableCells.map(e => e.payload.position[0]+String(e.payload.text).length*3*1.2))+8, Math.max(...tableCells.map(e => e.payload.position[1]))+10]
      const views = name === 'original'
        ? [['overview', compiled.bounds], ['plan', frame('plan')], ['profile-tables', profile], ['sections', sections], ['table-detail', tableDetail], ['section-detail', sectionDetail]]
        : [['overview', compiled.bounds], ['table-detail', tableDetail], ['section-detail', sectionDetail]]
      for (const [view, bounds] of views) {
        const spanX = bounds[2]-bounds[0], spanY = bounds[3]-bounds[1], scale = Math.min(1600/spanX, 1600/spanY, Math.sqrt(1_950_000/(spanX*spanY)))
        const width = Math.max(1, Math.floor(spanX*scale)), height = Math.max(1, Math.floor(spanY*scale))
        const image = await captureDrawingView(drawing, { bounds, width, height, pixelRatio: 1, theme: 'light' })
        const decoded = new Image(); decoded.src = image.dataUrl; await decoded.decode()
        const canvas = document.createElement('canvas'); canvas.width=decoded.width;canvas.height=decoded.height
        const ctx = canvas.getContext('2d');ctx.drawImage(decoded,0,0)
        const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data
        let ink = 0
        for (let i=0;i<pixels.length;i+=16) if (Math.min(pixels[i],pixels[i+1],pixels[i+2])<210) ink++
        images.push({ version:name,view,...image,inkSamples:ink,textHeightPixels:3*image.pixelWidth/(image.viewBounds[2]-image.viewBounds[0]) })
      }
      const summaryEntity = key => compiled.entities.find(e => e.key === key)
      versions.push({ name, dxf, kjd, input:structuredClone(input), unchanged:drawing.serialize()===before, calculation:compiled.calculation, frames:compiled.frames, count:compiled.entities.length, reopened,
        keys:compiled.entities.map(e=>[e.key,e.options.id]), sectionCount:compiled.projections.sections.length,
        nativeTypes:[...new Set(drawing.listEntities().map(e=>e.type))].sort(),
        widthGeometry:summaryEntity('sections/station/0/design').payload.vertices,
        designElevationLabel:summaryEntity('profile/station-table/row/0/cell/1').payload.text,
        fillVolumeLabel:summaryEntity('profile/volume-table/row/total/cell/4').payload.text,
        cutVolumeLabel:summaryEntity('profile/volume-table/row/total/cell/3').payload.text,
        sectionProjection:p })
    }
    return { sourceWasIndependent:original===JSON.stringify(createRoadDesignFixture()), versions, images }
  },{fixture:createRoadDesignFixture(),roadDrawingFixtureOptions})
  expect(result.sourceWasIndependent).toBe(true)
  expect(result.versions).toHaveLength(3)
  for (const version of result.versions) {
    expect(version.unchanged).toBe(true)
    expect(version.calculation.length).toBe(600)
    expect(version.sectionCount).toBe(13)
    expect(version.calculation.sections.map(s=>s.station)).toEqual(Array.from({length:13},(_,i)=>i*50))
    expect(version.nativeTypes).toEqual(['LINE','LWPOLYLINE','TEXT'])
    expect(version.calculation.totalVolume.cut).toBeGreaterThan(0)
    expect(version.calculation.totalVolume.fill).toBeGreaterThan(0)
    expect(version.cutVolumeLabel).toBe(version.calculation.totalVolume.cut.toFixed(3))
    expect(version.fillVolumeLabel).toBe(version.calculation.totalVolume.fill.toFixed(3))
    for (const reopened of version.reopened) expect(reopened).toMatchObject({units:'meter',entities:version.count,types:['LINE','LWPOLYLINE','TEXT']})
  }
  const [a,b,c]=result.versions
  expect(b.keys).toEqual(a.keys);expect(c.keys).toEqual(b.keys)
  expect(b.widthGeometry).not.toEqual(a.widthGeometry)
  expect(b.calculation.totalVolume).not.toEqual(a.calculation.totalVolume)
  expect(c.calculation.totalVolume.fill).toBeGreaterThan(b.calculation.totalVolume.fill)
  expect(c.calculation.totalVolume.cut).toBeLessThan(b.calculation.totalVolume.cut)
  expect(c.designElevationLabel).not.toBe(b.designElevationLabel)
  expect(c.widthGeometry).not.toEqual(b.widthGeometry)
  await mkdir('.cache/road-drawing',{recursive:true})
  for (const image of result.images) {
    expect(image.renderReport.unsupported).toBe(0)
    expect(image.renderReport.unsupportedTypes).toEqual([])
    expect(image.renderReport.approximateTypes.every(type=>type==='TEXT')).toBe(true)
    expect(image.inkSamples).toBeGreaterThan(100)
    expect(image.pixelWidth*image.pixelHeight).toBeLessThanOrEqual(2_000_000)
    if (image.view.endsWith('detail')) expect(image.textHeightPixels).toBeGreaterThanOrEqual(10)
    const png=Buffer.from(image.dataUrl.split(',')[1],'base64')
    expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]))
    const name=`${testInfo.project.name}-${image.version}-${image.view}`
    await writeFile(`.cache/road-drawing/${name}.png`,png)
    await testInfo.attach(name,{body:png,contentType:'image/png'})
  }
  for (const version of result.versions) {
    await writeFile(`.cache/road-drawing/${testInfo.project.name}-${version.name}.dxf`,version.dxf)
    await writeFile(`.cache/road-drawing/${testInfo.project.name}-${version.name}.kjd`,version.kjd)
  }
  await writeFile(`.cache/road-drawing/${testInfo.project.name}-acceptance.json`,JSON.stringify({ scope:'Original input / deterministic SDK compilation, not an AI result or automatic update. PNGs require human visual review; font rendering remains an acknowledged TEXT approximation.', versions:result.versions.map(({dxf,kjd,...v})=>v), images:result.images.map(({dataUrl,...image})=>image) },null,2)+'\n')
})

test('explicit host rebuild updates the same road document with stable identities, one undo and preserved external geometry', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state', 'ready')
  const result = await page.evaluate(async ({ fixture, options }) => {
    const { createKJDrawSDK } = await import('/packages/kjdraw-sdk/src/sdk.js')
    const { buildRoadDrawing } = await import('/packages/kjdraw-sdk/src/road-drawing.js')
    const { applyRoadDrawingRevision } = await import('/packages/kjdraw-sdk/src/road-drawing-update.js')
    const { captureDrawingView } = await import('/packages/kjdraw-sdk/src/drawing-image.js')
    const { normalizeStandardEntityPayload } = await import('/packages/kjdraw-sdk/src/standard-entities.js')
    const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units:'meter' }), documentId = drawing.id
    const input = structuredClone(fixture), previous = buildRoadDrawing(input, options)
    await sdk.executeCommand('CREATEBATCH', { resources:previous.resources, entities:previous.entities })
    await sdk.executeCommand('CREATE', { type:'CIRCLE', payload:{center:[-1000,-1000,0],radius:7}, options:{id:'external-road-review-circle'} })
    const external = drawing.listEntities({type:'CIRCLE'})[0]
    const modelState = () => JSON.stringify([...drawing.listEntities()].sort((a,b)=>a.id.localeCompare(b.id)))
    const before = modelState(), resources = JSON.stringify([drawing.getTable('layers'),drawing.getTable('linetypes')])
    const originalIdentities = new Map(drawing.listEntities().map(entity=>[entity.id,{handle:entity.handle,ownerId:entity.ownerId,type:entity.type}]))
    const images = []
    const captureDetails = async (compiled, phase) => {
      const station = compiled.calculation.sections[0].station
      const groups = [
        ['table-detail', compiled.entities.filter(entity=>entity.key.startsWith('profile/station-table/') || entity.key.startsWith('profile/volume-table/'))],
        ['section-detail', compiled.entities.filter(entity=>entity.key.startsWith(`sections/station/${station}/`))],
      ]
      for (const [view, entities] of groups) {
        const coords = entities.flatMap(entity=>entity.type==='LINE' ? [entity.payload.start,entity.payload.end] : entity.type==='LWPOLYLINE' ? entity.payload.vertices : [entity.payload.position,[entity.payload.position[0]+String(entity.payload.text).length*entity.payload.height*1.2,entity.payload.position[1]+entity.payload.height]])
        const bounds = [Math.min(...coords.map(p=>p[0]))-6,Math.min(...coords.map(p=>p[1]))-6,Math.max(...coords.map(p=>p[0]))+6,Math.max(...coords.map(p=>p[1]))+6]
        const spanX = bounds[2]-bounds[0], spanY = bounds[3]-bounds[1], scale = Math.min(1600/spanX,1600/spanY,Math.sqrt(1_950_000/(spanX*spanY)))
        const image = await captureDrawingView(drawing,{bounds,width:Math.max(1,Math.floor(spanX*scale)),height:Math.max(1,Math.floor(spanY*scale)),theme:'light'})
        const decoded = new Image(); decoded.src=image.dataUrl; await decoded.decode()
        const canvas=document.createElement('canvas'); canvas.width=decoded.width; canvas.height=decoded.height
        const context=canvas.getContext('2d'); context.drawImage(decoded,0,0)
        const pixels=context.getImageData(0,0,canvas.width,canvas.height).data
        let ink=0; for(let i=0;i<pixels.length;i+=16) if(Math.min(pixels[i],pixels[i+1],pixels[i+2])<210) ink++
        images.push({phase,view,...image,inkSamples:ink})
      }
    }
    await captureDetails(previous,'original')
    // The host explicitly recompiles changed inputs and requests the revision application.
    // Neither changing this input object nor buildRoadDrawing is an automatic document listener.
    input.pavement.leftWidth += .75
    input.profile.forEach(point=>{point.elevation += 1.25})
    const next=buildRoadDrawing(input,options), beforeApply=drawing.revision
    const unmodifiedUntilApply=modelState()===before
    const receipt=await applyRoadDrawingRevision(drawing,previous,next,{expectedRevision:beforeApply})
    const atAppliedRevision=drawing.revision
    const sameIdentities=next.entities.filter(entity=>originalIdentities.has(entity.options.id)).every(entity=>{
      const actual=drawing.getObject(entity.options.id), old=originalIdentities.get(entity.options.id)
      return actual.handle===old.handle && actual.ownerId===old.ownerId && actual.type===old.type
    })
    const allNativePayloads=next.entities.every(entity=>JSON.stringify(drawing.getObject(entity.options.id).payload)===JSON.stringify(normalizeStandardEntityPayload(entity.type,entity.payload)))
    const externalPreserved=JSON.stringify(drawing.getObject(external.id))===JSON.stringify(external)
    const after=modelState(), beforeCapture=drawing.serialize()
    await captureDetails(next,'applied')
    const captureReadOnly=drawing.serialize()===beforeCapture
    await sdk.executeCommand('UNDO'); const undoExact=modelState()===before
    await sdk.executeCommand('REDO'); const redoExact=modelState()===after
    const reopened=[], artifacts=[]
    for(const format of ['KJD','DXF']) {
      const raw=await sdk.writeDocument(drawing,{format,...(format==='DXF'?{version:'2018'}:{})})
      const document=await createKJDrawSDK().readDocument(raw,{format})
      const circle=document.listEntities({type:'CIRCLE'}).find(entity=>entity.payload.radius===7)
      reopened.push({format,count:document.listEntities().length,units:document.snapshot().header.units,externalCenter:circle?.payload.center,externalRadius:circle?.payload.radius,
        text:document.listEntities({type:'TEXT'}).map(entity=>entity.payload.text),stableIds:format==='KJD' ? next.entities.every(entity=>!!document.getObject(entity.options.id)) : null})
      artifacts.push({format,raw})
    }
    const find=(compiled,key)=>compiled.entities.find(entity=>entity.key===key)
    const labels=['profile/station-table/row/0/cell/1','profile/volume-table/row/total/cell/3','profile/volume-table/row/total/cell/4'].map(key=>({key,original:find(previous,key).payload.text,expected:find(next,key).payload.text,actual:drawing.getObject(find(next,key).options.id).payload.text}))
    return {sameDocument:drawing.id===documentId,documentId,unmodifiedUntilApply,beforeApply,atAppliedRevision,receipt,sameIdentities,allNativePayloads,externalPreserved,captureReadOnly,undoExact,redoExact,
      resourcesPreserved:JSON.stringify([drawing.getTable('layers'),drawing.getTable('linetypes')])===resources,
      originalCount:previous.entities.length,nextCount:next.entities.length,actualCount:drawing.listEntities().length,
      originalWidth:normalizeStandardEntityPayload('LWPOLYLINE',find(previous,'sections/station/0/design').payload).vertices,updatedWidth:drawing.getObject(find(next,'sections/station/0/design').options.id).payload.vertices,
      originalVolumes:previous.calculation.totalVolume,updatedVolumes:next.calculation.totalVolume,labels,reopened,artifacts,images}
  }, {fixture:createRoadDesignFixture(),options:roadDrawingFixtureOptions})
  for(const key of ['sameDocument','unmodifiedUntilApply','sameIdentities','allNativePayloads','externalPreserved','captureReadOnly','undoExact','redoExact','resourcesPreserved']) expect(result[key],key).toBe(true)
  expect(result.atAppliedRevision).toBe(result.beforeApply+1)
  expect(result.receipt.revision).toBe(result.atAppliedRevision)
  expect(result.receipt.updatedIds.length).toBeGreaterThan(0)
  expect(result.actualCount).toBe(result.nextCount+1)
  expect(result.originalCount+result.receipt.createdIds.length-result.receipt.removedIds.length).toBe(result.nextCount)
  expect(result.updatedWidth).not.toEqual(result.originalWidth)
  expect(result.updatedVolumes).not.toEqual(result.originalVolumes)
  expect(result.labels[0].actual).not.toBe(result.labels[0].original)
  expect(result.labels[1].actual).toBe(result.updatedVolumes.cut.toFixed(3))
  expect(result.labels[2].actual).toBe(result.updatedVolumes.fill.toFixed(3))
  for(const label of result.labels) expect(label.actual).toBe(label.expected)
  for(const reopened of result.reopened) {
    expect(reopened).toMatchObject({count:result.nextCount+1,units:'meter',externalCenter:[-1000,-1000,0],externalRadius:7})
    for(const label of result.labels) expect(reopened.text).toContain(label.expected)
    if(reopened.format==='KJD') expect(reopened.stableIds).toBe(true)
  }
  await mkdir('.cache/road-drawing',{recursive:true})
  for(const image of result.images) {
    expect(image.documentId).toBe(result.documentId)
    expect(image.renderReport.unsupported).toBe(0)
    expect(image.renderReport.approximateTypes.every(type=>type==='TEXT')).toBe(true)
    expect(image.inkSamples).toBeGreaterThan(100)
    const png=Buffer.from(image.dataUrl.split(',')[1],'base64')
    expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]))
    const name=`update-${image.phase}-${image.view}`
    await writeFile(`.cache/road-drawing/${name}.png`,png)
    await testInfo.attach(name,{body:png,contentType:'image/png'})
  }
  for(const artifact of result.artifacts) await writeFile(`.cache/road-drawing/update-applied.${artifact.format.toLowerCase()}`,artifact.raw)
  const {images,artifacts,...summary}=result
  await writeFile('.cache/road-drawing/update-acceptance.json',JSON.stringify({scope:'Explicit host rebuild and same-document revision application; no automatic constraint solver. Actual PNGs require human visual review; TEXT remains an acknowledged renderer approximation.',...summary,images:images.map(({dataUrl,...image})=>image)},null,2)+'\n')
})
