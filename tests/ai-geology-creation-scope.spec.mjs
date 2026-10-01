import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { compileGeologyColumn } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { getKJDrawChatToolNames, getKJDrawChatToolNamesForRequest,
  getKJDrawChatCapabilityForRequest, KJDRAW_CHAT_TOOL_NAMES,
} from '../apps/playground/agent-chat.js'

const creation = ['cad_propose_geology_column', 'cad_propose_geology_section']

test('blank millimeter host exposes both compilers without interpreting user instructions or modifying the drawing', () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const before = document.serialize(), policy = getKJDrawChatToolNames(document)
  assert.ok(Object.isFrozen(policy))
  assert.deepEqual(policy, [...KJDRAW_CHAT_TOOL_NAMES, ...creation])
  for (const prompt of ['请按我提供的勘察资料绘图。', 'Plot the supplied borehole data.',
    'Do not create a drawing. Explain what source facts are needed.', '绘制钻孔地质柱状图。']) {
    assert.equal(getKJDrawChatCapabilityForRequest(document, prompt), null)
    assert.equal(getKJDrawChatToolNamesForRequest(document, prompt), policy)
  }
  assert.equal(document.serialize(), before)
  assert.equal(document.history.undoCount, 0)
})

for (const units of ['meter', 'inch', 'unitless']) test(`creation is not advertised for unsupported host units: ${units}`, () => {
  const document = createKJDrawSDK().createDocument({ units })
  for (const name of creation) assert.equal(getKJDrawChatToolNames(document).includes(name), false)
})

test('any existing native geometry disables blank-sheet geology creation regardless of requested wording', async () => {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
  const blankPolicy = getKJDrawChatToolNames(document)
  await document.transact('Existing imported-style geometry', tx => tx.createEntity('LINE', {
    start: [0, 0, 0], end: [15, 0, 0],
  }))
  for (const prompt of ['按现有剖面重新分层。', 'Create a geological column from this existing drawing.',
    'Only inspect the drawing; do not change anything.']) {
    const policy = getKJDrawChatToolNamesForRequest(document, prompt)
    for (const name of creation) assert.equal(policy.includes(name), false)
  }
  for (const name of creation) assert.ok(blankPolicy.includes(name), 'A run captures an immutable tool policy')
})

test('a retained source recipe still selects source revision rather than creating a replacement drawing', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const input = { expectedRevision: 0, units: 'millimeter', hole: {
    id: 'PUBLIC-SCOPE', collarElevation: 100, depth: 12,
    strata: [{ intervalId: 'FILL', code: '1', name: 'Fill', top: 0, bottom: 12, lithology: 'fill' }],
  } }
  const compiled = compileGeologyColumn(input)
  await sdk.executeCommand('CREATEBATCH', { ...structuredClone(compiled.commandArgs),
    geologySource: { kind: 'column', input } }, { document })
  const fingerprint = document.fingerprint()
  const policy = getKJDrawChatToolNamesForRequest(document, '把钻孔的稳定水位更新为 4 米，其余不变。')
  assert.deepEqual(policy, ['cad_read_geology_source', 'cad_propose_geology_revision'])
  for (const name of creation) assert.equal(getKJDrawChatToolNames(document).includes(name), false)
  assert.equal(document.fingerprint(), fingerprint)
})

test('unrelated explicitly selected compilers retain their locked capability policy on a blank sheet', () => {
  const document = createKJDrawSDK().createDocument({ units: 'millimeter' })
  assert.deepEqual(getKJDrawChatToolNamesForRequest(document,
    'Create an architectural floor plan with walls, doors and windows.'), ['cad_propose_architecture_plan'])
  assert.deepEqual(getKJDrawChatToolNamesForRequest(document,
    'Create a grouped bar chart with a target line.'), ['cad_propose_cartesian_chart'])
})
