import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackageInstallCandidateEvidence } from './package-install-candidate-evidence.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const argument = name => {
  const index = process.argv.indexOf(name)
  return index < 0 ? null : process.argv[index + 1]
}
const inputPath = argument('--input')
if (!inputPath) throw new Error('Usage: node scripts/audits/verify-package-install-candidate.mjs --input <audit.json> [--output <evidence.json>]')
const candidatePath = path => isAbsolute(path) ? path : resolve(root, path)
const input = JSON.parse(await readFile(candidatePath(inputPath), 'utf8'))
if (input.releaseManifestPath) {
  const bytes = await readFile(candidatePath(input.releaseManifestPath))
  input.releaseManifest = JSON.parse(bytes)
  input.releaseManifestSha256 = createHash('sha256').update(bytes).digest('hex')
}
const packageJson = JSON.parse(await readFile(resolve(root, 'packages/kjdraw-sdk/package.json'), 'utf8'))
const repositoryJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const repositoryUrl = String(repositoryJson.repository?.url ?? repositoryJson.repository ?? packageJson.repository?.url ?? packageJson.repository ?? '')
const repository = argument('--repository') ?? process.env.GITHUB_REPOSITORY ?? repositoryUrl.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/i)?.[1]
const commit = argument('--commit') ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
const evidence = buildPackageInstallCandidateEvidence(input, { repository, commit, packageName: packageJson.name, packageVersion: packageJson.version })
const output = candidatePath(argument('--output') ?? '.cache/release-evidence/package-install-candidate.json')
await mkdir(dirname(output), { recursive: true })
const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`
const handle = await open(temporary, 'wx')
try {
  await handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`)
  await handle.sync()
  await handle.close()
  await link(temporary, output)
} catch (error) {
  await handle.close().catch(() => {})
  throw error
} finally {
  await unlink(temporary).catch(() => {})
}
console.log(JSON.stringify({ evidence: output, repository, commit, package: `${packageJson.name}@${packageJson.version}`, artifact: evidence.artifact, consumers: evidence.consumers.map(row => row.id), pagesRunId: evidence.demoAndDocs.pagesRunId }, null, 2))
