import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { hostedSmokeOptions, hostedSyntheticSection, assertHostedTextPreview } from '../scripts/testing/run-hosted-ai-smoke.mjs'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'

test('hosted live-model entry defaults to a zero-call dry run', () => {
  const child = execFileSync(process.execPath, ['scripts/testing/run-hosted-ai-smoke.mjs'], { encoding: 'utf8' })
  const report = JSON.parse(child)
  assert.equal(report.mode, 'dry-run')
  assert.equal(report.modelCalls, 0)
  assert.match(report.scope, /Not independent users/)
  assert.equal(report.origin, 'https://kanjieteam.github.io/kjdraw/')
})

test('help cancels paid execution even when --run was supplied', () => {
  assert.deepEqual(hostedSmokeOptions(['--run', '--help', '--suite', 'imported-geology']), {
    run: false, suite: 'imported-geology', output: undefined,
  })
})

test('paid hosted tests require a new archive and reject ambiguous options', () => {
  assert.throws(() => hostedSmokeOptions(['--run']), /NEW --output-dir/)
  assert.throws(() => hostedSmokeOptions(['--suite', 'anything']), /Unknown hosted suite/)
  assert.throws(() => hostedSmokeOptions(['--run', '--run']), /duplicate/)
  assert.throws(() => hostedSmokeOptions(['--suite']), /needs a value/)
  assert.throws(() => hostedSmokeOptions(['--api-key', 'never-a-command-argument']), /Unknown/)
  assert.throws(() => hostedSmokeOptions(['--origin', 'https://untrusted.invalid']), /Unknown/)
})

test('the public synthetic section is valid ordinary DXF, not inferred project source facts', async () => {
  const { sdk, bytes } = await hostedSyntheticSection()
  const document = await sdk.readDocument(bytes, { format: 'DXF' })
  assert.equal(document.validate().valid, true)
  assert.equal(document.listEntities().length, 125)
  assert.equal(document.listEntities({ type: 'HATCH' }).length, 15)
  const texts = document.listEntities().map(entity => entity.payload.text).filter(Boolean)
  for (const literal of ['项目名称:合成回归项目', '孔号:TEST-01', '历史备注；原标点。 Historical note; keep punctuation.']) {
    assert.equal(texts.filter(value => value === literal).length, 1)
  }
  assert.equal(texts.filter(value => /SYN-[ABC]/.test(value)).length, 3)
})

test('the test reviewer rejects padding, target changes, stale revisions and unrelated geometry BEFORE approval', async () => {
  const { sdk, bytes } = await hostedSyntheticSection()
  const document = await sdk.readDocument(bytes, { format: 'DXF' })
  const from = '历史备注；原标点。 Historical note; keep punctuation.', to = from + '复核版'
  const entity = document.listEntities().find(item => item.payload.text === from)
  const proposal = { command: 'TEXTEDIT', expectedRevision: document.revision,
    preview: { before: [{ id: entity.id, type: entity.type, payload: entity.payload }],
      after: [{ id: entity.id, type: entity.type, payload: { ...entity.payload, text: to } }] } }
  assertHostedTextPreview(proposal, document, from, to)
  for (const mutate of [
    value => { value.preview.after[0].payload.text = from + ' 复核版' },
    value => { value.preview.after[0].payload.position[0] += 1 },
    value => { value.preview.after[0].id = 'wrong-target' },
    value => { value.expectedRevision += 1 },
    value => { value.preview.after.push(value.preview.after[0]) },
    value => { value.preview.before = [] },
  ]) {
    const changed = structuredClone(proposal)
    mutate(changed)
    assert.throws(() => assertHostedTextPreview(changed, document, from, to))
  }
  assert.equal(document.getObject(entity.id).payload.text, from)
})

test('native preview survives canonical JSON transport without weakening literal or geometry checks', async () => {
  const { sdk, bytes } = await hostedSyntheticSection()
  const document = await sdk.readDocument(bytes, { format: 'DXF' })
  const reader = createKJDrawSDK()
  const saved = await reader.readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  const from = '项目名称:合成回归项目', to = '项目名称:合成复核项目'
  const entity = document.listEntities().find(item => item.payload.text === from)
  const tools = new KJAgentToolSession(sdk, document)
  const result = await tools.call('cad_propose_text_edit', { expectedRevision: document.revision, units: 'millimeter',
    changes: [{ id: entity.id, expectedText: from, text: to }] })
  assert.equal(result.ok, true)
  const transported = JSON.parse(JSON.stringify(result.value))
  assertHostedTextPreview(transported, saved, from, to)
  transported.preview.after[0].payload.text += ' '
  assert.throws(() => assertHostedTextPreview(transported, saved, from, to))
  assert.equal(document.getObject(entity.id).payload.text, from)
})
