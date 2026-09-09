import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

const python = process.env.KJDRAW_PYTHON || (process.platform === 'win32' ? 'python.exe' : 'python3')
const bridge = fileURLToPath(new URL('./ezdxf-interop.py', import.meta.url))

function runPython(action, path) {
  const result = spawnSync(python, [bridge, action, path], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error([`Independent ezdxf ${action} failed`, result.stdout, result.stderr].filter(Boolean).join('\n'))
  return JSON.parse(result.stdout)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function pointNear(actual, expected, tolerance = 1e-9) {
  return actual.length === expected.length && actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance)
}

function hasLine(lines, first, second) {
  return lines.some(line =>
    (pointNear(line.start, first) && pointNear(line.end, second)) ||
    (pointNear(line.start, second) && pointNear(line.end, first)))
}

function assertImportedStyles(drawing) {
  const layer = drawing.getTable('layers').records.find(record => record.name === 'KJ_STYLES')
  assert.ok(layer, 'Independent styled-entity layer must be imported')
  const entities = drawing.listEntities({ ownerId: drawing.snapshot().spaces.modelSpaceId }).filter(entity => entity.payload.layerId === layer.id)
  assert.deepEqual(entities.map(entity => entity.type).sort(), ['ARC', 'LINE'])
  for (const entity of entities) {
    for (const [key, value] of Object.entries({ color: 2, trueColor: 0x2468ac, linetypeName: 'KJ_INTEROP_DASH', linetypeScale: 1.5, lineweight: 35, visible: false })) assert.equal(entity.payload[key], value, `external ${entity.type}.${key}`)
    assert.equal(drawing.getObject(entity.payload.linetypeId)?.name, 'KJ_INTEROP_DASH')
  }
  const line = entities.find(entity => entity.type === 'LINE'), arc = entities.find(entity => entity.type === 'ARC')
  assert.deepEqual(line.payload.start, [220, 0, 6])
  assert.deepEqual(line.payload.end, [220, 15, 6])
  assert.deepEqual(arc.payload.center, [210, 0, 6])
  assert.equal(arc.payload.radius, 10)
  assert.equal(arc.payload.startAngle, Math.PI)
  assert.equal(arc.payload.endAngle, Math.PI * 2)
}

const directory = await mkdtemp(join(tmpdir(), 'kjdraw-dxf-interop-'))
try {
  const kjdrawOutput = join(directory, 'kjdraw-output.dxf')
  const externalInput = join(directory, 'ezdxf-input.dxf')
  const roundTrip = join(directory, 'kjdraw-roundtrip.dxf')

  const sdk = createKJDrawSDK()
  const drawing = sdk.createDocument({ documentId: 'cross-implementation-output', title: 'KJDraw → ezdxf' })
  const layer = await sdk.executeCommand('LAYERNEW', { name: 'KJ_INTEROP', color: 3 })
  const payloads = [
    ['LINE', { start: [0, 0, 0], end: [120, 35, 0], layerId: layer.id }],
    ['CIRCLE', { center: [40, 60, 0], radius: 12.5, layerId: layer.id }],
    ['ARC', { center: [95, 65, 0], radius: 18, startAngle: Math.PI / 9, endAngle: Math.PI * 7 / 6, layerId: layer.id }],
    ['LWPOLYLINE', { vertices: [[0, 100], { point: [50, 100, 0], bulge: 0.35 }, [70, 125], [0, 125]], closed: true, layerId: layer.id }],
    ['ELLIPSE', { center: [160, 120, 0], majorAxis: [20, 5, 0], ratio: 0.4, startParameter: 0, endParameter: Math.PI * 2, layerId: layer.id }],
    ['SPLINE', { degree: 3, controlPoints: [[140, 150, 0], [150, 170, 0], [175, 165, 0], [190, 145, 0]], knots: [0, 0, 0, 0, 1, 1, 1, 1], closed: false, periodic: false, layerId: layer.id }],
    ['HATCH', { boundaryLoops: [
      { external: true, vertices: [[0, 180, 0], [80, 180, 0], [80, 240, 0], [0, 240, 0]] },
      { external: false, vertices: [[20, 195, 0], [60, 195, 0], [60, 225, 0], [20, 225, 0]] },
    ], patternName: 'ANSI31', patternScale: 2, patternAngle: Math.PI / 6, solid: false, layerId: layer.id }],
    ['HATCH', { boundaryLoops: [
      { external: true, vertices: [[100, 180, 0], [170, 180, 0], [170, 240, 0], [100, 240, 0]] },
    ], patternName: 'ANSI37', patternScale: 1, patternAngle: 0, solid: false, layerId: layer.id }],
    ['DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[25, 280, 0], [0, 260, 0], [50, 260, 0]], measurement: 50, styleName: 'STANDARD', layerId: layer.id }],
    ['DIMENSION', { dimensionType: 'ROTATED', definitionPoints: [[210, 280, 0], [190, 260, 0], [230, 260, 0]], rotation: 0, measurement: 40, styleName: 'STANDARD', layerId: layer.id }],
    ['DIMENSION', { dimensionType: 'RADIUS', definitionPoints: [[90, 265, 0], [100, 265, 0]], measurement: 10, styleName: 'STANDARD', layerId: layer.id }],
    ['DIMENSION', { dimensionType: 'DIAMETER', definitionPoints: [[130, 265, 0], [150, 265, 0]], measurement: 20, styleName: 'STANDARD', layerId: layer.id }],
    ['TEXT', { position: [10, 145, 0], text: 'KJDraw interop', height: 4, layerId: layer.id }],
  ]
  for (const [type, payload] of payloads) await sdk.executeCommand('CREATE', { type, payload })
  const styleLayer = await sdk.executeCommand('LAYERNEW', { name: 'KJ_STYLES', color: 5 })
  const styleLinetype = await sdk.executeCommand('LINETYPE', { name: 'KJ_INTEROP_DASH', pattern: [3, -1] })
  const elevatedProfile = await sdk.executeCommand('CREATE', { type: 'LWPOLYLINE', payload: {
    layerId: styleLayer.id, color: 2, trueColor: 0x2468ac, linetypeId: styleLinetype.id,
    linetypeScale: 1.5, lineweight: 35, visible: false, elevation: 6,
    vertices: [{ point: [200, 0], bulge: 1 }, { point: [220, 0] }, { point: [220, 15] }],
  } })
  const exploded = await sdk.executeCommand('EXPLODE', { id: elevatedProfile.id })
  assert.deepEqual(exploded.map(entity => entity.type), ['ARC', 'LINE'])
  assert.equal(drawing.getObject(elevatedProfile.id), null)
  const emitted = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
  await writeFile(kjdrawOutput, emitted)
  const externalRead = runPython('inspect', kjdrawOutput)
  assert.equal(externalRead.dxfVersion, 'AC1032')
  assert.equal(externalRead.auditErrors, 0)
  assert.equal(externalRead.auditFixes, 0)
  assert.equal(externalRead.modelspaceEntities.LINE, 2)
  assert.equal(externalRead.modelspaceEntities.ARC, 2)
  assert.equal(externalRead.styledEntities.length, 2)
  assert.equal(externalRead.modelspaceEntities.CIRCLE, 1)
  assert.equal(externalRead.modelspaceEntities.HATCH, 2)
  assert.equal(externalRead.modelspaceEntities.ELLIPSE, 1)
  assert.equal(externalRead.modelspaceEntities.SPLINE, 1)
  assert.equal(externalRead.modelspaceEntities.DIMENSION, 4)
  assert.ok(externalRead.layers.includes('KJ_INTEROP'))
  const ansi31 = externalRead.hatches.find(hatch => hatch.patternName === 'ANSI31')
  const ansi37 = externalRead.hatches.find(hatch => hatch.patternName === 'ANSI37')
  assert.ok(ansi31)
  assert.equal(ansi31.solid, false)
  assert.equal(ansi31.boundaryPathCount, 2)
  assert.deepEqual(ansi31.boundaryPathFlags, [3, 2], 'outer boundary must be external and the inner boundary must remain a hole')
  assert.equal(ansi31.patternLines.length, 1)
  assert.ok(Math.abs(ansi31.patternLines[0].angleDegrees - 75) < 1e-9)
  assert.ok(Math.abs(Math.hypot(...ansi31.patternLines[0].offset) - 6.35) < 1e-9)
  assert.equal(ansi37.patternLines.length, 2)
  assert.deepEqual(ansi37.patternLines.map(line => line.angleDegrees), [45, 135])
  assert.ok(Math.abs(externalRead.ellipses[0].ratio - 0.4) < 1e-12)
  assert.deepEqual(externalRead.ellipses[0].center, [160, 120, 0])
  assert.deepEqual(externalRead.ellipses[0].majorAxis, [20, 5, 0])
  assert.equal(externalRead.splines[0].degree, 3)
  assert.equal(externalRead.splines[0].controlPointCount, 4)
  assert.deepEqual(externalRead.splines[0].knots, [0, 0, 0, 0, 1, 1, 1, 1])
  const dimensions = new Map(externalRead.dimensions.map(dimension => [dimension.type, dimension]))
  const aligned = dimensions.get('ALIGNED')
  const rotated = dimensions.get('ROTATED')
  const radius = dimensions.get('RADIUS')
  const diameter = dimensions.get('DIAMETER')
  assert.ok(Math.abs(aligned.measurement - 50) < 1e-9)
  assert.ok(Math.abs(aligned.storedMeasurement - 50) < 1e-9)
  assert.deepEqual(aligned.definitionPoints, [[25, 280, 0], [0, 260, 0], [50, 260, 0]])
  assert.equal(aligned.rawType & 32, 32)
  assert.deepEqual(aligned.geometryEntityCounts, { LINE: 3, SOLID: 2, TEXT: 1 })
  assert.ok(hasLine(aligned.geometryLines, [0, 280, 0], [50, 280, 0]))
  assert.equal(aligned.geometryTexts[0].text, '50')
  assert.ok(Math.abs(rotated.measurement - 40) < 1e-9)
  assert.ok(Math.abs(rotated.storedMeasurement - 40) < 1e-9)
  assert.deepEqual(rotated.definitionPoints, [[210, 280, 0], [190, 260, 0], [230, 260, 0]])
  assert.equal(rotated.rawType & 32, 32)
  assert.deepEqual(rotated.geometryEntityCounts, { LINE: 3, SOLID: 2, TEXT: 1 })
  assert.ok(hasLine(rotated.geometryLines, [190, 280, 0], [230, 280, 0]))
  assert.equal(rotated.geometryTexts[0].text, '40')
  assert.ok(Math.abs(radius.measurement - 10) < 1e-9)
  assert.ok(Math.abs(radius.storedMeasurement - 10) < 1e-9)
  assert.deepEqual(radius.definitionPoints, [[90, 265, 0], [100, 265, 0]])
  assert.equal(radius.rawType & 32, 32)
  assert.deepEqual(radius.geometryEntityCounts, { LINE: 1, SOLID: 1, TEXT: 1 })
  assert.ok(hasLine(radius.geometryLines, [90, 265, 0], [100, 265, 0]))
  assert.equal(radius.geometryTexts[0].text, 'R10')
  assert.ok(Math.abs(diameter.measurement - 20) < 1e-9)
  assert.ok(Math.abs(diameter.storedMeasurement - 20) < 1e-9)
  assert.deepEqual(diameter.definitionPoints, [[130, 265, 0], [150, 265, 0]])
  assert.equal(diameter.rawType & 32, 32)
  assert.deepEqual(diameter.geometryEntityCounts, { LINE: 1, SOLID: 2, TEXT: 1 })
  assert.ok(hasLine(diameter.geometryLines, [130, 265, 0], [150, 265, 0]))
  assert.equal(diameter.geometryTexts[0].text, '⌀20')
  assert.equal(new Set(externalRead.dimensions.map(dimension => dimension.geometryBlock)).size, 4)
  assert.equal(externalRead.dimensions.every(dimension => /^\*D\d+$/i.test(dimension.geometryBlock)), true)
  for (const dimension of [aligned, rotated, radius, diameter]) {
    assert.equal(dimension.geometryTexts[0].horizontalAlignment, 1)
    assert.equal(dimension.geometryTexts[0].verticalAlignment, 1)
    assert.deepEqual(dimension.geometryTexts[0].alignPoint, dimension.geometryTexts[0].insert)
  }

  const externalGeneration = runPython('generate', externalInput)
  assert.equal(externalGeneration.auditErrors, 0)
  assert.equal(externalGeneration.auditFixes, 0)
  const externalBytes = await readFile(externalInput)
  const imported = await createKJDrawSDK().readDocument(externalBytes, { format: 'DXF', version: '2018' })
  assert.equal(imported.getTable('layers').records.some(row => row.name === 'KJ_INTEROP'), true)
  const importedModelSpaceId = imported.snapshot().spaces.modelSpaceId
  assert.equal(imported.listEntities({ ownerId: importedModelSpaceId, type: 'LINE' }).length, 2)
  assert.equal(imported.listEntities({ ownerId: importedModelSpaceId, type: 'CIRCLE' }).length, 1)
  assert.equal(imported.listEntities({ ownerId: importedModelSpaceId, type: 'ARC' }).length, 2)
  assert.equal(imported.listEntities({ ownerId: importedModelSpaceId, type: 'LWPOLYLINE' }).length, 1)
  assert.equal(imported.listEntities({ ownerId: importedModelSpaceId, type: 'TEXT' }).length, 1)
  assert.equal(imported.listEntities({ ownerId: importedModelSpaceId, type: 'INSERT' }).length, 1)
  assert.equal(imported.listEntities({ ownerId: importedModelSpaceId, type: 'HATCH' }).length, 2)
  assert.equal(imported.listEntities({ ownerId: importedModelSpaceId, type: 'ELLIPSE' }).length, 1)
  assert.equal(imported.listEntities({ ownerId: importedModelSpaceId, type: 'SPLINE' }).length, 1)
  assert.equal(imported.listEntities({ ownerId: importedModelSpaceId, type: 'DIMENSION' }).length, 4)
  const polyline = imported.listEntities({ ownerId: importedModelSpaceId, type: 'LWPOLYLINE' })[0]
  assert.equal(polyline.payload.closed, true)
  assert.equal(polyline.payload.vertices.some(vertex => Number(vertex.bulge ?? 0) !== 0), true)
  assertImportedStyles(imported)

  const reopenedSDK = createKJDrawSDK()
  reopenedSDK.attachDocument(imported)
  const movedDimension = imported.listEntities({ ownerId: importedModelSpaceId, type: 'DIMENSION' }).find(entity =>
    pointNear(entity.payload.definitionPoints?.[1] ?? [], [0, 260, 0]))
  assert.ok(movedDimension)
  await reopenedSDK.executeCommand('MOVE', { id: movedDimension.id, dx: 7, dy: -3 })
  await writeFile(roundTrip, await reopenedSDK.writeDocument(imported, { format: 'DXF', version: '2018' }))
  const externalRoundTrip = runPython('inspect', roundTrip)
  assert.deepEqual(externalRoundTrip.layouts, [
    { name: 'Layout1', order: 1, types: [], lines: [] },
    { name: 'Sheet 7', order: 3, types: ['LINE'], lines: [{ start: [1, 2, 0], end: [3, 4, 0] }] },
    { name: 'Empty 42', order: 4, types: [], lines: [] },
  ], 'independent layout identity, tab order, ownership and exact paper geometry')
  assert.equal(externalRoundTrip.auditErrors, 0)
  assert.equal(externalRoundTrip.auditFixes, 0)
  assert.equal(externalRoundTrip.styledEntities.length, 2)
  assert.equal(externalRoundTrip.modelspaceEntities.INSERT, 1)
  assert.equal(externalRoundTrip.modelspaceEntities.HATCH, 2)
  assert.equal(externalRoundTrip.modelspaceEntities.ELLIPSE, 1)
  assert.equal(externalRoundTrip.modelspaceEntities.SPLINE, 1)
  assert.equal(externalRoundTrip.modelspaceEntities.DIMENSION, 4)
  const independentlyMoved = externalRoundTrip.dimensions.find(dimension => pointNear(dimension.definitionPoints?.[1] ?? [], [7, 257, 0]))
  assert.deepEqual(independentlyMoved.definitionPoints, [[7, 277, 0], [7, 257, 0], [57, 257, 0]])
  assert.ok(Math.abs(independentlyMoved.measurement - 50) < 1e-9)
  assert.deepEqual(independentlyMoved.geometryEntityCounts, { LINE: 3, SOLID: 2, TEXT: 1 })
  assert.ok(hasLine(independentlyMoved.geometryLines, [7, 277, 0], [57, 277, 0]))

  console.log(JSON.stringify({
    schema: 'com.kanjie.kjdraw.audit.dxf-interop@1',
    independentImplementation: `ezdxf ${externalRead.ezdxfVersion}`,
    direction: ['KJDraw write → ezdxf read/audit', 'ezdxf write → KJDraw read/write → ezdxf read/audit'],
    entityStyleCoverage: ['ACI', 'trueColor', 'linetype reference', 'linetype scale', 'lineweight', 'visibility'],
    explodedGeometryCoverage: ['elevated bulge ARC', 'elevated LINE', 'native endpoints and Z=6'],
    files: {
      kjdrawOutputSha256: sha256(Buffer.from(emitted)),
      externalInputSha256: sha256(externalBytes),
      roundTripSha256: sha256(await readFile(roundTrip)),
    },
    externalRead,
    externalGeneration,
    externalRoundTrip,
    limitation: 'Independent open-source implementation evidence for the tested ASCII R2018 subset; not Autodesk certification.',
  }, null, 2))
} finally {
  await rm(directory, { recursive: true, force: true })
}
