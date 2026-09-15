import assert from 'node:assert/strict'
import test from 'node:test'

import {
  KJKnowledgePackRegistry,
  buildHatchPatternKnowledgePack,
  createKJDrawSDK,
  hatchPatternFromCatalog,
  hatchPatternFromKnowledgePack,
  parseAutoCADPat,
} from '../src/index.js'
import { hatchPatternLines } from '../src/geometry/hatch.js'

const fixture = `; synthetic public test data
*CLAY_TEST, crossed clay pattern
0, 0, 0, 0, 4, 1, -3
90, 0, 0, 4, 0, 1, -3
*砂层测试, granular test pattern
45, 0, 0, 3, 3, 0, -2
`

test('PAT parser produces deterministic bounded native pattern data', () => {
  const first = parseAutoCADPat(fixture), second = parseAutoCADPat(fixture)
  assert.deepEqual(first, second)
  assert.equal(first.patterns.length, 2)
  assert.equal(first.patterns[0].name, 'CLAY_TEST')
  assert.equal(first.patterns[0].lines[1].angle, Math.PI / 2)
  assert.deepEqual(first.patterns[1].lines[0].dashes, [0, -2])
  assert.match(first.contentHash, /^[a-f0-9]{16}$/)
  assert.ok(Object.isFrozen(first))
})

test('PAT parser accepts legacy DOS EOF and bare terminator records', () => {
  const catalog = parseAutoCADPat('*LEGACY\n0,0,0,0,4\n*\n\u001a ignored legacy bytes')
  assert.equal(catalog.patterns.length, 1)
  assert.equal(catalog.patterns[0].name, 'LEGACY')
})

test('parsed PAT pattern becomes editable HATCH and survives KJD and DXF reopen', async () => {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: 'pat-catalog-roundtrip', units: 'millimeter' })
  const pattern = hatchPatternFromCatalog(parseAutoCADPat(fixture), 'clay_test', { scale: 1.5, angleDegrees: 15 })
  await sdk.executeCommand('CREATE', { type: 'HATCH', payload: {
    boundaryLoops: [{ external: true, closed: true, vertices: [[0, 0, 0], [20, 0, 0], [20, 15, 0], [0, 15, 0]] }],
    solid: false,
    ...pattern,
  } }, { document })
  const hatch = document.listEntities({ type: 'HATCH' })[0]
  assert.equal(hatch.payload.patternName, 'CLAY_TEST')
  assert.equal(hatch.payload.patternLines.length, 2)

  const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
  const reopenedKjd = await sdk.readDocument(kjd, { format: 'KJD', version: '1' })
  assert.equal(reopenedKjd.listEntities({ type: 'HATCH' })[0].payload.patternLines.length, 2)

  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopenedDxf = await sdk.readDocument(dxf, { format: 'DXF', version: '2018' })
  const dxfHatch = reopenedDxf.listEntities({ type: 'HATCH' })[0]
  assert.equal(dxfHatch.payload.patternName, 'CLAY_TEST')
  const nativeLines = hatchPatternLines(dxfHatch.payload)
  assert.equal(nativeLines.length, 2)
  assert.ok(Math.abs(nativeLines[0].angle - Math.PI / 12) < 1e-9)
  assert.equal(reopenedDxf.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
})

test('PAT parser rejects malformed, duplicate and unbounded definitions', () => {
  assert.throws(() => parseAutoCADPat('0,0,0,0,1'), /before a pattern header/)
  assert.throws(() => parseAutoCADPat('*A\n0,0,0,0,1\n*a\n0,0,0,0,1'), /duplicates pattern/)
  assert.throws(() => parseAutoCADPat('*DOTS\n0,0,0,1,1,0,0'), /only dots/)
  assert.throws(() => parseAutoCADPat(`*A\n0,0,0,0,${'9'.repeat(400)}`), /bounded finite number/)
  assert.throws(() => hatchPatternFromCatalog(parseAutoCADPat(fixture), 'missing'), /does not exist/)
})

test('selected PAT definitions become license-gated semantic knowledge packs', () => {
  const input = {
    id: 'geology.patterns.synthetic', version: '1.0.0', title: 'Synthetic geology patterns', domain: 'geology',
    license: { spdx: 'Apache-2.0', redistributable: true, trainingAllowed: true },
    sources: [{ id: 'synthetic-fixture', title: 'Synthetic public PAT fixture', license: 'Apache-2.0', contentHash: '0123456789abcdef' }],
    patSource: fixture,
    selectedPatterns: ['CLAY_TEST'],
    mappings: { clay: 'CLAY_TEST' },
  }
  const pack = buildHatchPatternKnowledgePack(input)
  assert.equal(new KJKnowledgePackRegistry().register(pack).id, 'geology.patterns.synthetic')
  const pattern = hatchPatternFromKnowledgePack(pack, 'clay')
  assert.equal(pattern.patternName, 'CLAY_TEST')
  assert.equal(pattern.patternLines.length, 2)

  const privatePack = buildHatchPatternKnowledgePack({ ...input, id: 'geology.patterns.private', license: { ...input.license, redistributable: false } })
  assert.throws(() => new KJKnowledgePackRegistry().register(privatePack), /not redistributable/)
  assert.throws(() => buildHatchPatternKnowledgePack({ ...input, mappings: { clay: '砂层测试' } }), /unselected pattern/)
})
