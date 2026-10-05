import { expect, test } from '@playwright/test'
import { openAiChat } from './ai-chat-ui.mjs'
import { readFile } from 'node:fs/promises'
import {
  KJProjectSession,
  buildAgentArchitecturePlan,
  buildAgentSitePlan,
  createKJDrawSDK,
} from '../../packages/kjdraw-sdk/src/index.js'

const architecture={version:'1.0.0',expectedRevision:0,units:'millimeter',drawingId:'UI-ARCH-101',title:'TWO ROOM OFFICE PLAN',width:10000,depth:8000,wallThickness:200,
  exteriorOpenings:[{wall:'south',offset:1200,width:900,kind:'door'},{wall:'north',offset:3000,width:1500,kind:'window'},{wall:'east',offset:3000,width:1500,kind:'window'}],
  partitions:[{id:'P1',axis:'vertical',position:5000,start:200,end:7800,openings:[{offset:3100,width:900,kind:'door'}]}],
  rooms:[{id:'R101',name:'MEETING',bounds:[200,200,4700,7600]},{id:'R102',name:'STUDIO',bounds:[5100,200,4700,7600]}],textHeight:250}
const site={version:'1.0.0',expectedRevision:0,units:'meter',drawingId:'UI-SITE-101',title:'MIXED USE CAMPUS GENERAL SITE PLAN',revision:'C3',
  boundary:[[1000,2000],[1260,2000],[1270,2120],[1220,2220],[1000,2200]],
  roads:[{name:'MAIN ACCESS ROAD',width:8,centerline:[[990,2020],[1080,2020],[1160,2060],[1280,2060]]},{name:'SERVICE ROAD',width:6,centerline:[[1110,1990],[1110,2140],[1220,2180]]}],
  buildings:[{name:'ADMINISTRATION',floors:4,footprint:[[1025,2040],[1080,2040],[1080,2080],[1025,2080]]},{name:'WORKSHOP',floors:2,footprint:[[1140,2080],[1230,2080],[1230,2140],[1140,2140]]},{name:'WAREHOUSE',footprint:[[1035,2120],[1125,2120],[1125,2180],[1035,2180]]}],
  utilities:[{kind:'water',name:'DOMESTIC WATER',diameterMm:200,path:[[1005,2028],[1090,2028],[1170,2070],[1240,2070]],nodeIndices:[0,1,2,3]},{kind:'drainage',name:'STORM DRAIN',diameterMm:600,path:[[1010,2190],[1080,2160],[1160,2160],[1250,2120]],nodeIndices:[0,1,2,3]},{kind:'power',name:'11kV POWER',path:[[1005,2010],[1100,2010],[1180,2050]],nodeIndices:[0,2]}],
  coordinateReference:{position:[1010,2010],easting:385000.125,northing:3452000.75,crs:'EPSG:32650'},northAngleDegrees:-8,scale:500}

const wire=(name,args)=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:`${name}-call`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]})

async function openBlankChat(page,units,compile){
  const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:`ui-${units}-semantic`,units})
  const blank=await sdk.writeDocument(drawing,{format:'KJD'}),compiled=compile(drawing)
  await page.goto('/')
  await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
  await page.locator('#file-input').setInputFiles({name:`blank-${units}.kjd`,mimeType:'application/json',buffer:Buffer.from(blank)})
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await openAiChat(page)
  await page.getByRole('button',{name:'Connect model',exact:true}).click()
  await page.locator('#chat-endpoint').fill('/api/model')
  await page.locator('#chat-model').fill('ui-contract-fixture')
  await page.getByRole('button',{name:'Use this connection',exact:true}).click()
  return compiled
}

async function saveProject(page){
  const pending=page.waitForEvent('download');await page.locator('#save').click();const download=await pending
  const bytes=await readFile(await download.path()),project=await KJProjectSession.open(bytes,{sdk:createKJDrawSDK()})
  return {bytes,project}
}

test('one visible AI request builds an editable architectural plan from a blank drawing',async({page})=>{
  await page.setViewportSize({width:1600,height:1000})
  const compiled=await openBlankChat(page,'millimeter',document=>buildAgentArchitecturePlan(document,architecture)),requests=[]
  await page.route('**/api/model',route=>{
    const body=route.request().postDataJSON();requests.push(body)
    expect(body.tools.map(tool=>tool.function.name)).toEqual(['cad_propose_architecture_plan'])
    return route.fulfill({json:wire('cad_propose_architecture_plan',architecture)})
  })
  await page.locator('#chat-input').fill('Create an architectural floor plan with two rooms, walls, doors, windows, areas, dimensions, layers and an A3 drawing frame.')
  await page.locator('#chat-send').click()
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.getByRole('button',{name:'Preview on drawing',exact:true}).click()
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.getByRole('button',{name:'Apply changes',exact:true}).click()
  await expect(page.locator('#entity-count')).toHaveText(`${compiled.evidence.entityCount} entities`)
  expect(requests).toHaveLength(1)
  const saved=await saveProject(page),drawing=saved.project.activeDocument
  expect(drawing.listEntities({type:'INSERT'})).toHaveLength(4)
  expect(drawing.listEntities({type:'DIMENSION'})).toHaveLength(2)
  expect(drawing.getTable('blockRecords').records.filter(record=>record.name.startsWith('KJ_ARCH_'))).toHaveLength(2)
  saved.project.destroy()
  await page.locator('#undo').click();await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.locator('#redo').click();await expect(page.locator('#entity-count')).toHaveText(`${compiled.evidence.entityCount} entities`)
  await page.locator('#file-input').setInputFiles({name:'architecture-reviewed.kjp',mimeType:'application/zip',buffer:saved.bytes})
  await expect(page.locator('#entity-count')).toHaveText(`${compiled.evidence.entityCount} entities`)
})

test('one visible AI request builds an editable multidisciplinary site plan from a blank drawing',async({page})=>{
  await page.setViewportSize({width:1600,height:1000})
  const compiled=await openBlankChat(page,'meter',document=>buildAgentSitePlan(document,site)),requests=[]
  await page.route('**/api/model',route=>{
    const body=route.request().postDataJSON();requests.push(body)
    expect(body.tools.map(tool=>tool.function.name)).toEqual(['cad_propose_site_plan'])
    return route.fulfill({json:wire('cad_propose_site_plan',site)})
  })
  await page.locator('#chat-input').fill('Create a general site plan with boundary, roads, buildings, utilities, coordinates, dimensions, north arrow and an A1 1:500 output view.')
  await page.locator('#chat-send').click()
  await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.getByRole('button',{name:'Apply changes',exact:true}).click()
  await expect(page.locator('#entity-count')).toHaveText(`${compiled.evidence.entityCount} entities`)
  expect(requests).toHaveLength(1)
  const saved=await saveProject(page),drawing=saved.project.activeDocument
  expect(drawing.snapshot().header.units).toBe('meter')
  expect(drawing.listEntities({type:'DIMENSION'})).toHaveLength(2)
  expect(drawing.getTable('layers').records.some(record=>record.name==='WATER')).toBe(true)
  expect(drawing.getTable('layers').records.some(record=>record.name==='DRAINAGE')).toBe(true)
  expect(drawing.getTable('layers').records.some(record=>record.name==='POWER')).toBe(true)
  saved.project.destroy()
  await page.locator('#undo').click();await expect(page.locator('#entity-count')).toHaveText('0 entities')
  await page.locator('#redo').click();await expect(page.locator('#entity-count')).toHaveText(`${compiled.evidence.entityCount} entities`)
  await page.locator('#file-input').setInputFiles({name:'site-reviewed.kjp',mimeType:'application/zip',buffer:saved.bytes})
  await expect(page.locator('#entity-count')).toHaveText(`${compiled.evidence.entityCount} entities`)
})
