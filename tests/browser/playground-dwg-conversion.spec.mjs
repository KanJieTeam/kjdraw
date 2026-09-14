import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import { openKjpPackage } from '../../packages/kjdraw-sdk/src/project-package.js'

if (process.env.KJDRAW_TEST_BASE_URL) test.use({ baseURL: process.env.KJDRAW_TEST_BASE_URL })

const endpoint = 'https://dwg-provider.example.test/convert'
const sourceBytes = Buffer.from('AC1032\0KJDraw browser DWG provider test')

async function editableDxf() {
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'dwg-converted',title:'Converted DWG',units:'millimeter'})
  await sdk.executeCommand('CREATE',{type:'LINE',payload:{start:[0,0],end:[120,40]}},{document:drawing})
  await sdk.executeCommand('CREATE',{type:'CIRCLE',payload:{center:[40,20],radius:12}},{document:drawing})
  return sdk.writeDocument(drawing,{format:'DXF',version:'2018'})
}

async function ready(page) {
  await page.addInitScript(() => localStorage.setItem('kjdraw.language','en'))
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
}

test('configures a browser-only provider, imports editable DWG conversion and preserves source plus diagnostics in KJP', async ({ page }) => {
  await ready(page)
  const dxf=await editableDxf(),requests=[]
  await page.route(endpoint,async route=>{
    requests.push({method:route.request().method(),body:route.request().postDataBuffer()})
    await new Promise(resolve=>setTimeout(resolve,120))
    await route.fulfill({status:200,headers:{'content-type':'application/json'},body:JSON.stringify({format:'DXF',dxf,warnings:['SHX font substituted'],converterVersion:'7.2',diagnostics:{layouts:2,proxyObjects:1,apiKey:'must-not-persist'}})})
  })
  const before={title:await page.locator('#drawing-title').textContent(),count:await page.locator('#entity-count').textContent()}
  await page.locator('#file-input').setInputFiles({name:'plant-layout.dwg',mimeType:'application/acad',buffer:sourceBytes})
  const settings=page.locator('#dwg-provider-dialog')
  await expect(settings).toBeVisible()
  await expect(settings).toContainText('Configure a DWG conversion service')
  await expect(page.locator('#drawing-title')).toHaveText(before.title)
  await expect(page.locator('#entity-count')).toHaveText(before.count)
  await settings.locator('#dwg-provider-endpoint').fill('http://remote-converter.example/convert')
  await settings.locator('[data-action="save"]').click()
  await expect(settings.locator('.dialog-error')).toContainText('HTTPS')
  await expect(settings).toBeVisible()
  await settings.locator('#dwg-provider-endpoint').fill(endpoint)
  await settings.locator('[data-action="save"]').click()
  const progress=page.locator('#dwg-conversion-dialog')
  await expect(progress).toBeVisible()
  await expect(progress).toContainText('The current drawing remains unchanged')
  await expect(progress.locator('li[data-phase="convert"]')).toHaveAttribute('data-state','working')
  await expect(progress).toBeHidden()
  await expect(page.locator('#top-file-name')).toHaveText('plant-layout.dwg')
  await expect(page.locator('#file-state')).toHaveText('Converted by provider')
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
  await expect(page.locator('#status')).toContainText('some DWG objects may be approximated')
  expect(requests).toHaveLength(1)
  expect(requests[0].method).toBe('POST')
  expect(requests[0].body.toString('latin1')).toContain('plant-layout.dwg')
  expect(requests[0].body.toString('latin1')).toContain('outputFormat')
  await expect(progress).toHaveAttribute('data-history','validate,upload,convert,download,import')
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kjdraw.dwg-provider.v1')))).toEqual({endpoint})

  const pending=page.waitForEvent('download')
  await page.locator('#save').click()
  const bytes=await readFile(await (await pending).path()),opened=await openKjpPackage(bytes)
  const sha=createHash('sha256').update(sourceBytes).digest('hex'),asset=`assets/imports/${sha}.dwg`,diagnostic=`diagnostics/imports/${sha}.json`
  expect(Buffer.from(opened.entries.get(asset))).toEqual(sourceBytes)
  expect(opened.entries.has(diagnostic)).toBe(true)
  const report=JSON.parse(new TextDecoder().decode(opened.entries.get(diagnostic)))
  expect(report.source).toMatchObject({name:'plant-layout.dwg',sha256:sha,assetPath:`imports/${sha}.dwg`})
  expect(report.provider).toEqual({id:'kjdraw.playground.http',locality:'self-hosted',version:'7.2'})
  expect(report.diagnostics).toEqual({layouts:2,proxyObjects:1})
  expect(report.warnings).toEqual(['SHX font substituted'])
  expect(report.approximations).toEqual([])
  expect(report.potentialApproximation).toBe(true)
  expect(JSON.stringify({manifest:opened.manifest,report})).not.toContain('dwg-provider.example.test')

  await page.reload()
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#dwg-provider-settings').click()
  await expect(page.locator('#dwg-provider-endpoint')).toHaveValue(endpoint)
})

test('Escape cancels an in-flight provider conversion without replacing the current drawing', async ({ page }) => {
  await ready(page)
  await page.evaluate(value=>localStorage.setItem('kjdraw.dwg-provider.v1',JSON.stringify({endpoint:value})),endpoint)
  await page.route(endpoint,async route=>{await new Promise(resolve=>setTimeout(resolve,800));await route.fulfill({status:200,contentType:'application/dxf',body:await editableDxf()}).catch(()=>{})})
  const before={title:await page.locator('#drawing-title').textContent(),count:await page.locator('#entity-count').textContent(),revision:await page.locator('#revision').textContent()}
  await page.evaluate(({bytes})=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],'cancel-me.dwg',{type:'application/acad'}));document.querySelector('#drop-zone').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))},{bytes:[...sourceBytes]})
  await expect(page.locator('#dwg-conversion-dialog')).toBeVisible()
  await expect(page.locator('#dwg-conversion-dialog li[data-phase="convert"]')).toHaveAttribute('data-state','working')
  await page.keyboard.press('Escape')
  await expect(page.locator('#dwg-conversion-dialog')).toBeHidden()
  await expect(page.locator('#status')).toContainText('current drawing was not changed')
  await expect(page.locator('#drawing-title')).toHaveText(before.title)
  await expect(page.locator('#entity-count')).toHaveText(before.count)
  await expect(page.locator('#revision')).toHaveText(before.revision)
})

test('provider failure is actionable and never replaces the current drawing', async ({ page }) => {
  await ready(page)
  await page.evaluate(value=>localStorage.setItem('kjdraw.dwg-provider.v1',JSON.stringify({endpoint:value})),endpoint)
  await page.route(endpoint,route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:'unsupported proxy object'})}))
  const before={title:await page.locator('#drawing-title').textContent(),count:await page.locator('#entity-count').textContent(),revision:await page.locator('#revision').textContent()}
  await page.locator('#file-input').setInputFiles({name:'provider-error.dwg',mimeType:'application/acad',buffer:sourceBytes})
  const dialog=page.locator('#dwg-conversion-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.dwg-conversion-error')).toContainText('current drawing was not changed')
  await expect(dialog.locator('.dwg-conversion-error')).toContainText('unsupported proxy object')
  await expect(dialog.locator('[data-action="retry"]')).toBeVisible()
  await expect(page.locator('#drawing-title')).toHaveText(before.title)
  await expect(page.locator('#entity-count')).toHaveText(before.count)
  await expect(page.locator('#revision')).toHaveText(before.revision)
})

test('provider endpoint policy permits local HTTP and streaming reads cancel immediately at the byte limit', async ({ page }) => {
  await ready(page)
  const result=await page.evaluate(async()=>{
    const {createPlaygroundDwgProvider,validateDwgProviderEndpoint}=await import('/apps/playground/dwg-conversion.js')
    const accepted=[validateDwgProviderEndpoint('http://localhost:8123/convert'),validateDwgProviderEndpoint('http://127.0.0.1:8123/convert'),validateDwgProviderEndpoint('http://[::1]:8123/convert')]
    let cancelled=false
    const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(6));setTimeout(()=>controller.enqueue(new Uint8Array(6)),0)},cancel(){cancelled=true}})
    const provider=createPlaygroundDwgProvider({endpoint:'https://safe.example/convert',maxResultBytes:8,fetchImpl:async()=>new Response(stream,{status:200,headers:{'content-type':'application/dxf'}})})
    let error=''
    try{await provider.convert({source:{name:'small.dwg',bytes:new TextEncoder().encode('AC1032'),sha256:'0'.repeat(64),dwgVersion:'AC1032'},target:'DXF'})}catch(reason){error=String(reason.message??reason)}
    return{accepted,cancelled,error,limit:provider.limits.maxResultBytes}
  })
  expect(result.accepted).toEqual(['http://localhost:8123/convert','http://127.0.0.1:8123/convert','http://[::1]:8123/convert'])
  expect(result).toMatchObject({cancelled:true,limit:8})
  expect(result.error).toContain('size limit')
})
