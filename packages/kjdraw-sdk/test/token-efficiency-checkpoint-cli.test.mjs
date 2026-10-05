import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTokenCheckpointCli } from '../../../scripts/benchmarks/token-efficiency-checkpoint-cli.mjs'
import { tokenEfficiencyTaskCorpus } from '../../../scripts/benchmarks/token-efficiency-task-corpus.mjs'
import { compileDeclarativeEzdxfRound, declarativeEzdxfSchema } from '../../../scripts/benchmarks/declarative-ezdxf-baseline.mjs'
import { scoreTokenEfficiencyRound } from '../../../scripts/benchmarks/token-efficiency-scorer.mjs'

const task = tokenEfficiencyTaskCorpus.find(item => item.family === 'corner-hole-plate')
const config = { taskIds: [task.id], repetitions: 3, models: [{ provider: 'deepseek', model: 'fixture-model', settings: { temperature: 0, max_tokens: 4096 } }] }
const expected = task.expectedRounds[0].expected
const drawing = { lines: expected.lines.map(shape => [shape.start.x, shape.start.y, shape.end.x, shape.end.y]),
  circles: expected.circles.map(shape => [shape.center.x, shape.center.y, shape.radius]),
  arcs: expected.arcs.map(shape => [shape.center.x, shape.center.y, shape.radius, shape.startDegrees, shape.endDegrees]),
  polylines: expected.polylines.map(shape => ({ points: shape.vertices.map(point => [point.x, point.y]), closed: shape.closed })) }
const baseline = { schema: declarativeEzdxfSchema, units: 'millimeter', operations: [
  ...expected.lines.map((shape, index) => ({ op: 'add', id: `line-${index}`, kind: 'LINE', shape })),
  ...expected.circles.map((shape, index) => ({ op: 'add', id: `circle-${index}`, kind: 'CIRCLE', shape })),
  ...expected.arcs.map((shape, index) => ({ op: 'add', id: `arc-${index}`, kind: 'ARC', shape })),
  ...expected.polylines.map((shape, index) => ({ op: 'add', id: `poly-${index}`, kind: 'LWPOLYLINE', shape })),
] }
const usage = { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
const runtime = { python: process.env.KJDRAW_PYTHON ?? 'python', ezdxfPath: process.env.KJDRAW_EZDXF_PATH ?? null }

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-token-cli-'))
  t.after(async () => { assert.ok(resolve(directory).startsWith(resolve(tmpdir()))); await rm(directory, { recursive: true, force: true }) })
  return directory
}

test('fixture CLI integration runs both real CAD arms, independently scores DXF, and resumes all three atomic units', async t => {
  const output = join(await scratch(t), 'checkpoint')
  const secret = 'fixture-private-api-key-12345678'
  const priorKey = process.env.KJDRAW_DEEPSEEK_API_KEY
  process.env.KJDRAW_DEEPSEEK_API_KEY = secret
  t.after(() => { if (priorKey === undefined) delete process.env.KJDRAW_DEEPSEEK_API_KEY; else process.env.KJDRAW_DEEPSEEK_API_KEY = priorKey })
  let requests = 0
  const modelCall = input => {
    requests++
    assert.doesNotMatch(JSON.stringify({ messages: input.messages, settings: input.settings }), /expectedRounds|acceptanceSha256|validatorKind/)
    return input.arm === 'kjdraw-tool'
      ? { content: `The echoed credential ${secret} must be redacted`, toolCalls: [{ id: `fixture-${requests}`, type: 'function', function: {
        name: 'cad_propose_drawing_basic', arguments: JSON.stringify({ units: 'millimeter', expectedRevision: 0, ...drawing }),
      } }], usage, model: 'fixture-served-v1', elapsedMs: 1 }
      : { content: JSON.stringify(baseline), toolCalls: [], usage, model: 'fixture-served-v1', elapsedMs: 1 }
  }
  const options = { config, output, mode: 'fixture', dryRun: false, modelCall,
    compileBaseline: input => compileDeclarativeEzdxfRound({ ...input, ...runtime }),
    scoreRound: input => scoreTokenEfficiencyRound({ ...input, ...runtime }) }
  const first = await runTokenCheckpointCli(options)
  assert.equal(first.stopped, false, first.stopReason)
  assert.equal(first.executedUnits, 3)
  assert.equal(first.remainingUnits, 0)
  assert.equal(requests, 6)
  assert.equal(first.aggregates[0].plannedTasks, 1)
  assert.equal(first.aggregates[0].paired.claim99Supported, false)
  const second = await runTokenCheckpointCli(options)
  assert.equal(second.resumedUnits, 3)
  assert.equal(second.executedUnits, 0)
  assert.equal(requests, 6)
  const units = await readdir(join(output, 'units'))
  assert.equal(units.length, 3)
  let firstResponsePath
  for (const key of units) {
    const files = await readdir(join(output, 'units', key))
    const commit = JSON.parse(await readFile(join(output, 'units', key, files.find(name => name.startsWith('commit-'))), 'utf8'))
    const evidence = JSON.parse(await readFile(join(output, 'units', key, `attempt-${commit.attemptId}`, 'evidence.json'), 'utf8'))
    assert.equal(evidence.runs.length, 2)
    assert.equal(evidence.runs.every(run => run.validation.passed && run.dxfArtifact), true)
    assert.equal(evidence.runs.every(run => run.modelResponseArtifact), true)
    assert.equal(evidence.artifacts.length, 4)
    const responsePath = join(output, 'units', key, `attempt-${commit.attemptId}`, evidence.runs[0].modelResponseArtifact)
    const response = await readFile(responsePath, 'utf8')
    assert.equal(response.includes(secret), false)
    assert.equal(response.includes('[REDACTED]') || evidence.runs[0].arm === 'declarative-ezdxf', true)
    firstResponsePath ??= responsePath
  }
  await writeFile(firstResponsePath, '{"corrupt":true}')
  const repaired = await runTokenCheckpointCli(options)
  assert.equal(repaired.invalidCommits, 1)
  assert.equal(repaired.executedUnits, 1)
  assert.equal(repaired.resumedUnits, 2)
  assert.equal(requests, 8)
})

test('live checkpoint refuses missing review gate and paid confirmation before model or file activity', async t => {
  const output = join(await scratch(t), 'never-created')
  let called = 0
  await assert.rejects(runTokenCheckpointCli({ config, output, mode: 'live', dryRun: false,
    modelCall: () => { called++ } }), /EXPLICIT_LIVE_REVIEW_AND_PAYMENT_CONFIRMATION_REQUIRED/)
  assert.equal(called, 0)
  await assert.rejects(readdir(output), { code: 'ENOENT' })
})

test('direct CLI dry-run is read-only; --run without pinned gate fails before provider activity', async t => {
  const directory = await scratch(t), configPath = join(directory, 'config.json'), output = join(directory, 'not-created')
  await writeFile(configPath, JSON.stringify(config))
  const cli = fileURLToPath(new URL('../../../scripts/benchmarks/token-efficiency-checkpoint-cli.mjs', import.meta.url))
  const dry = spawnSync(process.execPath, [cli, `--config=${configPath}`, `--output=${output}`], { encoding: 'utf8', timeout: 20000 })
  assert.equal(dry.status, 0, dry.stderr)
  const plan = JSON.parse(dry.stdout)
  assert.equal(plan.mode, 'dry-run')
  assert.equal(plan.plannedUnits, 3)
  const denied = spawnSync(process.execPath, [cli, `--config=${configPath}`, `--output=${output}`, '--run', '--confirm-paid'], { encoding: 'utf8', timeout: 20000 })
  assert.equal(denied.status, 1)
  assert.match(denied.stderr, /HASH_PINNED_REVIEW_GATE_REQUIRED/)
  await assert.rejects(readdir(output), { code: 'ENOENT' })
})
