import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createAiChatRuntime } from '../apps/playground/ai/runtime.js'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { createModelProxy } from './model-proxy.mjs'
import { createBenchmarkProxyAgent } from './benchmarks/token-provider-transport.mjs'
import { teeSyntheticProviderResponse, collectSyntheticProviderResponse } from './record-synthetic-geology-demo.mjs'
import { KJDRAW_GEOLOGY_HATCH_PATTERN_SOURCE } from '../packages/kjdraw-sdk/src/knowledge-packs/geology-patterns.js'
import { createPublicNativeHatchFixture, NATIVE_HATCH_DEMO_PROVENANCE, NATIVE_HATCH_DEMO_ROUNDS,
  assertNativeHatchChange, assertNativeHatchDxf, assertNativeHatchModelReads } from './testing/helpers/native-geology-hatch-demo.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const endpoint = 'https://api.deepseek.com/chat/completions'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export function parseNativeHatchDemoOptions(argv) {
  const options = { live: false, output: `.cache/native-geology-hatch-demo/run-${Date.now()}`, timeoutMs: 180000 }
  const supplied = new Set()
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (supplied.has(flag) || !['--live', '--output', '--timeout-ms'].includes(flag)) throw new Error('NATIVE_HATCH_OPTIONS_INVALID')
    supplied.add(flag)
    if (flag === '--live') options.live = true
    else {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error('NATIVE_HATCH_OPTION_VALUE_REQUIRED')
      if (flag === '--output') options.output = value
      else options.timeoutMs = Number(value)
    }
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 30000 || options.timeoutMs > 300000) throw new Error('NATIVE_HATCH_TIMEOUT_INVALID')
  const output = resolve(root, options.output), local = relative(root, output)
  if (isAbsolute(local) || !local.startsWith(`.cache${sep}`) || local === `.cache${sep}` || local.split(sep).includes('..')) throw new Error('NATIVE_HATCH_OUTPUT_MUST_BE_NEW_IGNORED_CACHE')
  return { ...options, output }
}

function independentAudit(dxf, expected) {
  if (!process.env.KJDRAW_PYTHON) throw new Error('INDEPENDENT_EZDXF_PYTHON_REQUIRED')
  const child = spawnSync(process.env.KJDRAW_PYTHON, [resolve(root, 'scripts/audits/native-geology-hatch-demo.py')], {
    input: JSON.stringify({ synthetic: true, dxf, patSource: KJDRAW_GEOLOGY_HATCH_PATTERN_SOURCE, ...expected }),
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
  })
  if (child.status !== 0) throw new Error('INDEPENDENT_EZDXF_AUDIT_FAILED')
  const result = JSON.parse(child.stdout)
  assert.equal(result.errors, 0); assert.equal(result.fixes, 0)
  return result
}

export function validateNativeHatchDemoCredentials(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('EXISTING_LOCAL_CREDENTIAL_CONFIG_REQUIRED')
  const provider = config.deepseek ?? config
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) throw new Error('EXISTING_LOCAL_CREDENTIAL_CONFIG_REQUIRED')
  const apiKey = provider.apiKey ?? provider.key ?? provider.api_key ?? provider.KJDRAW_DEEPSEEK_API_KEY
  if (typeof apiKey !== 'string' || !apiKey || /[\r\n]/.test(apiKey)) throw new Error('EXISTING_LOCAL_CREDENTIAL_CONFIG_REQUIRED')
  if (!['https://api.deepseek.com', 'https://api.deepseek.com/', endpoint].includes(provider.endpoint ?? endpoint)) throw new Error('FIXED_REAL_DEEPSEEK_ENDPOINT_REQUIRED')
  const model = provider.model
  if (typeof model !== 'string' || !/^deepseek-[a-zA-Z0-9._/-]{1,80}$/.test(model)) throw new Error('EXISTING_REAL_DEEPSEEK_MODEL_REQUIRED')
  const proxy = new URL(config.proxy ?? 'http://127.0.0.1:7890')
  if (proxy.href !== 'http://127.0.0.1:7890/') throw new Error('EXISTING_FIXED_LOCAL_CONNECT_PROXY_REQUIRED')
  return { apiKey, model, proxy }
}

export async function runNativeHatchDemo(argv = process.argv.slice(2)) {
  const options = parseNativeHatchDemoOptions(argv)
  try { await stat(options.output); throw new Error('NATIVE_HATCH_OUTPUT_ALREADY_EXISTS_PRESERVE_PRIOR_EVIDENCE') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const fixture = await createPublicNativeHatchFixture()
  const originalAudit = independentAudit(fixture.dxf, { name: '素填土', scale: 0.5, degrees: 0 })
  await mkdir(options.output, { recursive: true })
  await writeFile(resolve(options.output, 'original-public-native-hatches.dxf'), fixture.dxf)
  const manifest = { ...NATIVE_HATCH_DEMO_PROVENANCE, mode: options.live ? 'real-model' : 'prepare-only',
    status: options.live ? 'running' : 'prepared', publicSyntheticOnly: true,
    runtime: 'unchanged-default-AI-runtime-and-default-SDK-catalog', modelResponsesMocked: false,
    promptIntercepted: false, initialFormat: 'DXF', originalAudit, initialDxfSha256: hash(fixture.dxf),
    outcomes: [], providerReceipts: [], responseFailures: [], totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    modelInvocations: 0, complete: false }
  if (!options.live) {
    await writeFile(resolve(options.output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    return { status: manifest.status, entities: fixture.document.listEntities().length, originalAudit, modelInvocations: 0 }
  }
  if (process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT) throw new Error('REAL_MODEL_REQUIRES_NO_FIXTURE_ENDPOINT')
  // Only --live reads this existing, ignored, user-authorized config. Neither
  // its contents nor its path is copied into published evidence or process args.
  let credentials
  try {
    credentials = validateNativeHatchDemoCredentials(JSON.parse(await readFile(resolve(root, '.cache/private-model-credentials.json'), 'utf8')))
  } catch (error) {
    const known = ['EXISTING_LOCAL_CREDENTIAL_CONFIG_REQUIRED', 'FIXED_REAL_DEEPSEEK_ENDPOINT_REQUIRED',
      'EXISTING_REAL_DEEPSEEK_MODEL_REQUIRED', 'EXISTING_FIXED_LOCAL_CONNECT_PROXY_REQUIRED']
    manifest.status = 'failed'; manifest.failureCode = known.includes(error.message) ? error.message : 'EXISTING_LOCAL_CREDENTIAL_CONFIG_REQUIRED'
    await writeFile(resolve(options.output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    throw new Error(manifest.failureCode)
  }
  const { apiKey, model, proxy } = credentials
  manifest.requestedModel = model
  const nativeFetch = globalThis.fetch, agent = createBenchmarkProxyAgent(proxy)
  const receiptsPending = new Set(), sdk = createKJDrawSDK()
  let server, runtime, origin, activeRound = null, requests = 0
  const safeSave = async () => {
    const json = JSON.stringify(manifest, null, 2)
    assert.ok(!json.includes(apiKey) && !json.includes(JSON.stringify(apiKey).slice(1, -1)), 'Credential must not enter evidence')
    await writeFile(resolve(options.output, 'manifest.json'), json + '\n')
  }
  const upstreamFetch = (url, requestOptions) => new Promise((resolveResponse, rejectResponse) => {
    assert.equal(new URL(url).href, endpoint)
    assert.equal(requestOptions.method, 'POST')
    assert.ok(activeRound && ++requests <= 80, 'Bounded real provider request budget required')
    manifest.modelInvocations++
    console.log(JSON.stringify({ event: 'actual-provider-request', round: activeRound.id, request: manifest.modelInvocations }))
    const roundId = activeRound.id, body = JSON.parse(requestOptions.body)
    assert.equal(body.stream, true, 'Actual default runtime must request streaming')
    body.stream_options = { ...body.stream_options, include_usage: true }
    assert.ok(!JSON.stringify(body).includes(apiKey), 'Key must never enter model context')
    const request = https.request(endpoint, { method: 'POST', agent, headers: requestOptions.headers,
      signal: requestOptions.signal }, response => {
      const actual = new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers })
      resolveResponse(teeSyntheticProviderResponse(actual, evidenceResponse => {
        const capture = collectSyntheticProviderResponse(evidenceResponse, apiKey).then(evidence => {
          const receipt = { round: roundId, requestIndex: manifest.providerReceipts.length,
            httpStatus: response.statusCode, ...evidence }
          manifest.providerReceipts.push(receipt)
          for (const field of ['inputTokens', 'outputTokens', 'totalTokens']) manifest.totals[field] += evidence.usage[field]
        }).catch(error => {
          manifest.responseFailures.push({ round: roundId, code: error.code ?? 'PROVIDER_RECEIPT_INVALID',
            ...(error.evidence ? { evidence: error.evidence } : {}) })
        }).finally(() => receiptsPending.delete(capture))
        receiptsPending.add(capture)
      }))
    })
    request.once('error', () => rejectResponse(new Error('REAL_PROVIDER_TRANSPORT_FAILED')))
    request.end(JSON.stringify(body))
  })
  try {
    globalThis.fetch = (url, requestOptions) => {
      if (new URL(url).href === endpoint) return upstreamFetch(url, requestOptions)
      assert.equal(new URL(url).href, `${origin}/api/model`, 'Only the fixed provider and this local proxy are network targets')
      // Node has no browser origin header. This is real HTTP transport only:
      // bodies/messages/tools and provider responses are not routed or mocked.
      return nativeFetch(url, { ...requestOptions, headers: { ...requestOptions.headers, Origin: origin } })
    }
    const modelProxy = createModelProxy({ protocol: 'chat-completions', model, endpoint, apiKey,
      maxOutputTokens: 16384, maxRequestBytes: 2 * 1024 * 1024, maxResponseBytes: 2 * 1024 * 1024,
      timeoutMs: 120000, chatStreamToolCalls: true })
    server = createServer((request, response) => {
      if (request.url !== '/api/model') { response.writeHead(404).end(); return }
      void modelProxy(request, response)
    })
    await new Promise((resolveListening, rejectListening) => { server.once('error', rejectListening); server.listen(0, '127.0.0.1', resolveListening) })
    origin = `http://127.0.0.1:${server.address().port}`
    runtime = createAiChatRuntime({ endpoint: `${origin}/api/model`, model, provider: 'custom', captureToolOutputs: true })
    await runtime.importDocument(new File([fixture.dxf], 'original-public-native-hatches.dxf'))
    const currentDrawing = async () => sdk.readDocument(await runtime.exportDocument('KJD'), { format: 'KJD' })
    let expectedCurrent = { name: '素填土', scale: 0.5, degrees: 0 }
    for (const round of NATIVE_HATCH_DEMO_ROUNDS) {
      activeRound = round
      const before = await currentDrawing(), beforeFingerprint = before.fingerprint(), receiptStart = manifest.providerReceipts.length
      const outcome = { id: round.id, prompt: round.prompt, status: 'running', requestedAction: round.reject ? 'review-then-discard' : 'review-then-approve' }
      manifest.outcomes.push(outcome); await safeSave()
      console.log(JSON.stringify({ event: 'round-started', round: round.id, modelInvocations: manifest.modelInvocations }))
      const pending = await runtime.send(round.prompt, { signal: AbortSignal.timeout(options.timeoutMs) })
      await Promise.all([...receiptsPending])
      outcome.runtimeStatus = pending.status; outcome.actualToolOutputs = pending.toolOutputs ?? []
      outcome.toolNames = outcome.actualToolOutputs.map(call => call.name)
      outcome.modelRequests = manifest.providerReceipts.length - receiptStart
      assert.equal(pending.status, 'proposal', 'Ordinary real-model request must yield an actual review proposal')
      assert.equal(pending.proposals.length, 1, 'Exactly one pending proposal required')
      assert.equal(pending.proposal.command, 'HATCHPATTERN')
      assert.equal(pending.proposal.preview.before.length, 2); assert.equal(pending.proposal.preview.after.length, 2)
      assert.equal((await currentDrawing()).fingerprint(), beforeFingerprint, 'No change before approval')
      outcome.preApprovalUnchanged = true; outcome.exactOnePending = true
      outcome.modelReadEvidence = assertNativeHatchModelReads(outcome.actualToolOutputs, before)
      if (round.reject) {
        assert.equal(runtime.reject(pending.proposal.planId).status, 'rejected')
        assert.equal((await currentDrawing()).fingerprint(), beforeFingerprint)
        assert.equal((await runtime.approve(pending.proposal.planId)).status, 'error', 'Discarded proposal cannot later commit')
        outcome.status = 'cancelled-without-change'; outcome.cancelledUnchanged = true
      } else {
        assert.equal((await runtime.approve(pending.proposal.planId)).status, 'applied')
        const after = await currentDrawing(), afterFingerprint = after.fingerprint()
        outcome.nativeClosure = assertNativeHatchChange(before, after, round)
        const dxf = await runtime.exportDocument('DXF')
        outcome.dxfClosure = assertNativeHatchDxf(after, await sdk.readDocument(dxf, { format: 'DXF' }))
        outcome.independentAudit = independentAudit(dxf, round)
        outcome.dxfSha256 = hash(dxf)
        await writeFile(resolve(options.output, `${round.id}-actual-approved.dxf`), dxf)
        await writeFile(resolve(options.output, `${round.id}-actual-approved.kjd`), await runtime.exportDocument('KJD'))
        assert.equal((await runtime.applyHistory('undo')).status, 'applied')
        assert.equal((await currentDrawing()).fingerprint(), beforeFingerprint)
        assert.equal((await runtime.applyHistory('redo')).status, 'applied')
        assert.equal((await currentDrawing()).fingerprint(), afterFingerprint)
        outcome.undoRedoExact = true; outcome.status = 'passed'; expectedCurrent = round
      }
      const current = await currentDrawing(), dxf = await runtime.exportDocument('DXF')
      outcome.finalFingerprint = current.fingerprint()
      outcome.finalDxfClosure = assertNativeHatchDxf(current, await sdk.readDocument(dxf, { format: 'DXF' }))
      outcome.finalIndependentAudit = independentAudit(dxf, expectedCurrent)
      assert.equal(manifest.responseFailures.length, 0, 'Every real provider response must have a validated cost receipt')
      await safeSave()
      console.log(JSON.stringify({ event: 'round-completed', round: round.id, status: outcome.status,
        modelRequests: outcome.modelRequests, modelInvocations: manifest.modelInvocations, totals: manifest.totals }))
    }
    activeRound = null
    assert.equal(manifest.modelInvocations, manifest.providerReceipts.length, 'All attempted model requests must be counted')
    assert.equal(manifest.totals.totalTokens, manifest.totals.inputTokens + manifest.totals.outputTokens)
    manifest.actualModels = [...new Set(manifest.providerReceipts.map(receipt => receipt.model))]
    manifest.status = 'passed'; manifest.complete = true
    const finalDxf = await runtime.exportDocument('DXF')
    manifest.finalDxfSha256 = hash(finalDxf)
    await writeFile(resolve(options.output, 'final-public-native-hatches.dxf'), finalDxf)
    await writeFile(resolve(options.output, 'final-public-native-hatches.kjd'), await runtime.exportDocument('KJD'))
    await safeSave()
    return { status: manifest.status, rounds: manifest.outcomes.length, approved: manifest.outcomes.filter(item => item.status === 'passed').length,
      cancelled: manifest.outcomes.filter(item => item.status === 'cancelled-without-change').length,
      requests: manifest.modelInvocations, actualModels: manifest.actualModels, totals: manifest.totals, finalDxfSha256: manifest.finalDxfSha256 }
  } catch (error) {
    await Promise.allSettled([...receiptsPending])
    manifest.status = 'failed'; manifest.failureCode = error.code ?? error.name ?? 'NATIVE_HATCH_VERIFICATION_FAILED'
    manifest.complete = false
    if (activeRound) manifest.failedRound = activeRound.id
    if (error instanceof assert.AssertionError) manifest.failedCheck = error.message.split('\n')[0]
    const failed = manifest.outcomes.find(item => item.id === manifest.failedRound)
    if (failed) failed.status = 'failed'
    await safeSave()
    throw new Error(`NATIVE_HATCH_VERIFICATION_FAILED:${manifest.failedRound ?? 'setup'}:${manifest.failureCode}`)
  } finally {
    runtime?.destroy(); agent.destroy(); globalThis.fetch = nativeFetch
    if (server) { server.closeAllConnections(); await new Promise(resolveClosed => server.close(resolveClosed)) }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNativeHatchDemo().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message); process.exitCode = 1
  })
}
