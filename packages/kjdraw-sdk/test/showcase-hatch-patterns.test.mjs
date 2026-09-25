import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCadCapabilitySpecimenDocuments } from '../../../examples/cad-capability-specimens.mjs'
import { exportDrawingSvg } from '../src/index.js'

test('public hatch specimen keeps editable patterns and a true island through KJD and DXF reopen', async () => {
  const specimen = (await buildCadCapabilitySpecimenDocuments()).find(item => item.id === 'hatch-patterns')
  assert.ok(specimen)
  const hatches = specimen.document.listEntities({ type: 'HATCH' })
  assert.equal(hatches.length, 4)
  assert.deepEqual(hatches.map(item => item.payload.patternName), ['ANSI31', 'ANSI37', 'CROSS', 'ANSI31'])
  assert.equal(hatches[3].payload.boundaryLoops.length, 2)
  assert.equal(hatches[3].payload.boundaryLoops[1].external, false)
  assert.equal(specimen.document.listEntities({ type: 'LWPOLYLINE' }).length, 5)
  const rendered = exportDrawingSvg(specimen.document, { layoutId: specimen.layoutId })
  assert.deepEqual(rendered.report.diagnostics, [])
  for (const format of ['KJD', 'DXF']) {
    const bytes = await specimen.sdk.writeDocument(specimen.document, { format, version: format === 'DXF' ? '2018' : '1' })
    const reopened = await specimen.sdk.readDocument(bytes, { format })
    const restored = reopened.listEntities({ type: 'HATCH' })
    assert.equal(restored.length, 4, `${format} lost hatch entities`)
    assert.equal(restored.find(item => item.payload.patternName === 'CROSS')?.payload.patternName, 'CROSS')
    assert.equal(restored.filter(item => item.payload.boundaryLoops.length === 2).length, 1, `${format} lost island boundary`)
  }
})
