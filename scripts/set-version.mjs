import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const version = String(process.argv[2] ?? '').trim()
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

if (!semver.test(version)) {
  console.error('Usage: node scripts/set-version.mjs <semver>')
  process.exit(2)
}

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'))
}

async function writeJson(path, value) {
  await writeFile(new URL(path, root), `${JSON.stringify(value, null, 2)}\n`)
}

const repositoryPackage = await readJson('package.json')
const sdkPackage = await readJson('packages/kjdraw-sdk/package.json')
const lockfile = await readJson('package-lock.json')
const matrix = await readJson('docs/KJDRAW_1_0_ACCEPTANCE_MATRIX.json')

repositoryPackage.version = version
sdkPackage.version = version
lockfile.version = version
lockfile.packages[''].version = version
lockfile.packages['packages/kjdraw-sdk'].version = version
matrix.release = version

await Promise.all([
  writeJson('package.json', repositoryPackage),
  writeJson('packages/kjdraw-sdk/package.json', sdkPackage),
  writeJson('package-lock.json', lockfile),
  writeJson('docs/KJDRAW_1_0_ACCEPTANCE_MATRIX.json', matrix),
])

const versionSourceUrl = new URL('packages/kjdraw-sdk/src/version.ts', root)
const versionSource = await readFile(versionSourceUrl, 'utf8')
const updatedVersionSource = versionSource.replace(
  /export const KJDRAW_VERSION = '[^']+' as const/,
  `export const KJDRAW_VERSION = '${version}' as const`,
)
if (updatedVersionSource === versionSource) throw new Error('Unable to update KJDRAW_VERSION')
await writeFile(versionSourceUrl, updatedVersionSource)

console.log(`Set repository, SDK, lockfile, runtime and acceptance matrix to ${version}.`)
console.log('Next: npm run build, then run the complete release gates before tagging.')
