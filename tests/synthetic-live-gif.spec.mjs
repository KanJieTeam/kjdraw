import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeSyntheticLiveGif, parseSyntheticGifOptions, planSyntheticGifCuts, validateSyntheticGifManifest } from '../scripts/encode-synthetic-live-gif.mjs'

// Manifest-only protocol tests: no model/video/image mocks and no fake frames.
const rounds = ['collar', 'depth', 'stable-water', 'boundary', 'lithology-pattern', 'sample-add', 'spt-update', 'sample-remove', 'station', 'water-unknown']
function fixture() {
  const provenance = { synthetic: true, measuredData: false, source: 'original-public-synthetic-facts', license: 'Apache-2.0' }
  const prepared = { ...provenance, modelInvocations: 0, patterns: 'bundled-original-redistributable-geology-patterns',
    evidenceScope: 'deterministic-CAD-workflow-with-host-review', holeCount: 8, stratumCount: 48 }
  const names = ['live-synthetic-baseline', ...rounds.flatMap(round => [`${round}-actual-model-review`, `${round}-actual-approved`]),
    'live-native-undo', 'live-native-redo', 'live-actual-dxf-reopened']
  const manifest = { ...provenance, schema: 'com.kanjie.kjdraw.synthetic-live-capture@1', status: 'passed', publishableModelEvidence: true,
    publicationReviewRequired: true, viewerErrorObservations: [], provider: 'deepseek', providerEndpoint: 'https://api.deepseek.com/chat/completions',
    receiptCapture: 'bounded-tee-of-actual-DeepSeek-HTTPS-response-not-CDP-body', initialCreation: 'trusted-host-compiler-not-model-creation',
    initialImportFormat: 'KJD', sameDrawingSequentialRounds: true, approval: 'actual-automated-reviewer-harness-not-human-review',
    phases: ['source-backed-synthetic-KJD-domain-revisions', 'export-and-reopen-DXF-graphics-only-no-source-recipe'],
    scope: 'source-backed synthetic drawing; arbitrary imported DXF source-fact regeneration is not claimed',
    video: 'synthetic-live-model-workflow.webm',
    captureTiming: 'elapsed milliseconds since recorded browser context became ready; screenshot-request offsets, not synthetic frames',
    modelInvocations: 10, verifiedModelReceipts: 10, providerResponsesObserved: 10, responseFailures: [],
    calls: rounds.map((round, sequence) => ({ sequence, round, httpStatus: 200, streamed: true, model: 'actual-reported-model', finishReason: 'tool_calls',
      usage: { protocol: 'chat-completions', inputTokens: 100, outputTokens: 20, totalTokens: 120, invalidFields: [],
        inputTokensSource: 'reported', outputTokensSource: 'reported', totalTokensSource: 'reported',
        reportedInputTokens: 100, reportedOutputTokens: 20, reportedTotalTokens: 120 } })),
    totals: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
    browserResponses: rounds.map(round => ({ round, httpStatus: 200, contentType: 'text/event-stream; charset=utf-8', streamRequested: true })),
    outcomes: rounds.map((round, index) => ({ round, status: 'passed', beforeRevision: 2 + index, afterRevision: 3 + index,
      sourceFactsExact: true, unrequestedFactsExact: true, unchangedObjectsExact: true, targetGeometryMatchesIndependentCompiler: true,
      approval: 'actual-automated-reviewer-harness', planId: `public-plan-${index}`, modelRequests: 1,
      actualProposalReceipt: { planId: `public-plan-${index}`, command: 'GEOLOGY_DRAWING_UPDATE', expectedRevision: 2 + index,
        engineeringEvidence: { afterSource: { facts: {} } } } })),
    final: { actualNativeUndoRedo: true, actualBrowserDxfReopen: true, sourceRecipePreservedInKjd: true, dxfCarriesGraphicsNotRecipe: true },
    captures: names.map((name, index) => ({ file: `${String(index + 1).padStart(2, '0')}-${name}.png`, elapsedMs: 2000 + index * 2000 })) }
  return { manifest, prepared }
}

test('plan only real source timestamps, preserve inputs and declare 24 one-second cuts without interpolation', () => {
  const { manifest, prepared } = fixture(), before = structuredClone(manifest)
  const cuts = planSyntheticGifCuts(manifest, prepared, { videoOffsetMs: -100 })
  assert.equal(cuts.length, 24); assert.equal(cuts.reduce((sum, cut) => sum + cut.playbackDurationMs, 0), 24000)
  assert.equal(cuts[0].sourceStartMs, 1900)
  assert.deepEqual(cuts[0].frames.map(frame => frame.sourceTimestampMs), [1900, 2150, 2400, 2650])
  assert.ok(cuts.every(cut => cut.frames.length === 4 && cut.frames.every(frame => frame.durationMs === 250)))
  assert.deepEqual(manifest, before)
})

for (const [label, mutate] of [
  ['missing manifest', f => { f.manifest = null }],
  ['failed', f => { f.manifest.status = 'failed' }],
  ['still running', f => { f.manifest.status = 'running' }],
  ['not publishable', f => { f.manifest.publishableModelEvidence = false }],
  ['failure even with passed label', f => { f.manifest.failure = {} }],
  ['missing viewer observations', f => { delete f.manifest.viewerErrorObservations }],
  ['null viewer observations', f => { f.manifest.viewerErrorObservations = null }],
  ['transient unavailable preview', f => { f.manifest.viewerErrorObservations = [{ timeMs: 1, mode: 'proposal' }] }],
  ['measured/private source', f => { f.manifest.measuredData = true }],
  ['non-synthetic', f => { f.manifest.synthetic = false }],
  ['unknown source', f => { f.manifest.source = 'uploaded-private-drawing' }],
  ['private files read', f => { f.manifest.noPrivateFilesRead = false }],
  ['private prepared source', f => { f.prepared.source = 'private-case' }],
  ['model-created baseline claim', f => { f.manifest.initialCreation = 'AI-generated' }],
  ['human acceptance claim', f => { f.manifest.approval = 'human-accepted' }],
  ['wrong DXF/source scope', f => { f.manifest.scope = 'arbitrary-DXF-rebuilt' }],
  ['only nine rounds', f => { f.manifest.outcomes.pop() }],
  ['out-of-order rounds', f => { f.manifest.outcomes.reverse() }],
  ['broken revision chain', f => { f.manifest.outcomes[5].beforeRevision++ }],
  ['failed unchanged-facts oracle', f => { f.manifest.outcomes[4].unrequestedFactsExact = false }],
  ['failed response', f => { f.manifest.responseFailures.push({}) }],
  ['missing actual browser SSE', f => { f.manifest.browserResponses[1].streamRequested = false }],
  ['unverified receipt', f => { f.manifest.verifiedModelReceipts-- }],
  ['truncated actual response', f => { f.manifest.calls[0].finishReason = 'length' }],
  ['missing provider usage', f => { delete f.manifest.calls[0].usage }],
  ['unreported usage must not become zero', f => { f.manifest.calls[0].usage.inputTokens = null }],
  ['zero output usage', f => { f.manifest.calls[0].usage.outputTokens = 0 }],
  ['invalid provider usage', f => { f.manifest.calls[0].usage.invalidFields.push('inputTokens') }],
  ['estimated rather than reported usage', f => { f.manifest.calls[0].usage.inputTokensSource = 'estimated' }],
  ['raw reported value mismatch', f => { f.manifest.calls[0].usage.reportedInputTokens++ }],
  ['unclosed provider totals', f => { f.manifest.calls[0].usage.totalTokens++; f.manifest.calls[0].usage.reportedTotalTokens++ }],
  ['missing aggregate totals', f => { delete f.manifest.totals }],
  ['aggregate excludes repair costs', f => { f.manifest.totals.inputTokens -= 100 }],
  ['uncommitted proposal', f => { f.manifest.outcomes[0].actualProposalReceipt.expectedRevision++ }],
  ['missing DXF closure', f => { f.manifest.final.actualBrowserDxfReopen = false }],
  ['capture elapsed decreases', f => { f.manifest.captures[3].elapsedMs = f.manifest.captures[2].elapsedMs - 1 }],
  ['capture elapsed repeats', f => { f.manifest.captures[3].elapsedMs = f.manifest.captures[2].elapsedMs }],
  ['nonfinite capture time', f => { f.manifest.captures[0].elapsedMs = NaN }],
  ['negative capture time', f => { f.manifest.captures[0].elapsedMs = -1 }],
  ['video traversal', f => { f.manifest.video = '../private.webm' }],
  ['capture traversal', f => { f.manifest.captures[0].file = '../private.png' }],
  ['missing real capture', f => { f.manifest.captures.pop() }],
]) test(`manifest fails closed before frame extraction: ${label}`, () => {
  const f = fixture(); mutate(f)
  assert.throws(() => validateSyntheticGifManifest(f.manifest, f.prepared), /LIVE_GIF_REJECTED/)
})

test('bounded timing controls reject invalid frame rate, duration and calibrated timestamps', () => {
  const { manifest, prepared } = fixture()
  for (const options of [{ fps: 3 }, { fps: 7 }, { fps: 4.5 }, { durationSeconds: 23 }, { durationSeconds: 31 },
    { videoOffsetMs: NaN }, { videoOffsetMs: 5001 }, { videoOffsetMs: -3000 }])
    assert.throws(() => planSyntheticGifCuts(manifest, prepared, options), /LIVE_GIF_REJECTED/)
  const cuts = planSyntheticGifCuts(manifest, prepared, { fps: 6, durationSeconds: 30 })
  assert.ok(Math.abs(cuts.reduce((sum, cut) => sum + cut.playbackDurationMs, 0) - 30000) < 0.001)
})

test('successful receipts include every repair call and must not hide that cost from the aggregate', () => {
  const { manifest, prepared } = fixture(), repair = structuredClone(manifest.calls[0])
  manifest.calls.splice(1, 0, repair); manifest.browserResponses.splice(1, 0, structuredClone(manifest.browserResponses[0]))
  manifest.calls.forEach((call, index) => { call.sequence = index })
  manifest.modelInvocations++; manifest.verifiedModelReceipts++; manifest.providerResponsesObserved++
  manifest.outcomes[0].modelRequests++; manifest.outcomes[0].proposalAttempts = { failed: 1, successful: 1 }
  assert.throws(() => validateSyntheticGifManifest(manifest, prepared), /never omit repair costs/)
  for (const field of ['inputTokens', 'outputTokens', 'totalTokens']) manifest.totals[field] += repair.usage[field]
  assert.equal(validateSyntheticGifManifest(manifest, prepared).length, 24)
})

test('CLI permits explicit existing tools but rejects unknown, duplicate and missing options', () => {
  const options = parseSyntheticGifOptions(['--manifest', '.cache/public/live-recording-manifest.json', '--output', '.cache/public-gif',
    '--ffmpeg', 'existing-ffmpeg.exe', '--python', 'existing-python.exe', '--video-offset-ms', '-125'])
  assert.equal(options.ffmpeg, 'existing-ffmpeg.exe'); assert.equal(options.python, 'existing-python.exe')
  assert.equal(options.videoOffsetMs, -125); assert.equal(options.videoOffsetExplicit, true)
  for (const args of [[], ['--manifest'], ['--private-source', 'file'], ['--manifest', 'a', '--manifest', 'b'],
    ['manifest', 'a'], ['--manifest', 'a', '--output', 'b', '--width', '999']])
    assert.throws(() => parseSyntheticGifOptions(args), /LIVE_GIF_REJECTED/)
})

test('failed manifest is rejected before output creation or any external decoder/encoder invocation', async () => {
  const checkout = fileURLToPath(new URL('../', import.meta.url))
  const temporary = await mkdtemp(resolve(checkout, '.cache/synthetic-gif-invalid-'))
  const { manifest, prepared } = fixture(); manifest.status = 'failed'; manifest.publishableModelEvidence = false
  const live = resolve(temporary, 'live-recording-manifest.json'), baseline = resolve(temporary, 'manifest.json')
  const output = resolve(temporary, 'never-created-output')
  try {
    await writeFile(live, JSON.stringify(manifest)); await writeFile(baseline, JSON.stringify(prepared))
    const original = await readFile(live)
    await assert.rejects(encodeSyntheticLiveGif(['--manifest', live, '--output', output,
      '--ffmpeg', 'forbidden-never-run-decoder', '--python', 'forbidden-never-run-encoder']), /passed\/publishable/)
    assert.equal(existsSync(output), false); assert.deepEqual(await readFile(live), original)
    await assert.rejects(encodeSyntheticLiveGif(['--manifest', live, '--output', 'docs/media/forbidden-output']), /docs\/media/)
  } finally {
    assert.ok(temporary.startsWith(resolve(checkout, '.cache/synthetic-gif-invalid-')))
    await rm(temporary, { recursive: true, force: true })
  }
})
