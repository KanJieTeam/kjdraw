import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { validateSyntheticGifManifest, planSyntheticGifCuts } from '../scripts/encode-synthetic-live-gif.mjs'

// Integrity guards over the actual copied public recording, not fake live
// receipts, provider replay, or independent authentication of a model service.
// No model calls, private cache evidence, media decoding or artifact writes.
const root = fileURLToPath(new URL('../', import.meta.url))
const directory = resolve(root, 'docs/media/ai-geology-live-20261003')
const pageFile = resolve(directory, 'index.html')
const pageUrl = 'https://kanjieteam.github.io/kjdraw/docs/media/ai-geology-live-20261003/'
const gifName = 'synthetic-live-model-highlights.gif'
const videoName = 'synthetic-live-model-workflow.webm'
const shaPattern = /^[a-f0-9]{64}$/

async function regularFile(file) {
  const resolved = await realpath(file), inside = relative(await realpath(root), resolved)
  assert.ok(inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside), 'public links must remain inside this checkout')
  const info = await lstat(file)
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size > 0, 'public evidence must be a nonempty regular file, not an external symlink')
  return info
}
async function text(file, limit = 8 * 1024 * 1024) {
  assert.ok((await regularFile(file)).size <= limit, 'bounded public text artifact required')
  return readFile(file, 'utf8')
}
const json = async name => JSON.parse(await text(resolve(directory, name)))
async function sha(file) {
  await regularFile(file)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function evidence() {
  const manifest = await json('live-recording-manifest.json'), prepared = await json('manifest.json'), cutlist = await json('cutlist.json')
  validateSyntheticGifManifest(manifest, prepared)
  return { manifest, prepared, cutlist }
}

test('both public README heroes link the actual synthetic live GIF to its full recording evidence page', async () => {
  const expectedImage = `docs/media/ai-geology-live-20261003/${gifName}`
  for (const file of ['README.md', 'README.zh-CN.md']) {
    const source = await text(resolve(root, file))
    const links = [...source.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    const heroes = links.filter(link => [...link[2].matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)]
      .some(image => image[1] === expectedImage))
    assert.equal(heroes.length, 1, `${file}: exactly one actual recording hero is required`)
    assert.equal(heroes[0][1], pageUrl, `${file}: hero must open the evidence page, not an unrelated editor`)
    await regularFile(resolve(root, expectedImage))
    await regularFile(pageFile)
  }
})

test('public evidence page preserves its original CSS rules in a self-hosted file and reuses the existing SVG favicon', async () => {
  const source = await text(pageFile)
  assert.doesNotMatch(source, /<style\b|\bstyle\s*=/i, 'style-src self must not depend on inline styles')
  assert.match(source, /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']style\.css["']/i)
  assert.match(source, /<link\b[^>]*\brel=["']icon["'][^>]*\bhref=["']\.\.\/\.\.\/assets\/mark\.svg["'][^>]*\btype=["']image\/svg\+xml["']/i)
  const css = (await text(resolve(directory, 'style.css'))).trim()
  // Hash of the original inline rule text captured before CSP-only extraction;
  // whitespace outside the stylesheet is immaterial, all rule bytes stay exact.
  assert.equal(createHash('sha256').update(css).digest('hex'), '2014dc0aeeaa0a44bd8abd1aec39b077f973841773d82ad08858bbf5279d7b43')
  await regularFile(resolve(directory, '../../assets/mark.svg'))
})

test('public evidence page is DXF-first, has original WebM controls, and accurately declares synthetic/non-human/non-benchmark scope', async () => {
  const source = await text(pageFile), visible = source.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const downloads = [...source.matchAll(/<a\b(?=[^>]*\bdownload\b)[^>]*\bhref=["']([^"']+)["']/gi)].map(match => match[1])
  assert.equal(downloads[0], 'synthetic-live-final.dxf', 'the default downloadable drawing is the final usable DXF')
  assert.ok(downloads.includes('synthetic-geology-section.dxf'))
  assert.ok(downloads.every(file => file.endsWith('.dxf')), 'public drawing download choices must not default to native KJD')
  const video = /<video\b([^>]*)>([\s\S]*?)<\/video>/i.exec(source)
  assert.ok(video && /\bcontrols\b/i.test(video[1]), 'original uncut video requires usable native playback controls')
  assert.match(video[2], /<source\b[^>]*\bsrc=["']synthetic-live-model-workflow\.webm["']/i)
  assert.match(video[2], /\bhref=["']synthetic-live-model-workflow\.webm["']/i)
  assert.match(visible, /full,? uncut browser recording/i)
  assert.match(visible, /condensed excerpt from this same video/i)
  assert.match(visible, /does not synthesize frames or model responses/i)
  assert.match(visible, /original public synthetic data/i)
  assert.match(visible, /not a private project/i)
  assert.match(visible, /trusted host compiler/i)
  assert.match(visible, /initial AI creation is not claimed/i)
  assert.match(visible, /not independent human-user acceptance/i)
  assert.match(visible, /DXF preserves supported native graphics, not its source recipe or internal UUIDs/i)
  assert.match(visible, /Arbitrary imported DXF source reconstruction is not claimed/i)
  assert.match(visible, /not a comparative benchmark or evidence of universal correctness or token savings/i)
  for (const match of source.matchAll(/\b(?:href|src|poster)=["']([^"']+)["']/gi)) {
    const reference = match[1].replaceAll('&amp;', '&')
    if (/^https?:\/\//i.test(reference) || reference.startsWith('#')) continue
    assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(reference) && !reference.startsWith('//'), 'unsupported link protocols are forbidden')
    const pathname = decodeURIComponent(reference.split(/[?#]/)[0])
    const target = resolve(dirname(pageFile), pathname)
    const info = await lstat(target)
    await regularFile(info.isDirectory() ? resolve(target, 'index.html') : target)
  }
})

test('actual public live receipts passed all ten same-drawing rounds with explicit zero UI errors and complete reported cost accounting', async () => {
  const { manifest, prepared } = await evidence()
  assert.equal(manifest.status, 'passed')
  assert.equal(manifest.publishableModelEvidence, true)
  assert.ok(Object.hasOwn(manifest, 'viewerErrorObservations'))
  assert.deepEqual(manifest.viewerErrorObservations, [])
  assert.ok(manifest.calls.length >= 10, 'guard actual calls without hard-coding one stochastic run count')
  assert.equal(manifest.modelInvocations, manifest.calls.length)
  assert.ok(typeof manifest.requestedModel === 'string' && manifest.requestedModel.length > 0)
  for (const call of manifest.calls) assert.ok(typeof call.model === 'string' && call.model.length > 0, 'record the actual served model, not an inferred alias version')
  for (const field of ['inputTokens', 'outputTokens', 'totalTokens'])
    assert.equal(manifest.totals[field], manifest.calls.reduce((sum, call) => sum + call.usage[field], 0), 'all real calls including repairs count toward cost')
  assert.equal(manifest.totals.totalTokens, manifest.totals.inputTokens + manifest.totals.outputTokens)
  assert.equal(prepared.modelInvocations, 0, 'host-compiled initial drawing is not model creation')
  assert.equal(manifest.approval, 'actual-automated-reviewer-harness-not-human-review')
  assert.equal(manifest.outcomes.length, 10)
})

test('public GIF provenance hashes the exact original WebM, original manifests, all 24 captures and the published condensed GIF bytes', async () => {
  const { manifest, prepared, cutlist } = await evidence()
  assert.equal(cutlist.schema, 'com.kanjie.kjdraw.synthetic-live-gif@1')
  assert.equal(cutlist.status, 'encoded-awaiting-visual-publication-review')
  assert.equal(cutlist.sourceVideo, videoName)
  for (const [key, file] of [['sourceVideoSha256', videoName], ['sourceManifestSha256', 'live-recording-manifest.json'], ['preparedManifestSha256', 'manifest.json']]) {
    assert.match(cutlist[key], shaPattern)
    assert.equal(await sha(resolve(directory, file)), cutlist[key], `published ${file} must remain byte-exact original evidence`)
  }
  assert.deepEqual(cutlist.tokenAccounting.totals, manifest.totals)
  assert.deepEqual(cutlist.tokenAccounting.calls, manifest.calls.map(({ sequence, round, model, usage }) => ({ sequence, round, model, usage })))
  assert.equal(cutlist.condensed, true); assert.equal(cutlist.waitingTimeCut, true)
  assert.equal(cutlist.framesInterpolated, false); assert.equal(cutlist.modelProseAltered, false)
  assert.equal(cutlist.publicationReviewRequired, true)
  assert.equal(cutlist.captureReferences.length, 24)
  assert.deepEqual(cutlist.captureReferences.map(item => item.file), manifest.captures.map(item => item.file))
  for (const item of cutlist.captureReferences) {
    assert.match(item.file, /^\d{2}-[a-z0-9-]+\.png$/)
    assert.match(item.sha256, shaPattern)
    assert.equal(await sha(resolve(directory, item.file)), item.sha256, 'every published screenshot is its actual original capture')
  }
  const expected = planSyntheticGifCuts(manifest, prepared, { ...cutlist.requested, videoOffsetMs: cutlist.timestampCalibration.videoOffsetMs })
  assert.equal(cutlist.cuts.length, 24)
  for (const [index, cut] of cutlist.cuts.entries()) {
    const frames = cut.frames.map(({ sha256, ...frame }) => {
      assert.match(sha256, shaPattern, 'unpublished decoded frame hashes remain present; no private frame files are read')
      return frame
    })
    assert.deepEqual({ ...cut, frames }, expected[index], 'cuts use actual recorder offsets and declared real-video calibration, not manufactured timelines')
  }
  assert.equal(cutlist.gif.file, gifName)
  assert.match(cutlist.gif.sha256, shaPattern)
  assert.equal(await sha(resolve(directory, gifName)), cutlist.gif.sha256)
  assert.equal((await regularFile(resolve(directory, gifName))).size, cutlist.gif.bytes)
  assert.ok(cutlist.gif.bytes <= 10_000_000 && cutlist.gif.durationMs >= 24_000 && cutlist.gif.durationMs <= 30_000)
  const header = await readFile(resolve(directory, gifName))
  assert.match(header.subarray(0, 6).toString('ascii'), /^GIF8[79]a$/)
})

test('both public synthetic DXFs actually reopen as native CAD graphics without a KJD source recipe', async () => {
  const { manifest, prepared } = await evidence(), audit = await json('dxf-audit.json'), sdk = createKJDrawSDK()
  assert.equal(audit.schema, 'com.kanjie.kjdraw.public-synthetic-dxf-audit@1')
  assert.equal(audit.validator, 'ezdxf')
  assert.match(audit.validatorVersion, /^\d+\.\d+\.\d+$/)
  assert.equal(audit.source, 'original-public-synthetic-facts')
  assert.deepEqual(Object.keys(audit.files).sort(), ['synthetic-geology-section.dxf', 'synthetic-live-final.dxf'].sort())
  try {
    for (const [file, count, hatchCount] of [['synthetic-geology-section.dxf', prepared.entityCount, prepared.hatchCount],
      ['synthetic-live-final.dxf', manifest.final.entityCount, manifest.final.hatchCount]]) {
      await regularFile(resolve(directory, file))
      const report = audit.files[file]
      assert.match(report.sha256, shaPattern)
      assert.equal(await sha(resolve(directory, file)), report.sha256, 'published DXF bytes must be the independently audited original bytes')
      assert.equal(report.entities, count); assert.equal(report.hatches, hatchCount)
      assert.equal(report.auditErrors, 0); assert.equal(report.auditFixes, 0)
      // Match the published real independent-validator receipt; this SDK reopen
      // is an additional check, not a replacement or fabricated ezdxf audit.
      const document = await sdk.readDocument(await readFile(resolve(directory, file)), { format: 'DXF' })
      assert.equal(document.validate().valid, true)
      assert.equal(document.listEntities().length, count)
      assert.equal(document.listEntities({ type: 'HATCH' }).length, hatchCount)
      assert.ok(document.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text.includes('Synthetic')))
      assert.equal(Object.keys(document.snapshot().opaquePayloads).some(key => key.startsWith('geology-drawing-recipe:')), false)
      if (file === 'synthetic-live-final.dxf') {
        assert.ok(document.listEntities({ type: 'TEXT' }).some(entity => entity.payload.text === '示例耕植土'))
        assert.ok(document.listEntities({ type: 'HATCH' }).some(entity => entity.payload.patternName === 'GEO_TOPSOIL'))
      }
    }
  } finally { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) }
})

test('public development disclosure retains the earlier real model failure and UI-review failure instead of relabeling them passed', async () => {
  const development = await json('development-runs.json')
  assert.equal(development.source, 'original-public-synthetic-facts')
  const v9 = development.runs.find(run => run.run === 'v9'), v8 = development.runs.find(run => run.run === 'v8')
  assert.equal(v9.status, 'failed'); assert.equal(v9.approvedRounds, 4)
  assert.equal(v9.completeCostAccounting, true)
  assert.ok(v9.reportedTotals.totalTokens > 0)
  assert.equal(v9.reportedTotals.totalTokens, v9.reportedTotals.inputTokens + v9.reportedTotals.outputTokens)
  assert.equal(v8.status, 'CAD-checks-passed-UI-review-failed')
  assert.match(development.accounting, /no token-savings claim/i)
})
