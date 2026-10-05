import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { nativeHatchPattern, hatchPatternFingerprint } from '../src/agent-hatch-pattern.js'
import { getKJDrawChatToolNamesForRequest } from '../../../apps/playground/agent-chat.js'
import { stableHash } from '../src/utils.js'

// Original synthetic geometry/line families. No private engineering drawings or PAT assets.
async function fixture({ catalogOnly = false } = {}) {
  // This controlled synthetic-resource fixture predates the real bundled PAT
  // library. Keep its exact single-resource oracle; default-library integration
  // is exercised separately with literal source-only STT geometry.
  const sdk = createKJDrawSDK({ includeBundledHatchPatterns: false }), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Synthetic native soil patterns without text labels', tx => {
    for (const [id, x, scale, angle] of [['left', 0, 0.5, 0], ['right', 20, 1.25, 0.25]]) {
      tx.createEntity('HATCH', { patternName: '素填土', solid: false, patternScale: scale, patternAngle: angle,
        patternDefinitionScale: 1, patternDefinitionAngle: 0,
        patternLines: [{ angle: 0, base: [0, 0], offset: [0, 3], dashes: [2, -1] }, { angle: Math.PI / 2, base: [0, 0], offset: [3, 0], dashes: [1, -2] }],
        boundaryLoops: [{ external: true, closed: true, vertices: [[x, 0, 0], [x + 10, 0, 0], [x + 10, 6, 0], [x, 6, 0]] }, { external: false, vertices: [[x + 2, 2, 0], [x + 4, 2, 0], [x + 4, 4, 0], [x + 2, 4, 0]] }],
      }, { id })
    }
    tx.createEntity('LINE', { start: [0, 20, 0], end: [40, 20, 0] }, { id: 'unrelated' })
    if (!catalogOnly) tx.createEntity('HATCH', { patternName: '杂填土', solid: false, patternScale: 1, patternAngle: 0,
      patternDefinitionScale: 1, patternDefinitionAngle: 0, patternLines: mixedLines,
      boundaryLoops: [{ external: true, vertices: [[50, 0, 0], [60, 0, 0], [60, 6, 0], [50, 6, 0]] }],
    }, { id: 'pattern-resource' })
  })
  const patterns = [{ name: '杂填土', description: 'Synthetic review pattern', lines: mixedLines }]
  const options = catalogOnly ? { hatchPatternCatalogs: [{ version: '1.0.0', contentHash: stableHash(patterns), patterns }] } : {}
  return { sdk, document, session: new KJAgentToolSession(sdk, document, options) }
}
const mixedLines = [
  { angle: 0, base: [0, 0], offset: [0, 4], dashes: [1, -3] },
  { angle: Math.PI / 2, base: [1, 0], offset: [4, 0], dashes: [1, -3] },
  { angle: Math.PI / 4, base: [0, 1], offset: [0, 6], dashes: [2, -4] },
  { angle: -Math.PI / 4, base: [1, 1], offset: [0, 5], dashes: [1, -4] },
]
function ok(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
async function replacement(value, ids = ['left', 'right'], extra = {}) {
  const patterns = ok(await value.session.call('cad_read_hatch_patterns', { expectedRevision: value.document.revision, search: '杂填土' }))
  assert.equal(patterns.totalMatches, 1)
  return value.session.call('cad_propose_hatch_pattern', { expectedRevision: value.document.revision, units: 'millimeter', ids, patternId: patterns.patterns[0].patternId, ...extra })
}

test('a soil name is found in HATCH patterns even when no TEXT contains it', async () => {
  const value = await fixture(), before = value.document.serialize()
  assert.equal(ok(await value.session.call('cad_find_text', { expectedRevision: value.document.revision, search: '素填土' })).totalMatches, 0)
  const patterns = ok(await value.session.call('cad_read_hatch_patterns', { expectedRevision: value.document.revision, search: '素填土' }))
  assert.equal(patterns.totalMatches, 1)
  assert.deepEqual(patterns.patterns[0].entityIds, ['left', 'right'])
  assert.equal(patterns.patterns[0].lineFamilies, 2)
  assert.equal(value.document.serialize(), before)
  for (const request of ['素填土改为杂填土', '把标签素填土改为杂填土并更换花纹', 'Change the soil layer pattern']) {
    const names = getKJDrawChatToolNamesForRequest(value.document, request)
    assert.ok(names.includes('cad_read_hatch_patterns'), request)
    assert.ok(names.includes('cad_propose_hatch_pattern'), request)
  }
})

test('one approved batch changes real strokes, keeps identities/boundaries/each scale-angle, and undo/redo restores exactly', async () => {
  const value = await fixture(), before = value.document.serialize(), old = value.document.listEntities().map(entity => structuredClone(entity))
  const proposal = ok(await replacement(value))
  assert.equal(proposal.command, 'HATCHPATTERN')
  assert.equal(value.document.serialize(), before)
  assert.equal(proposal.preview.before.length, 2); assert.equal(proposal.preview.after.length, 2)
  for (const after of proposal.preview.after) {
    assert.equal(after.payload.patternName, '杂填土'); assert.equal(after.payload.patternLines.length, 4)
    const original = old.find(entity => entity.id === after.id)
    assert.deepEqual(after.payload.boundaryLoops, original.payload.boundaryLoops)
    assert.equal(after.payload.patternScale, original.payload.patternScale)
    assert.equal(after.payload.patternAngle, original.payload.patternAngle)
  }
  ok(await value.session.approve(proposal.planId, 'synthetic-reviewer'))
  for (const original of old) {
    const actual = value.document.getObject(original.id)
    if (['left', 'right'].includes(original.id)) {
      assert.equal(actual.handle, original.handle)
      assert.equal(actual.ownerId, original.ownerId)
      assert.deepEqual(actual.payload.boundaryLoops, original.payload.boundaryLoops)
      assert.equal(actual.payload.patternName, '杂填土')
    } else assert.deepEqual(actual, original)
  }
  assert.equal((await value.session.approve(proposal.planId, 'synthetic-reviewer')).ok, false)
  await value.document.undo(); assert.deepEqual(value.document.listEntities(), old)
  await value.document.redo(); assert.equal(value.document.getObject('left').payload.patternLines.length, 4)
  const reopened = await createKJDrawSDK().readDocument(await value.sdk.writeDocument(value.document, { format: 'DXF' }), { format: 'DXF' })
  for (const original of old.filter(entity => ['left', 'right'].includes(entity.id))) {
    const target = reopened.listEntities().find(entity => entity.handle === original.handle)
    assert.equal(target.payload.patternName, '杂填土'); assert.equal(target.payload.patternLines.length, 4)
    assert.equal(target.payload.boundaryLoops.length, 2)
  }
})

test('an exact private host catalog supplies a destination absent from the current file without a geology recipe', async () => {
  const value = await fixture({ catalogOnly: true })
  assert.equal(value.document.listEntities().some(entity => entity.payload.patternName === '杂填土'), false)
  const proposal = ok(await replacement(value))
  ok(await value.session.approve(proposal.planId, 'host-reviewer'))
  assert.equal(value.document.getObject('left').payload.patternName, '杂填土')
  assert.equal(value.document.getObject('left').payload.patternLines.length, 4)
  assert.equal(Object.keys(value.document.snapshot().opaquePayloads).some(key => key.startsWith('geology-drawing-recipe:')), false)
})

test('missing destination, protected/hidden/paper targets, mixed types and duplicate IDs never create a partial plan', async () => {
  for (const mode of ['missing', 'locked', 'hidden', 'paper', 'mixed', 'duplicate', 'no-op']) {
    const value = await fixture()
    if (mode === 'locked') await value.document.transact('lock', tx => tx.updateObject('right', { payload: { locked: true } }))
    if (mode === 'hidden') await value.document.transact('hide', tx => tx.updateObject('right', { payload: { visible: false } }))
    if (mode === 'paper') await value.document.transact('paper', tx => tx.reparentObject('right', value.document.spaces.paperSpaceIds[0]))
    const before = value.document.serialize()
    const ids = mode === 'mixed' ? ['left', 'unrelated'] : mode === 'duplicate' ? ['left', 'left'] : mode === 'no-op' ? ['pattern-resource'] : ['left', 'right']
    const result = mode === 'missing' ? await value.session.call('cad_propose_hatch_pattern', { expectedRevision: value.document.revision, units: 'millimeter', ids, patternId: 'not-a-pattern' }) : await replacement(value, ids)
    assert.equal(result.ok, false, mode)
    assert.equal(value.document.serialize(), before, mode)
  }
})

test('stale or replaced core approval rejects with no modification', async () => {
  for (const mode of ['stale', 'replaced']) {
    const value = await fixture(), proposal = ok(await replacement(value))
    if (mode === 'stale') await value.document.transact('another edit', tx => tx.updateObject('unrelated', { payload: { start: [1, 20, 0] } }))
    else value.sdk.commands.register({ id: 'HATCHPATTERN', execute() { throw new Error('must not execute replacement') } }, { replace: true, owner: 'synthetic-plugin' })
    const before = value.document.serialize()
    assert.equal((await value.session.approve(proposal.planId, 'reviewer')).ok, false)
    assert.equal(value.document.serialize(), before)
  }
})

test('canonical native replacement refuses mismatched expected hash and accessor/extra-field payloads', async () => {
  const value = await fixture(), before = value.document.serialize(), pattern = nativeHatchPattern({ patternName: '杂填土', patternLines: mixedLines, patternDefinitionScale: 1, patternDefinitionAngle: 0 })
  const change = { id: 'left', expectedPatternHash: hatchPatternFingerprint(value.document.getObject('left').payload), pattern }
  await assert.rejects(value.sdk.executeCommand('HATCHPATTERN', { changes: [{ ...change, expectedPatternHash: '0'.repeat(16) }] }, { document: value.document }))
  await assert.rejects(value.sdk.executeCommand('HATCHPATTERN', { changes: [{ ...change, pattern: { ...pattern, boundaryLoops: [] } }] }, { document: value.document }))
  let accessed = false
  await assert.rejects(value.sdk.executeCommand('HATCHPATTERN', { get changes() { accessed = true; return [change] } }, { document: value.document }))
  const oversized = { ...pattern, patternLines: Array.from({ length: 129 }, () => mixedLines[0]) }
  await assert.rejects(value.sdk.executeCommand('HATCHPATTERN', { changes: [{ ...change, pattern: oversized }] }, { document: value.document }))
  const inherited = [...mixedLines]
  Object.setPrototypeOf(inherited, { ...Array.prototype })
  await assert.rejects(value.sdk.executeCommand('HATCHPATTERN', { changes: [{ ...change, pattern: { ...pattern, patternLines: inherited } }] }, { document: value.document }))
  assert.equal(accessed, false)
  assert.equal(value.document.serialize(), before)
})

test('catalog pagination is explicit and a small response budget rejects rather than hides matches', async () => {
  const value = await fixture()
  const first = ok(await value.session.call('cad_read_hatch_patterns', { expectedRevision: value.document.revision, limit: 1 }))
  assert.equal(first.patterns.length, 1); assert.equal(first.nextOffset, 1)
  const next = ok(await value.session.call('cad_read_hatch_patterns', { expectedRevision: value.document.revision, offset: first.nextOffset, limit: 1 }))
  assert.notEqual(first.patterns[0].patternId, next.patterns[0].patternId)
  assert.equal(first.totalMatches, next.totalMatches)
  await value.document.transact('Synthetic catalog budget', tx => {
    for (let index = 0; index < 12; index++) tx.createEntity('HATCH', {
      patternName: `synthetic-pattern-${index}-${'x'.repeat(80)}`, solid: false,
      patternDefinitionScale: 1, patternDefinitionAngle: 0, patternLines: mixedLines,
      boundaryLoops: [{ external: true, vertices: [[0, 0, 0], [10, 0, 0], [10, 6, 0], [0, 6, 0]] }],
    })
  })
  const bounded = await value.session.call('cad_read_hatch_patterns', { expectedRevision: value.document.revision, limit: 64, maxBytes: 1024 })
  assert.equal(bounded.ok, false)
  assert.match(JSON.stringify(bounded), /exceeds maxBytes/)
  const stale = await value.session.call('cad_read_hatch_patterns', { expectedRevision: value.document.revision + 1 })
  assert.equal(stale.ok, false)
})
