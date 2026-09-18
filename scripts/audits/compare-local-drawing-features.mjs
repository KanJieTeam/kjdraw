import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

import {
  KJDRAW_LOCAL_CORPUS_SCHEMA,
  canonicalJson,
  compareCanonicalFeatureSummaries,
} from './local-drawing-corpus-core.mjs'

function argumentsOf(argv) {
  const options = { expected: '', actual: '', pairs: '', output: '', boundsTolerance: 0 }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index], value = argv[index + 1]
    if (['--expected', '--actual', '--pairs', '--output'].includes(name) && value) { options[name.slice(2)] = value; index += 1 }
    else if (name === '--bounds-tolerance' && value && Number.isFinite(Number(value)) && Number(value) >= 0) { options.boundsTolerance = Number(value); index += 1 }
    else throw new Error(`Unknown or incomplete argument: ${name}`)
  }
  if (!options.expected || !options.actual || !options.pairs) throw new Error('Usage: node compare-local-drawing-features.mjs --expected manifest.json --actual manifest.json --pairs anonymous-pairs.json [--bounds-tolerance N] [--output report.json]')
  return options
}

const parse = async path => JSON.parse(await readFile(resolve(path), 'utf8'))
const exactKeys = (value, allowed, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label} is invalid`)
  return value
}
const manifest = (value, label, path) => {
  if (value?.schema !== KJDRAW_LOCAL_CORPUS_SCHEMA || !Array.isArray(value.files)) throw new Error(`${label} must be a current local corpus manifest`)
  const byId = new Map()
  for (const entry of value.files) {
    if (typeof entry?.anonymousId !== 'string' || byId.has(entry.anonymousId)) throw new Error(`${label} contains invalid or duplicate anonymous IDs`)
    byId.set(entry.anonymousId, entry)
  }
  return { corpusId: value.corpusId, byId, directory: dirname(resolve(path)) }
}

const featureSummary = async (manifest, entry, label) => {
  if (entry.featureSummary) return entry.featureSummary
  if (typeof entry.featureSummaryRef !== 'string' || !entry.featureSummaryRef || isAbsolute(entry.featureSummaryRef) || entry.featureSummaryRef.split(/[\\/]/u).includes('..')) return null
  const summary = await parse(resolve(manifest.directory, entry.featureSummaryRef))
  if (typeof entry.featureDigest !== 'string' || summary?.digest !== entry.featureDigest) throw new Error(`${label} feature shard does not match its manifest digest`)
  return summary
}

const options = argumentsOf(process.argv.slice(2))
const expected = manifest(await parse(options.expected), 'Expected manifest', options.expected)
const actual = manifest(await parse(options.actual), 'Actual manifest', options.actual)
const pairSource = await parse(options.pairs)
if (!Array.isArray(pairSource) || pairSource.length < 1 || pairSource.length > 10000) throw new Error('Pairs must contain 1-10000 anonymous mappings')
const pairs = pairSource.map((raw, index) => {
  const pair = exactKeys(raw, ['expectedId', 'actualId'], `Pair ${index}`)
  if (typeof pair.expectedId !== 'string' || typeof pair.actualId !== 'string') throw new Error(`Pair ${index} IDs are invalid`)
  return pair
}).sort((left, right) => left.expectedId.localeCompare(right.expectedId) || left.actualId.localeCompare(right.actualId))
if (new Set(pairs.map(pair => pair.expectedId)).size !== pairs.length || new Set(pairs.map(pair => pair.actualId)).size !== pairs.length) throw new Error('Pair mappings must be one-to-one')

const results = []
for (const pair of pairs) {
  const left = expected.byId.get(pair.expectedId), right = actual.byId.get(pair.actualId)
  if (!left || !right) { results.push({ ...pair, passed: false, categoryCounts: { missing: 1 }, differences: [{ category: 'missing', key: !left ? 'expected-entry' : 'actual-entry' }] }); continue }
  const leftSummary = await featureSummary(expected, left, 'Expected'), rightSummary = await featureSummary(actual, right, 'Actual')
  if (left.parseStatus !== 'parsed' || right.parseStatus !== 'parsed' || !leftSummary || !rightSummary) { results.push({
    ...pair, passed: false, categoryCounts: { blocked: 1 }, differences: [{ category: 'blocked', key: 'parse-status', expected: left.parseStatus, actual: right.parseStatus }],
  }); continue }
  results.push({ ...pair, ...compareCanonicalFeatureSummaries(leftSummary, rightSummary, { boundsTolerance: options.boundsTolerance }) })
}
const report = {
  schema: 'com.kanjie.kjdraw.local-drawing-corpus-comparison@1',
  expectedCorpusId: expected.corpusId,
  actualCorpusId: actual.corpusId,
  passed: results.every(result => result.passed),
  totals: {
    pairs: results.length,
    passed: results.filter(result => result.passed).length,
    failed: results.filter(result => !result.passed).length,
    categories: results.reduce((counts, result) => {
      for (const [category, amount] of Object.entries(result.categoryCounts ?? {})) counts[category] = (counts[category] ?? 0) + amount
      return counts
    }, {}),
  },
  results,
}
const json = canonicalJson(report)
if (options.output) await writeFile(resolve(options.output), json, { flag: 'wx' })
process.stdout.write(json)
if (!report.passed) process.exitCode = 1
