import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createKJDrawSDK } from '../src/index.js'
import { createSample } from '../../../examples/sample.js'
import { AGENT_REVISION_COMMAND, createShowcaseRevision, registerShowcaseCommand } from '../../../apps/playground/agent-showcase.js'

const read = path => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8')

test('playground exposes the deterministic 90-second review workflow', async () => {
  const [html, app, translations, showcase] = await Promise.all([
    read('apps/playground/index.html'),
    read('apps/playground/app.js'),
    read('apps/playground/i18n.js'),
    read('apps/playground/agent-showcase.js'),
  ])

  for (const id of ['agent-preset','agent-intent','plan','plan-state','plan-steps','confirm','receipt-timeline','receipt-undo','receipt-save','receipt-reopen']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`)
  }
  assert.match(html, /value="service-yard"/)
  assert.match(html, /value="fire-corridor"/)
  assert.match(html, /value="inspection-buffer"/)
  assert.match(html, /role="status" aria-live="polite"/)
  assert.match(html, /role="log" aria-live="polite"/)
  assert.match(html, /aria-keyshortcuts="Control\+Enter"/)
  assert.match(showcase, /DEMO_APPLY_REVISION/)
  assert.match(app, /origin:'ai',mode:'plan'/)
  assert.match(app, /confirmation:\{status:'confirmed'/)
  assert.match(showcase, /moveIds/)
  assert.match(showcase, /deleteIds/)
  assert.match(showcase, /additions/)
  assert.doesNotMatch(app, /window\.(?:prompt|confirm)\s*\(/)
  assert.match(translations, /Describe → diff → approve → receipt/)
  assert.match(translations, /描述 → 差异 → 批准 → 回执/)
})

test('playground keeps one branded top shell and uses an accessible local command dialog', async () => {
  const html = await read('apps/playground/index.html')
  assert.equal((html.match(/class="site-header"/g)??[]).length,1)
  assert.equal((html.match(/class="brand"/g)??[]).length,1)
  assert.doesNotMatch(html, /workbench-head/)
  assert.match(html, /<dialog id="app-dialog"/)
  assert.match(html, /aria-labelledby="dialog-title"/)
})

test('showcase plan atomically moves, deletes and adds through public SDK envelopes', async () => {
  const sdk=createKJDrawSDK(),document=await createSample(sdk)
  registerShowcaseCommand(sdk)
  const args=createShowcaseRevision(document,'service-yard')
  const movedBefore=document.getObject(args.moveIds[0])
  const beforeCount=document.listEntities().length,beforeRevision=document.revision
  const plan=sdk.createCommandEnvelope(AGENT_REVISION_COMMAND,args,{origin:'ai',mode:'plan',expectedRevision:beforeRevision})
  const preview=await sdk.executeCommandEnvelope(plan)

  assert.equal(preview.status,'planned')
  assert.equal(document.listEntities().length,beforeCount)
  assert.deepEqual(document.getObject(args.moveIds[0]).payload,movedBefore.payload)

  const confirmed=sdk.createCommandEnvelope(plan.command,plan.arguments,{origin:'ai',expectedRevision:plan.expectedRevision,confirmation:{status:'confirmed',planId:plan.id,confirmedBy:'test-reviewer'}})
  const receipt=await sdk.executeCommandEnvelope(confirmed)
  assert.equal(receipt.afterRevision,beforeRevision+1)
  assert.equal(receipt.result.movedIds.length,args.moveIds.length)
  assert.equal(receipt.result.deletedIds.length,args.deleteIds.length)
  assert.equal(receipt.result.addedIds.length,args.additions.length)
  assert.equal(document.getObject(args.moveIds[0]).payload.vertices[0].point[1],movedBefore.payload.vertices[0].point[1]+8)
  assert.equal(document.getObject(args.deleteIds[0]),null)
  assert.equal(document.listEntities().length,beforeCount-args.deleteIds.length+args.additions.length)

  await sdk.executeCommand('UNDO')
  assert.deepEqual(document.getObject(args.moveIds[0]).payload,movedBefore.payload)
  assert.ok(document.getObject(args.deleteIds[0]))
  assert.equal(document.listEntities().length,beforeCount)
})
