import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRoadDrawing } from '../src/road-drawing.js'
import { computeRoadDesign } from '../src/road-design.js'
import { createKJDrawSDK } from '../src/sdk.js'

const close = (a, b) => assert.ok(Math.abs(a-b) < 1e-8, `${a} != ${b}`)
const options = () => ({ drawingId: 'route-review', title: 'Original access route study', profileScale: { horizontal: 1, vertical: 8 }, sectionScale: { horizontal: 2, vertical: 3 }, textHeight: 2, sectionColumns: 3 })
function straight() {
  return { units: 'meter', startStation: 0, alignment: [[300, 500], [900, 500]], profile: [{ station: 0, elevation: 10 }, { station: 600, elevation: 16 }],
    sections: Array.from({ length: 7 }, (_, i) => ({ station: i*100, ground: [[-30, 8+i], [0, 8+i], [30, 8+i]] })),
    pavement: { leftWidth: 4, rightWidth: 4, leftCrossfall: -.02, rightCrossfall: -.02 }, slopes: { cutHtoV: 1, fillHtoV: 1.5 } }
}
function bent() {
  return { units: 'meter', startStation: 1000, alignment: [[-200, 50], [-140, 130], [-140, 280]], profile: [{ station: 1000, elevation: 50 }, { station: 1100, elevation: 48 }, { station: 1250, elevation: 51 }],
    sections: [1000, 1050, 1100, 1175, 1250].map(station => ({ station, ground: [[-40, 47.8], [-5, 48.85], [0, 49], [40, 50.2]] })),
    pavement: { leftWidth: 3.5, rightWidth: 2.5, leftCrossfall: -.02, rightCrossfall: .03 }, slopes: { cutHtoV: 1, fillHtoV: 1.5 } }
}
const entity = (drawing, key) => { const found = drawing.entities.find(e => e.key === key); assert.ok(found, key); return found }
const pointList = e => e.type === 'LWPOLYLINE' ? e.payload.vertices : e.type === 'LINE' ? [e.payload.start, e.payload.end] : [e.payload.position]

test('two independent road inputs retain native plan coordinates and exactly invert explicit diagram projections', () => {
  for (const input of [straight(), bent()]) {
    const before = structuredClone(input), opts = options(), drawing = buildRoadDrawing(input, opts)
    assert.deepEqual(input, before)
    assert.deepEqual(drawing.calculation, computeRoadDesign(input))
    assert.deepEqual(entity(drawing, 'plan/alignment').payload.vertices, input.alignment.map(p => [...p, 0]))
    assert.equal(drawing.entities.filter(e => e.key.endsWith('-pavement-edge')).length, (input.alignment.length-1)*2)
    drawing.calculation.alignment.forEach((span, i) => {
      for (const [side, distance] of [['left', input.pavement.leftWidth], ['right', -input.pavement.rightWidth]]) {
        const edge = entity(drawing, `plan/span/${i}/${side}-pavement-edge`)
        close(edge.payload.start[0], span.start[0] - span.tangent[1]*distance)
        close(edge.payload.start[1], span.start[1] + span.tangent[0]*distance)
      }
    })
    assert.equal(drawing.units, 'meter')
    assert.equal(drawing.projections.sections.length, input.sections.length)
    for (const section of drawing.calculation.sections) {
      const projection = drawing.projections.sections.find(p => p.station === section.station)
      for (const kind of ['ground', 'design']) {
        const drawn = entity(drawing, `sections/station/${section.station}/${kind}`).payload.vertices
        assert.equal(drawn.length, section[kind].length)
        drawn.forEach((p, i) => {
          close((p[0] - projection.origin[0]) / projection.horizontal + projection.offsetDatum, section[kind][i][0])
          close((p[1] - projection.origin[1]) / projection.vertical + projection.elevationDatum, section[kind][i][1])
          assert.equal(p[2], 0)
        })
      }
      assert.deepEqual(entity(drawing, `plan/station/${section.station}/section`).payload.vertices, section.worldDesign.map(p => [p[0], p[1], 0]))
    }
    const projection = drawing.projections.profile
    entity(drawing, 'profile/design').payload.vertices.forEach((p, i) => {
      close((p[0] - projection.origin[0]) / projection.horizontal + projection.stationDatum, input.profile[i].station)
      close((p[1] - projection.origin[1]) / projection.vertical + projection.elevationDatum, input.profile[i].elevation)
    })
    assert.ok(drawing.limitations.some(value => value.includes('not paper-space')))
    assert.ok(Object.isFrozen(drawing.entities[0].payload.vertices[0]))
  }
})

test('station/elevation, area and average-end-area quantity tables expose actual computed values', () => {
  const drawing = buildRoadDrawing(bent(), options())
  for (const section of drawing.calculation.sections) {
    const row = `profile/station-table/row/${section.station}/cell/`
    for (const [i, value] of [section.station, section.designElevation, section.groundCenterElevation, section.longitudinalGrade*100, section.areas.cut, section.areas.fill].entries()) assert.equal(entity(drawing, `${row}${i}`).payload.text, value.toFixed(3))
  }
  close(drawing.calculation.intervals.reduce((n, i) => n + i.cutVolume, 0), drawing.calculation.totalVolume.cut)
  assert.equal(entity(drawing, 'profile/volume-table/row/total/cell/3').payload.text, drawing.calculation.totalVolume.cut.toFixed(3))
  assert.equal(entity(drawing, 'profile/volume-table/row/total/cell/4').payload.text, drawing.calculation.totalVolume.fill.toFixed(3))
  assert.ok(drawing.entities.some(e => e.type === 'TEXT' && String(e.payload.text).includes('vertical exaggeration')))
  assert.ok(drawing.entities.some(e => e.type === 'TEXT' && String(e.payload.text).includes('not certify')))
})

test('profile and cross sections carry projected coordinate ticks, real style legends and pavement width/crossfall labels', () => {
  const input=straight(), drawing=buildRoadDrawing(input,options())
  for(const group of ['profile','sections']) {
    assert.equal(entity(drawing,`${group}/legend/design-label`).payload.text,'Design')
    assert.equal(entity(drawing,`${group}/legend/ground-label`).payload.text,'Supplied ground')
    assert.notEqual(entity(drawing,`${group}/legend/design-sample`).payload.layerId,entity(drawing,`${group}/legend/ground-sample`).payload.layerId)
  }
  const projection=drawing.projections.profile
  for(const tick of drawing.entities.filter(e=>/^profile\/station-tick\/\d+\/grid$/.test(e.key))) {
    const station=(tick.payload.start[0]-projection.origin[0])/projection.horizontal+projection.stationDatum
    assert.equal(entity(drawing,tick.key.replace('/grid','/value')).payload.text,station.toFixed(3))
  }
  for(const section of drawing.calculation.sections) {
    const key=`sections/station/${section.station}`
    assert.equal(entity(drawing,`${key}/left-width-crossfall`).payload.text,'L width 4.000 m; outward crossfall -2.000%')
    assert.equal(entity(drawing,`${key}/right-width-crossfall`).payload.text,'R width 4.000 m; outward crossfall -2.000%')
    assert.equal(entity(drawing,`${key}/offset-center-value`).payload.text,'0.000')
    assert.equal(entity(drawing,`${key}/offset-right-value`).payload.text,'-30.000')
    assert.equal(entity(drawing,`${key}/offset-left-value`).payload.text,'30.000')
    assert.equal(entity(drawing,`${key}/elevation-lower-value`).payload.text,drawing.projections.sections.find(p=>p.station===section.station).elevationDatum.toFixed(3))
    const designMaxY=Math.max(...entity(drawing,`${key}/design`).payload.vertices.map(p=>p[1]))
    assert.ok(entity(drawing,`${key}/right-width-crossfall`).payload.position[1]>designMaxY)
  }
})

test('three dynamic model-space frames do not overlap and contain geometry and conservative text bounds', () => {
  for (const input of [straight(), bent()]) {
    const drawing = buildRoadDrawing(input, options())
    for (let i = 0; i < drawing.frames.length; i++) for (let j = i+1; j < drawing.frames.length; j++) {
      const a = drawing.frames[i].bounds, b = drawing.frames[j].bounds
      assert.ok(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1])
    }
    for (const e of drawing.entities) {
      const group = e.key.split('/')[0], frame = drawing.frames.find(f => f.key === (group === 'profile' ? 'profile-tables' : group)).bounds
      for (const p of pointList(e)) assert.ok(p[0] >= frame[0]-1e-8 && p[0] <= frame[2]+1e-8 && p[1] >= frame[1]-1e-8 && p[1] <= frame[3]+1e-8, e.key)
      if (e.type === 'TEXT') assert.ok(e.payload.position[0] + e.payload.text.length * 1.2 * e.payload.height <= frame[2]+1e-8, `Text width: ${e.key}`)
    }
  }
  const input = straight(), a = buildRoadDrawing(input, options())
  input.sections.push({ station: 550, ground: [[-30, 13.5], [30, 13.5]] }); input.sections.sort((a,b)=>a.station-b.station)
  assert.equal(buildRoadDrawing(input, options()).projections.sections.length, a.projections.sections.length + 1)
})

test('width/elevation changes preserve semantic identities while section edits expose added and removed keys', () => {
  const input = straight(), original = buildRoadDrawing(input, options())
  input.pavement.leftWidth = 5
  input.profile[1].elevation = 17
  const changed = buildRoadDrawing(input, options())
  assert.deepEqual(changed.entities.map(e => [e.key, e.options.id]), original.entities.map(e => [e.key, e.options.id]))
  assert.notDeepEqual(entity(changed, 'sections/station/600/design').payload, entity(original, 'sections/station/600/design').payload)
  assert.notEqual(entity(changed, 'profile/volume-table/row/total/cell/4').payload.text, entity(original, 'profile/volume-table/row/total/cell/4').payload.text)
  input.sections = input.sections.filter(s => s.station !== 300)
  const removed = buildRoadDrawing(input, options())
  assert.ok(!removed.entities.some(e => e.key.includes('/station/300/')))
  assert.ok(!removed.entities.some(e => e.key.includes('/row/200-300/')))
  assert.ok(removed.entities.some(e => e.key.includes('/row/200-400/')))
  assert.equal(new Set(removed.entities.map(e => e.options.id)).size, removed.entities.length)
})

test('actual CREATEBATCH resources and entities roundtrip through native DXF and undo as one document operation', async () => {
  for (const input of [straight(), bent()]) {
    const drawing = buildRoadDrawing(input, options()), sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'meter' })
    await sdk.executeCommand('CREATEBATCH', { resources: drawing.resources, entities: drawing.entities })
    assert.equal(document.listEntities().length, drawing.entities.length)
    const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
    const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
    assert.equal(reopened.snapshot().header.units, 'meter')
    assert.equal(reopened.listEntities().filter(e => e.type === 'TEXT').length, drawing.entities.filter(e => e.type === 'TEXT').length)
    assert.equal(reopened.getTable('layers').records.filter(r => r.name?.startsWith('route-review_ROAD')).length, 6)
    await sdk.executeCommand('UNDO')
    assert.equal(document.listEntities().length, 0)
    assert.equal(document.getTable('layers').records.filter(r => r.name?.startsWith('route-review_ROAD')).length, 0)
  }
})

test('invalid or overlapping layout settings, accessors and explicit work budgets fail before producing a drawing', () => {
  for (const mutation of [o=>{o.profileScale.vertical=0},o=>{o.sectionScale.horizontal=Infinity},o=>{o.sectionColumns=0},o=>{o.origin=[300,500]},o=>{o.maxEntities=10},o=>{o.drawingId='unsafe/name'},o=>{o.title='bad\ntext'}]) {
    const opts = options(); mutation(opts); assert.throws(()=>buildRoadDrawing(straight(),opts),/Road drawing:/)
  }
  let calls=0;const opts=options();Object.defineProperty(opts.profileScale,'horizontal',{enumerable:true,get(){calls++;return 1}})
  assert.throws(()=>buildRoadDrawing(straight(),opts),/accessors/);assert.equal(calls,0)
  const input=straight();input.profile.forEach(p=>{p.elevation=0});input.sections.forEach(s=>{s.ground=[[-30,0],[30,0]]});input.pavement.leftCrossfall=input.pavement.rightCrossfall=0
  assert.deepEqual(buildRoadDrawing(input,options()).calculation.totalVolume,{cut:0,fill:0})
})

test('exact deferred entity budgeting accepts precisely the required count and rejects one fewer', () => {
  const input=straight(), opts=options(), reference=buildRoadDrawing(input,opts)
  assert.deepEqual(buildRoadDrawing(input,{...opts,maxEntities:reference.entities.length}),reference)
  assert.throws(()=>buildRoadDrawing(input,{...opts,maxEntities:reference.entities.length-1}),/exact entity count/)
})
