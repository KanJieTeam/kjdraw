import assert from 'node:assert/strict'
import test from 'node:test'
import { createKJDrawSDK } from '../src/index.js'

function fixture({ elevation = 7, extrusion = [0, 1, 0], solid = false } = {}) {
  return [
    '0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1032', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', '0', 'HATCH', '5', 'A1',
    '100', 'AcDbEntity', '8', '0', '100', 'AcDbHatch',
    '10', '0', '20', '0', '30', String(elevation),
    '210', String(extrusion[0]), '220', String(extrusion[1]), '230', String(extrusion[2]),
    '2', solid ? 'SOLID' : 'ANSI31', '70', solid ? '1' : '0', '71', '0', '91', '1',
    '92', '3', '72', '0', '73', '1', '93', '4',
    '10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '8', '10', '0', '20', '8',
    '97', '0', '75', '0', '76', '1',
    ...(solid ? [] : [
      '52', '0', '41', '1', '77', '0', '78', '1',
      '53', '45', '43', '1', '44', '2', '45', '-2', '46', '2', '79', '2', '49', '2', '49', '-1',
    ]),
    '98', '0', '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\r\n')
}

const json = value => JSON.parse(JSON.stringify(value))
const ocsTags = payload => payload.rawTags.filter(tag => [30, 210, 220, 230].includes(tag.code))

test('untouched non-planar solid and patterned HATCH retain OCS through KJD and DXF reopening', async () => {
  for (const options of [
    { elevation: 7, extrusion: [0, 0, 1], solid: true },
    { elevation: 0, extrusion: [0, 1, 0] },
    { elevation: 7, extrusion: [0, 1, 0] },
  ]) {
    const sdk = createKJDrawSDK()
    const source = await sdk.readDocument(fixture(options), { format: 'DXF' })
    const original = source.listEntities({ type: 'HATCH' })[0]
    await sdk.writeDocument(source, { format: 'DXF' })
    let current = source
    for (let round = 0; round < 3; round++) {
      const beforeSave = json(current.listEntities({ type: 'HATCH' })[0].payload)
      current = await sdk.readDocument(await sdk.writeDocument(current, { format: 'KJD' }), { format: 'KJD' })
      const saved = current.listEntities({ type: 'HATCH' })[0]
      assert.deepEqual(json(saved.payload), beforeSave)
      current = await sdk.readDocument(await sdk.writeDocument(current, { format: 'DXF' }), { format: 'DXF' })
      const actual = current.listEntities({ type: 'HATCH' })[0]
      assert.equal(actual.handle, original.handle)
      assert.deepEqual(json(actual.payload.boundaryLoops), json(original.payload.boundaryLoops))
      assert.deepEqual(actual.payload.patternLines, original.payload.patternLines)
      assert.deepEqual(json(ocsTags(actual.payload)), json(ocsTags(original.payload)))
    }
  }
})

test('non-geometric property edits preserve imported non-planar HATCH geometry after KJD reopening', async () => {
  const sdk = createKJDrawSDK()
  const source = await sdk.readDocument(fixture(), { format: 'DXF' })
  const current = await sdk.readDocument(await sdk.writeDocument(source, { format: 'KJD' }), { format: 'KJD' })
  const original = current.listEntities({ type: 'HATCH' })[0]
  await current.transact('Change display color only', tx => tx.updateObject(original.id, { payload: { color: 3 } }))
  const reopened = await sdk.readDocument(await sdk.writeDocument(current, { format: 'DXF' }), { format: 'DXF' })
  const actual = reopened.listEntities({ type: 'HATCH' })[0]
  assert.equal(actual.payload.color, 3)
  assert.deepEqual(json(actual.payload.boundaryLoops), json(original.payload.boundaryLoops))
  assert.deepEqual(json(ocsTags(actual.payload)), json(ocsTags(original.payload)))
})

test('genuine non-planar HATCH boundary and pattern edits remain blocked without an OCS-aware adapter', async () => {
  const sdk = createKJDrawSDK()
  const source = await sdk.readDocument(fixture(), { format: 'DXF' })
  const saved = await sdk.writeDocument(source, { format: 'KJD' })
  for (const change of [
    payload => ({ patternScale: payload.patternScale + 1e-10 }),
    payload => ({ patternAngle: payload.patternAngle + 1e-10 }),
    payload => {
      const boundaryLoops = json(payload.boundaryLoops)
      boundaryLoops[0].vertices[0].point[0] += 1e-10
      return { boundaryLoops }
    },
    payload => {
      const patternLines = json(payload.patternLines)
      patternLines[0].dashes[0] += 1e-10
      return { patternLines }
    },
  ]) {
    const current = await sdk.readDocument(saved, { format: 'KJD' })
    const hatch = current.listEntities({ type: 'HATCH' })[0]
    await current.transact('Explicit geometric edit', tx => tx.updateObject(hatch.id, { payload: change(hatch.payload) }))
    await assert.rejects(sdk.writeDocument(current, { format: 'DXF' }), error =>
      /Edited non-planar DXF HATCH geometry requires an OCS-aware adapter/u.test(error.cause?.message ?? error.message))
  }
})
