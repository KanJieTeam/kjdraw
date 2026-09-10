import test from 'node:test'
import assert from 'node:assert/strict'
import { parametricDrawingTasks, deterministicFixturePatternInputs, parametricTaskScope } from '../../../scripts/benchmarks/parametric-drawing-tasks.mjs'
import { strategyTasks, checkDrawing } from '../../../scripts/benchmarks/drawing-strategies.mjs'
import { independentValidation } from '../../../scripts/benchmarks/paired-model-benchmark.mjs'
import { expandRectangularDrawingPattern } from '../src/agent-drawing-patterns.js'
import { createKJDrawSDK } from '../src/sdk.js'

const groups = ['lines', 'circles', 'arcs', 'polylines']
const count = expected => groups.reduce((total, group) => total + expected[group].length, 0)
const expand = fixture => [...structuredClone(fixture.baseEntities), ...fixture.patterns.flatMap(({ entities, pattern }) => expandRectangularDrawingPattern(entities, pattern, { maxEntities: 256 }))]

test('public parametric requirements contain exactly 209, 78 and 140 native entities with independently enumerated expectations', () => {
  assert.deepEqual(parametricDrawingTasks.map(task => count(task.expected)), [209, 78, 140])
  assert.deepEqual(parametricDrawingTasks[0].expected, strategyTasks.find(task => task.id === 'perforated-panel-209').expected)
  assert.deepEqual(groups.map(group => parametricDrawingTasks[0].expected[group].length), [8, 192, 8, 1])
  assert.deepEqual(groups.map(group => parametricDrawingTasks[1].expected[group].length), [0, 52, 0, 26])
  assert.deepEqual(groups.map(group => parametricDrawingTasks[2].expected[group].length), [2, 134, 3, 1])
  assert.match(parametricTaskScope, /does not measure complete engineering drawings/)
  for (const task of parametricDrawingTasks) {
    assert.equal(task.expected.expectedRevision, 0)
    assert.equal(task.expected.units, 'millimeter')
    assert.match(task.prompt, /z=0/)
    assert.match(task.prompt, /no text, dimensions/)
    assert.ok(!task.prompt.includes('deterministicFixture'))
  }
})

test('small generic source sets expand to every expected entity without mutation or built-in task templates', async () => {
  assert.deepEqual(deterministicFixturePatternInputs.map(fixture => fixture.baseEntities.length + fixture.patterns.reduce((sum, pattern) => sum + pattern.entities.length, 0)), [6, 8, 8])
  for (const fixture of deterministicFixturePatternInputs) {
    const before = JSON.stringify(fixture), entities = expand(fixture), task = parametricDrawingTasks.find(task => task.id === fixture.taskId)
    assert.equal(entities.length, count(task.expected))
    assert.equal(JSON.stringify(fixture), before)
    const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    await sdk.executeCommand('CREATEBATCH', { entities })
    assert.equal(checkDrawing(document, task.expected).passed, true, fixture.taskId)
  }
})

test('all three parametric fixture drawings pass real SDK DXF export and independent strict ezdxf validation', async t => {
  const python = process.env.KJDRAW_PYTHON ?? 'python'
  try { independentValidation({ python }) } catch {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail('Configure Python with the independent ezdxf dependency')
    t.skip('Independent ezdxf is required; set KJDRAW_PYTHON/PYTHONPATH and KJDRAW_BENCH_INTEGRATION_REQUIRED=1 for acceptance')
    return
  }
  for (const fixture of deterministicFixturePatternInputs) {
    const task = parametricDrawingTasks.find(task => task.id === fixture.taskId), sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
    await sdk.executeCommand('CREATEBATCH', { entities: expand(fixture) })
    const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
    const result = independentValidation({ python, dxf, expected: task.expected })
    assert.equal(result.passed, true, `${fixture.taskId}: ${JSON.stringify(result)}`)
    assert.equal(result.entities, count(task.expected))
  }
})
