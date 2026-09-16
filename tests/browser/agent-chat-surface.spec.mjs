import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import { mountingProfile } from '../../packages/kjdraw-sdk/examples/fixtures/mounting-profile.mjs'

function patternProfile(revision = 0) {
  const source = mountingProfile(revision)
  return {
    expectedRevision: source.expectedRevision, units: source.units,
    lines: source.lines.map(({ start, end }) => [start.x, start.y, end.x, end.y]),
    circles: source.circles.slice(0, 1).map(({ center, radius }) => [center.x, center.y, radius]),
    arcs: source.arcs.map(({ center, radius, startDegrees, endDegrees }) => [center.x, center.y, radius, startDegrees, endDegrees]),
    polylines: source.polylines.map(({ vertices, closed }) => ({ points: vertices.map(({ x, y }) => [x, y]), closed })),
    arrays: [{ sources: ['circles:0'], rows: 2, columns: 2, dx: 100, dy: 40 }],
  }
}

const wire = (calls = [], text = '') => ({ choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop', message: {
  role: 'assistant', content: text || null,
  tool_calls: calls.map(([id, name, args = {}]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })),
} }] })

test('AI homepage keeps drawing changes approval-gated and supports preview, save, reopen, editor and undo', async ({ page }) => {
  const sdk=createKJDrawSDK(), source=sdk.createDocument({documentId:'ai-homepage-drawing',units:'millimeter'}), requests=[]
  await page.setViewportSize({width:1440,height:900})
  await page.goto('/ai/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#file-input').setInputFiles({name:'ai-homepage.kjd',mimeType:'application/json',buffer:Buffer.from(await sdk.writeDocument(source,{format:'KJD'}))})
  await expect(page.locator('body')).toHaveClass(/ai-surface/)
  await expect(page.locator('html')).toHaveAttribute('lang','zh-CN')
  await expect(page.locator('#ai-chat-window')).toBeVisible()
  await expect(page.locator('#canvas')).toBeHidden()
  await expect(page.locator('.cad-ribbon')).toBeHidden()
  await expect(page.locator('#revision')).toHaveText('REV 0')

  await page.locator('#chat-input').fill('先尝试绘图，但尚未连接模型。')
  await page.locator('#chat-send').click()
  await expect(page.locator('#chat-messages')).toContainText('连接模型后即可发送这个需求')
  expect(requests).toHaveLength(0)
  await expect(page.locator('#revision')).toHaveText('REV 0')

  await page.route('**/api/model',route=>{
    const body=route.request().postDataJSON();requests.push(body)
    if(requests.length===1)return route.fulfill({json:wire([['read','cad_read_drawing']])})
    const result=JSON.parse(body.messages.at(-1).content)
    expect(result.ok).toBe(true);expect(result.value.documentId).toBe(source.id);expect(result.value.entities).toEqual([])
    return route.fulfill({json:wire([['profile','cad_propose_drawing_pattern',patternProfile(result.value.revision)]],'请在卡片中检查图形，确认后再应用。')})
  })
  await page.locator('#chat-endpoint').fill('/api/model')
  await page.locator('#chat-model').fill('browser-fixture')
  await page.getByRole('button',{name:'使用此连接',exact:true}).click()
  const stored=await page.evaluate(()=>({session:sessionStorage.getItem('kjdraw:model-connection:v1'),local:localStorage.getItem('kjdraw:model-connection:v1')}))
  expect(JSON.parse(stored.session).model).toBe('browser-fixture');expect(stored.local).toBeNull()

  await page.locator('#chat-input').fill('绘制一个 120 × 60 mm 的安装板，带四个安装孔和中央直槽。')
  await page.locator('#chat-send').click()
  await expect(page.getByRole('button',{name:'应用修改',exact:true})).toBeEnabled()
  await expect(page.locator('#revision')).toHaveText('REV 0')
  await expect(page.locator('.chat-proposal-canvas')).toBeVisible()
  const previewPixels=await page.locator('.chat-proposal-canvas').evaluate(canvas=>{
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
    let blue=0,nonWhite=0
    for(let i=0;i<pixels.length;i+=4){if(pixels[i]<245||pixels[i+1]<245||pixels[i+2]<245)nonWhite++;if(pixels[i+2]>pixels[i]+35&&pixels[i+2]>pixels[i+1]+15)blue++}
    return{blue,nonWhite}
  })
  expect(previewPixels.blue).toBeGreaterThan(100);expect(previewPixels.nonWhite).toBeGreaterThan(200)
  await expect(page.locator('#canvas')).toBeHidden()

  await page.getByRole('button',{name:'应用修改',exact:true}).click()
  await expect(page.locator('.chat-proposal-state')).toContainText('修改已应用')
  await expect(page.locator('#revision')).toHaveText('REV 1')
  await expect(page.locator('#entity-count')).toHaveText('9 个对象')

  const kjdEvent=page.waitForEvent('download')
  await page.getByRole('button',{name:'保存 KJD',exact:true}).click()
  const kjdDownload=await kjdEvent,kjd=await createKJDrawSDK().readDocument(await readFile(await kjdDownload.path(),'utf8'),{format:'KJD'})
  expect(kjd.id).toBe(source.id);expect(kjd.revision).toBe(1);expect(kjd.validate().valid).toBe(true);expect(kjd.listEntities()).toHaveLength(9)

  const dxfEvent=page.waitForEvent('download')
  await page.getByRole('button',{name:'保存 DXF',exact:true}).click()
  const dxfDownload=await dxfEvent,dxf=await createKJDrawSDK().readDocument(await readFile(await dxfDownload.path()),{format:'DXF'})
  expect(dxf.validate().valid).toBe(true);expect(dxf.listEntities()).toHaveLength(9)
  await page.getByRole('button',{name:'验证重开',exact:true}).click()
  await expect(page.locator('.chat-proposal-state')).toContainText('KJD 与 DXF 重开验证通过')

  await page.getByRole('button',{name:'打开完整编辑器',exact:true}).last().click()
  await expect(page.locator('body')).toHaveClass(/ai-editor-open/)
  await expect(page.locator('#canvas')).toBeVisible()
  await page.getByRole('button',{name:'撤销这次修改',exact:true}).click()
  await expect(page.locator('#revision')).toHaveText('REV 2')
  await expect(page.locator('#entity-count')).toHaveText('0 个对象')

  await page.setViewportSize({width:390,height:844})
  await expect(page.locator('#ai-chat-window')).toBeVisible()
  await expect(page.locator('#canvas')).toBeHidden()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(requests).toHaveLength(2)
})
