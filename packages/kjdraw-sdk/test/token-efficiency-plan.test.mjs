import assert from 'node:assert/strict'
import test from 'node:test'
import { tokenEfficiencyPlan } from '../../../scripts/benchmarks/token-efficiency-plan.mjs'

test('frozen 100-task multi-round plan counts every paid round before live execution', () => {
  const plan = tokenEfficiencyPlan()
  assert.equal(plan.mode, 'dry-run')
  assert.equal(plan.modelCallsMade, 0)
  assert.equal(plan.taskCount, 100)
  assert.equal(plan.roundCount, 180)
  assert.equal(plan.requestsPerModel, 1080)
  assert.equal(plan.plannedRequests, 3240)
  assert.deepEqual(plan.categories, {
    'simple-one-shot': { tasks: 30, rounds: 30 },
    'complex-one-shot': { tasks: 30, rounds: 30 },
    'multi-round-edit': { tasks: 40, rounds: 120 },
  })
  assert.match(plan.corpusSha256, /^[a-f0-9]{64}$/)
})

test('plan refuses ambiguous or unbounded request budgets', () => {
  assert.throws(() => tokenEfficiencyPlan({ tasks: [{ id: 'one', rounds: [{}] }, { id: 'one', rounds: [{}] }] }), /Duplicate task ID/)
  assert.throws(() => tokenEfficiencyPlan({ repetitions: 0 }), /Positive integer/)
  assert.throws(() => tokenEfficiencyPlan({ models: Number.MAX_SAFE_INTEGER }), /overflow/)
})
