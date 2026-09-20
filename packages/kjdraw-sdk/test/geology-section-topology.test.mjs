import assert from 'node:assert/strict'
import test from 'node:test'
import { compileGeologySectionTopology } from '../src/geology-section-topology.js'

const principal = (intervalId, groupId, top, bottom) => ({ intervalId, groupId, groupRole: 'principal', code: groupId, top, bottom })
const lens = (intervalId, groupId, code, top, bottom) => ({ intervalId, groupId, groupRole: 'lens', code, top, bottom })
const hole = (id, station, collarElevation, depth, strata) => ({ id, station, collarElevation, depth, strata })

test('group topology merges split principals, preserves exact lens occurrences and treats hole termination as unpenetrated', () => {
  const topology = compileGeologySectionTopology([
    hole('P1', 0, 100, 12, [principal('1a', 'A', 0, 3), lens('1l', 'A', 'A-1', 3, 4), principal('1b', 'A', 4, 7), principal('1c', 'B', 7, 12)]),
    hole('P2', 10, 101, 13, [principal('2a', 'A', 0, 3.5), lens('2l', 'A', 'A-1', 3.5, 5), principal('2b', 'A', 5, 8), principal('2c', 'B', 8, 13)]),
    hole('P3', 22, 100.5, 11, [principal('3a', 'A', 0, 6), principal('3b', 'B', 6, 11)]),
  ])
  assert.equal(topology.mainIdentityCount, 2)
  assert.equal(topology.lensIdentityCount, 1)
  assert.equal(topology.mainCells.length, 2)
  assert.equal(topology.lensCells.length, 2)
  assert.equal(topology.mainBoundaries.length, 2)
  assert.deepEqual(topology.mainCells.map(cell => [cell.identity, cell.leftHoleId, cell.rightHoleId]), [['A', 'P1', 'P2'], ['A', 'P2', 'P3']])
  assert.deepEqual(topology.lensCells.map(cell => [cell.leftHoleId, cell.rightHoleId, cell.pinchout]), [['P1', 'P2', false], ['P2', 'P3', true]])
  assert.ok(topology.mainBoundaries.every(boundary => boundary.identity === 'A'))
})

test('group topology creates source-bounded midpoint pinches and rejects incomplete identities atomically', () => {
  const topology = compileGeologySectionTopology([
    hole('P1', 0, 100, 10, [principal('a', 'A', 0, 4), principal('b', 'B', 4, 10)]),
    hole('P2', 8, 100, 10, [principal('c', 'B', 0, 10)]),
  ])
  assert.equal(topology.mainCells.length, 1)
  assert.equal(topology.mainCells[0].identity, 'A')
  assert.equal(topology.mainCells[0].pinchout, true)
  assert.deepEqual(topology.mainCells[0].points.map(point => point.station), [0, 4, 0])
  assert.equal(topology.mainBoundaries[0].mode, 'known-missing-midpoint')
  assert.deepEqual(topology.mainCells[0].points[1], topology.mainBoundaries[0].points[1],
    'a proven pinchout cell and its bottom boundary terminate at the same source-bounded midpoint')
  assert.throws(() => compileGeologySectionTopology([
    hole('P1', 0, 100, 10, [{ code: 'A', top: 0, bottom: 10 }]),
    hole('P2', 8, 100, 10, [principal('c', 'A', 0, 10)]),
  ]), /group id/u)
  const unpenetrated = compileGeologySectionTopology([
    hole('P1', 0, 100, 10, [principal('a', 'A', 0, 4), principal('b', 'B', 4, 10)]),
    hole('P2', 8, 100, 3, [principal('c', 'B', 0, 3)]),
  ])
  assert.equal(unpenetrated.mainCells.length, 0, 'a shallower termination is not proof that the missing group pinches out')
  assert.equal(unpenetrated.mainBoundaries.length, 0, 'an unpenetrated missing group never invents a bottom boundary')
  const lowCollar = compileGeologySectionTopology([
    hole('P1', 0, 100, 10, [principal('a', 'A', 0, 4), principal('b', 'B', 4, 10)]),
    hole('P2', 8, 90, 10, [principal('c', 'B', 0, 10)]),
  ])
  assert.equal(lowCollar.mainCells.length, 0, 'a collar already below the known group is not evidence of absence')
  assert.throws(() => compileGeologySectionTopology([
    hole('P1', 0, 100, 10, [principal('a', 'A', 0, 4), principal('b', 'B', 4, 10)]),
    hole('P2', 8, 100, 10, [principal('c', 'B', 0, 4), principal('d', 'A', 4, 10)]),
  ]), /cross or reverse/u)
  assert.throws(() => compileGeologySectionTopology([
    hole('P1', 0, 100, 10, [principal('a', 'A', 0, 3), principal('b', 'B', 3, 6), principal('c', 'A', 6, 10)]),
    hole('P2', 8, 100, 10, [principal('d', 'A', 0, 10)]),
  ]), /discontinuous major group/u)
  assert.throws(() => compileGeologySectionTopology([
    hole('P1', 0, 100, 10, [principal('a1', 'A', 0, 2), lens('l1', 'A', 'L1', 2, 3), principal('a2', 'A', 3, 4),
      lens('l2', 'A', 'L2', 4, 5), principal('a3', 'A', 5, 10)]),
    hole('P2', 8, 100, 10, [principal('b1', 'A', 0, 2), lens('r2', 'A', 'L2', 2, 3), principal('b2', 'A', 3, 4),
      lens('r1', 'A', 'L1', 4, 5), principal('b3', 'A', 5, 10)]),
  ]), /lens occurrences cross or reverse/u)
  assert.throws(() => compileGeologySectionTopology([
    hole('P1', 0, 100, 10, [principal('a1', 'A', 0, 2), lens('l1', 'A', 'L', 2, 3), principal('a2', 'A', 3, 4),
      lens('l2', 'A', 'L', 4, 5), principal('a3', 'A', 5, 10)]),
    hole('P2', 8, 100, 10, [principal('b1', 'A', 0, 4), lens('r1', 'A', 'L', 4, 5), principal('b2', 'A', 5, 10)]),
  ]), /shared explicit occurrence identity/u)
  assert.throws(() => compileGeologySectionTopology([
    hole('P1', 0, 100, 14, [principal('a1', 'A', 0, 4), principal('b1', 'B', 4, 4.2),
      lens('l1', 'B', 'B-1', 4.2, 4.4), principal('b2', 'B', 4.4, 10), principal('c1', 'C', 10, 14)]),
    hole('P2', 8, 100, 14, [principal('a2', 'A', 0, 8), principal('b3', 'B', 8, 12), principal('c2', 'C', 12, 14)]),
  ]), /lens occurrence crosses its host major-group boundary/u)
  const crowded = Array.from({ length: 24 }, (_, holeIndex) => hole(`Q${holeIndex + 1}`, holeIndex, 100, 80,
    Array.from({ length: 80 }, (_, intervalIndex) => principal(`${holeIndex}-${intervalIndex}`, `G${intervalIndex}`, intervalIndex, intervalIndex + 1))))
  assert.throws(() => compileGeologySectionTopology(crowded), /entity budget/u)
})
