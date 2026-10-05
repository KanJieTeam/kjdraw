import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'

import { parseAutoCADPat } from '../../packages/kjdraw-sdk/src/hatch-pattern-catalog.js'

const args = process.argv.slice(2)
const option = name => {
  const index = args.indexOf(name)
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`)
  return args[index + 1]
}
const sourceRoot = resolve(option('--root'))
const outputPath = resolve(option('--output'))
const spdx = args.includes('--spdx') ? option('--spdx') : 'NOASSERTION'
const redistributable = args.includes('--redistributable') ? option('--redistributable') === 'true' : false
if (outputPath === sourceRoot || outputPath.startsWith(`${sourceRoot}${sep}`)) throw new Error('Audit output must stay outside the source corpus')
if (!/^[A-Za-z0-9-.+]{2,64}$/.test(spdx)) throw new Error('Invalid SPDX/NOASSERTION value')

const rootInfo = await stat(sourceRoot)
if (!rootInfo.isDirectory()) throw new Error('--root must be a directory')
const files = []
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.pat') files.push(path)
    if (files.length > 10_000) throw new Error('PAT audit supports at most 10,000 files per corpus')
  }
}
await walk(sourceRoot)
files.sort((a, b) => a.localeCompare(b))
if (!files.length) throw new Error('No PAT files found')

const utf8 = new TextDecoder('utf-8', { fatal: true })
const gb18030 = new TextDecoder('gb18030', { fatal: true })
const decode = bytes => {
  try { return { encoding: 'utf-8', text: utf8.decode(bytes) } }
  catch { return { encoding: 'gb18030', text: gb18030.decode(bytes) } }
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const records = []
const names = new Map()
let totalBytes = 0, totalPatterns = 0, totalLineFamilies = 0
for (const path of files) {
  const bytes = await readFile(path)
  if (bytes.length > 5_000_000) {
    records.push({ path: relative(sourceRoot, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256(bytes), split: 'development', status: 'rejected', error: 'file exceeds 5 MB' })
    continue
  }
  totalBytes += bytes.length
  const hash = sha256(bytes), split = Number.parseInt(hash.slice(-2), 16) < 51 ? 'holdout' : 'development'
  try {
    const decoded = decode(bytes), catalog = parseAutoCADPat(decoded.text)
    const lineFamilies = catalog.patterns.reduce((sum, pattern) => sum + pattern.lines.length, 0)
    totalPatterns += catalog.patterns.length
    totalLineFamilies += lineFamilies
    for (const pattern of catalog.patterns) names.set(pattern.name.toUpperCase(), (names.get(pattern.name.toUpperCase()) ?? 0) + 1)
    records.push({ path: relative(sourceRoot, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash, split, status: 'parsed', encoding: decoded.encoding, patterns: catalog.patterns.length, lineFamilies })
  } catch (error) {
    records.push({ path: relative(sourceRoot, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash, split, status: 'rejected', error: String(error?.message ?? error).slice(0, 500) })
  }
}

const parsed = records.filter(record => record.status === 'parsed')
const holdout = records.filter(record => record.split === 'holdout')
const report = {
  schema: 'kjdraw.pat-corpus-audit.v1',
  corpus: basename(sourceRoot),
  license: { spdx, redistributable, publishable: redistributable && spdx !== 'NOASSERTION' },
  sourcePolicy: 'local-read-only; no pattern geometry or source content embedded in this report',
  splitPolicy: 'sha256-last-byte-below-51-is-holdout',
  summary: {
    files: records.length,
    parsed: parsed.length,
    rejected: records.length - parsed.length,
    bytes: totalBytes,
    patterns: totalPatterns,
    uniquePatternNames: names.size,
    duplicatePatternNames: [...names.values()].filter(count => count > 1).length,
    lineFamilies: totalLineFamilies,
    developmentFiles: records.length - holdout.length,
    holdoutFiles: holdout.length,
  },
  records,
}
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
console.log(JSON.stringify({ output: outputPath, ...report.summary }))
