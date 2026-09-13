import {expect,test} from '@playwright/test'

test('Workbench adds a selected verified closed SPLINE as a native rendered hatch island',async({page})=>{
  await page.goto('/')
  await page.evaluate(async()=>{
    document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:1100px;height:720px';document.body.append(host)
    const [{createKJDrawSDK},{mountKJDrawWorkbench}]=await Promise.all([import('/packages/kjdraw-sdk/src/sdk.js'),import('/packages/kjdraw-sdk/src/workbench.js')])
    const sdk=createKJDrawSDK(),drawing=sdk.createDocument({documentId:'hatch-spline-ui',units:'millimeter'}),c=[30,20],u=[8,3],v=[-1.5,4],at=(a,b)=>[c[0]+a*u[0]+b*v[0],c[1]+a*u[1]+b*v[1],0]
    const spline={degree:2,controlPoints:[at(1,0),at(1,1),at(0,1),at(-1,1),at(-1,0),at(-1,-1),at(0,-1),at(1,-1),at(1,0)],knots:[0,0,0,.25,.25,.5,.5,.75,.75,1,1,1],weights:[1,Math.SQRT1_2,1,Math.SQRT1_2,1,Math.SQRT1_2,1,Math.SQRT1_2,1],closed:true}
    await drawing.transact('fixture',tx=>{tx.createEntity('HATCH',{solid:true,boundaryLoops:[{external:true,vertices:[[0,0],[60,0],[60,40],[0,40]]}]},{id:'hatch'});tx.createEntity('SPLINE',spline,{id:'spline'})})
    const workbench=mountKJDrawWorkbench(host,{sdk,document:drawing,locale:'en'});await workbench.ready;await sdk.executeCommand('SELECT',{ids:['hatch','spline'],operation:'replace'},{document:drawing});window.__hatchSpline={drawing,workbench}
  })
  await page.locator('[data-inspector] [data-action="edit-hatch"]').click();await expect(page.locator('[data-hatch-source-review]')).toContainText('SPLINE');await expect(page.locator('[data-hatch-operation]')).toHaveValue('add-selected');await page.locator('[data-hatch-apply]').click();await expect(page.locator('[data-hatch-edit-dialog]')).toHaveCount(0)
  await expect.poll(()=>page.evaluate(()=>{const edge=window.__hatchSpline.drawing.getObject('hatch').payload.boundaryLoops[1].edges[0],report=window.__hatchSpline.workbench.renderer.report;return{type:edge.type,degree:edge.degree,control:edge.controlPoints.length,unsupported:report.unsupported,diagnostics:report.hatchDiagnostics?.length??0}})).toEqual({type:'SPLINE',degree:2,control:9,unsupported:0,diagnostics:0})
})
