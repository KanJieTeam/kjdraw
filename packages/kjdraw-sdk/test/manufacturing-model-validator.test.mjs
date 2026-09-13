import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { independentValidation, pairedModelPlan } from '../../../scripts/benchmarks/paired-model-benchmark.mjs'
import { manufacturingDrawingRequirements, manufacturingDrawingTasks, manufacturingSheetInput } from '../../../scripts/benchmarks/manufacturing-drawing-tasks.mjs'

const python = process.env.KJDRAW_PYTHON ?? 'python'

test('manufacturing suite materializes and independently validates the complete high-density DXF contract', async t => {
  try { independentValidation({ python, taskSuite: 'manufacturing' }) } catch {
    t.skip('Independent manufacturing validator unavailable; configure KJDRAW_PYTHON and ezdxf')
    return
  }
  const plan = pairedModelPlan({ taskSuite: 'manufacturing', repetitions: 1, maxRequests: 2, exploratory: true, maxOutputTokens: 8192 })
  assert.deepEqual(plan.tasks.map(task => task.id), manufacturingDrawingTasks.map(task => task.id))
  assert.match(plan.scope, /96-hole working array/)

  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, document)
  const proposal = await session.call('cad_propose_manufacturing_sheet', manufacturingSheetInput())
  assert.equal(proposal.ok, true, JSON.stringify(proposal))
  assert.equal((await session.approve(proposal.value.planId, 'manufacturing-validator-test')).ok, true)
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const expected = manufacturingDrawingRequirements()
  const result = independentValidation({ python, dxf, expected, taskSuite: 'manufacturing' })
  assert.equal(result.passed, true, JSON.stringify(result))
  assert.equal(result.workingHolesChecked, 96)
  assert.equal(result.mountingHolesChecked, 4)
  assert.equal(result.slotsChecked, 2)
  assert.equal(result.dimensionsChecked, 11)
  assert.equal(result.auditErrors, 0)
  assert.equal(result.auditFixes, 0)

  const altered = structuredClone(expected)
  altered.holePatterns[0].spacing[0] = 23
  const rejected = independentValidation({ python, dxf, expected: altered, taskSuite: 'manufacturing' })
  assert.equal(rejected.passed, false)
})
