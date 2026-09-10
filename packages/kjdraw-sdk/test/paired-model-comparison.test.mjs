import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { renderPairedModelComparison } from '../../../scripts/benchmarks/render-paired-model-comparison.mjs'

// Deliberately fabricated live-shaped data tests renderer logic only; temporary images are never published.
const hash = data => createHash('sha256').update(data).digest('hex')
async function fixture(t) {
  const input = await mkdtemp(join(tmpdir(), 'kjdraw-comparison-test-'))
  t.after(async () => { assert.ok(resolve(input).startsWith(resolve(tmpdir()))); await rm(input, { recursive: true, force: true }) })
  const settings = { temperature: 0, max_tokens: 4096, stream: false }
  const tasks = ['plate', 'triangle', 'bracket'].map(id => ({ id, prompt: `SYNTHETIC TEST ONLY ${id}`, expected: { fixture: id }, fixtureSha256: hash(JSON.stringify({ fixture: id })) }))
  const report = { schema: 'com.kanjie.kjdraw.benchmark.paired-model@1', mode: 'live', status: 'complete', createdAt: '2026-09-10T00:00:00.000Z', protocol: 'chat-completions', model: 'SYNTHETIC-DO-NOT-PUBLISH', settings, repetitions: 5, maxRequests: 30, plannedRequests: 30, attemptedRequests: 30, unexecutedRequests: 0, consistentReturnedModel: true, returnedModels: ['SYNTHETIC-SERVED'], tasks, validator: { validator: 'ezdxf', version: '1.4.0' }, source: Object.fromEntries(['paired-model-benchmark.mjs', 'paired-model-validator.py', 'model-drawing-pilot.mjs', 'deepseek-drawing-pilot.py', 'model-usage.js', 'sdkRuntimeSha256'].map(key => [key, hash(key)])), runs: [] }
  for (let repetition = 1; repetition <= 5; repetition++) for (const task of tasks) for (const [order, arm] of ['kjdraw-tool', 'direct-dxf'].entries()) {
    const index = report.runs.length, failed = index === 0, geometryFailed = index === 1
    const usage = { protocol: 'chat-completions', inputTokens: 100, outputTokens: arm === 'kjdraw-tool' ? 20 : 40, totalTokens: arm === 'kjdraw-tool' ? 120 : 140, cacheReadInputTokens: 60, cacheMissInputTokens: 40, reasoningOutputTokens: 7, invalidFields: [] }
    const run = { taskId: task.id, arm, repetition, order, requestedModel: report.model, returnedModel: 'SYNTHETIC-SERVED', status: failed ? 'failed' : geometryFailed ? 'geometry-failed' : 'passed', validation: { ...report.validator, passed: !failed && !geometryFailed }, usage, transportLatencyMs: 1000 + index, totalMs: 1500 + index, files: {} }
    const bodies = { request: JSON.stringify({ model: report.model, ...settings, ...(arm === 'kjdraw-tool' ? { tools: [{ type: 'function', function: { name: 'cad_propose_drawing', parameters: {} } }], tool_choice: { type: 'function', function: { name: 'cad_propose_drawing' } } } : {}), messages: [{ role: 'system', content: `Test ${arm}` }, { role: 'user', content: task.prompt }] }), response: JSON.stringify({ model: run.returnedModel, usage, choices: [] }), ...(!failed ? { dxf: 'SYNTHETIC DXF BYTES: NOT REAL VALIDATION EVIDENCE' } : {}) }
    for (const [key, text] of Object.entries(bodies)) { const name = `${index}-${key}.${key === 'dxf' ? 'dxf' : 'json'}`; run.files[key] = name; run[`${key}Sha256`] = hash(text); if (key === 'request') run.requestBytes = Buffer.byteLength(text); await writeFile(join(input, name), text) }
    report.runs.push(run)
  }
  const save = () => writeFile(join(input, 'report.json'), JSON.stringify(report))
  await save()
  return { input, report, save, output: join(input, 'rendered') }
}
async function reviseResponse(f, index, callback) {
  const run = f.report.runs[index], path = join(f.input, run.files.response), data = JSON.parse(await readFile(path, 'utf8'))
  callback(run, data)
  const text = JSON.stringify(data); run.responseSha256 = hash(text); await writeFile(path, text); await f.save()
}

test('complete evidence renders three accessible SVGs, retains failed denominators and computes reported sums and medians', async t => {
  const f = await fixture(t), before = await readFile(join(f.input, 'report.json'))
  const result = await renderPairedModelComparison(f)
  assert.equal(result.status, 'comparable'); assert.equal(result.publicationReviewRequired, true); assert.equal(result.independentValidationRerun, false)
  assert.deepEqual(result.charts, ['tokens.svg', 'timing.svg', 'geometry.svg'])
  for (const arm of ['kjdraw-tool', 'direct-dxf']) { assert.equal(result.summaries[arm].attempted, 15); assert.equal(result.summaries[arm].passed, 14); assert.equal(result.summaries[arm].inputTokens, 1500); assert.equal(result.summaries[arm].cacheReadInputTokens, 900) }
  assert.equal(result.summaries['kjdraw-tool'].outputTokens, 300)
  assert.equal(result.summaries['direct-dxf'].outputTokens, 600)
  assert.equal(result.summaries['kjdraw-tool'].transportMedianMs, 1014)
  assert.equal(result.summaries['direct-dxf'].endToEndMedianMs, 1515)
  for (const file of result.charts) { const svg = await readFile(join(f.output, file), 'utf8'); assert.match(svg, /<svg /); assert.match(svg, /SYNTHETIC-DO-NOT-PUBLISH/); assert.match(svg, /SYNTHETIC-SERVED/); assert.match(svg, /15 attempts per arm/); assert.match(svg, /Source report SHA-256/); assert.doesNotMatch(svg, /NaN|undefined/) }
  const geometry = await readFile(join(f.output, 'geometry.svg'), 'utf8')
  assert.match(geometry, /Strict DXF \+ geometry pass rate/)
  assert.match(geometry, /Native format, units, independent geometry and zero audit errors\/fixes/)
  assert.match(geometry, /4\/5 \(80%\)/)
  assert.equal((geometry.match(/data-arm=/g) ?? []).length, 6)
  assert.match(geometry, /width="1020" height="480"/)
  assert.match(geometry, /fill="#2563eb"/); assert.match(geometry, /fill="#94a3b8"/)
  assert.equal(result.perTask.length, 3)
  assert.equal(result.perTask[0].taskId, 'plate')
  assert.equal(result.perTask[0].arms['kjdraw-tool'].attempted, 5)
  assert.equal(result.perTask[0].arms['kjdraw-tool'].passed, 4)
  assert.equal(result.perTask[0].arms['kjdraw-tool'].totalTokens, 600)
  assert.equal(result.perTask[0].arms['kjdraw-tool'].reasoningOutputTokens, 35)
  assert.match(await readFile(join(f.output, 'tokens.svg'), 'utf8'), /including reasoning/)
  assert.equal(result.perTask[0].arms['direct-dxf'].totalTokens, 700)
  assert.equal(result.perTask[0].arms['kjdraw-tool'].transportMedianMs, 1012)
  assert.equal(result.perTask[0].arms['direct-dxf'].endToEndMedianMs, 1513)
  assert.match(await readFile(join(f.output, 'tokens.svg'), 'utf8'), /does not imply equal drawing quality/)
  assert.deepEqual(await readFile(join(f.input, 'report.json')), before)
  await assert.rejects(renderPairedModelComparison(f), /EEXIST/)
})

test('fixture mode is rejected before creating output', async t => {
  const f = await fixture(t); f.report.mode = 'fixture'; await f.save()
  await assert.rejects(renderPairedModelComparison(f), /Only live/)
  assert.ok(!(await readdir(f.input)).includes('rendered'))
})

test('interrupted, unpaired, inconsistent-model and insufficient-repetition reports never produce comparison charts', async t => {
  for (const mutate of [f => { f.report.status = 'stopped' }, f => { f.report.runs[1].arm = 'kjdraw-tool' }, f => { f.report.runs[1].returnedModel = 'other' }, f => { f.report.repetitions = 4 }]) {
    const f = await fixture(t); mutate(f); await f.save()
    const result = await renderPairedModelComparison(f)
    assert.equal(result.status, 'not-comparable'); assert.deepEqual(result.charts, [])
    assert.deepEqual(await readdir(f.output), ['comparison.json'])
  }
})

test('missing tokens remain null and block comparison; missing optional cache split remains explicitly unknown', async t => {
  const f = await fixture(t)
  await reviseResponse(f, 0, (run, response) => { run.usage.inputTokens = null; response.usage.inputTokens = null })
  const missing = await renderPairedModelComparison(f)
  assert.equal(missing.status, 'not-comparable'); assert.equal(missing.summaries['kjdraw-tool'].inputTokens, null); assert.equal(missing.perTask[0].arms['kjdraw-tool'].inputTokens, null)
  const optional = await fixture(t)
  await reviseResponse(optional, 0, (run, response) => { run.usage.cacheReadInputTokens = null; response.usage.cacheReadInputTokens = null })
  const result = await renderPairedModelComparison(optional)
  assert.equal(result.status, 'comparable'); assert.equal(result.summaries['kjdraw-tool'].cacheReadInputTokens, null)
  assert.equal(result.perTask[0].arms['kjdraw-tool'].cacheReadInputTokens, null)
  assert.match(await readFile(join(optional.output, 'tokens.svg'), 'utf8'), /Cache hit and miss are included in input/)
})

test('changed request, response and DXF bytes are detected by per-artifact hashes', async t => {
  for (const key of ['request', 'response', 'dxf']) {
    const f = await fixture(t), run = f.report.runs[1]
    await writeFile(join(f.input, run.files[key]), 'MODIFIED')
    const result = await renderPairedModelComparison(f)
    assert.equal(result.status, 'not-comparable'); assert.ok(result.reasons.includes('ARTIFACT_HASH')); assert.deepEqual(result.charts, [])
  }
})

test('rehashed request setting mismatch and response usage mismatch still fail semantic evidence checks', async t => {
  const f = await fixture(t), run = f.report.runs[1], path = join(f.input, run.files.request), request = JSON.parse(await readFile(path, 'utf8'))
  request.temperature = 1
  const text = JSON.stringify(request); await writeFile(path, text); run.requestSha256 = hash(text); run.requestBytes = Buffer.byteLength(text); await f.save()
  assert.ok((await renderPairedModelComparison(f)).reasons.includes('REQUEST_SETTINGS'))
  const mismatch = await fixture(t)
  await reviseResponse(mismatch, 0, (_, response) => { response.usage.inputTokens = 99 })
  assert.ok((await renderPairedModelComparison(mismatch)).reasons.includes('RESPONSE_RECORD_MISMATCH'))
})

test('artifact traversal is refused and model labels are XML escaped', async t => {
  const f = await fixture(t); f.report.runs[0].files.request = '../outside.json'; await f.save()
  assert.ok((await renderPairedModelComparison(f)).reasons.includes('ARTIFACT_REFERENCE'))
  const escaped = await fixture(t)
  for (let i = 0; i < escaped.report.runs.length; i++) await reviseResponse(escaped, i, (run, response) => { run.returnedModel = '<script>bad</script>'; response.model = run.returnedModel })
  escaped.report.returnedModels = ['<script>bad</script>']; await escaped.save()
  assert.equal((await renderPairedModelComparison(escaped)).status, 'comparable')
  const svg = await readFile(join(escaped.output, 'tokens.svg'), 'utf8')
  assert.doesNotMatch(svg, /<script>/); assert.match(svg, /&lt;script&gt;/)
})

test('missing timing or a rehashed request attributed to the wrong arm cannot become comparable', async t => {
  const missing = await fixture(t); missing.report.runs[0].totalMs = null; await missing.save()
  const result = await renderPairedModelComparison(missing)
  assert.equal(result.status, 'not-comparable'); assert.ok(result.reasons.includes('MISSING_OR_INVALID_TIMING'))
  assert.equal(result.summaries['kjdraw-tool'].endToEndMedianMs, null)
  const f = await fixture(t), run = f.report.runs[0], path = join(f.input, run.files.request), request = JSON.parse(await readFile(path, 'utf8'))
  delete request.tools; delete request.tool_choice
  const text = JSON.stringify(request); await writeFile(path, text); run.requestSha256 = hash(text); run.requestBytes = Buffer.byteLength(text); await f.save()
  assert.ok((await renderPairedModelComparison(f)).reasons.includes('REQUEST_ARM_MISMATCH'))
})

test('tool choice mode is explicit in evidence and charts; legacy missing mode means forced', async t => {
  const legacy = await fixture(t)
  const legacyResult = await renderPairedModelComparison(legacy)
  assert.equal(legacyResult.toolChoiceMode, 'forced'); assert.match(legacyResult.toolChoiceNote, /Legacy/)
  assert.match(await readFile(join(legacy.output, 'tokens.svg'), 'utf8'), /tool_choice=forced/)
  const auto = await fixture(t); auto.report.toolChoiceMode = 'auto'
  for (const run of auto.report.runs.filter(run => run.arm === 'kjdraw-tool')) {
    const path = join(auto.input, run.files.request), request = JSON.parse(await readFile(path, 'utf8'))
    request.tool_choice = 'auto'
    const text = JSON.stringify(request); await writeFile(path, text); run.requestSha256 = hash(text); run.requestBytes = Buffer.byteLength(text)
  }
  await auto.save()
  const result = await renderPairedModelComparison(auto)
  assert.equal(result.status, 'comparable'); assert.equal(result.toolChoiceMode, 'auto'); assert.match(result.toolChoiceNote, /may choose/)
  assert.match(await readFile(join(auto.output, 'tokens.svg'), 'utf8'), /tool_choice=auto/)
  assert.equal(result.summaries['kjdraw-tool'].attempted, 15)
})

test('declared auto cannot silently accept forced requests or an unsupported mode', async t => {
  const auto = await fixture(t); auto.report.toolChoiceMode = 'auto'; await auto.save()
  assert.ok((await renderPairedModelComparison(auto)).reasons.includes('REQUEST_ARM_MISMATCH'))
  const invalid = await fixture(t); invalid.report.toolChoiceMode = 'required'; await invalid.save()
  assert.ok((await renderPairedModelComparison(invalid)).reasons.includes('INVALID_TOOL_CHOICE_MODE'))
  const forced = await fixture(t); forced.report.toolChoiceMode = 'forced'; await forced.save()
  assert.equal((await renderPairedModelComparison(forced)).status, 'comparable')
})

async function selectDrawingTool(f, tool, mode = 'forced') {
  f.report.drawingTool = tool; f.report.toolChoiceMode = mode
  for (const run of f.report.runs.filter(run => run.arm === 'kjdraw-tool')) {
    const path = join(f.input, run.files.request), request = JSON.parse(await readFile(path, 'utf8'))
    request.tools[0].function.name = tool
    request.tool_choice = mode === 'auto' ? 'auto' : { type: 'function', function: { name: tool } }
    const text = JSON.stringify(request); await writeFile(path, text); run.requestSha256 = hash(text); run.requestBytes = Buffer.byteLength(text)
  }
  await f.save()
}

test('compact drawing tool is explicitly verified and labeled for forced and auto modes', async t => {
  for (const mode of ['forced', 'auto']) {
    const f = await fixture(t); await selectDrawingTool(f, 'cad_propose_drawing_compact', mode)
    const result = await renderPairedModelComparison(f)
    assert.equal(result.status, 'comparable'); assert.equal(result.drawingTool, 'cad_propose_drawing_compact'); assert.equal(result.toolChoiceMode, mode)
    assert.match(await readFile(join(f.output, 'tokens.svg'), 'utf8'), /Tool: cad_propose_drawing_compact/)
  }
  const legacy = await fixture(t)
  assert.equal((await renderPairedModelComparison(legacy)).drawingTool, 'cad_propose_drawing')
})

test('drawing tool must be allowlisted and agree with the actual schema and forced choice', async t => {
  const unknown = await fixture(t); unknown.report.drawingTool = 'cad_approve'; await unknown.save()
  assert.ok((await renderPairedModelComparison(unknown)).reasons.includes('INVALID_DRAWING_TOOL'))
  const mismatch = await fixture(t); mismatch.report.drawingTool = 'cad_propose_drawing_compact'; await mismatch.save()
  assert.ok((await renderPairedModelComparison(mismatch)).reasons.includes('REQUEST_ARM_MISMATCH'))
  const choice = await fixture(t); await selectDrawingTool(choice, 'cad_propose_drawing_compact')
  const run = choice.report.runs[0], path = join(choice.input, run.files.request), request = JSON.parse(await readFile(path, 'utf8'))
  request.tool_choice.function.name = 'cad_propose_drawing'
  const text = JSON.stringify(request); await writeFile(path, text); run.requestSha256 = hash(text); run.requestBytes = Buffer.byteLength(text); await choice.save()
  assert.ok((await renderPairedModelComparison(choice)).reasons.includes('REQUEST_ARM_MISMATCH'))
})

async function setOutputLimit(f, limit) {
  f.report.settings.max_tokens = limit
  for (const run of f.report.runs) {
    const path = join(f.input, run.files.request), request = JSON.parse(await readFile(path, 'utf8'))
    request.max_tokens = limit
    const text = JSON.stringify(request); await writeFile(path, text); run.requestSha256 = hash(text); run.requestBytes = Buffer.byteLength(text)
  }
  await f.save()
}

test('parametric suite requires its source hash, supports pattern tools and labels geometry scope on every chart', async t => {
  const f = await fixture(t); await selectDrawingTool(f, 'cad_propose_drawing_pattern', 'auto')
  f.report.taskSuite = 'parametric'; f.report.source['parametric-drawing-tasks.mjs'] = hash('SYNTHETIC TASK GENERATOR FOR TEST ONLY')
  await setOutputLimit(f, 32768)
  const result = await renderPairedModelComparison(f)
  assert.equal(result.status, 'comparable'); assert.equal(result.taskSuite, 'parametric'); assert.equal(result.drawingTool, 'cad_propose_drawing_pattern')
  assert.equal(result.settings.max_tokens, 32768)
  assert.match(result.scope, /no annotations, complete drawings or autonomous design/)
  for (const name of result.charts) {
    const svg = await readFile(join(f.output, name), 'utf8')
    assert.match(svg, /Parametric: 3 specified repeat-pattern geometry tasks/)
    assert.match(svg, /no annotations, complete drawings or autonomous design/)
    assert.match(svg, /max_tokens=32768/)
  }
  const legacy = await fixture(t)
  assert.equal((await renderPairedModelComparison(legacy)).taskSuite, 'pilot')
})

test('unknown suites, missing parametric source and unsupported output budgets are not comparable', async t => {
  for (const [suite, expectedReason] of [['unknown', 'INVALID_TASK_SUITE'], ['parametric', 'PARAMETRIC_SOURCE_HASH_MISSING']]) {
    const f = await fixture(t); f.report.taskSuite = suite; await f.save()
    assert.ok((await renderPairedModelComparison(f)).reasons.includes(expectedReason))
  }
  for (const limit of [4095, 32769, '4096']) {
    const f = await fixture(t); await setOutputLimit(f, limit)
    assert.ok((await renderPairedModelComparison(f)).reasons.includes('INVALID_SETTINGS'))
  }
})


test('explicit exploratory results are never charted even if their sample count reaches the full benchmark threshold', async t => {
  const f = await fixture(t); f.report.exploratory = true; await f.save()
  const result = await renderPairedModelComparison(f)
  assert.equal(result.status, 'not-comparable')
  assert.ok(result.reasons.includes('EXPLORATORY_NOT_PUBLIC_EVIDENCE'))
  assert.deepEqual(result.charts, [])
  assert.deepEqual(await readdir(f.output), ['comparison.json'])
})
