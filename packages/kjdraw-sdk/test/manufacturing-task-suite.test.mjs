import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { independentValidation, pairedModelPlan } from '../../../scripts/benchmarks/paired-model-benchmark.mjs'
import { hashManufacturingSuiteInput, manufacturingTaskSuite, manufacturingTaskSuiteVersion } from '../../../scripts/benchmarks/manufacturing-task-suite.mjs'

const python = process.env.KJDRAW_PYTHON ?? 'python'

test('manufacturing-30 manifest contains thirty distinct versioned semantic contracts', () => {
  assert.equal(manufacturingTaskSuiteVersion, '1.0.0')
  assert.equal(manufacturingTaskSuite.length, 30)
  assert.equal(new Set(manufacturingTaskSuite.map(task => task.id)).size, 30)
  assert.equal(new Set(manufacturingTaskSuite.map(task => task.prompt)).size, 30)
  assert.equal(new Set(manufacturingTaskSuite.map(task => task.inputSha256)).size, 30)
  assert.equal(new Set(manufacturingTaskSuite.map(task => task.input.drawingId)).size, 30)
  for (const task of manufacturingTaskSuite) {
    assert.equal(task.version, manufacturingTaskSuiteVersion)
    assert.match(task.id, /^[a-z0-9-]+$/)
    assert.match(task.inputSha256, /^[a-f0-9]{64}$/)
    assert.equal(task.inputSha256, hashManufacturingSuiteInput(task.input))
    assert.equal(task.input.version, '1.0.0')
    assert.equal(task.input.expectedRevision, 0)
    assert.equal(task.input.units, 'millimeter')
    assert.equal(task.input.holePatterns.length, 2)
    assert.equal(task.input.slots.length, 2)
    assert.ok(task.input.holePatterns.reduce((total, pattern) => total + pattern.rows * pattern.columns, 0) >= 58)
    assert.ok(task.prompt.includes(task.input.drawingId))
    assert.ok(task.prompt.includes(`${task.input.length} x ${task.input.width} x ${task.input.thickness}`))
  }

  const fullPlan = pairedModelPlan({ taskSuite: 'manufacturing-30', repetitions: 5, maxRequests: 300, maxOutputTokens: 8192 })
  assert.equal(fullPlan.mode, 'dry-run')
  assert.equal(fullPlan.tasks.length, 30)
  assert.equal(fullPlan.repetitions, 5)
  assert.equal(fullPlan.plannedRequests, 300)
  assert.equal(fullPlan.actualRequests, 0)
  assert.equal(fullPlan.drawingTool, 'cad_propose_manufacturing_sheet')
  assert.deepEqual(fullPlan.tasks.map(task => task.id), manufacturingTaskSuite.map(task => task.id))
  assert.deepEqual(fullPlan.tasks.map(task => task.inputSha256), manufacturingTaskSuite.map(task => task.inputSha256))
  assert.throws(() => pairedModelPlan({ taskSuite: 'manufacturing-30', repetitions: 5, maxRequests: 299, maxOutputTokens: 8192 }), /request budget/)
  const maximumPlan = pairedModelPlan({ taskSuite: 'manufacturing-30', repetitions: 30, maxRequests: 1800, maxOutputTokens: 8192 })
  assert.equal(maximumPlan.plannedRequests, 1800)
  assert.throws(() => pairedModelPlan({ taskSuite: 'manufacturing-30', drawingTool: 'cad_propose_drawing', repetitions: 5, maxRequests: 300, maxOutputTokens: 8192 }), /requires cad_propose_manufacturing_sheet/)
})

test('all manufacturing-30 inputs materialize as editable KJD/DXF and pass independent geometry validation', async t => {
  try { independentValidation({ python, taskSuite: 'manufacturing-30' }) } catch {
    t.skip('Independent manufacturing validator unavailable; configure KJDRAW_PYTHON and ezdxf')
    return
  }

  for (const task of manufacturingTaskSuite) {
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    const session = new KJAgentToolSession(sdk, document)
    const proposal = await session.call('cad_propose_manufacturing_sheet', structuredClone(task.input))
    assert.equal(proposal.ok, true, `${task.id}: ${JSON.stringify(proposal)}`)
    assert.equal(proposal.value.command, 'CREATEBATCH')
    assert.ok(proposal.value.arguments.entities.length >= 200, task.id)
    assert.ok(proposal.value.arguments.entities.length <= 512, task.id)
    assert.equal((await session.approve(proposal.value.planId, 'manufacturing-suite-validator')).ok, true, task.id)

    const expectedCircleCount = task.input.holePatterns.reduce((total, pattern) => total + pattern.rows * pattern.columns * (pattern.counterboreDiameter == null ? 1 : 2), 0)
    assert.equal(document.listEntities({ type: 'CIRCLE' }).length, expectedCircleCount, task.id)
    assert.equal(document.listEntities({ type: 'DIMENSION' }).length, task.expected.nativeDimensionCount, task.id)
    assert.ok(document.listEntities().length >= 200, task.id)

    const kjd = await sdk.writeDocument(document, { format: 'KJD', version: '1' })
    const reopenedKjd = await createKJDrawSDK().readDocument(kjd, { format: 'KJD', version: '1' })
    assert.equal(reopenedKjd.listEntities().length, document.listEntities().length, `${task.id}: KJD entity count`)
    assert.equal(reopenedKjd.listEntities({ type: 'DIMENSION' }).length, task.expected.nativeDimensionCount, `${task.id}: KJD dimensions`)

    const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
    const reopenedDxf = await createKJDrawSDK().readDocument(dxf, { format: 'DXF', version: '2018' })
    assert.equal(reopenedDxf.listEntities({ type: 'CIRCLE' }).length, expectedCircleCount, `${task.id}: DXF circles`)
    assert.equal(reopenedDxf.listEntities({ type: 'DIMENSION' }).length, task.expected.nativeDimensionCount, `${task.id}: DXF dimensions`)

    const validation = independentValidation({ python, dxf: String(dxf), expected: task.expected, taskSuite: 'manufacturing-30', timeoutMs: 30000 })
    assert.equal(validation.passed, true, `${task.id}: ${JSON.stringify(validation)}`)
    assert.equal(validation.auditErrors, 0, task.id)
    assert.equal(validation.auditFixes, 0, task.id)
    assert.equal(validation.workingHolesChecked, task.input.holePatterns[0].rows * task.input.holePatterns[0].columns, task.id)
    assert.equal(validation.mountingHolesChecked, 4, task.id)
    assert.equal(validation.slotsChecked, 2, task.id)
  }
})
