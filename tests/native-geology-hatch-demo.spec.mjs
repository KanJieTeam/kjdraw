import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJDRAW_GEOLOGY_HATCH_PATTERN_SOURCE } from '../packages/kjdraw-sdk/src/knowledge-packs/geology-patterns.js'
import { parseNativeHatchDemoOptions, validateNativeHatchDemoCredentials } from '../scripts/record-native-geology-hatch-demo.mjs'
import { createPublicNativeHatchFixture, publicNativeHatchPattern, NATIVE_HATCH_DEMO_ROUNDS,
  assertNativeHatchAssociations, assertNativeHatchChange, assertNativeHatchDxf, assertNativeHatchModelReads,
  proposePublicNativeHatch } from '../scripts/testing/helpers/native-geology-hatch-demo.mjs'

test('public fixture contains only two source HATCH names, native islands/associations/metadata and unrelated geometry', async () => {
  const { sdk, document, dxf } = await createPublicNativeHatchFixture()
  assert.equal(document.listEntities().length, 9)
  assert.equal(document.listEntities({ type: 'HATCH' }).length, 2)
  assert.deepEqual(document.listEntities({ type: 'HATCH' }).map(item => [item.payload.patternName, item.payload.patternScale, item.payload.patternAngle, item.payload.hatchStyle]),
    [['素填土', 0.5, 0, 1], ['素填土', 0.5, 0, 2]])
  assert.equal(dxf.includes('杂填土'), false)
  assert.equal(document.listEntities({ type: 'TEXT' }).some(item => /素填土|杂填土/.test(item.payload.text)), false)
  assert.equal(Object.keys(document.snapshot().opaquePayloads).some(key => key.startsWith('geology-drawing-recipe:')), false)
  assertNativeHatchAssociations(document)
  assertNativeHatchDxf(document, await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' }))
})

test('default runtime imports the public DXF without any model/key and exports its exact current baseline', async () => {
  const { dxf } = await createPublicNativeHatchFixture(), runtime = createAiChatRuntime()
  try {
    const imported = await runtime.importDocument(new File([dxf], 'original-public-native-hatches.dxf'))
    assert.equal(imported.format, 'DXF'); assert.equal(imported.entityCount, 9)
    assert.equal(runtime.configured, false)
    const sdk = createKJDrawSDK(), before = await sdk.readDocument(await runtime.exportDocument('KJD'), { format: 'KJD' })
    assertNativeHatchDxf(before, await sdk.readDocument(await runtime.exportDocument('DXF'), { format: 'DXF' }))
  } finally { runtime.destroy() }
})

test('default catalog proposes an absent donor and eight sequential requests retain all native objects, metadata, history and DXF closures', async () => {
  const { sdk, document } = await createPublicNativeHatchFixture()
  for (const expected of NATIVE_HATCH_DEMO_ROUNDS) {
    const before = document.fork(), beforeFingerprint = document.fingerprint()
    const { session, proposal } = await proposePublicNativeHatch(sdk, document, expected)
    assert.equal(proposal.command, 'HATCHPATTERN')
    assert.equal(proposal.preview.before.length, 2); assert.equal(proposal.preview.after.length, 2)
    assert.equal(document.fingerprint(), beforeFingerprint, 'Read/proposal must not change the real imported drawing')
    if (expected.reject) {
      assert.equal((await session.reject(proposal.planId, 'public-fixture-reviewer')).ok, true)
      assert.equal(document.fingerprint(), beforeFingerprint)
      assert.equal((await session.approve(proposal.planId, 'public-fixture-reviewer')).ok, false)
      assert.equal(document.fingerprint(), beforeFingerprint)
      continue
    }
    assert.equal((await session.approve(proposal.planId, 'public-fixture-reviewer')).ok, true)
    assertNativeHatchChange(before, document, expected)
    const afterFingerprint = document.fingerprint(), after = document.fork()
    assertNativeHatchDxf(document, await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' }))
    await document.undo(); assert.equal(document.fingerprint(), beforeFingerprint)
    await document.redo(); assert.equal(document.fingerprint(), afterFingerprint)
    assert.deepEqual(document.listEntities(), after.listEntities())
    assert.equal((await session.approve(proposal.planId, 'public-fixture-reviewer')).ok, false)
  }
})

test('independent native oracle rejects name-only substitutions, single-target edits and unrelated geometry or metadata changes', async () => {
  const { document } = await createPublicNativeHatchFixture(), expected = NATIVE_HATCH_DEMO_ROUNDS[0]
  const hatchIds = document.listEntities({ type: 'HATCH' }).map(item => item.id)
  for (const mode of ['name-only', 'one-target', 'other-geometry', 'metadata', 'island-style', 'boundary', 'header']) {
    const actual = document.fork()
    await actual.transact('Deliberate public oracle negative control', tx => {
      for (const [index, id] of hatchIds.entries()) {
        if (mode === 'one-target' && index) continue
        const patch = { patternName: expected.name, patternScale: expected.scale, patternAngle: 0,
          patternDefinitionScale: 1, patternDefinitionAngle: 0,
          patternLines: mode === 'name-only' ? document.getObject(id).payload.patternLines : structuredClone(publicNativeHatchPattern(expected.name).lines) }
        if (mode === 'metadata' && !index) patch.rawTags = document.getObject(id).payload.rawTags.filter(tag => tag.code < 1000)
        if (mode === 'island-style' && !index) patch.hatchStyle = 2
        if (mode === 'boundary' && !index) {
          patch.boundaryLoops = structuredClone(document.getObject(id).payload.boundaryLoops)
          patch.boundaryLoops[0].vertices[0][0] += 0.1
        }
        tx.updateObject(id, { payload: patch })
      }
      if (mode === 'other-geometry') {
        const line = document.listEntities({ type: 'LINE' })[0]
        tx.updateObject(line.id, { payload: { end: [11.1, -1, 0] } })
      }
      if (mode === 'header') tx.setHeader('measurement', 0)
    })
    assert.throws(() => assertNativeHatchChange(document, actual, expected), assert.AssertionError, mode)
  }
})

test('independent ezdxf reads the original public PAT families, native styles/filled areas, dictionary/XDATA and all boundary reactors without repairs', {
  skip: !process.env.KJDRAW_PYTHON,
}, async () => {
  const { sdk, document, dxf } = await createPublicNativeHatchFixture()
  const auditPath = fileURLToPath(new URL('../scripts/audits/native-geology-hatch-demo.py', import.meta.url))
  const run = (text, expected) => {
    const child = spawnSync(process.env.KJDRAW_PYTHON, [auditPath], {
      input: JSON.stringify({ synthetic: true, dxf: text, patSource: KJDRAW_GEOLOGY_HATCH_PATTERN_SOURCE, ...expected }),
      encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
    })
    assert.equal(child.status, 0, child.stderr)
    const result = JSON.parse(child.stdout)
    assert.equal(result.errors, 0); assert.equal(result.fixes, 0); assert.equal(result.entities, 9)
    assert.deepEqual(result.styles, [1, 2]); assert.deepEqual(result.filledAreas, [29, 20])
    return result
  }
  run(dxf, { name: '素填土', scale: 0.5, degrees: 0 })
  const expected = NATIVE_HATCH_DEMO_ROUNDS[0], { session, proposal } = await proposePublicNativeHatch(sdk, document, expected)
  assert.equal((await session.approve(proposal.planId, 'public-independent-audit')).ok, true)
  run(await sdk.writeDocument(document, { format: 'DXF' }), expected)
})

test('public verification files do not implement a phrase interceptor, fixed model reply or forced tool selection', async () => {
  const source = await readFile(new URL('../scripts/record-native-geology-hatch-demo.mjs', import.meta.url), 'utf8')
  assert.equal(/tool_choice\s*[:=]|route\.fulfill|page\.route\(|modelCall\s*:|fixture-oracle-selftest/.test(source), false)
  assert.match(source, /runtime\.send\(round\.prompt/)
  assert.match(source, /createAiChatRuntime\(/)
  assert.match(source, /createModelProxy\(/)
})

test('independent native runner only permits bounded new ignored evidence and explicit real-model opt-in', () => {
  assert.equal(parseNativeHatchDemoOptions([]).live, false)
  assert.equal(parseNativeHatchDemoOptions(['--live', '--output', '.cache/native-geology-hatch-demo/preflight']).live, true)
  for (const args of [ ['--output', 'docs/media/should-not-be-written'], ['--output', '.cache'],
    ['--output', '.cache/../../outside'], ['--timeout-ms', '29999'], ['--timeout-ms', '300001'],
    ['--timeout-ms', 'NaN'], ['--live', '--live'], ['--endpoint', 'https://another-provider.invalid'],
    ['--model', 'fixed-test-reply'], ['--output'] ]) assert.throws(() => parseNativeHatchDemoOptions(args))
})

test('existing nested credential schema accepts only the official fixed DeepSeek endpoint and loopback proxy', () => {
  const config = { deepseek: { apiKey: 'public-test-not-a-secret', endpoint: 'https://api.deepseek.com', model: 'deepseek-chat' }, proxy: 'http://127.0.0.1:7890' }
  assert.equal(validateNativeHatchDemoCredentials(config).model, 'deepseek-chat')
  assert.equal(validateNativeHatchDemoCredentials({ ...config, deepseek: { ...config.deepseek, endpoint: 'https://api.deepseek.com/chat/completions' } }).model, 'deepseek-chat')
  for (const patch of [ { endpoint: 'https://another-provider.invalid' }, { endpoint: 'https://api.deepseek.com/other' },
    { endpoint: 'https://api.deepseek.com/chat/completions?token=not-allowed' }, { apiKey: 'public\nheader' }, { model: 'mock-reply' } ])
    assert.throws(() => validateNativeHatchDemoCredentials({ ...config, deepseek: { ...config.deepseek, ...patch } }))
  assert.throws(() => validateNativeHatchDemoCredentials({ ...config, proxy: 'http://another-host.invalid:7890' }))
})

test('native model-read guard accepts actual native catalog discovery but rejects catalog-only, wrong, incomplete, truncated or failed reads', async () => {
  const { document } = await createPublicNativeHatchFixture()
  const ids = document.listEntities({ type: 'HATCH' }).map(entity => entity.id)
  const proof = (patterns, ok = true) => [ { name: 'cad_read_hatch_patterns', result: { ok, value: { patterns, documentId: document.id, revision: document.revision } } },
    { name: 'cad_propose_hatch_pattern', result: { ok: true } } ]
  const pattern = { source: 'drawing', entityIds: ids, entityIdsTruncated: false }
  assert.equal(assertNativeHatchModelReads(proof([pattern]), document).nativeCatalogRead, true)
  assert.equal(assertNativeHatchModelReads([...proof([{ source: 'host-catalog', entityIds: [], entityIdsTruncated: false }]),
    { name: 'cad_query_drawing', result: { ok: true, value: { documentId: document.id, revision: document.revision,
      entities: ids.map(id => ({ id, type: 'HATCH' })) } } }], document).nativeCatalogRead, false)
  for (const patterns of [ [{ ...pattern, source: 'host-catalog' }], [{ ...pattern, entityIds: ids.slice(0, 1) }],
    [{ ...pattern, entityIds: [ids[0], 'unrelated-id'] }], [{ ...pattern, entityIdsTruncated: true }] ])
    assert.throws(() => assertNativeHatchModelReads(proof(patterns), document))
  assert.throws(() => assertNativeHatchModelReads(proof([pattern], false), document))
  for (const patch of [ { revision: document.revision + 1 }, { documentId: 'wrong-public-drawing' } ]) {
    const stale = proof([pattern]); Object.assign(stale[0].result.value, patch)
    assert.throws(() => assertNativeHatchModelReads(stale, document))
  }
  assert.throws(() => assertNativeHatchModelReads(proof([pattern]).slice(0, 1), document))
  assert.throws(() => assertNativeHatchModelReads([{ name: 'cad_query_drawing', result: { ok: true } },
    { name: 'cad_propose_hatch_pattern', result: { ok: true } }], document))
})
