import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { captureLiveReadmeConfiguration, liveReadmeCapturePlan, runLiveReadmeWorkflow } from '../../../scripts/capture-live-readme-workflow.mjs'
import { manufacturingSheetInput } from '../../../scripts/benchmarks/manufacturing-drawing-tasks.mjs'

const root = resolve(import.meta.dirname, '../../..')
const chrome = process.env.KJDRAW_CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const python = process.env.KJDRAW_PYTHON ?? (existsSync('D:/anaconda/python.exe') ? 'D:/anaconda/python.exe' : 'python')
const mediaPython = process.env.KJDRAW_MEDIA_PYTHON ?? (existsSync('D:/anaconda/python.exe') ? 'D:/anaconda/python.exe' : python)

test('live README capture CLI validates a dry-run without accepting credentials or touching output', () => {
  const output = resolve(root, '.cache/live-readme-test-plan/missing')
  const config = captureLiveReadmeConfiguration(['--dry-run', '--live', '--base-url=http://127.0.0.1:4173', '--model=test-model', `--output=${output}`])
  const plan = liveReadmeCapturePlan(config)
  assert.equal(plan.mode, 'live'); assert.equal(plan.networkRequests, 2); assert.equal(plan.output, output)
  assert.equal(existsSync(output), false)
  assert.throws(() => captureLiveReadmeConfiguration(['--live', '--base-url=http://127.0.0.1:4173', '--model=x', '--output=x', '--api-key=must-not-be-accepted']), /Unknown option --api-key/)
  assert.throws(() => captureLiveReadmeConfiguration(['--live', '--fixture', '--base-url=http://127.0.0.1:4173', '--model=x', '--output=x']), /exactly one/)
  assert.throws(() => captureLiveReadmeConfiguration(['--live', '--base-url=https://provider.example/model', '--model=x', '--output=x']), /loopback/)
})

test('fixture transport records the complete two-turn Chromium workflow but is barred from public evidence', { skip: process.env.KJDRAW_CAPTURE_BROWSER_TEST !== 'true', timeout: 240000 }, async t => {
  const output = resolve(root, `.cache/live-readme-fixture-${process.pid}-${Date.now()}`)
  t.after(async () => { await rm(output, { recursive: true, force: true }) })
  let requestCount = 0
  const upstream = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); requestCount++
    let name, args
    if (requestCount === 1) { name = 'cad_propose_manufacturing_sheet'; args = manufacturingSheetInput(0) }
    else {
      name = 'cad_propose_move'
      const selected = JSON.stringify(body).match(/mfg-[a-f0-9]+-\d{4}/)?.[0]
      assert.ok(selected, 'second model request must contain the selected native object ID')
      args = { expectedRevision: 1, units: 'millimeter', ids: [selected], dx: 5, dy: 0 }
    }
    const json = {
      model: 'fixture-returned-model',
      usage: { prompt_tokens: 100 + requestCount, completion_tokens: 20, total_tokens: 120 + requestCount, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 90 + requestCount },
      choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: `fixture-${requestCount}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(json))
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  t.after(() => new Promise(resolveClose => upstream.close(resolveClose)))
  const upstreamURL = `http://127.0.0.1:${upstream.address().port}/model`
  const server = spawn(process.execPath, ['scripts/serve.mjs'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', KJDRAW_MODEL_PROTOCOL: 'chat-completions', KJDRAW_MODEL_NAME: 'fixture-requested-model', KJDRAW_MODEL_ENDPOINT: upstreamURL, KJDRAW_MODEL_MAX_OUTPUT_TOKENS: '8192' },
  })
  let stderr = ''; server.stderr.on('data', chunk => { stderr += chunk })
  const baseURL = await new Promise((resolveURL, reject) => {
    let stdout = ''
    const timer = setTimeout(() => reject(new Error(`Server startup timeout: ${stderr}`)), 30000)
    server.stdout.on('data', chunk => {
      stdout += chunk
      const match = stdout.match(/http:\/\/localhost:(\d+)/)
      if (match) { clearTimeout(timer); resolveURL(`http://127.0.0.1:${match[1]}/`) }
    })
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)) })
  })
  t.after(async () => { if (server.exitCode === null) { server.kill(); await once(server, 'exit').catch(() => {}) } })

  const config = captureLiveReadmeConfiguration(['--fixture', `--base-url=${baseURL}`, '--model=fixture-requested-model', `--output=${output}`, `--python=${python}`, `--media-python=${mediaPython}`, `--chrome=${chrome}`, '--timeout-ms=180000'])
  const evidence = await runLiveReadmeWorkflow(config)
  assert.equal(requestCount, 2); assert.equal(evidence.status, 'passed'); assert.equal(evidence.mode, 'fixture')
  assert.equal(evidence.publishableModelEvidence, false); assert.match(evidence.fixtureWarning, /must never be used in public claims/)
  assert.deepEqual(evidence.geometry.modification.changedEntityIds, [evidence.geometry.modification.target.id])
  assert.deepEqual(evidence.geometry.modification.target.delta, [5, 0, 0])
  assert.equal(evidence.geometry.independentValidation.passed, true)
  assert.equal(evidence.reopen.method, 'playground-file-input')
  for (const name of ['workflow.kjp', 'workflow.dxf', 'validator.json', 'provider-calls.json', 'workflow.webm', 'workflow.gif']) {
    const bytes = await readFile(join(output, name)); assert.equal(evidence.artifacts[name].sha256.length, 64); assert.equal(evidence.artifacts[name].bytes, bytes.length)
  }
  const disk = JSON.parse(await readFile(join(output, 'evidence.json'), 'utf8'))
  assert.equal(JSON.stringify(disk).includes('API_KEY'), false); assert.equal(JSON.stringify(disk).includes('fixture-secret'), false)
  assert.equal(disk.calls[0].toolCalls[0].name, 'cad_propose_manufacturing_sheet')
  assert.equal(disk.calls[0].toolCalls[0].arguments.textHeight, 3)
  assert.equal(disk.sources['scripts/capture-live-readme-workflow.mjs'].length, 64)
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
  assert.ok(manifest.frames.length > 5)
  assert.ok(manifest.frames.every(frame => !frame.path.includes(':') && !frame.path.startsWith('/')))
  await mkdir(join(output, 'already-exists'))
  await assert.rejects(runLiveReadmeWorkflow({ ...config, output: join(output, 'already-exists') }), /EEXIST/)
})
