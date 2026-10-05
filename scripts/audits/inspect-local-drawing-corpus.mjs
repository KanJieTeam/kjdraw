import { mkdir, opendir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'
import {
  KJDRAW_LOCAL_CORPUS_SCHEMA,
  anonymousFileId,
  canonicalJson,
  classifyDrawingHint,
  createCanonicalFeatureSummary,
  dwgHeaderVersion,
  safeFailureReason,
  validateCorpusSalt,
} from './local-drawing-corpus-core.mjs'

function argumentsOf(argv) {
  const options = { root: '', output: '', featureDir: '', limit: Number.POSITIVE_INFINITY, corpusId: '', drawingKind: '', selectKind: '', format: '', hintToken: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index], value = argv[index + 1]
    if (name === '--root' && value) { options.root = value; index += 1 }
    else if (name === '--output' && value) { options.output = value; index += 1 }
    else if (name === '--feature-dir' && value) { options.featureDir = value; index += 1 }
    else if (name === '--limit' && value && Number.isSafeInteger(Number(value)) && Number(value) > 0) { options.limit = Number(value); index += 1 }
    else if (name === '--corpus-id' && value && /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value)) { options.corpusId = value; index += 1 }
    else if (name === '--drawing-kind' && value && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(value)) { options.drawingKind = value; index += 1 }
    else if (name === '--select-kind' && value && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(value)) { options.selectKind = value; index += 1 }
    else if (name === '--format' && value && ['DXF', 'DWG', 'ARCHIVE'].includes(value.toUpperCase())) { options.format = value.toUpperCase(); index += 1 }
    else if (name === '--hint-token' && value && value.length <= 64 && !/[\u0000-\u001f\u007f]/u.test(value)) { options.hintToken = value.normalize('NFKC'); index += 1 }
    else throw new Error(`Unknown or incomplete argument: ${name}`)
  }
  if (!options.root || !options.corpusId) throw new Error('Usage: KJDRAW_CORPUS_SALT=<private> node scripts/audits/inspect-local-drawing-corpus.mjs --root <drawing-directory> --corpus-id <anonymous-id> [--drawing-kind kind|--select-kind kind] [--format DXF|DWG|ARCHIVE] [--hint-token private-local-filter] [--output report.json --feature-dir summaries] [--limit N]')
  if (options.drawingKind && options.selectKind) throw new Error('--drawing-kind and --select-kind are mutually exclusive')
  if (options.featureDir && !options.output) throw new Error('--feature-dir requires --output so references have a stable manifest base')
  return options
}

async function walk(directory, files = []) {
  const handle = await opendir(directory)
  for await (const entry of handle) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await walk(path, files)
    else if (entry.isFile() && ['.dxf', '.dwg', '.zip', '.rar', '.7z'].includes(extname(entry.name).toLowerCase())) files.push(path)
  }
  return files
}

const options = argumentsOf(process.argv.slice(2))
const root = resolve(options.root)
const outputPath = options.output ? resolve(options.output) : ''
const featureDirectory = options.featureDir ? resolve(options.featureDir) : ''
if (featureDirectory) {
  const reference = relative(dirname(outputPath), featureDirectory)
  if (!reference || reference.startsWith('..') || isAbsolute(reference)) throw new Error('--feature-dir must be a child of the manifest directory')
  await mkdir(featureDirectory, { recursive: true })
}
const salt = validateCorpusSalt(process.env.KJDRAW_CORPUS_SALT)
const sourceFormat = path => ['.zip', '.rar', '.7z'].includes(extname(path).toLowerCase()) ? 'ARCHIVE' : extname(path).slice(1).toUpperCase()
const sourceKind = path => options.drawingKind || classifyDrawingHint(relative(root, path).replaceAll('\\', '/'))
const discoveredFiles = (await walk(root)).sort((left, right) => left.localeCompare(right))
const matchingFiles = discoveredFiles
  .filter(path => !options.selectKind || sourceKind(path) === options.selectKind)
  .filter(path => !options.format || sourceFormat(path) === options.format)
  .filter(path => !options.hintToken || relative(root, path).replaceAll('\\', '/').normalize('NFKC').includes(options.hintToken))
const sourceFiles = matchingFiles.slice(0, options.limit)
const sdk = createKJDrawSDK()
const files = []
for (const path of sourceFiles) {
  const bytes = await readFile(path), format = sourceFormat(path)
  const privateHint = relative(root, path).replaceAll('\\', '/')
  const entry = { anonymousId: anonymousFileId(bytes, salt, options.corpusId), format, sourceVersion: format === 'DWG' ? dwgHeaderVersion(bytes) : null, byteLength: bytes.length, drawingKind: options.drawingKind || classifyDrawingHint(privateHint) }
  if (format === 'ARCHIVE') files.push({
    ...entry,
    parseStatus: 'blocked', baseline: 'blocked', featureSummary: null,
    blockingReasons: ['archive-extraction-required'],
    conversion: { attempted: false, provider: null, fidelityRisk: 'unknown' },
  })
  else if (format === 'DWG') files.push({
    ...entry,
    parseStatus: 'blocked', baseline: 'blocked', featureSummary: null,
    blockingReasons: ['dwg-converter-required'],
    conversion: { attempted: false, provider: null, fidelityRisk: 'unknown' },
  })
  else {
    try {
      const drawing = await sdk.readDocument(bytes, { format: 'DXF' })
      const featureSummary = createCanonicalFeatureSummary(drawing, { salt })
      let featureStorage = { featureSummary }
      if (featureDirectory) {
        const featureName = `${entry.anonymousId}.json`, featurePath = resolve(featureDirectory, featureName)
        const featureJson = canonicalJson(featureSummary)
        const existing = await readFile(featurePath, 'utf8').catch(() => null)
        if (existing == null) await writeFile(featurePath, featureJson, { flag: 'wx' })
        else if (existing !== featureJson) throw new Error('Existing feature shard does not match the deterministic summary')
        featureStorage = { featureSummaryRef: relative(dirname(outputPath), featurePath).replaceAll('\\', '/'), featureDigest: featureSummary.digest, featureCounts: featureSummary.counts }
      }
      files.push({
        ...entry, sourceVersion: featureSummary.sourceVersion,
        parseStatus: 'parsed', baseline: featureSummary.counts.proxies ? 'blocked' : 'candidate', ...featureStorage,
        ...(featureSummary.counts.proxies ? { blockingReasons: ['proxy-entities-present'] } : { blockingReasons: [] }),
        conversion: null,
      })
    } catch (error) {
      files.push({
        ...entry, parseStatus: 'blocked', baseline: 'blocked', featureSummary: null,
        blockingReasons: ['parse-failed'], failureReason: safeFailureReason(error, [root, path, privateHint]), conversion: null,
      })
    }
  }
}
files.sort((left, right) => left.anonymousId.localeCompare(right.anonymousId))
const totals = {
  files: files.length,
  parsed: files.filter(file => file.parseStatus === 'parsed').length,
  blocked: files.filter(file => file.parseStatus === 'blocked').length,
  baselineCandidates: files.filter(file => file.baseline === 'candidate').length,
  entities: files.reduce((sum, file) => sum + (file.featureSummary?.counts.entities ?? file.featureCounts?.entities ?? 0), 0),
  proxies: files.reduce((sum, file) => sum + (file.featureSummary?.counts.proxies ?? file.featureCounts?.proxies ?? 0), 0),
  byKind: Object.fromEntries([...new Set(files.map(file => file.drawingKind))].sort().map(kind => [kind, files.filter(file => file.drawingKind === kind).length])),
}
const report = {
  schema: KJDRAW_LOCAL_CORPUS_SCHEMA,
  corpusId: options.corpusId,
  deterministic: true,
  featureStorage: featureDirectory ? 'sharded' : 'embedded',
  selection: {
    discoveredSources: discoveredFiles.length,
    matchingSources: matchingFiles.length,
    selectedSources: sourceFiles.length,
    truncated: sourceFiles.length < matchingFiles.length,
    limit: Number.isFinite(options.limit) ? options.limit : null,
    format: options.format || null,
    drawingKind: options.drawingKind || options.selectKind || null,
    privateHintFilterApplied: Boolean(options.hintToken),
    classificationMode: options.drawingKind ? 'host-declared' : 'path-hint',
  },
  totals,
  files,
}
const json = canonicalJson(report)
if (options.output) await writeFile(outputPath, json, { flag: 'wx' })
process.stdout.write(json)
