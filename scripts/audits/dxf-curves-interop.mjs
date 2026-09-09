import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import { arcSweep } from '../../packages/kjdraw-sdk/src/geometry/measure.js'

const python = process.env.KJDRAW_PYTHON || (process.platform === 'win32' ? 'python.exe' : 'python3')
const bridge = fileURLToPath(new URL('./ezdxf-curves.py', import.meta.url))
const radians = degrees => degrees * Math.PI / 180
const fractions = Array.from({ length: 9 }, (_, index) => index / 8)
const style = { color: 2, lineweight: 35, linetypeScale: 1.5 }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const near = (actual, expected, label, tolerance = 1e-8) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`)
}

function expectedCurve(label, entity, layer, center, radius, startDegrees, sweepDegrees, sampleFractions = fractions) {
  assert.equal(entity.type, 'ARC', `${label} must produce a native SDK ARC`)
  // Expected loci are explicit fixture geometry, never reconstructed from the
  // edited entity's start/end angles (which are precisely what this audit tests).
  return {
    label, handle: entity.handle, layer, center, radius, ...style,
    arcLength: radius * radians(sweepDegrees), sampleFractions,
    samples: sampleFractions.map(fraction => {
      const angle = radians(startDegrees + sweepDegrees * fraction)
      return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), center[2]]
    }),
  }
}

function verifySDK(drawing, expected, circleBoundaries, label, imported = false) {
  const entities = drawing.listEntities({ ownerId: drawing.snapshot().spaces.modelSpaceId })
  assert.equal(entities.filter(entity => entity.type === 'ARC').length, expected.length, `${label}: native ARC count`)
  assert.equal(entities.filter(entity => entity.type === 'CIRCLE').length, circleBoundaries.length, `${label}: only cutting circles remain`)
  assert.equal(entities.filter(entity => entity.type === 'LINE').length, 4, `${label}: finite cutting boundaries retained`)
  for (const item of circleBoundaries) {
    const boundary = entities.find(entity => (imported ? entity.source?.originalHandle : entity.handle) === item.handle)
    assert.equal(boundary?.type, 'CIRCLE', `${label}: circular cutting boundary retained`)
    near(boundary.payload.radius, item.radius, `${label}/cutter/radius`)
    item.center.forEach((coordinate, axis) => near(boundary.payload.center[axis], coordinate, `${label}/cutter/center${axis}`))
    assert.equal(drawing.getObject(boundary.payload.layerId)?.name, item.layer)
  }
  for (const item of expected) {
    // DXF import may allocate a new internal handle if a table already owns the
    // incoming value. The adapter retains the original DXF handle as provenance.
    const entity = entities.find(entity => (imported ? entity.source?.originalHandle : entity.handle) === item.handle)
    assert.ok(entity, `${label}: missing ${item.label} handle ${item.handle}`)
    assert.equal(entity.type, 'ARC')
    const p = entity.payload
    assert.equal(drawing.getObject(p.layerId)?.name, item.layer)
    for (const key of ['color', 'lineweight', 'linetypeScale']) near(p[key], item[key], `${label}/${item.label}/${key}`)
    for (let axis = 0; axis < 3; axis++) near(p.center[axis], item.center[axis], `${label}/${item.label}/center${axis}`)
    near(p.radius, item.radius, `${label}/${item.label}/radius`)
    const sweep = arcSweep(p), start = sweep < 0 ? p.startAngle + sweep : p.startAngle
    near(Math.abs(sweep) * p.radius, item.arcLength, `${label}/${item.label}/arcLength`)
    const samplePoints = []
    for (const [index, fraction] of item.sampleFractions.entries()) {
      const angle = start + Math.abs(sweep) * fraction
      const actual = [p.center[0] + p.radius * Math.cos(angle), p.center[1] + p.radius * Math.sin(angle), p.center[2]]
      samplePoints.push(actual)
      actual.forEach((value, axis) => near(value, item.samples[index][axis], `${label}/${item.label}/sample${index}/${axis}`))
    }
    if (item.cutGapLength != null) {
      // An almost-complete arc's total length can conceal a badly computed tiny
      // cut: check the missing interval and its endpoint chord in drawing units.
      near(p.radius * (2 * Math.PI - Math.abs(sweep)), item.cutGapLength, `${label}/${item.label}/cutGapLength`, 1e-9)
      near(Math.hypot(...samplePoints[0].map((value, axis) => value - samplePoints.at(-1)[axis])), item.cutChordLength, `${label}/${item.label}/cutChordLength`, 1e-9)
    }
  }
}

const temporaryParent = resolve(tmpdir())
const directory = await mkdtemp(join(temporaryParent, 'kjdraw-dxf-curves-'))
try {
  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: 'curves-independent-interop', title: 'Trim/extend and clockwise curve interop', units: 'millimeter' })
  const expected = []
  const circleBoundaries = []
  const create = (type, payload) => sdk.executeCommand('CREATE', { type, payload }, { document: drawing })
  const layer = name => sdk.executeCommand('LAYERNEW', { name, color: 3 }, { document: drawing })
  const atLayer = layerId => drawing.listEntities().filter(entity => entity.payload.layerId === layerId)

  const circleLayer = await layer('TRIM_CIRCLE')
  const circle = await create('CIRCLE', { center: [0, 0, 6], radius: 10, layerId: circleLayer.id, ...style })
  const circleBoundary = await create('LINE', { start: [-15, 0, 6], end: [15, 0, 6] })
  let revision = drawing.revision
  await sdk.executeCommand('TRIM', { id: circle.id, boundaryIds: [circleBoundary.id], pickPoint: [0, 10] }, { document: drawing })
  assert.equal(drawing.revision, revision + 1)
  assert.equal(drawing.getObject(circle.id), null)
  const circlePieces = atLayer(circleLayer.id)
  assert.equal(circlePieces.length, 1)
  assert.notEqual(circlePieces[0].handle, circle.handle)
  assert.equal(circlePieces[0].source.derivedFromId, circle.id)
  expected.push(expectedCurve('circle trim: lower semicircle', circlePieces[0], circleLayer.name, [0, 0, 6], 10, 180, 180))

  const splitLayer = await layer('TRIM_CW_ARC')
  const upper = await create('ARC', { center: [40, 0, 6], radius: 10, startAngle: Math.PI, endAngle: 0, clockwise: true, layerId: splitLayer.id, ...style })
  const cutters = []
  for (const x of [35, 45]) cutters.push(await create('LINE', { start: [x, 0, 6], end: [x, 15, 6] }))
  revision = drawing.revision
  await sdk.executeCommand('TRIM', { id: upper.id, boundaryIds: cutters.map(entity => entity.id), pickPoint: [40, 10] }, { document: drawing })
  assert.equal(drawing.revision, revision + 1)
  const splitPieces = atLayer(splitLayer.id)
  assert.equal(splitPieces.length, 2)
  const first = drawing.getObject(upper.id), second = splitPieces.find(entity => entity.id !== upper.id)
  assert.equal(first.handle, upper.handle)
  assert.equal(first.payload.clockwise, true)
  assert.equal(second.payload.clockwise, true)
  expected.push(expectedCurve('CW arc trim: retained left end', first, splitLayer.name, [40, 0, 6], 10, 120, 60))
  expected.push(expectedCurve('CW arc trim: retained right end', second, splitLayer.name, [40, 0, 6], 10, 0, 60))

  const extendLayer = await layer('EXTEND_ARC')
  const short = await create('ARC', { center: [80, 0, 6], radius: 10, startAngle: 0, endAngle: Math.PI / 4, clockwise: false, layerId: extendLayer.id, ...style })
  const extendBoundary = await create('LINE', { start: [80, 5, 6], end: [80, 15, 6] })
  revision = drawing.revision
  await sdk.executeCommand('EXTEND', { id: short.id, boundaryIds: [extendBoundary.id], pickPoint: [80 + Math.sqrt(50), Math.sqrt(50)] }, { document: drawing })
  assert.equal(drawing.revision, revision + 1)
  expected.push(expectedCurve('arc extend: 45 to 90 degrees', drawing.getObject(short.id), extendLayer.name, [80, 0, 6], 10, 0, 90))

  for (const item of [
    { label: 'CW minor', layer: 'CW_MINOR', center: [0, 40, 6], radius: 7, start: 90, end: 0, expectedStart: 0, expectedSweep: 90 },
    { label: 'CW major', layer: 'CW_MAJOR', center: [40, 40, 6], radius: 8, start: 0, end: 90, expectedStart: 90, expectedSweep: 270 },
    { label: 'CW across zero', layer: 'CW_ZERO', center: [80, 40, 6], radius: 9, start: 20, end: 340, expectedStart: 340, expectedSweep: 40 },
  ]) {
    const record = await layer(item.layer)
    const entity = await create('ARC', { center: item.center, radius: item.radius, startAngle: radians(item.start), endAngle: radians(item.end), clockwise: true, layerId: record.id, ...style })
    expected.push(expectedCurve(item.label, entity, record.name, item.center, item.radius, item.expectedStart, item.expectedSweep))
  }
  const precisionLayer = await layer('TRIM_LARGE_SMALL_CIRCLES')
  const cutterLayer = await layer('SMALL_CIRCLE_BOUNDARY')
  const largeRadius = 1e4, smallRadius = .001, precisionCenter = [0, 100, 6]
  const large = await create('CIRCLE', { center: precisionCenter, radius: largeRadius, layerId: precisionLayer.id, ...style })
  const smallCenter = [largeRadius, 100, 6]
  const small = await create('CIRCLE', { center: smallCenter, radius: smallRadius, layerId: cutterLayer.id })
  revision = drawing.revision
  await sdk.executeCommand('TRIM', { id: large.id, boundaryIds: [small.id], pickPoint: smallCenter }, { document: drawing })
  assert.equal(drawing.revision, revision + 1)
  assert.equal(drawing.getObject(large.id), null)
  assert.deepEqual(drawing.getObject(small.id), small, 'Small cutting circle is not modified')
  const precisionPieces = atLayer(precisionLayer.id)
  assert.equal(precisionPieces.length, 1)
  // For d=R, sin(phi/2)=r/(2R). This expected angle comes from the
  // independent analytic triangle, never SDK intersection/output coordinates.
  const halfGap = 2 * Math.asin(smallRadius / (2 * largeRadius))
  const nearCutFractions = [0, 1e-9, ...fractions.slice(1, -1), 1 - 1e-9, 1]
  const precisionCurve = expectedCurve('large/small circle trim: precise cut gap', precisionPieces[0], precisionLayer.name,
    precisionCenter, largeRadius, halfGap * 180 / Math.PI, (2 * Math.PI - 2 * halfGap) * 180 / Math.PI, nearCutFractions)
  precisionCurve.cutGapLength = 2 * largeRadius * halfGap
  precisionCurve.cutChordLength = 2 * largeRadius * Math.sin(halfGap)
  expected.push(precisionCurve)
  circleBoundaries.push({ handle: small.handle, center: smallCenter, radius: smallRadius, layer: cutterLayer.name })
  assert.equal(expected.length, 8)
  verifySDK(drawing, expected, circleBoundaries, 'SDK command results')

  const input = join(directory, 'kjdraw-curves.dxf'), manifest = join(directory, 'expected-curves.json'), output = join(directory, 'ezdxf-curves-roundtrip.dxf')
  const bytes = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  await writeFile(input, bytes)
  await writeFile(manifest, JSON.stringify({ schema: 'com.kanjie.kjdraw.audit.curve-expectations@1', expected, lineCount: 4, circleBoundaries }))
  const result = spawnSync(python, [bridge, input, manifest, output], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(['Independent ezdxf curve audit failed', result.stdout, result.stderr].filter(Boolean).join('\n'))
  const external = JSON.parse(result.stdout)
  assert.equal(external.ezdxfVersion, '1.4.4')
  for (const report of [external.input, external.resaved]) {
    assert.equal(report.auditErrors, 0)
    assert.equal(report.auditFixes, 0)
    assert.equal(report.arcs.length, expected.length)
  }
  const rewritten = await readFile(output)
  const reopened = await createKJDrawSDK().readDocument(rewritten, { format: 'DXF' })
  verifySDK(reopened, expected, circleBoundaries, 'ezdxf write → SDK read', true)
  console.log(JSON.stringify({
    schema: 'com.kanjie.kjdraw.audit.dxf-curves-interop@1',
    independentImplementation: `ezdxf ${external.ezdxfVersion}`,
    directions: ['SDK TRIM/EXTEND → DXF → ezdxf native ARC audit', 'ezdxf save/read → SDK native ARC trajectory verification'],
    scenarios: 7, arcs: expected.length, samplesPerArc: expected.map(item => item.samples.length),
    verified: ['native ARC geometry', 'no audit errors or fixes', 'interior trajectory samples', 'large/small circle near-cut samples', 'tiny removed gap and chord length', 'arc length', 'center Z=6', 'radius', 'layer', 'ACI color', 'lineweight', 'linetype scale'],
    hashes: { emitted: sha256(Buffer.from(bytes)), ezdxfSaved: sha256(rewritten) },
    external,
    limitation: 'Independent R2018 ASCII / positive-XY-plane curve evidence; not a universal DXF or Autodesk certification.',
  }, null, 2))
} finally {
  // Delete only this invocation's validated mkdtemp child, never a workspace or parent directory.
  if (dirname(directory) !== temporaryParent || !basename(directory).startsWith('kjdraw-dxf-curves-')) throw new Error('Refusing unsafe audit temporary-directory cleanup')
  await rm(directory, { recursive: true, force: true })
}
