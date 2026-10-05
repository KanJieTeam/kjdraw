import { test, expect } from '@playwright/test'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'

async function openMeasurementFixture(page) {
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'measurement-fixture',title:'Measurement fixture',units:'millimeter'})
  await sdk.executeCommand('CREATE',{type:'LWPOLYLINE',payload:{vertices:[[0,0],[180,0],[180,120],[0,120]],closed:true}})
  await sdk.executeCommand('CREATE',{type:'CIRCLE',payload:{center:[90,60],radius:22}})
  await page.setViewportSize({width:1440,height:960})
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#file-input').setInputFiles({name:'measurement.kjd',mimeType:'application/json',buffer:Buffer.from(await sdk.writeDocument(drawing,{format:'KJD'}))})
  await expect(page.locator('#entity-count')).toHaveText('2 entities')
}

async function drawingPoint(page,x,y) {
  const box=await page.locator('#canvas').boundingBox(),scale=Math.min((box.width-164)/180,(box.height-164)/120)
  return {x:box.x+box.width/2+(x-90)*scale,y:box.y+box.height/2-(y-60)*scale}
}

async function selectAt(page,x,y) {
  await page.mouse.click(...Object.values(await drawingPoint(page,x,y)))
  await expect(page.locator('#selection-count')).toHaveText('1 selected')
}

async function measureSelected(page,mode,label,value) {
  await page.locator('#measure-mode').selectOption(mode)
  await page.locator('#measure-entity').click()
  await expect(page.locator('.measure-result')).toContainText(label)
  await expect(page.locator('.measure-result')).toContainText(value)
}

test('measurement menu runs distance, length, area, radius, angle and coordinate without changing the drawing', async ({page},testInfo) => {
  test.skip(testInfo.project.name!=='chromium','Focused playground interaction coverage runs once in Chromium')
  await openMeasurementFixture(page)
  await page.locator('.ribbon-tabs [data-i18n="inspect"]').click()
  await expect(page.locator('#measure-mode option')).toHaveCount(6)
  const revision=await page.locator('#revision').textContent()

  await selectAt(page,10,0)
  await measureSelected(page,'length','Length','600 millimeter')
  await measureSelected(page,'area','Area','21,600 millimeter²')

  await selectAt(page,112,60)
  await measureSelected(page,'radius','Radius','22 millimeter')

  await page.locator('#measure-mode').selectOption('distance');await page.locator('#measure-entity').click()
  for(const point of [[90,60],[112,60]])await page.mouse.click(...Object.values(await drawingPoint(page,...point)))
  await expect(page.locator('.measure-result')).toContainText('Distance')
  await expect(page.locator('.measure-result')).toContainText('22 millimeter')

  await page.locator('#measure-mode').selectOption('angle');await page.locator('#measure-entity').click()
  for(const point of [[90,60],[112,60],[90,82]])await page.mouse.click(...Object.values(await drawingPoint(page,...point)))
  await expect(page.locator('.measure-result')).toContainText('Angle')
  await expect(page.locator('.measure-result')).toContainText('90°')

  await page.locator('#measure-mode').selectOption('coordinate');await page.locator('#measure-entity').click()
  await page.mouse.click(...Object.values(await drawingPoint(page,90,60)))
  await expect(page.locator('.measure-result')).toContainText('Coordinate')
  await expect(page.locator('.measure-result')).toContainText('X 90 · Y 60')
  await expect(page.locator('#revision')).toHaveText(revision)
  expect(await page.locator('.workbench').getAttribute('data-last-error')).toBeNull()
})
