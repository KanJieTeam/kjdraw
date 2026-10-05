import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/sdk.js'
import { parseAutoCADPat, hatchPatternFromCatalog } from '../src/hatch-pattern-catalog.js'
import { readAgentHatchPatterns, prepareAgentHatchPatternEdit } from '../src/agent-hatch-pattern.js'
import { stableHash } from '../src/utils.js'

// Original public fixture definitions. These test declared discovery metadata,
// not geological equivalence or an instruction-specific replacement route.
function catalog() {
  const value = structuredClone(parseAutoCADPat('*PUBLIC_A,Public engineering hatch\n45,2,3,0,4,2,-1\n*Public mixed,Public mixed fill example\n0,0,0,0,3,1,-2\n'))
  value.patterns[0].aliases = ['公开图案', 'Public diagonal']
  value.contentHash = stableHash(value.patterns)
  return value
}
async function drawing() {
  const sdk = createKJDrawSDK({ includeBundledHatchPatterns: false })
  const document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Public native hatch search fixture', tx => {
    tx.createEntity('HATCH', { ...hatchPatternFromCatalog(catalog(), 'PUBLIC_A'),
      boundaryLoops: [{ external: true, closed: true, vertices: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]] }],
    }, { id: 'public-hatch' })
  })
  return document
}

test('exact native definition merges catalog descriptions without losing drawing targets', async () => {
  const document = await drawing(), before = document.serialize(), bank = catalog()
  const result = readAgentHatchPatterns(document, { search: 'PUBLIC_A' }, [bank])
  assert.equal(result.totalMatches, 1)
  const entry = result.patterns[0]
  assert.equal(entry.name, 'PUBLIC_A')
  assert.equal(entry.source, 'drawing')
  assert.deepEqual(entry.entityIds, ['public-hatch'])
  assert.deepEqual(entry.aliases, ['公开图案', 'Public diagonal'])
  assert.deepEqual(entry.descriptions, ['Public engineering hatch'])
  assert.deepEqual(entry.catalogHashes, [stableHash(bank.patterns)])
  assert.equal(entry.matchKind, 'exact-name')
  assert.equal(entry.catalogMetadataMatch, 'exact-definition')
  assert.ok(Object.isFrozen(entry.aliases))
  assert.equal(document.serialize(), before)
})

test('search discovers declared aliases and descriptions, never substitutes their text as a pattern name', async () => {
  const document = await drawing(), bank = catalog(), before = document.serialize()
  const alias = readAgentHatchPatterns(document, { search: '公开图案' }, [bank])
  assert.equal(alias.totalMatches, 1)
  assert.equal(alias.patterns[0].name, 'PUBLIC_A')
  assert.equal(alias.patterns[0].matchKind, 'declared-alias')
  const description = readAgentHatchPatterns(document, { search: 'mixed fill' }, [bank])
  assert.equal(description.totalMatches, 1)
  assert.equal(description.patterns[0].entityCount, 0)
  assert.equal(description.patterns[0].matchKind, 'description')
  const proposal = prepareAgentHatchPatternEdit(document, {
    ids: ['public-hatch'], patternId: description.patterns[0].patternId,
  }, [bank])
  assert.equal(proposal.changes[0].pattern.patternName, 'Public mixed')
  assert.equal(readAgentHatchPatterns(document, { search: '杂填土' }, [bank]).totalMatches, 0)
  assert.equal(document.serialize(), before)
})

test('search normalizes case and full-width characters and prioritizes exact literal names', async () => {
  const document = await drawing(), bank = catalog()
  bank.patterns[1].description = 'PUBLIC_A related display metadata'
  bank.contentHash = stableHash(bank.patterns)
  const result = readAgentHatchPatterns(document, { search: 'ｐｕｂｌｉｃ＿ａ' }, [bank])
  assert.equal(result.totalMatches, 2)
  assert.equal(result.patterns[0].name, 'PUBLIC_A')
  assert.equal(result.patterns[0].matchKind, 'exact-name')
  assert.equal(result.patterns[1].matchKind, 'description')
  const first = readAgentHatchPatterns(document, { search: 'public_a', limit: 1 }, [bank])
  const second = readAgentHatchPatterns(document, { search: 'public_a', offset: first.nextOffset, limit: 1 }, [bank])
  assert.equal(first.nextOffset, 1)
  assert.equal(second.nextOffset, null)
  assert.notEqual(first.patterns[0].patternId, second.patterns[0].patternId)
})

test('same literal names with different definitions remain separate, explicit candidates', async () => {
  const document = await drawing(), bank = catalog(), other = structuredClone(bank)
  other.patterns[0].lines[0].offset = [7, 9]
  other.contentHash = stableHash(other.patterns)
  const result = readAgentHatchPatterns(document, { search: 'PUBLIC_A' }, [bank, other])
  assert.equal(result.totalMatches, 2)
  assert.notEqual(result.patterns[0].patternId, result.patterns[1].patternId)
  assert.equal(result.patterns[0].entityCount, 1)
  assert.equal(result.patterns[1].entityCount, 0)
  for (const entry of result.patterns) assert.equal(entry.name, 'PUBLIC_A')
})

test('imported same-name definitions share only discovery metadata, never pattern identity or authority', async () => {
  const document = await drawing(), bank = catalog()
  await document.transact('Original imported definition differs from the host resource', tx => {
    const payload = structuredClone(document.getObject('public-hatch').payload)
    payload.patternLines[0].offset = [2, 9]
    tx.updateObject('public-hatch', { payload })
  })
  const before = document.serialize()
  const result = readAgentHatchPatterns(document, { search: '公开图案' }, [bank])
  assert.equal(result.totalMatches, 2)
  const drawingEntry = result.patterns.find(entry => entry.source === 'drawing')
  const catalogEntry = result.patterns.find(entry => entry.source === 'host-catalog')
  assert.deepEqual(drawingEntry.entityIds, ['public-hatch'])
  assert.equal(drawingEntry.catalogMetadataMatch, 'literal-name')
  assert.equal(catalogEntry.catalogMetadataMatch, 'exact-definition')
  assert.notEqual(drawingEntry.patternId, catalogEntry.patternId)
  assert.equal(catalogEntry.entityCount, 0)
  assert.equal(document.serialize(), before)
  const prepared = prepareAgentHatchPatternEdit(document, { ids: ['public-hatch'], patternId: catalogEntry.patternId }, [bank])
  assert.notDeepEqual(prepared.changes[0].pattern.patternLines, document.getObject('public-hatch').payload.patternLines)
})

test('metadata participates in the explicit response budget, with no silent truncation', async () => {
  const document = await drawing(), bank = catalog()
  bank.patterns[0].aliases = Array.from({ length: 16 }, (_, index) => `${index}-${'a'.repeat(120)}`)
  bank.contentHash = stableHash(bank.patterns)
  assert.throws(() => readAgentHatchPatterns(document, { search: 'PUBLIC_A', maxBytes: 1024 }, [bank]), /exceeds maxBytes/)
  const result = readAgentHatchPatterns(document, { search: 'PUBLIC_A', maxBytes: 8192 }, [bank])
  assert.equal(result.patterns[0].aliases.length, 16)
})

test('malformed search or unbounded catalog metadata is rejected', async () => {
  const document = await drawing()
  for (const search of [1, 'x'.repeat(257), 'PUBLIC\nA']) {
    assert.throws(() => readAgentHatchPatterns(document, { search }), /bounded printable/)
  }
  for (const change of [
    entry => { entry.description = 'x'.repeat(257) },
    entry => { entry.aliases = Array(17).fill('name') },
    entry => { entry.aliases = ['unsafe\nname'] },
  ]) {
    const bank = catalog()
    change(bank.patterns[0])
    assert.throws(() => readAgentHatchPatterns(document, {}, [bank]), /bounded printable/)
  }
})
