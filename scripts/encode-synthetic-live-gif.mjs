import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Optional development media tool only. Never calls a provider, creates a CAD
// drawing, synthesizes frames, alters model prose, or writes public docs/media.
const root = fileURLToPath(new URL('../', import.meta.url))
const rounds = ['collar', 'depth', 'stable-water', 'boundary', 'lithology-pattern',
  'sample-add', 'spt-update', 'sample-remove', 'station', 'water-unknown']
const phases = ['source-backed-synthetic-KJD-domain-revisions', 'export-and-reopen-DXF-graphics-only-no-source-recipe']
const maxBytes = 10_000_000
const fail = message => { throw new Error(`LIVE_GIF_REJECTED: ${message}`) }
const check = (condition, message) => { if (!condition) fail(message) }
const sha256 = async path => {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

export function validateSyntheticGifManifest(manifest, prepared) {
  for (const record of [manifest, prepared]) {
    check(record?.synthetic === true && record.measuredData === false &&
      record.source === 'original-public-synthetic-facts' && record.license === 'Apache-2.0',
    'only original public synthetic facts are permitted; private/measured/unknown sources are forbidden')
    check(record.noPrivateFilesRead !== false && record.privateSource !== true && record.privateFilesRead !== true,
      'private source declarations are forbidden')
  }
  check(prepared.modelInvocations === 0 && prepared.patterns === 'bundled-original-redistributable-geology-patterns' &&
    prepared.evidenceScope === 'deterministic-CAD-workflow-with-host-review' && prepared.holeCount === 8 && prepared.stratumCount === 48,
  'public host-compiled baseline provenance is required')
  check(manifest.schema === 'com.kanjie.kjdraw.synthetic-live-capture@1' && manifest.status === 'passed' &&
    manifest.publishableModelEvidence === true && manifest.publicationReviewRequired === true && !manifest.failure,
  'a completed passed/publishable live manifest is required; publication still requires visual review')
  check(Object.hasOwn(manifest, 'viewerErrorObservations') && Array.isArray(manifest.viewerErrorObservations) &&
    manifest.viewerErrorObservations.length === 0,
  'explicit zero unavailable-viewer observations are required; older/unobserved recordings are not clean UI evidence')
  check(manifest.provider === 'deepseek' && manifest.providerEndpoint === 'https://api.deepseek.com/chat/completions' &&
    manifest.receiptCapture === 'bounded-tee-of-actual-DeepSeek-HTTPS-response-not-CDP-body', 'genuine DeepSeek HTTPS receipts are required')
  check(manifest.initialCreation === 'trusted-host-compiler-not-model-creation' && manifest.initialImportFormat === 'KJD' &&
    manifest.sameDrawingSequentialRounds === true && manifest.approval === 'actual-automated-reviewer-harness-not-human-review' &&
    JSON.stringify(manifest.phases) === JSON.stringify(phases) &&
    manifest.scope === 'source-backed synthetic drawing; arbitrary imported DXF source-fact regeneration is not claimed',
  'host creation, automated approval and KJD/DXF scope must be accurately declared')
  check(manifest.video === 'synthetic-live-model-workflow.webm', 'only the recorder-produced local WebM is accepted')
  check(manifest.captureTiming === 'elapsed milliseconds since recorded browser context became ready; screenshot-request offsets, not synthetic frames',
    'capture offsets must declare their approximate context-ready time origin')
  check(Array.isArray(manifest.responseFailures) && manifest.responseFailures.length === 0 &&
    Array.isArray(manifest.calls) && manifest.calls.length >= 10 && manifest.calls.length <= 100 &&
    manifest.modelInvocations === manifest.calls.length && manifest.verifiedModelReceipts === manifest.calls.length &&
    manifest.providerResponsesObserved === manifest.calls.length, 'all actual provider receipts must be successful and accounted for')
  check(Array.isArray(manifest.browserResponses) && manifest.browserResponses.length === manifest.calls.length &&
    manifest.browserResponses.every(response => response.httpStatus === 200 && response.streamRequested === true &&
      /^text\/event-stream(?:\s*;|$)/i.test(response.contentType)), 'actual browser SSE responses are required')
  check(manifest.calls.every((call, index) => call.sequence === index && rounds.includes(call.round) && call.httpStatus === 200 &&
    call.streamed === true && typeof call.model === 'string' && call.model.length > 0 &&
    ['stop', 'tool_calls'].includes(call.finishReason)), 'only complete actual model responses can be published')
  const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  for (const call of manifest.calls) {
    const usage = call.usage
    check(usage?.protocol === 'chat-completions' && Array.isArray(usage.invalidFields) && usage.invalidFields.length === 0,
      'actual valid provider usage is required for every call; unreported costs are never replaced by zero')
    for (const field of Object.keys(totals)) {
      const reported = `reported${field[0].toUpperCase()}${field.slice(1)}`
      check(Number.isSafeInteger(usage[field]) && usage[field] > 0 && usage[`${field}Source`] === 'reported' && usage[reported] === usage[field],
        'every call must contain positive safe reported input/output/total usage, including failed tool attempts and repairs')
      totals[field] += usage[field]
      check(Number.isSafeInteger(totals[field]), 'aggregate reported usage exceeds the safe integer budget')
    }
    check(usage.totalTokens === usage.inputTokens + usage.outputTokens, 'every actual provider token receipt must close')
  }
  check(Object.keys(totals).every(field => manifest.totals?.[field] === totals[field]),
    'manifest totals must equal all actual provider calls; never omit repair costs')
  check(Array.isArray(manifest.outcomes) && manifest.outcomes.length === 10, 'all ten same-drawing sequential rounds must pass')
  let previousRevision
  for (const [index, outcome] of manifest.outcomes.entries()) {
    check(outcome.round === rounds[index] && outcome.status === 'passed' && outcome.sourceFactsExact === true &&
      outcome.unrequestedFactsExact === true && outcome.unchangedObjectsExact === true && outcome.targetGeometryMatchesIndependentCompiler === true &&
      outcome.approval === 'actual-automated-reviewer-harness' && Number.isSafeInteger(outcome.beforeRevision) &&
      Number.isSafeInteger(outcome.afterRevision) && outcome.afterRevision === outcome.beforeRevision + 1 &&
      (index === 0 || outcome.beforeRevision === previousRevision), 'ten exact same-drawing approved revisions are required')
    const receipt = outcome.actualProposalReceipt
    check(typeof outcome.planId === 'string' && outcome.planId.length > 0 && receipt?.planId === outcome.planId &&
      receipt.command === 'GEOLOGY_DRAWING_UPDATE' && receipt.expectedRevision === outcome.beforeRevision &&
      receipt.engineeringEvidence?.afterSource?.facts, 'each outcome must contain its actual source revision proposal receipt')
    const count = manifest.calls.filter(call => call.round === outcome.round).length
    check(count === outcome.modelRequests && count > 0, 'actual response counts must match each round')
    previousRevision = outcome.afterRevision
  }
  for (const field of ['actualNativeUndoRedo', 'actualBrowserDxfReopen', 'sourceRecipePreservedInKjd', 'dxfCarriesGraphicsNotRecipe'])
    check(manifest.final?.[field] === true, 'successful native undo/redo and graphics-only DXF reopening are required')
  const names = ['live-synthetic-baseline', ...rounds.flatMap(round => [`${round}-actual-model-review`, `${round}-actual-approved`]),
    'live-native-undo', 'live-native-redo', 'live-actual-dxf-reopened']
  check(Array.isArray(manifest.captures) && manifest.captures.length === names.length, 'all 24 actual recorder captures are required')
  let previous = -1
  for (const [index, capture] of manifest.captures.entries()) {
    check(capture.file === `${String(index + 1).padStart(2, '0')}-${names[index]}.png`, 'unknown, private or traversing capture paths are forbidden')
    check(Number.isFinite(capture.elapsedMs) && capture.elapsedMs > previous && capture.elapsedMs >= 0 && capture.elapsedMs <= 3_600_000,
      'capture elapsed offsets must be finite, bounded and strictly increasing')
    previous = capture.elapsedMs
  }
  return manifest.captures
}

export function planSyntheticGifCuts(manifest, prepared, { fps = 4, durationSeconds = 24, videoOffsetMs = 0 } = {}) {
  const captures = validateSyntheticGifManifest(manifest, prepared)
  check(Number.isInteger(fps) && fps >= 4 && fps <= 6, 'fps must be an integer from 4 to 6')
  check(Number.isInteger(durationSeconds) && durationSeconds >= 24 && durationSeconds <= 30, 'duration must be 24–30 seconds')
  check(Number.isFinite(videoOffsetMs) && Math.abs(videoOffsetMs) <= 5000, 'video offset must be finite and within ±5000ms')
  const totalFrames = durationSeconds * fps, baseFrames = Math.floor(totalFrames / captures.length)
  const frameDurationMs = 1000 / fps
  // Every PNG is decoded at its actual original WebM timestamp. The source
  // window is at most 750ms (the recorder holds each captured view for 900ms).
  // No interpolation, screenshot substitution, text overlays or fake ticks.
  return captures.map((capture, index) => {
    const framesPerCut = baseFrames + (index < totalFrames % captures.length ? 1 : 0)
    const sourceStartMs = capture.elapsedMs + videoOffsetMs
    check(sourceStartMs >= 0, 'calibrated source timestamps must not precede the real video')
    return { index, capture: capture.file, captureElapsedMs: capture.elapsedMs, sourceStartMs,
      playbackDurationMs: framesPerCut * frameDurationMs,
      frames: Array.from({ length: framesPerCut }, (_, frame) => ({
        file: `${String(index + 1).padStart(2, '0')}-${String(frame + 1).padStart(2, '0')}.png`,
        sourceTimestampMs: sourceStartMs + frame * 750 / Math.max(1, framesPerCut - 1), durationMs: frameDurationMs,
      })) }
  })
}

export function parseSyntheticGifOptions(argv) {
  const options = {}, allowed = new Set(['manifest', 'output', 'python', 'ffmpeg', 'width', 'fps', 'duration-seconds', 'video-offset-ms'])
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.replace(/^--/, '')
    check(argv[index]?.startsWith('--') && allowed.has(name) && !Object.hasOwn(options, name) &&
      typeof argv[index + 1] === 'string' && !argv[index + 1].startsWith('--'), 'require unique known named options with values')
    options[name] = argv[index + 1]
  }
  check(options.manifest && options.output, '--manifest and a new --output cache directory are required')
  const width = Number(options.width ?? 1152), fps = Number(options.fps ?? 4), durationSeconds = Number(options['duration-seconds'] ?? 24)
  const videoOffsetMs = Number(options['video-offset-ms'] ?? 0)
  check(Number.isInteger(width) && width >= 1000 && width <= 1152, 'width must be 1000–1152px')
  return { manifest: resolve(root, options.manifest), output: resolve(root, options.output),
    python: options.python || process.env.KJDRAW_PYTHON || 'python', ffmpeg: options.ffmpeg || process.env.KJDRAW_FFMPEG_PATH || 'ffmpeg',
    width, fps, durationSeconds, videoOffsetMs, videoOffsetExplicit: Object.hasOwn(options, 'video-offset-ms') }
}

function requireInside(parent, target, message) {
  const path = relative(parent, target)
  check(path && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path), message)
}
async function readJson(path, limit = 10_000_000) {
  const info = await lstat(path)
  check(info.isFile() && !info.isSymbolicLink() && info.size <= limit, 'bounded original regular manifest file required')
  return JSON.parse(await readFile(path, 'utf8'))
}
export async function encodeSyntheticLiveGif(argv = process.argv.slice(2)) {
  const options = parseSyntheticGifOptions(argv)
  requireInside(resolve(root, '.cache'), options.manifest, 'input evidence must reside in this checkout .cache')
  requireInside(resolve(root, '.cache'), options.output, 'output must be a dedicated .cache directory; docs/media are never written')
  check(basename(options.manifest) === 'live-recording-manifest.json', 'use an original recorder live manifest')
  check(!existsSync(options.output), 'output must be new; preserve all previous recordings and evidence')
  const realCache = await realpath(resolve(root, '.cache'))
  requireInside(realCache, await realpath(options.manifest), 'evidence may not escape .cache through a junction or symlink')
  let outputAncestor = dirname(options.output)
  while (!existsSync(outputAncestor)) outputAncestor = dirname(outputAncestor)
  requireInside(realCache, resolve(await realpath(outputAncestor), relative(outputAncestor, options.output)),
    'output may not escape .cache through a junction or symlink')
  const inputDirectory = dirname(options.manifest), preparedPath = resolve(inputDirectory, 'manifest.json')
  const manifest = await readJson(options.manifest), prepared = await readJson(preparedPath)
  const cuts = planSyntheticGifCuts(manifest, prepared, options)
  const video = resolve(inputDirectory, manifest.video)
  const videoInfo = await lstat(video)
  check(videoInfo.isFile() && !videoInfo.isSymbolicLink() && videoInfo.size > 0, 'original regular recorder WebM is required')
  // Hash original captures as calibration references, but never use them as
  // video/GIF frames. All emitted images come from the same hashed WebM.
  const references = []
  for (const capture of manifest.captures) {
    const file = resolve(inputDirectory, capture.file), info = await lstat(file)
    check(info.isFile() && !info.isSymbolicLink(), 'only original regular public capture reference files are allowed')
    references.push({ file: capture.file, sha256: await sha256(file) })
  }
  const evidence = { schema: 'com.kanjie.kjdraw.synthetic-live-gif@1', status: 'extracting',
    synthetic: true, measuredData: false, source: manifest.source, approval: manifest.approval,
    initialCreation: manifest.initialCreation, scope: manifest.scope, actualRoundCount: 10,
    publicationReviewRequired: true, condensed: true, waitingTimeCut: true, framesInterpolated: false, modelProseAltered: false,
    sourceManifestSha256: await sha256(options.manifest), preparedManifestSha256: await sha256(preparedPath), sourceVideoSha256: await sha256(video),
    sourceVideo: manifest.video, captureReferences: references,
    tokenAccounting: { scope: 'all actual provider calls, including failed tool attempts and repair requests; no unreported usage imputed',
      totals: structuredClone(manifest.totals), calls: manifest.calls.map(({ sequence, round, model, usage }) => ({ sequence, round, model, usage: structuredClone(usage) })) },
    proposalAttempts: manifest.outcomes.map(outcome => ({ round: outcome.round,
      ...(outcome.proposalAttempts === undefined ? { availability: 'not recorded; no zero-attempt claim' } : { reported: structuredClone(outcome.proposalAttempts) }) })),
    timestampCalibration: { videoOffsetMs: options.videoOffsetMs, explicitlyProvided: options.videoOffsetExplicit,
      accuracy: 'approximate context-ready screenshot-request offsets plus operator video-start calibration; not exact screenshot PTS' },
    requested: { width: options.width, fps: options.fps, durationSeconds: options.durationSeconds }, maximumBytes: maxBytes, cuts }
  await mkdir(resolve(options.output, 'frames'), { recursive: true })
  const cutlist = resolve(options.output, 'cutlist.json')
  await writeFile(cutlist, JSON.stringify(evidence, null, 2) + '\n')
  try {
    for (const cut of cuts) for (const frame of cut.frames) {
      const destination = resolve(options.output, 'frames', frame.file)
      const decoded = spawnSync(options.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', (frame.sourceTimestampMs / 1000).toFixed(6),
        '-i', video, '-frames:v', '1', '-vf', `scale=${options.width}:-1`, '-c:v', 'png', '-f', 'image2', destination],
      { windowsHide: true, encoding: 'utf8', timeout: 30_000, maxBuffer: 64_000 })
      check(!decoded.error && decoded.status === 0 && existsSync(destination) && (await stat(destination)).size > 0,
        'WebM timestamp extraction failed; no substitute frames are allowed')
      frame.sha256 = await sha256(destination)
    }
    evidence.status = 'encoding'; await writeFile(cutlist, JSON.stringify(evidence, null, 2) + '\n')
    const encoded = spawnSync(options.python, [fileURLToPath(new URL('./encode-synthetic-live-gif.py', import.meta.url)), cutlist],
      { windowsHide: true, encoding: 'utf8', timeout: 120_000, maxBuffer: 64_000 })
    check(!encoded.error && encoded.status === 0, 'optional Pillow encoding failed; install nothing and do not publish a partial GIF')
    const report = JSON.parse(encoded.stdout), gif = resolve(options.output, 'synthetic-live-model-highlights.gif')
    check(report.bytes === (await stat(gif)).size && report.bytes <= maxBytes && report.durationMs >= 24_000 && report.durationMs <= 30_000,
      'GIF must be 24–30 seconds and at most 10MB')
    check(await sha256(video) === evidence.sourceVideoSha256 && await sha256(options.manifest) === evidence.sourceManifestSha256 &&
      await sha256(preparedPath) === evidence.preparedManifestSha256, 'original evidence changed during extraction; preserve the unsuccessful cache and do not publish')
    evidence.status = 'encoded-awaiting-visual-publication-review'; evidence.gif = { file: basename(gif), sha256: await sha256(gif), ...report }
    await writeFile(cutlist, JSON.stringify(evidence, null, 2) + '\n')
    console.log(JSON.stringify({ status: evidence.status, output: relative(root, options.output), gif: evidence.gif }))
    return evidence
  } catch (error) {
    evidence.status = 'failed-not-publishable'; evidence.failure = 'REAL_VIDEO_EXTRACTION_OR_GIF_ENCODING_FAILED'
    await writeFile(cutlist, JSON.stringify(evidence, null, 2) + '\n')
    throw error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  encodeSyntheticLiveGif().catch(() => { console.error('LIVE_GIF_REJECTED: evidence, real-video extraction or optional Pillow checks failed; no public files changed'); process.exitCode = 1 })
}
