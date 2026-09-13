import { expect, test } from '@playwright/test'

test('Workbench adds a selected full ellipse as a native hatch island and renders it',async({page})=>{
  await page.goto('/')
  await page.evaluate(async()=>{
    document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1100px;height:720px';document.body.append(host)
    const [{createKJDrawSDK},{mountKJDrawWorkbench}]=await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'),import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'hatch-ellipse-ui',units:'millimeter'})
    await drawing.transact('fixture',tx=>{
      tx.createEntity('HATCH',{solid:true,boundaryLoops:[{external:true,vertices:[[0,0],[60,0],[60,40],[0,40]]}]},{id:'hatch'})
      tx.createEntity('ELLIPSE',{center:[30,20,0],majorAxis:[8,3,0],ratio:.4},{id:'ellipse'})
    })
    const workbench=mountKJDrawWorkbench(host,{sdk,document:drawing,locale:'en'});await workbench.ready
    await sdk.executeCommand('SELECT',{ids:['hatch','ellipse'],operation:'replace'},{document:drawing})
    window.__hatchEllipse={sdk,drawing,workbench}
  })
  await page.locator('[data-inspector] [data-action="edit-hatch"]').click()
  await expect(page.locator('[data-hatch-source-review]')).toContainText('ELLIPSE')
  await expect(page.locator('[data-hatch-operation]')).toHaveValue('add-selected')
  await page.locator('[data-hatch-apply]').click()
  await expect(page.locator('[data-hatch-edit-dialog]')).toHaveCount(0)
  await expect.poll(()=>page.evaluate(()=>{
    const hatch=window.__hatchEllipse.drawing.getObject('hatch'),edge=hatch.payload.boundaryLoops[1].edges[0],report=window.__hatchEllipse.workbench.renderer.report
    return {type:edge.type,center:edge.center,axis:edge.majorAxis,ratio:edge.ratio,unsupported:report.unsupported,hatchDiagnostics:report.hatchDiagnostics?.length??0}
  })).toEqual({type:'ELLIPSE',center:[30,20,0],axis:[8,3,0],ratio:.4,unsupported:0,hatchDiagnostics:0})
})
