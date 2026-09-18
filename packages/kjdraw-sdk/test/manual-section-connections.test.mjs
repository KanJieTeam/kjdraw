import assert from 'node:assert/strict'
import test from 'node:test'
import { compileGeologySection } from '../src/index.js'

const holes = [
  { id: 'ZK1', station: 0, collarElevation: 100, depth: 10, strata: [{ code: '1', name: 'soil', top: 0, bottom: 10, lithology: 'clay' }] },
  { id: 'ZK2', station: 20, collarElevation: 99, depth: 10, strata: [{ code: '1', name: 'soil', top: 0, bottom: 10, lithology: 'clay' }] },
]

test('source manual section connection is rendered without inventing a correlation', () => {
  const result = compileGeologySection({
    holes,
    correlations: [],
    manualConnections: [{ fromHoleId: 'ZK1', toHoleId: 'ZK2', fromDepth: 4, toDepth: 5, kind: 'pinchout', layerCode: '1' }],
    horizontalScaleDenominator: 100,
    verticalScaleDenominator: 100,
    datumElevation: 80,
    surfaceRule: 'straight-between-supplied-collars',
    expectedRevision: 0,
  })
  const lines = result.commandArgs.entities.filter(entity => entity.type === 'LINE' && entity.payload.semanticRole === 'source-manual-connection')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].payload.connectionKind, 'pinchout')
  assert.equal(lines[0].payload.sourceLayerCode, '1')
  assert.equal(result.evidence.entityCount, result.commandArgs.entities.length)
})

test('source manual section connections reject non-adjacent, out-of-range and crossing input', () => {
  assert.throws(() => compileGeologySection({ holes, correlations: [], manualConnections: [{ fromHoleId: 'ZK1', toHoleId: 'ZK2', fromDepth: 11, toDepth: 5 }], horizontalScaleDenominator: 100, verticalScaleDenominator: 100, datumElevation: 80, surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }), /outside its borehole/)
  assert.throws(() => compileGeologySection({ holes, correlations: [], manualConnections: [{ fromHoleId: 'ZK2', toHoleId: 'ZK1', fromDepth: 4, toDepth: 5 }], horizontalScaleDenominator: 100, verticalScaleDenominator: 100, datumElevation: 80, surfaceRule: 'straight-between-supplied-collars', expectedRevision: 0 }), /declared station order/)
})
