import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildExternalAcceptanceEvidence } from './external-acceptance-evidence.mjs'

const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex')

export async function recordExternalAcceptance(input, { candidate, artifactPath, kjdPath, dxfPath }) {
  for (const [name, path] of Object.entries({ artifactPath, kjdPath, dxfPath })) {
    if (typeof path !== 'string' || !path.trim()) throw new Error(`${name} is required`)
  }
  const evidence = buildExternalAcceptanceEvidence(input, candidate)
  const checks = [
    ['Package artifact', artifactPath, evidence.package.artifactSha256],
    ['KJD', kjdPath, evidence.workflow.artifacts.kjdSha256],
    ['DXF', dxfPath, evidence.workflow.artifacts.dxfSha256],
  ]
  for (const [name, path, expected] of checks) {
    if (await hashFile(path) !== expected) throw new Error(`${name} SHA-256 does not match the independent report`)
  }
  return evidence
}

function option(args, name, fallback) {
  const values = args.filter(value => value.startsWith(`--${name}=`))
  if (values.length > 1) throw new Error(`Duplicate --${name} option`)
  return values[0]?.slice(name.length + 3) ?? fallback
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(value => !/^--(?:input|output|artifact|kjd|dxf)=.+$/.test(value))) throw new Error('Options: --input, --output, --artifact, --kjd, --dxf')
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const sdk = JSON.parse(await readFile(resolve(root, 'packages/kjdraw-sdk/package.json'), 'utf8'))
  const repository = String(sdk.repository?.url ?? '').match(/^git\+https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\.git$/i)?.[1]
  if (!repository) throw new Error('Package repository is not a canonical GitHub URL')
  const candidate = {
    repository,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    packageName: sdk.name,
    packageVersion: sdk.version,
  }
  const inputPath = option(args, 'input'), outputPath = resolve(root, option(args, 'output', '.cache/release-evidence/external-acceptance.json'))
  if (!inputPath) throw new Error('Provide --input from an independent tester')
  const input = JSON.parse(await readFile(resolve(inputPath), 'utf8'))
  const evidence = await recordExternalAcceptance(input, {
    candidate,
    artifactPath: option(args, 'artifact'),
    kjdPath: option(args, 'kjd'),
    dxfPath: option(args, 'dxf'),
  })
  const bytes = `${JSON.stringify(evidence, null, 2)}\n`
  await mkdir(dirname(outputPath), { recursive: true })
  try { await writeFile(outputPath, bytes, { flag: 'wx' }) } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    if (await readFile(outputPath, 'utf8') !== bytes) throw new Error('Existing immutable acceptance evidence differs')
  }
  console.log(JSON.stringify({ status: 'recorded', output: outputPath, commit: candidate.commit }))
}