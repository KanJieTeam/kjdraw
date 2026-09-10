import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pairedModelPlan, liveModelConfiguration, independentValidation, runPairedModelBenchmark, safeResponse } from '../../../scripts/benchmarks/paired-model-benchmark.mjs'
import { pilotTasks } from '../../../scripts/benchmarks/model-drawing-pilot.mjs'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'

const fixtureKey = 'fixture-credential-never-artifact'
const python = process.env.KJDRAW_PYTHON ?? 'python'
const baseOptions = { mode: 'fixture', protocol: 'chat-completions', model: 'fixture-model', apiKey: fixtureKey, repetitions: 5, maxRequests: 30, python }
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
async function directory(t) { const folder = await mkdtemp(join(tmpdir(), 'kjdraw-paired-model-')); t.after(() => rm(folder, { recursive: true, force: true })); return folder }
function requireValidator(t) {
  try { independentValidation({ python }); return true } catch {
    if (process.env.KJDRAW_BENCH_INTEGRATION_REQUIRED === '1') assert.fail('Explicit integration run requires Python with ezdxf; configure KJDRAW_PYTHON/PYTHONPATH')
    t.skip('Independent ezdxf validator unavailable; set KJDRAW_PYTHON and install the pinned audits requirements to run this HTTP/SDK/validator integration test')
    return false
  }
}
async function server(t, handler) {
  const value = createServer(handler)
  const endpoint = await new Promise(resolve => value.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${value.address().port}/chat/completions`)))
  t.after(() => close(value))
  return endpoint
}
async function fixtureDxf(task) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' }), session = new KJAgentToolSession(sdk, document)
  const proposal = await session.call('cad_propose_drawing', task.expected)
  assert.equal(proposal.ok, true)
  assert.equal((await session.approve(proposal.value.planId, 'synthetic-http-fixture')).ok, true)
  return sdk.writeDocument(document, { format: 'DXF', version: '2018' })
}

test('paired live plan defaults to no network and refuses incomplete budgets or implicit provider configuration', async t => {
  const plan = pairedModelPlan()
  assert.equal(plan.mode, 'dry-run'); assert.equal(plan.actualRequests, 0); assert.equal(plan.plannedRequests, 30)
  assert.throws(() => pairedModelPlan({ repetitions: 4, maxRequests: 30 }))
  assert.throws(() => pairedModelPlan({ repetitions: 5, maxRequests: 29 }))
  assert.throws(() => liveModelConfiguration({}), /Set explicit/)
  const folder = await directory(t)
  for (const config of [
    { ...baseOptions, mode: 'live', endpoint: 'http://127.0.0.1:9999/chat' },
    { ...baseOptions, mode: 'live', endpoint: 'https://localhost/chat' },
    { ...baseOptions, endpoint: 'https://provider.example/chat' },
    { ...baseOptions, endpoint: 'http://127.0.0.1:9999/chat?key=bad' },
    { ...baseOptions, endpoint: 'http://127.0.0.1:9999/chat', protocol: 'responses' },
  ]) await assert.rejects(runPairedModelBenchmark({ ...config, output: join(folder, 'never-started') }))
  assert.equal((await readdir(folder)).length, 0)
})

test('missing independent validator produces a setup failure report and makes no provider request', async t => {
  const folder = await directory(t)
  let requests = 0
  const endpoint = await server(t, (req, res) => { requests++; req.resume(); res.end('{}') })
  const report = await runPairedModelBenchmark({ ...baseOptions, endpoint, python: 'kjdraw-nonexistent-validator-runtime', output: join(folder, 'setup-failed') })
  assert.equal(report.status, 'setup-failed')
  assert.equal(report.attemptedRequests, 0)
  assert.equal(report.unexecutedRequests, 30)
  assert.equal(requests, 0)
})

test('fixture paired run uses real HTTP, SDK materialization and independent ezdxf validation for all 30 requests', async t => {
  if (!requireValidator(t)) return
  const folder = await directory(t), dxfs = new Map()
  for (const task of pilotTasks) dxfs.set(task.id, await fixtureDxf(task))
  const requests = []
  const endpoint = await server(t, async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${fixtureKey}`)
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const task = pilotTasks.find(task => body.messages[1].content.endsWith(task.prompt))
    assert.ok(task)
    requests.push({ task: task.id, body })
    const tool = Boolean(body.tools)
    const message = tool ? { role: 'assistant', content: null, tool_calls: [{ id: 'fixture-call', type: 'function', function: { name: 'cad_propose_drawing', arguments: JSON.stringify(task.expected) } }] } : { role: 'assistant', content: dxfs.get(task.id) }
    message.reasoning_content = 'PRIVATE_REASONING_MUST_NOT_BE_SAVED'
    const usage = { prompt_tokens: requests.length === 2 ? 'invalid' : 100, completion_tokens: 200, total_tokens: 300, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 50 } }
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Private-Debug': fixtureKey }).end(JSON.stringify({ model: 'fixture-model', usage, choices: [{ finish_reason: tool ? 'tool_calls' : 'stop', message }] }))
  })
  const output = join(folder, 'fixture-only')
  const report = await runPairedModelBenchmark({ ...baseOptions, endpoint, output })
  assert.equal(report.mode, 'fixture')
  assert.equal(report.publishableModelEvidence, false)
  assert.match(report.fixtureWarning, /Never use/)
  assert.equal(report.status, 'complete')
  assert.equal(report.attemptedRequests, 30); assert.equal(report.unexecutedRequests, 0)
  assert.equal(report.runs.filter(run => run.validation.passed).length, 30)
  assert.equal(report.validator.validator, 'ezdxf')
  assert.match(report.source.sdkRuntimeSha256, /^[a-f0-9]{64}$/)
  assert.equal(report.consistentReturnedModel, true)
  assert.equal(report.runs[0].usage.inputTokens, 100)
  assert.equal(report.runs[0].usage.cacheReadInputTokens, 20)
  assert.equal(report.runs[0].usage.reasoningOutputTokens, 50)
  assert.equal(report.runs[1].usage.inputTokens, null)
  assert.ok(report.runs[1].usage.invalidFields.includes('usage.prompt_tokens'))
  assert.equal(report.summary['direct-dxf'].inputTokens, null)
  for (const item of requests) { assert.equal(item.body.model, 'fixture-model'); assert.equal(item.body.temperature, 0); assert.equal(item.body.max_tokens, 4096); assert.equal(item.body.stream, false) }
  assert.equal(Boolean(requests[0].body.tools), true)
  assert.equal(Boolean(requests[2].body.tools), false)
  assert.equal(Boolean(requests[6].body.tools), false)
  for (const file of await readdir(output)) {
    const content = await readFile(join(output, file), 'utf8')
    assert.ok(!content.includes(fixtureKey), file)
    assert.ok(!content.includes('PRIVATE_REASONING_MUST_NOT_BE_SAVED'), file)
    assert.ok(!content.includes('X-Private-Debug'), file)
  }
  assert.equal(report.runs.every(run => run.cost === null && Number.isFinite(run.transportLatencyMs) && run.totalMs >= run.transportLatencyMs), true)
})

test('provider HTTP failures and redirects stop immediately and retain all unexecuted requests', async t => {
  if (!requireValidator(t)) return
  const folder = await directory(t)
  for (const status of [401, 503, 302]) {
    let requests = 0
    const output = join(folder, `failure-${status}`)
    const endpoint = await server(t, async (req, res) => {
      requests++; req.resume()
      const inflight = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'))
      assert.equal(inflight.attemptedRequests, 1)
      assert.equal(inflight.runs[0].status, 'requesting')
      res.writeHead(status, { 'Content-Type': 'application/json', ...(status === 302 ? { Location: '/must-not-follow' } : {}) }).end(JSON.stringify({ error: fixtureKey }))
    })
    const report = await runPairedModelBenchmark({ ...baseOptions, endpoint, output })
    assert.equal(report.status, 'stopped')
    assert.equal(report.attemptedRequests, 1); assert.equal(report.unexecutedRequests, 29)
    assert.equal(requests, 1)
    assert.equal(report.runs[0].validation.passed, false)
    assert.equal(report.runs[0].usage, null)
    assert.ok(!(await readFile(join(output, 'report.json'), 'utf8')).includes(fixtureKey))
  }
})

test('provider timeout aborts the HTTP request without retrying or spending the remaining budget', async t => {
  if (!requireValidator(t)) return
  const folder = await directory(t)
  let requests = 0, disconnected
  const closed = new Promise(resolve => { disconnected = resolve })
  const endpoint = await server(t, (req, res) => { requests++; req.resume(); res.on('close', disconnected) })
  const report = await runPairedModelBenchmark({ ...baseOptions, endpoint, timeoutMs: 100, output: join(folder, 'timeout') })
  assert.equal(report.status, 'stopped')
  assert.equal(report.stopReason, 'PROVIDER_TIMEOUT')
  assert.equal(requests, 1)
  await closed
})

test('strict paired validator rejects non-XY, OCS, width, thickness, old-version and extra geometry counterexamples', async t => {
  if (!requireValidator(t)) return
  const task = pilotTasks[0], original = await fixtureDxf(task)
  assert.equal(independentValidation({ python, dxf: original, expected: task.expected }).passed, true)
  const script = `import io,json,sys,ezdxf
source=sys.stdin.read()
outputs={}
for variant in ['line-z','circle-normal','arc-z','poly-elevation','poly-width','vertex-width','thickness','old-version','extra-entity','paper-entity']:
 doc=ezdxf.read(io.StringIO(source)); m=doc.modelspace()
 if variant=='line-z':
  e=list(m.query('LINE'))[0]; e.dxf.start=(e.dxf.start.x,e.dxf.start.y,100)
 elif variant=='circle-normal': list(m.query('CIRCLE'))[0].dxf.extrusion=(0,1,0)
 elif variant=='arc-z':
  e=list(m.query('ARC'))[0]; e.dxf.center=(e.dxf.center.x,e.dxf.center.y,100)
 elif variant=='poly-elevation': list(m.query('LWPOLYLINE'))[0].dxf.elevation=100
 elif variant=='poly-width': list(m.query('LWPOLYLINE'))[0].dxf.const_width=20
 elif variant=='vertex-width':
  e=list(m.query('LWPOLYLINE'))[0]; p=list(e.get_points('xyseb')); p[0]=(p[0][0],p[0][1],20,20,p[0][4]); e.set_points(p,format='xyseb')
 elif variant=='thickness': list(m.query('CIRCLE'))[0].dxf.thickness=20
 elif variant=='old-version': doc.dxfversion='AC1015'
 elif variant=='extra-entity': m.add_point((1,2,0))
 elif variant=='paper-entity': doc.layout().add_line((0,0),(1,1))
 output=io.StringIO(); doc.write(output); outputs[variant]=output.getvalue()
print(json.dumps(outputs))`
  const generated = spawnSync(python, ['-B', '-c', script], { input: original, encoding: 'utf8', timeout: 30000, maxBuffer: 4194304, windowsHide: true })
  assert.equal(generated.status, 0, 'Independent negative-fixture generation must succeed')
  const variants = JSON.parse(generated.stdout)
  for (const [name, dxf] of Object.entries(variants)) {
    const checked = independentValidation({ python, dxf, expected: task.expected })
    assert.equal(checked.passed, false, name)
    assert.match(checked.reason, /^CONTRACT_/, name)
  }
})

test('safe final-response filtering preserves refusal decisions and blocks raw or escaped credential reflection in every retained string', () => {
  const key = 'fixture-"quoted\\credential'
  const response = () => ({ model: 'fixture-model', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call', type: 'function', function: { name: 'cad_propose_drawing', arguments: '{}' } }] } }] })
  const refusal = response(); refusal.choices[0].message.refusal = 'DO_NOT_RETAIN_REFUSAL_TEXT'
  assert.throws(() => safeResponse(refusal, { inputTokens: 10 }, key), error => error.code === 'MODEL_REFUSED' && !error.message.includes('DO_NOT_RETAIN'))
  const targets = [value => [value, 'model'], value => [value.choices[0], 'finish_reason'], value => [value.choices[0].message, 'content'], value => [value.choices[0].message.tool_calls[0], 'id'], value => [value.choices[0].message.tool_calls[0].function, 'name'], value => [value.choices[0].message.tool_calls[0].function, 'arguments']]
  for (const reflected of [key, JSON.stringify(key).slice(1, -1)]) for (const target of targets) {
    const value = response(), [object, property] = target(value)
    object[property] = `prefix ${reflected} suffix`
    assert.throws(() => safeResponse(value, {}, key), error => error.code === 'PROVIDER_REFLECTED_CREDENTIAL' && error.stop === true)
  }
})

test('thinking configuration is identical in both HTTP arms and refused tool output retains usage without saving refusal text', async t => {
  if (!requireValidator(t)) return
  const env = { KJDRAW_BENCH_PROTOCOL: 'chat-completions', KJDRAW_BENCH_MODEL: 'fixture-model', KJDRAW_BENCH_ENDPOINT: 'https://provider.example/chat', KJDRAW_BENCH_API_KEY: fixtureKey, KJDRAW_BENCH_THINKING: 'disabled' }
  assert.equal(liveModelConfiguration(env).thinkingMode, 'disabled')
  assert.equal(liveModelConfiguration({ ...env, KJDRAW_BENCH_THINKING: 'enabled' }).thinkingMode, 'enabled')
  assert.throws(() => liveModelConfiguration({ ...env, KJDRAW_BENCH_THINKING: 'arbitrary' }))
  const folder = await directory(t), requests = []
  const endpoint = await server(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    if (requests.length === 2) { res.writeHead(503).end(); return }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ model: 'fixture-model', usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80, completion_tokens_details: { reasoning_tokens: 40 } }, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, refusal: 'DO_NOT_RETAIN_REFUSAL_TEXT', tool_calls: [{ id: 'call', type: 'function', function: { name: 'cad_propose_drawing', arguments: JSON.stringify(pilotTasks[0].expected) } }] } }] }))
  })
  const output = join(folder, 'refusal')
  const report = await runPairedModelBenchmark({ ...baseOptions, endpoint, output, thinkingMode: 'disabled' })
  assert.equal(requests.length, 2)
  for (const body of requests) assert.deepEqual(body.thinking, { type: 'disabled' })
  assert.deepEqual(report.settings.thinking, { type: 'disabled' })
  assert.equal(report.runs[0].failure, 'MODEL_REFUSED')
  assert.equal(report.runs[0].validation.passed, false)
  assert.equal(report.runs[0].usage.inputTokens, 100)
  assert.equal(report.summary['kjdraw-tool'].cacheMissInputTokens, 80)
  assert.equal(report.summary['kjdraw-tool'].reasoningOutputTokens, 40)
  assert.equal(report.runs[0].files.response, undefined)
  assert.equal(report.runs[0].files.dxf, undefined)
  for (const file of await readdir(output)) assert.ok(!(await readFile(join(output, file), 'utf8')).includes('DO_NOT_RETAIN_REFUSAL_TEXT'), file)
})
