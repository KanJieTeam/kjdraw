import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createKJDrawSDK, KJAgentToolSession } from '../src/index.js'
import { hatchPatternFromCatalog } from '../src/hatch-pattern-catalog.js'
import { hatchPatternLines } from '../src/geometry/hatch.js'
import {
  KJDRAW_GEOLOGY_HATCH_PATTERN_CATALOG as catalog,
  KJDRAW_GEOLOGY_HATCH_PATTERN_SOURCE as source,
  KJDRAW_GEOLOGY_HATCH_PATTERN_PROVENANCE as provenance,
} from '../src/knowledge-packs/geology-patterns.js'

// Produced once by independent ezdxf 1.4.4, not by KJDraw's parser or writer.
const reference = JSON.parse(await readFile(new URL('./fixtures/geology-patterns-ezdxf-reference.json', import.meta.url), 'utf8'))
const byName = new Map(reference.patterns.map(pattern => [pattern.name, pattern.lines]))
const patternFields = new Set(['patternName', 'solid', 'patternLines', 'patternDefinitionAngle', 'patternDefinitionScale', 'patternScale', 'patternAngle'])
const close = (actual, expected, label) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-9, `${label}: ${actual} != ${expected}`)
const rotate = ([x, y], radians, factor) => [(x * Math.cos(radians) - y * Math.sin(radians)) * factor, (x * Math.sin(radians) + y * Math.cos(radians)) * factor]
const positions = vertices => vertices.map(vertex => {
  const point = Array.isArray(vertex) ? vertex : vertex.point
  if (!Array.isArray(vertex)) {
    assert.equal(vertex.bulge ?? 0, 0)
    assert.equal(vertex.startWidth ?? 0, 0)
    assert.equal(vertex.endWidth ?? 0, 0)
  }
  return [point[0], point[1], point[2] ?? 0]
})

function assertReferenceLines(actual, name, scale = 1, angleDegrees = 0) {
  const expected = byName.get(name), radians = angleDegrees * Math.PI / 180
  assert.equal(actual.length, expected.length, name)
  for (const [index, line] of actual.entries()) {
    const [angle, base, offset, dashes] = expected[index]
    const angleDifference = line.angle - (angle * Math.PI / 180 + radians)
    close(Math.atan2(Math.sin(angleDifference), Math.cos(angleDifference)), 0, `${name} line ${index} angle`)
    const transformedBase = rotate(base, radians, scale), transformedOffset = rotate(offset, radians, scale)
    for (let coordinate = 0; coordinate < 2; coordinate++) {
      close(line.base[coordinate], transformedBase[coordinate], `${name} line ${index} base`)
      close(line.offset[coordinate], transformedOffset[coordinate], `${name} line ${index} offset`)
    }
    assert.equal(line.dashes.length, dashes.length, name)
    line.dashes.forEach((dash, position) => close(dash, dashes[position] * scale, `${name} line ${index} dash`))
  }
}

test('bundled authorized catalog preserves all 209 literal names and 940 independently checked line families', () => {
  assert.equal(createHash('sha256').update(source).digest('hex'), 'cf3ce6d51c5fd2b4c51a132fa6c77b8325d7b346e334308d2d34a672e7ebd632')
  assert.equal(provenance.sourceSha256, reference.sourceSha256)
  assert.equal(provenance.vendorAuthorizationClaimed, false)
  assert.match(provenance.authorization, /2026-10-03/)
  assert.equal(catalog.patterns.length, 209)
  assert.equal(catalog.patterns.reduce((sum, entry) => sum + entry.lines.length, 0), 940)
  assert.equal(catalog.patterns.filter(entry => /[\u3400-\u9fff]/u.test(entry.name)).length, 68)
  assert.deepEqual(catalog.patterns.map(entry => entry.name), reference.patterns.map(entry => entry.name))
  assert.ok(Object.isFrozen(catalog) && Object.isFrozen(catalog.patterns[0].lines[0].offset))
  for (const entry of catalog.patterns) assertReferenceLines(entry.lines, entry.name)
  const lines = name => catalog.patterns.find(entry => entry.name === name).lines
  assert.deepEqual(lines('素填土'), lines('STT'))
  assert.deepEqual(lines('杂填土'), lines('ZTT'))
  assert.notDeepEqual(lines('杂填土'), lines('FZT'))
  assert.notDeepEqual(lines('素填土'), lines('TT'))
  assert.notDeepEqual(lines('粉质粘土'), lines('FNT'))
  assert.notDeepEqual(lines('辉绿岩'), lines('HLY'))
})

test('all 209 patterns retain independent reference scale and global angle exactly once', () => {
  for (const entry of catalog.patterns) {
    if (entry.name === 'SOLID') continue
    for (const [scale, angleDegrees] of [[0.5, 0], [1.75, 37], [2.25, -23]]) {
      const payload = hatchPatternFromCatalog(catalog, entry.name, { scale, angleDegrees })
      assertReferenceLines(hatchPatternLines(payload), entry.name, scale, angleDegrees)
    }
  }
  const corrupted = structuredClone(catalog.patterns.find(entry => entry.name === 'STT').lines)
  corrupted[0].offset = [0, 4]
  assert.throws(() => assertReferenceLines(corrupted, 'STT'), /offset/, 'the former unrotated-delta bug must fail the independent oracle')
})

function loopsFor(index) {
  const x = index % 20 * 80, y = Math.floor(index / 20) * 70
  return [[x, y, x + 60, y + 50], [x + 5, y + 5, x + 15, y + 15], [x + 30, y + 25, x + 40, y + 35], [x + 7, y + 7, x + 10, y + 10]].map(([left, bottom, right, top], loopIndex) => ({
    // The typed flag includes both DXF external(1) and outermost(16) paths.
    flags: [3, 18, 18, 2][loopIndex], external: loopIndex < 3, closed: true,
    vertices: [[left, bottom], [right, bottom], [right, top], [left, top]],
    sourceBoundaryIds: [`public-pattern-boundary-${index}-${loopIndex}`],
  }))
}

let allFixturePromise
function allPatternFixture() {
  return allFixturePromise ??= (async () => {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    await document.transact('All 209 publicly authorized PAT definitions and synthetic associated islands', tx => {
      for (const [index, entry] of catalog.patterns.entries()) {
        const loops = loopsFor(index), id = `public-pattern-${index}`
        tx.createEntity('HATCH', {
          ...hatchPatternFromCatalog(catalog, entry.name, { scale: 1.75, angleDegrees: 37 }),
          solid: entry.name === 'SOLID', associative: true, hatchStyle: index % 3,
          boundaryLoops: loops,
        }, { id })
        for (const loop of loops) tx.createEntity('LWPOLYLINE', { closed: true, vertices: loop.vertices, dxfReactorIds: [id] }, { id: loop.sourceBoundaryIds[0] })
      }
      tx.createEntity('TEXT', { text: 'PUBLIC SYNTHETIC PAT RESOURCE VALIDATION', position: [0, -10, 0], height: 3 }, { id: 'public-retained-note' })
    })
    return { sdk, document, dxf: await sdk.writeDocument(document, { format: 'DXF' }) }
  })()
}

test('all 209 actual DXF HATCHes reopen with exact pattern geometry, styles, holes and reciprocal associations', async () => {
  const { sdk, document, dxf } = await allPatternFixture()
  let current = document
  for (const format of ['KJD', 'DXF', 'DXF']) {
    current = await sdk.readDocument(format === 'DXF' && current === document ? dxf : await sdk.writeDocument(current, { format }), { format })
    assert.equal(current.listEntities({ type: 'HATCH' }).length, 209)
    assert.equal(current.listEntities().length, 209 * 5 + 1)
    assert.equal(current.listEntities({ type: 'TEXT' })[0].payload.text, 'PUBLIC SYNTHETIC PAT RESOURCE VALIDATION')
    for (const [index, entry] of catalog.patterns.entries()) {
      const hatch = current.listEntities({ type: 'HATCH' }).find(entity => entity.payload.patternName === entry.name)
      if (entry.name !== 'SOLID') {
        assert.equal(hatch.payload.patternScale, 1.75)
        close(hatch.payload.patternAngle, 37 * Math.PI / 180, `${entry.name} global angle`)
      }
      assert.equal(hatch.payload.hatchStyle ?? 0, index % 3)
      assert.deepEqual(hatch.payload.boundaryLoops.map(loop => loop.flags), [3, 18, 18, 2])
      assert.deepEqual(hatch.payload.boundaryLoops.map(loop => positions(loop.vertices)), loopsFor(index).map(loop => positions(loop.vertices)))
      for (const loop of hatch.payload.boundaryLoops) {
        assert.equal(loop.sourceBoundaryIds.length, 1)
        const boundary = current.getObject(loop.sourceBoundaryIds[0])
        assert.deepEqual(boundary.payload.dxfReactorIds, [hatch.id])
        assert.deepEqual(positions(boundary.payload.vertices), positions(loop.vertices))
      }
      if (entry.name === 'SOLID') assert.equal(hatch.payload.solid, true)
      else assertReferenceLines(hatchPatternLines(hatch.payload), entry.name, 1.75, 37)
    }
    assert.equal(current.validate().valid, true)
  }
})

const python = process.env.KJDRAW_PYTHON
test('independent ezdxf reopens all 209 emitted DXF patterns and verifies 940 reference families plus island association handles', { skip: !python }, async () => {
  const { dxf } = await allPatternFixture()
  const script = String.raw`
import io,json,math,sys,ezdxf
from ezdxf.tools.pattern import PatternFileCompiler,scale_pattern
data=json.load(sys.stdin)
reference=PatternFileCompiler(data['pat']).compile_pattern(ndigits=14)
indices={name:index for index,name in enumerate(reference)}
doc=ezdxf.read(io.StringIO(data['dxf'],newline=None))
hatches=list(doc.modelspace().query('HATCH'))
assert len(hatches)==209 and len(reference)==209
assert sum(len(lines) for lines in reference.values())==940
checked=0
for hatch in hatches:
 name=hatch.dxf.pattern_name
 assert name in reference
 assert [path.path_type_flags for path in hatch.paths]==[3,18,18,2]
 style=indices[name]%3
 assert hatch.dxf.hatch_style==style
 def area(path):
  vertices=path.vertices
  return abs(sum(vertices[i][0]*vertices[(i+1)%len(vertices)][1]-vertices[(i+1)%len(vertices)][0]*vertices[i][1] for i in range(len(vertices)))/2)
 filled=sum(area(path)*(1 if path.path_type_flags&1 or not path.path_type_flags&16 else -1) for path in hatch.paths.rendering_paths(style))
 assert filled==[2809,2800,3000][style]
 for path in hatch.paths:
  assert len(path.source_boundary_objects)==1
  boundary=doc.entitydb[path.source_boundary_objects[0]]
  assert boundary.get_reactors()==[hatch.dxf.handle]
  assert list(boundary.get_points('xy'))==[tuple(vertex[:2]) for vertex in path.vertices]
 if name=='SOLID':
  assert hatch.dxf.solid_fill==1
  continue
 assert abs(hatch.dxf.pattern_scale-1.75)<1e-9 and abs(hatch.dxf.pattern_angle-37)<1e-9
 expected=scale_pattern(reference[name],factor=1.75,angle=37)
 actual=hatch.pattern.as_list()
 assert len(actual)==len(expected)
 for got,wanted in zip(actual,expected):
  angle_error=(got[0]-wanted[0]+180)%360-180
  assert abs(angle_error)<=1e-9
  for observed,exact in zip([*got[1],*got[2],*got[3]],[*wanted[1],*wanted[2],*wanted[3]]):
   assert abs(observed-exact)<=1e-9,(name,observed,exact)
  assert len(got[3])==len(wanted[3])
  checked+=1
audit=doc.audit()
assert not audit.errors and not audit.fixes
print(json.dumps({'patterns':len(hatches),'referenceFamilies':940,'nativeNonSolidFamilies':checked,'boundaries':sum(len(h.paths) for h in hatches),'auditErrors':len(audit.errors),'auditFixes':len(audit.fixes)}))
`
  const result = spawnSync(python, ['-X', 'utf8', '-c', script], { encoding: 'utf8', input: JSON.stringify({ pat: source, dxf }), maxBuffer: 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.deepEqual(JSON.parse(result.stdout), { patterns: 209, referenceFamilies: 940, nativeNonSolidFamilies: 939, boundaries: 836, auditErrors: 0, auditFixes: 0 })
})

test('source-only imported HATCH uses absent destination from complete catalog with exact approval, islands, unchanged objects and undo', async () => {
  const sdk = createKJDrawSDK(), original = sdk.createDocument({ units: 'millimeter' })
  await original.transact('Public source-only graphical pattern fixture', tx => {
    const loops = loopsFor(0), id = 'public-source-hatch'
    tx.createEntity('HATCH', { ...hatchPatternFromCatalog(catalog, '素填土', { scale: 0.5, angleDegrees: 49 }), solid: false, associative: true, hatchStyle: 2, boundaryLoops: loops }, { id })
    for (const loop of loops) tx.createEntity('LWPOLYLINE', { closed: true, vertices: loop.vertices, dxfReactorIds: [id] }, { id: loop.sourceBoundaryIds[0] })
    tx.createEntity('TEXT', { text: 'PUBLIC NON-TARGET NOTE', position: [0, -5, 0], height: 2 })
  })
  const document = await sdk.readDocument(await sdk.writeDocument(original, { format: 'DXF' }), { format: 'DXF' })
  const before = structuredClone(document.listEntities()), hatch = before.find(entity => entity.type === 'HATCH')
  assert.equal(before.some(entity => entity.payload.patternName === '杂填土'), false)
  const session = new KJAgentToolSession(sdk, document, { hatchPatternCatalogs: [catalog] })
  const read = await session.call('cad_read_hatch_patterns', { expectedRevision: document.revision, search: '杂填土' })
  assert.equal(read.ok, true, JSON.stringify(read))
  const target = read.value.patterns.find(pattern => pattern.name === '杂填土')
  assert.equal(target.source, 'host-catalog')
  assert.equal(target.lineFamilies, 4)
  assert.equal(target.entityCount, 0)
  const proposed = await session.call('cad_propose_hatch_pattern', { expectedRevision: read.value.revision, units: read.value.units, ids: [hatch.id], patternId: target.patternId })
  assert.equal(proposed.ok, true, JSON.stringify(proposed))
  assert.deepEqual(document.listEntities(), before, 'a proposal cannot mutate the drawing')
  const approved = await session.approve(proposed.value.planId, 'public-test-reviewer')
  assert.equal(approved.ok, true, JSON.stringify(approved))
  const changed = document.getObject(hatch.id)
  const retained = entity => Object.fromEntries(Object.entries(entity.payload).filter(([key]) => !patternFields.has(key)))
  assert.deepEqual(retained(changed), retained(hatch))
  assertReferenceLines(hatchPatternLines(changed.payload), '杂填土', 0.5, 49)
  for (const entity of before.filter(entity => entity.id !== hatch.id)) assert.deepEqual(document.getObject(entity.id), entity)
  const after = structuredClone(document.listEntities())
  await document.undo(); assert.deepEqual(document.listEntities(), before)
  await document.redo(); assert.deepEqual(document.listEntities(), after)
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
  const actual = reopened.listEntities({ type: 'HATCH' })[0]
  assert.equal(actual.payload.patternName, '杂填土')
  assert.equal(actual.payload.hatchStyle, 2)
  assertReferenceLines(hatchPatternLines(actual.payload), '杂填土', 0.5, 49)
  for (const loop of actual.payload.boundaryLoops) assert.deepEqual(reopened.getObject(loop.sourceBoundaryIds[0]).payload.dxfReactorIds, [actual.id])
  assert.equal(reopened.validate().valid, true)
})
