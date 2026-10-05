import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK, mergeHatchPatternCatalogs } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { parseAutoCADPat } from '../packages/kjdraw-sdk/src/hatch-pattern-catalog.js'
import { KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG } from '../packages/kjdraw-sdk/src/knowledge-packs/geology-patterns.js'
import { stableHash } from '../packages/kjdraw-sdk/src/utils.js'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'

// Public synthetic host resources and protocol fixtures only; no provider/key,
// private drawing or claimed live-model acceptance is involved.
const hostCatalog = (count = 1, prefix = 'PUBLIC_HOST') => structuredClone(parseAutoCADPat(Array.from({ length: count }, (_, index) =>
  `*${prefix}_${index},Synthetic host pattern ${index}\n30,1,2,0,8,2,-3`).join('\n')))
const close = sdk => { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
const read = (session, document, search) => session.call('cad_read_hatch_patterns', {
  expectedRevision: document.revision, ...(search === undefined ? {} : { search }), offset: 0, limit: 64, maxBytes: 262144,
})

test('every default SDK exposes all 209 immutable bundled patterns without modifying CAD', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  try {
    assert.equal(sdk.hatchPatternCatalogs.length, 1)
    assert.equal(sdk.hatchPatternCatalogs[0].patterns.length, 209)
    assert.equal(sdk.hatchPatternCatalogs[0].patterns.reduce((sum, pattern) => sum + pattern.lines.length, 0), 940)
    assert.equal(Object.isFrozen(sdk.hatchPatternCatalogs), true)
    assert.equal(Object.isFrozen(sdk.hatchPatternCatalogs[0].patterns[0].lines[0].offset), true)
    const before = document.serialize(), session = new KJAgentToolSession(sdk, document), names = new Set()
    let offset = 0
    do {
      const result = await session.call('cad_read_hatch_patterns', { expectedRevision: document.revision, offset, limit: 64, maxBytes: 262144 })
      assert.equal(result.ok, true)
      for (const pattern of result.value.patterns) names.add(pattern.name)
      offset = result.value.nextOffset
    } while (offset !== null)
    for (const pattern of KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG.patterns) assert.equal(names.has(pattern.name), true, pattern.name)
    assert.equal(document.serialize(), before)
    const destination = await read(session, document, '杂填土')
    assert.equal(destination.ok, true)
    const exact = destination.value.patterns.find(pattern => pattern.name === '杂填土')
    assert.ok(exact); assert.equal(exact.lineFamilies, 4); assert.equal(exact.entityCount, 0)
  } finally { close(sdk) }
})

test('SDK host resources are detached and retained by every new session, even after caller mutation', async () => {
  const catalog = hostCatalog(), sdk = createKJDrawSDK({ hatchPatternCatalogs: [catalog] })
  const document = sdk.createDocument({ units: 'millimeter' })
  try {
    catalog.patterns[0].name = 'CALLER_CHANGED'; catalog.patterns[0].lines[0].offset[0] = 999
    const one = await read(new KJAgentToolSession(sdk, document), document, 'PUBLIC_HOST_0')
    const two = await read(new KJAgentToolSession(sdk, document), document, 'PUBLIC_HOST_0')
    assert.equal(one.ok, true); assert.equal(two.ok, true)
    assert.deepEqual(one.value.patterns, two.value.patterns)
    assert.equal(one.value.totalMatches, 1)
    assert.equal((await read(new KJAgentToolSession(sdk, document), document, 'CALLER_CHANGED')).value.totalMatches, 0)
    assert.throws(() => { sdk.hatchPatternCatalogs = [] }, TypeError)
    assert.throws(() => Object.defineProperty(sdk, 'hatchPatternCatalogs', { value: [] }), TypeError)
    assert.throws(() => { sdk.hatchPatternCatalogs[1].patterns[0].name = 'MUTATED_SDK' }, TypeError)
  } finally { close(sdk) }
})

test('session resources merge with the SDK snapshot once and exact duplicate catalogs do not multiply authority', async () => {
  const sdkCatalog = hostCatalog(1, 'SDK_SCOPE'), sessionCatalog = hostCatalog(1, 'SESSION_SCOPE')
  const sdk = createKJDrawSDK({ hatchPatternCatalogs: [sdkCatalog, structuredClone(KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG)] })
  const document = sdk.createDocument({ units: 'millimeter' })
  try {
    assert.equal(sdk.hatchPatternCatalogs.length, 2)
    const session = new KJAgentToolSession(sdk, document, { hatchPatternCatalogs: [sessionCatalog, sdkCatalog] })
    sessionCatalog.patterns[0].name = 'AFTER_SESSION_MUTATION'
    assert.equal((await read(session, document, 'SDK_SCOPE_0')).value.totalMatches, 1)
    assert.equal((await read(session, document, 'SESSION_SCOPE_0')).value.totalMatches, 1)
    assert.equal((await read(session, document, 'AFTER_SESSION_MUTATION')).value.totalMatches, 0)
    assert.equal((await read(new KJAgentToolSession(sdk, document), document, 'SESSION_SCOPE_0')).value.totalMatches, 0)
  } finally { close(sdk) }
})

test('constructor-only bundled opt-out allows a full 256-pattern host library without silently increasing the budget', async () => {
  const full = hostCatalog(256)
  assert.throws(() => createKJDrawSDK({ hatchPatternCatalogs: [full] }), /256 patterns/)
  const sdk = createKJDrawSDK({ includeBundledHatchPatterns: false, hatchPatternCatalogs: [full] })
  const document = sdk.createDocument({ units: 'millimeter' })
  try {
    assert.equal(sdk.hatchPatternCatalogs[0].patterns.length, 256)
    assert.equal((await read(new KJAgentToolSession(sdk, document), document, 'PUBLIC_HOST_255')).value.totalMatches, 1)
    assert.equal((await read(new KJAgentToolSession(sdk, document), document, '杂填土')).value.totalMatches, 0)
  } finally { close(sdk) }
  close(createKJDrawSDK({ hatchPatternCatalogs: [hostCatalog(47)] }))
  assert.throws(() => createKJDrawSDK({ hatchPatternCatalogs: [hostCatalog(48)] }), /256 patterns/)
  assert.throws(() => mergeHatchPatternCatalogs(Array.from({ length: 17 }, (_, index) => hostCatalog(1, `CAT_${index}`))), /16 dense/)
})

test('declared content hashes never authorize modified definitions or cause full-data catalogs to collapse', () => {
  const original = hostCatalog(), tampered = structuredClone(original)
  tampered.patterns[0].lines[0].dashes[0] = 9
  assert.throws(() => createKJDrawSDK({ hatchPatternCatalogs: [tampered] }), /content hash/)
  tampered.contentHash = stableHash(tampered.patterns)
  const merged = mergeHatchPatternCatalogs([original, tampered])
  assert.equal(merged.length, 2)
  assert.notDeepEqual(merged[0].patterns[0].lines, merged[1].patterns[0].lines)
})

test('catalog descriptions and optional explicit aliases are bounded detached data, not native pattern renames', async () => {
  const catalog = hostCatalog(); catalog.patterns[0].aliases = ['Public exact host alias']
  catalog.contentHash = stableHash(catalog.patterns)
  const sdk = createKJDrawSDK({ hatchPatternCatalogs: [catalog] }), document = sdk.createDocument({ units: 'millimeter' })
  try {
    const session = new KJAgentToolSession(sdk, document), result = await read(session, document, 'Public exact host alias')
    assert.equal(result.ok, true); assert.equal(result.value.totalMatches, 1)
    assert.equal(result.value.patterns[0].name, 'PUBLIC_HOST_0')
    catalog.patterns[0].aliases[0] = 'Mutated alias'
    assert.equal((await read(session, document, 'Mutated alias')).value.totalMatches, 0)
  } finally { close(sdk) }
  for (const value of ['x'.repeat(129), 'bad\nname', '']) {
    const bad = hostCatalog(); bad.patterns[0].aliases = [value]; bad.contentHash = stableHash(bad.patterns)
    assert.throws(() => createKJDrawSDK({ hatchPatternCatalogs: [bad] }), /aliases/)
  }
  const longDescription = hostCatalog(); longDescription.patterns[0].description = 'x'.repeat(257)
  assert.throws(() => createKJDrawSDK({ hatchPatternCatalogs: [longDescription] }), /descriptions/)
})

test('catalog authority rejects inherited options, accessors, sparse data and invalid bundled policy without invoking getters', () => {
  let getters = 0
  for (const key of ['hatchPatternCatalogs', 'includeBundledHatchPatterns']) {
    const accessor = {}; Object.defineProperty(accessor, key, { enumerable: true, get() { getters++; return key === 'hatchPatternCatalogs' ? [] : false } })
    assert.throws(() => createKJDrawSDK(accessor), /own enumerable data property/)
    assert.throws(() => createAiChatRuntime(accessor), /own enumerable data property/)
    assert.throws(() => createKJDrawSDK(Object.create({ [key]: key === 'hatchPatternCatalogs' ? [] : false })), /own enumerable data property/)
    assert.throws(() => createAiChatRuntime(Object.create({ [key]: key === 'hatchPatternCatalogs' ? [] : false })), /own enumerable data property/)
  }
  const nested = hostCatalog()
  Object.defineProperty(nested.patterns[0], 'description', { enumerable: true, get() { getters++; return 'untrusted accessor' } })
  assert.throws(() => createKJDrawSDK({ hatchPatternCatalogs: [nested] }), /accessors/)
  const sparse = hostCatalog(); sparse.patterns[0].aliases = new Array(2); sparse.patterns[0].aliases[1] = 'present'; sparse.patterns[0].aliases.extra = 'not dense'
  assert.throws(() => createKJDrawSDK({ hatchPatternCatalogs: [sparse] }), /dense/)
  for (const value of [null, 'false', 0]) assert.throws(() => createKJDrawSDK({ includeBundledHatchPatterns: value }), /must be boolean/)
  assert.equal(getters, 0)
})

function runtimeFixture(options = {}) {
  let runtime
  runtime = createAiChatRuntime({ ...options, endpoint: 'https://public-catalog-fixture.invalid/chat/completions',
    model: 'protocol-fixture-not-a-live-model', captureToolOutputs: true,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body), tool = body.messages.findLast(message => message.role === 'tool')
      return Response.json({ choices: [{ finish_reason: tool ? 'stop' : 'tool_calls', message: {
        role: 'assistant', content: tool ? 'Public catalog read complete; no drawing edit.' : '',
        ...(!tool ? { tool_calls: [{ id: 'public-read', type: 'function', function: {
          name: 'cad_read_hatch_patterns', arguments: JSON.stringify({ expectedRevision: runtime.revision,
            search: body.messages.findLast(message => message.role === 'user').content.split('RESOURCE=').at(-1).trim().split(' ')[0], limit: 64, maxBytes: 262144 }),
        } }] } : {}),
      } }] })
    } })
  return runtime
}
async function runtimeRead(runtime, search) {
  const result = await runtime.send(`Read-only public pattern resource, do not edit drawing. RESOURCE=${search} `)
  assert.equal(result.status, 'message', JSON.stringify(result.error))
  assert.equal(result.toolOutputs[0].result.ok, true)
  return result.toolOutputs[0].result.value
}

test('runtime catalog policy is immutable and caller option mutation cannot change later requests or removal', async () => {
  const catalog = hostCatalog(), runtime = runtimeFixture({ hatchPatternCatalogs: [catalog] })
  try {
    catalog.patterns[0].name = 'MUTATED_AFTER_RUNTIME'
    assert.equal((await runtimeRead(runtime, 'PUBLIC_HOST_0')).totalMatches, 1)
    assert.throws(() => runtime.configure({ hatchPatternCatalogs: [hostCatalog(1, 'NEW_AUTHORITY')] }), /immutable/)
    assert.throws(() => runtime.configure({ includeBundledHatchPatterns: false }), /immutable/)
    await runtime.removeDrawing()
    assert.equal((await runtimeRead(runtime, 'PUBLIC_HOST_0')).totalMatches, 1)
    assert.equal((await runtimeRead(runtime, 'MUTATED_AFTER_RUNTIME')).totalMatches, 0)
    assert.equal((await runtimeRead(runtime, '杂填土')).patterns.some(pattern => pattern.name === '杂填土'), true)
  } finally { runtime.destroy() }
})

test('restored chat/drawing fields cannot register catalogs or opt out of the default bundled resource policy', async () => {
  const seed = createAiChatRuntime(), state = await seed.exportLocalState(); seed.destroy()
  state.hatchPatternCatalogs = [hostCatalog(1, 'UNTRUSTED_SAVED')]; state.includeBundledHatchPatterns = false
  const runtime = runtimeFixture()
  try {
    await runtime.restoreLocalState(state)
    assert.equal((await runtimeRead(runtime, 'UNTRUSTED_SAVED_0')).totalMatches, 0)
    assert.equal((await runtimeRead(runtime, '杂填土')).patterns.some(pattern => pattern.name === '杂填土'), true)
    assert.equal((await runtime.exportLocalState()).drawing, state.drawing)
  } finally { runtime.destroy() }
})
