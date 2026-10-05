import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJDRAW_AGENT_TOOLS } from '../packages/kjdraw-sdk/src/agent-tools.js'

// Offline provider fixtures, not real-model acceptance. Native reads, impact
// checks, proposals, host approval, DXF export and history all use the engine.
const clone = structuredClone
const readOnlyPrompt = 'Read-only inspect the structural edit prerequisites without modifying the drawing.'

async function fixture() {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  try {
    await document.transact('Original public impact-prerequisite fixture', tx => {
      tx.createEntity('LINE', { start: [0, 0, 0], end: [10, 0, 0] })
      tx.createEntity('LINE', { start: [30, 0, 0], end: [40, 0, 0] })
    })
    return await sdk.writeDocument(document, { format: 'DXF' })
  } finally { sdk.closeDocument(document.id) }
}

function response(call, number) {
  return Response.json({ choices: [{ finish_reason: call ? 'tool_calls' : 'stop', message: {
    role: 'assistant', content: call ? '' : 'Offline prerequisite inspection finished; no completion claim.',
    ...(call ? { tool_calls: [{ id: `impact-fixture-${number}`, type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : {}),
  } }] })
}

function nativeRecords(state) {
  const drawing = JSON.parse(state.drawing)
  assert.ok(drawing.objects && Object.keys(drawing.objects).length > 0, 'Compare actual native records, never an absent entities field')
  for (const key of ['tables', 'spaces', 'resources', 'opaquePayloads'])
    assert.ok(drawing[key] && typeof drawing[key] === 'object', `Compare explicit native ${key}`)
  return { objects: drawing.objects, tables: drawing.tables, spaces: drawing.spaces,
    resources: drawing.resources, opaquePayloads: drawing.opaquePayloads, header: drawing.header }
}

async function exercise(t, steps, prompt = readOnlyPrompt, options = {}) {
  const requests = [], receipts = [], context = {}, dxf = await fixture()
  const chat = createAiChatRuntime({ endpoint: 'https://impact-fixture.invalid/v1/chat/completions',
    model: 'offline-impact-fixture', captureToolOutputs: true, ...options,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body), last = body.messages.at(-1)
      requests.push(body)
      if (last.role === 'tool') {
        const receipt = JSON.parse(last.content)
        receipts.push(receipt)
        if (receipt.ok && Array.isArray(receipt.value?.entities) && !context.ids) {
          context.ids = receipt.value.entities.map(entity => entity.id)
          context.revision = receipt.value.revision
          context.units = receipt.value.units
        }
      }
      const step = steps[requests.length - 1]
      return response(step?.(context, receipts.at(-1)), requests.length)
    },
  })
  t.after(() => chat.destroy())
  await chat.importDocument(new File([dxf], 'original-public-impact-fixture.dxf'))
  const before = await chat.exportLocalState(), result = await chat.send(prompt)
  return { chat, before, result, context, requests, receipts }
}

const read = () => ({ name: 'cad_read_drawing', arguments: {} })
const impact = (context, ids) => ({ name: 'cad_query_impact', arguments: {
  expectedRevision: context.revision, units: context.units, operation: 'erase',
  ids, tolerance: 0.01, maxBytes: 262144,
} })
const propose = (context, ids) => ({ name: 'cad_propose_structural_edit', arguments: {
  expectedRevision: context.revision, units: context.units, eraseIds: ids,
  tolerance: 0.01, maxBytes: 262144,
} })

for (const scope of ['no-prior-read', 'subset', 'superset', 'separate-query-union']) {
  test(`structural exact-set prerequisite rejects ${scope}, explains the actual required read and never modifies`, async t => {
    const queries = scope === 'no-prior-read' ? [] : scope === 'separate-query-union'
      ? [context => impact(context, [context.ids[0]]), context => impact(context, [context.ids[1]])]
      : [context => impact(context, scope === 'subset' ? context.ids : [context.ids[0]])]
    let intended
    const f = await exercise(t, [read, ...queries, context => {
      intended = scope === 'superset' || scope === 'separate-query-union' ? [...context.ids] : [context.ids[0]]
      return propose(context, intended)
    }])
    assert.equal(f.result.status, 'message', JSON.stringify(f.result.error))
    const denied = f.receipts.at(-1)
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'CAD_IMPACT_REQUIRED')
    assert.match(denied.error.message, /subset, superset or union/)
    assert.deepEqual(denied.error.details, {
      matchRule: 'same-request-successful-exact-ID-set', requiredRead: {
        name: 'cad_query_impact', arguments: { expectedRevision: f.context.revision, units: f.context.units,
          operation: 'erase', ids: intended, tolerance: 0.01, maxBytes: 262144 },
      },
    })
    assert.equal(f.result.toolOutputs.filter(output => output.name === 'cad_query_impact').length, queries.length,
      'the host never automatically invokes the suggested read')
    assert.equal(f.chat.revision, f.context.revision)
    assert.equal((await f.chat.exportLocalState()).drawing, f.before.drawing)
    assert.equal(f.chat.drawingHistory.canUndo, false)
    for (const name of ['cad_query_impact', 'cad_propose_structural_edit']) {
      const bound = f.requests[0].tools.find(tool => tool.function.name === name).function
      assert.match(bound.description, /subset, superset or union/)
      assert.match(bound.description, /16 total creations/)
      assert.deepEqual(bound.parameters.properties[name === 'cad_query_impact' ? 'ids' : 'eraseIds'],
        KJDRAW_AGENT_TOOLS.find(tool => tool.name === name).inputSchema.properties[name === 'cad_query_impact' ? 'ids' : 'eraseIds'])
    }
  })
}

test('following the suggested exact read repairs a subset proposal within existing budgets and approval restores exact history', async t => {
  let finalIds
  const f = await exercise(t, [read,
    context => impact(context, context.ids),
    (context, receipt) => {
      assert.equal(receipt.ok, true)
      assert.equal(receipt.value.canErase, true)
      finalIds = [context.ids[0]]
      return propose(context, finalIds)
    },
    (_context, receipt) => {
      assert.equal(receipt.error.code, 'CAD_IMPACT_REQUIRED')
      return clone(receipt.error.details.requiredRead)
    },
    (context, receipt) => {
      assert.equal(receipt.ok, true)
      assert.equal(receipt.value.canErase, true)
      return propose(context, finalIds)
    },
  ], 'Remove the first of the two original lines only, preserving the other line; prepare one proposal for review.')
  assert.equal(f.result.status, 'proposal', JSON.stringify(f.result.error))
  assert.equal(f.requests.length, 5)
  assert.equal(f.result.toolOutputs.length, 5)
  assert.equal((await f.chat.exportLocalState()).drawing, f.before.drawing)
  assert.equal(f.chat.entityCount, 2)
  assert.equal((await f.chat.approve(f.result.proposal.planId)).status, 'applied')
  assert.equal(f.chat.entityCount, 1)
  assert.equal(f.chat.drawingHistory.undoCount, 1)
  const approved = await f.chat.exportLocalState(), sdk = createKJDrawSDK()
  const reopened = await sdk.readDocument(await f.chat.exportDocument('DXF'), { format: 'DXF' })
  try {
    assert.equal(reopened.validate().valid, true)
    assert.equal(reopened.listEntities().length, 1)
    assert.deepEqual(reopened.listEntities()[0].payload.start, [30, 0, 0])
  } finally { sdk.closeDocument(reopened.id) }
  assert.equal((await f.chat.applyHistory('undo')).status, 'applied')
  assert.deepEqual(nativeRecords(await f.chat.exportLocalState()), nativeRecords(f.before))
  assert.equal((await f.chat.applyHistory('redo')).status, 'applied')
  assert.deepEqual(nativeRecords(await f.chat.exportLocalState()), nativeRecords(approved))
})

test('the same unique ID set is accepted in a different order without narrowing or fabricating an impact receipt', async t => {
  const f = await exercise(t, [read, context => impact(context, context.ids),
    context => propose(context, [...context.ids].reverse()),
  ], 'Prepare a single reviewed removal of both original lines.')
  assert.equal(f.result.status, 'proposal', JSON.stringify(f.result.error))
  assert.equal(f.requests.length, 3)
  assert.equal(f.chat.entityCount, 2)
  assert.equal((await f.chat.exportLocalState()).drawing, f.before.drawing)
})

for (const bad of ['too-many', 'duplicate', 'non-text', 'bad-tolerance', 'bad-byte-budget']) {
  test(`an invalid ${bad} structural request is not presented as a valid suggested impact read`, async t => {
    const f = await exercise(t, [read, context => {
      const call = propose(context, [context.ids[0]])
      if (bad === 'too-many') call.arguments.eraseIds = Array.from({ length: 65 }, (_, i) => `not-in-the-drawing-${i}`)
      if (bad === 'duplicate') call.arguments.eraseIds = [context.ids[0], context.ids[0]]
      if (bad === 'non-text') call.arguments.eraseIds = [1]
      if (bad === 'bad-tolerance') call.arguments.tolerance = 0
      if (bad === 'bad-byte-budget') call.arguments.maxBytes = 262145
      return call
    }])
    assert.equal(f.result.status, 'message', JSON.stringify(f.result.error))
    const denied = f.receipts.at(-1)
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'CAD_IMPACT_REQUIRED')
    assert.equal(denied.error.details, undefined)
    assert.equal(f.result.toolOutputs.filter(output => output.name === 'cad_query_impact').length, 0)
    assert.equal((await f.chat.exportLocalState()).drawing, f.before.drawing)
  })
}
