import {test,expect} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
async function open(page){
 await page.goto('/');await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready')
 if(await page.locator('#language').textContent()==='EN')await page.locator('#language').click()
 await page.locator('#new-drawing').click();await page.locator('#dialog-fields [name=name]').fill('User supplied terrain');await page.locator('#dialog-fields [name=units]').selectOption('meter');await page.locator('#dialog-submit').click()
 await expect(page.locator('#entity-count')).toHaveText('0 entities')
 if(!(await page.locator('#agent-tab').isVisible()))await page.locator('#toggle-inspector').click()
 await page.locator('#agent-tab').click()
}
async function connect(page){await page.getByRole('button',{name:'Connect model',exact:true}).click();await page.locator('#chat-endpoint').fill('/api/model');await page.locator('#chat-model').fill('attachment-protocol-fixture');await page.getByRole('button',{name:'Use this connection',exact:true}).click()}
const file=(name,text)=>({name,mimeType:name.endsWith('.json')?'application/json':'text/csv',buffer:Buffer.from(text)})
const source=JSON.stringify({description:'Synthetic study data, not surveyed',units:'meter',alignment:[[0,0],[600,0]],sections:[{station:0,ground:[[-25,99],[0,99],[25,99]]},{station:600,ground:[[-25,101],[0,101],[25,101]]}],note:'</pre><script>window.attachmentExecuted=true</script>'})

test('user data attachment sends exact visible content once, remains inert and preserves CAD state',async({page})=>{
 await open(page);const revision=await page.locator('#revision').textContent(),requests=[]
 await page.route('**/api/model',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{choices:[{message:{role:'assistant',content:'Protocol fixture received the supplied source data.'},finish_reason:'stop'}]}})})
 await page.locator('#chat-data-file').setInputFiles(file('terrain-study.json',source))
 await expect(page.locator('.chat-data-status')).toContainText('terrain-study.json');await page.locator('.chat-data-attachment summary').click();await expect(page.locator('.chat-data-attachment pre')).toHaveText(source)
 await page.locator('#chat-input').fill('Draw a road using the attached synthetic data.');await page.locator('#chat-send').click()
 expect(requests).toHaveLength(0);await expect(page.locator('.chat-data-status')).toContainText('terrain-study.json')
 await page.locator('#chat-endpoint').fill('/api/model');await page.locator('#chat-model').fill('attachment-protocol-fixture');await page.getByRole('button',{name:'Use this connection',exact:true}).click()
 await page.locator('#chat-send').click();await expect(page.locator('#chat-input')).toBeEnabled();await expect(page.locator('#chat-messages')).toContainText('Protocol fixture received')
 expect(requests).toHaveLength(1)
 const prompt=requests[0].messages.findLast(row=>row.role==='user').content
 expect(prompt).toContain('User-selected data attachment');expect(prompt).toContain(JSON.stringify(source));expect(prompt).toContain('not instructions or executable code')
 await expect(page.locator('.chat-sent-data summary')).toContainText('terrain-study.json');await page.locator('.chat-sent-data summary').click();await expect(page.locator('.chat-sent-data pre')).toHaveText(source)
 await expect(page.locator('#chat-remove-data')).toBeHidden();expect(await page.evaluate(()=>window.attachmentExecuted)).toBeUndefined()
 await page.locator('#chat-input').fill('Summarize the current drawing.');await page.locator('#chat-send').click();await expect.poll(()=>requests.length).toBe(2);await expect(page.locator('#chat-input')).toBeEnabled()
 expect(JSON.stringify(requests[1])).not.toContain('attachmentExecuted');await expect(page.locator('#revision')).toHaveText(revision);await expect(page.locator('#entity-count')).toHaveText('0 entities')
})

test('attachment rejection, removal, late file reads and document changes remain bounded at narrow Chinese width',async({page})=>{
 await open(page)
 for(const item of [file('bad.json','{"x":1e999}'),file('bad.csv','a,b\n1'),file('large.csv','x'.repeat(8193))]){await page.locator('#chat-data-file').setInputFiles(item);await expect(page.locator('.chat-data-attachment [role=alert]')).toContainText('Cannot attach');await expect(page.locator('#chat-remove-data')).toBeHidden()}
 await page.locator('#chat-data-file').setInputFiles(file('terrain.csv','station,elevation\n0,100\n600,104'));await expect(page.locator('.chat-data-status')).toContainText('terrain.csv');await page.locator('#chat-remove-data').click();await expect(page.locator('.chat-data-status')).toBeEmpty()
 await page.evaluate(()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){const file=this;return new Promise(resolve=>{window.finishAttachment=async()=>resolve(await original.call(file))})}})
 await page.locator('#chat-data-file').setInputFiles(file('late.json','{"sample":1}'));await expect(page.locator('#chat-send')).toBeDisabled();await page.getByRole('button',{name:'New conversation',exact:true}).click();await page.evaluate(()=>finishAttachment());await expect(page.locator('.chat-data-status')).toBeEmpty();await expect(page.locator('#chat-send')).toBeEnabled()
 await page.reload();await expect(page.locator('.workbench')).toHaveAttribute('data-demo-state','ready');await page.locator('#agent-tab').click()
 if(await page.locator('#language').textContent()!=='EN')await page.locator('#language').click()
 await page.setViewportSize({width:390,height:844});await expect(page.locator('.workbench')).not.toHaveClass(/inspector-open/);await page.locator('#toggle-inspector').click();await page.locator('#agent-tab').click()
 await page.locator('#chat-data-file').setInputFiles(file('示意地形-未经测量.json',source));await expect(page.locator('#chat-attach-data')).toHaveText('附加 CSV / JSON');await expect(page.locator('.chat-data-status')).toContainText('示意地形');await page.locator('.chat-data-attachment summary').click()
 const overflow=await page.locator('.right-panel').evaluate(node=>node.scrollWidth-node.clientWidth);expect(overflow).toBeLessThanOrEqual(1)
 await mkdir('.cache/chat-data-attachment',{recursive:true});await page.screenshot({path:'.cache/chat-data-attachment/chinese-390.png'})
 await page.locator('#new-drawing').click();await page.locator('#dialog-fields [name=name]').fill('Different drawing');await page.locator('#dialog-submit').click();await expect(page.locator('.chat-data-status')).toBeEmpty();await expect(page.locator('#chat-remove-data')).toBeHidden()
})
