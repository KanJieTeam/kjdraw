#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// This installer is deliberately locked to one public release candidate. It
// must be updated only after the candidate package and provenance exist.
export const CANDIDATE_VERSION = '1.0.0-rc.3'
const PACKAGE = '@kanjieteam/kjdraw'
const REGISTRY = 'https://registry.npmjs.org/'
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const sha256 = value => createHash('sha256').update(value).digest('hex')
class InstallerError extends Error {}
function fail(message) { throw new InstallerError(message) }

function parseArgs(argv) {
  const values = new Map()
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--dry-run') {
      if (values.has(key)) fail('Duplicate installer option')
      values.set(key, true)
      continue
    }
    if (!['--project', '--blank', '--candidate-sha', '--integrity', '--units', '--geology-column-pack', '--geology-column-pack-sha256', '--geology-section-pack', '--geology-section-pack-sha256'].includes(key) || values.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) fail('Unknown, duplicate or incomplete installer option')
    values.set(key, argv[++i])
  }
  if (!['--project', '--blank', '--candidate-sha', '--integrity'].every(key => values.has(key))) fail('Explicit project, new KJD path, candidate SHA and release integrity are required')
  const units = values.get('--units') ?? 'millimeter'
  if (!['millimeter', 'meter'].includes(units)) fail('Units must be millimeter or meter')
  if (values.has('--geology-column-pack') !== values.has('--geology-column-pack-sha256')) fail('Geology column pack path and SHA-256 must be supplied together')
  if (values.has('--geology-column-pack-sha256') && !/^[a-f0-9]{64}$/u.test(values.get('--geology-column-pack-sha256'))) fail('Geology column pack SHA-256 must be lowercase hexadecimal')
  if (values.has('--geology-section-pack') !== values.has('--geology-section-pack-sha256')) fail('Geology section pack path and SHA-256 must be supplied together')
  if (values.has('--geology-section-pack-sha256') && !/^[a-f0-9]{64}$/u.test(values.get('--geology-section-pack-sha256'))) fail('Geology section pack SHA-256 must be lowercase hexadecimal')
  return { project: values.get('--project'), blank: values.get('--blank'), candidateSha: values.get('--candidate-sha'), integrity: values.get('--integrity'), units, dryRun: values.has('--dry-run'),
    geologyColumnPack: values.get('--geology-column-pack'), geologyColumnPackSha256: values.get('--geology-column-pack-sha256'),
    geologySectionPack: values.get('--geology-section-pack'), geologySectionPackSha256: values.get('--geology-section-pack-sha256') }
}

export function validatePublishedCandidate(metadata, lock) {
  if (!/^[a-f0-9]{40}$/iu.test(lock.candidateSha) || !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(lock.integrity)) fail('Candidate SHA and sha512 integrity must be explicit release evidence')
  if (metadata.next !== CANDIDATE_VERSION) fail('npm next does not point to the exact KJDraw candidate; no package installed')
  if (metadata.version !== CANDIDATE_VERSION || metadata.gitHead?.toLowerCase() !== lock.candidateSha.toLowerCase() || metadata.integrity !== lock.integrity) fail('Published package version, source SHA or integrity differs from the release lock; no package installed')
  return true
}

export function validatePackedTarball(bytes, integrity) {
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity) fail('Downloaded candidate tarball differs from locked release integrity; no package installed')
  return true
}

function inside(root, target) {
  const part = relative(root, target)
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part))
}

async function item(path) {
  try { return await lstat(path) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

function relativeChild(value, label) {
  if (!value || isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.split(/[\\/]+/u).some(part => !part || part === '.' || part === '..')) fail(`${label} must be an unambiguous project-relative path`)
  return value
}

async function checkedChild(root, child, label, mustBeNew = false) {
  const target = resolve(root, relativeChild(child, label))
  if (!inside(root, target) || target === root) fail(`${label} must remain inside the project`)
  let cursor = root
  for (const part of relative(root, target).split(sep)) {
    cursor = resolve(cursor, part)
    const info = await item(cursor)
    if (info?.isSymbolicLink() || (cursor !== target && info && !info.isDirectory())) fail(`${label} contains an unsafe existing path`)
    if (cursor === target && mustBeNew && info) fail(`${label} already exists; no existing files are overwritten`)
  }
  return target
}

async function trustedNpmCli(project) {
  if (Number(process.versions.node.split('.')[0]) < 22) fail('Existing Node.js >=22 is required')
  const node = await realpath(process.execPath)
  if (inside(project, node) || /[\\/]_npx[\\/]/iu.test(node)) fail('Project-local or temporary Node.js is not a trusted installer runtime')
  const candidates = [
    resolve(dirname(node), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(node), '../node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js'),
  ]
  for (const candidate of candidates) {
    let info
    try { info = await item(candidate) }
    catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) continue; throw error }
    if (!info) continue
    if (!info.isFile() || info.isSymbolicLink() || inside(project, candidate) || /[\\/]_npx[\\/]/iu.test(candidate)) fail('npm CLI next to Node.js is not a trusted regular file')
    return candidate
  }
  fail('An existing npm CLI next to Node.js is required; this installer does not install Node or npm')
}

function npm(npmCli, args, timeout = 30000) {
  const result = spawnSync(process.execPath, [npmCli, ...args, `--registry=${REGISTRY}`], {
    encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, windowsHide: true,
  })
  // npm output can include local config, registry diagnostics or credentials.
  if (result.status !== 0 || result.error) fail('Public npm registry check or install failed; no published-candidate claim is available')
  return result.stdout.trim()
}

function npmJson(npmCli, args) {
  try { return JSON.parse(npm(npmCli, [...args, '--json'])) }
  catch { fail('Public npm registry returned invalid candidate metadata') }
}

async function publishedMetadata(npmCli) {
  return {
    next: npmJson(npmCli, ['view', PACKAGE, 'dist-tags.next']),
    version: npmJson(npmCli, ['view', `${PACKAGE}@${CANDIDATE_VERSION}`, 'version']),
    gitHead: npmJson(npmCli, ['view', `${PACKAGE}@${CANDIDATE_VERSION}`, 'gitHead']),
    integrity: npmJson(npmCli, ['view', `${PACKAGE}@${CANDIDATE_VERSION}`, 'dist.integrity']),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!isAbsolute(options.project)) fail('Project must be an explicit absolute local directory, not a URL')
  const projectEntry = await item(options.project)
  if (!projectEntry?.isDirectory() || projectEntry.isSymbolicLink()) fail('Project must be an existing real directory')
  const project = await realpath(options.project)
  if (extname(options.blank).toLowerCase() !== '.kjd') fail('New host drawing must be a .kjd file')
  await checkedChild(project, options.blank, 'New host drawing', true)
  if (options.geologyColumnPack) {
    const packPath = await checkedChild(project, options.geologyColumnPack, 'Geology column pack')
    const packInfo = await item(packPath)
    if (!packInfo?.isFile() || packInfo.isSymbolicLink() || packInfo.size > 1024 * 1024) fail('Geology column pack must be an existing regular file no larger than 1 MiB')
    const packBytes = await readFile(packPath)
    if (sha256(packBytes) !== options.geologyColumnPackSha256) fail('Geology column pack bytes do not match the host-supplied SHA-256')
    try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(packBytes)) }
    catch { fail('Geology column pack must be strict UTF-8 JSON') }
  }
  if (options.geologySectionPack) {
    const packPath = await checkedChild(project, options.geologySectionPack, 'Geology section pack')
    const packInfo = await item(packPath)
    if (!packInfo?.isFile() || packInfo.isSymbolicLink() || packInfo.size > 1024 * 1024) fail('Geology section pack must be an existing regular file no larger than 1 MiB')
    const packBytes = await readFile(packPath)
    if (sha256(packBytes) !== options.geologySectionPackSha256) fail('Geology section pack bytes do not match the host-supplied SHA-256')
    try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(packBytes)) }
    catch { fail('Geology section pack must be strict UTF-8 JSON') }
  }
  const vendorRelative = `.kjdraw/vendor/kjdraw-${CANDIDATE_VERSION}`
  const vendor = await checkedChild(project, vendorRelative, 'Candidate install directory', true)
  const localPackage = JSON.parse(await readFile(join(SCRIPT_DIR, '../packages/kjdraw-sdk/package.json'), 'utf8'))
  if (localPackage.name !== PACKAGE || localPackage.version !== CANDIDATE_VERSION) fail('Local bootstrap source and locked candidate version differ')
  const npmCli = await trustedNpmCli(project)
  validatePublishedCandidate(await publishedMetadata(npmCli), options)
  const receipt = { product: 'KJDraw', version: CANDIDATE_VERSION, sourceCommit: options.candidateSha.toLowerCase(), packageIntegritySha256: sha256(options.integrity), projectPathSha256: sha256(project), guiVerified: false, realModelInvoked: false, hostApprovalRequired: true }
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ ...receipt, dryRun: true, writesPerformed: 0, installReadyForExactCandidate: true })}\n`)
    return
  }
  await checkedChild(project, options.blank, 'New host drawing', true)
  await checkedChild(project, vendorRelative, 'Candidate install directory', true)
  await mkdir(dirname(vendor), { recursive: true })
  await mkdir(vendor)
  const packedName = npm(npmCli, ['pack', `${PACKAGE}@${CANDIDATE_VERSION}`, '--pack-destination', vendor, '--ignore-scripts', '--silent'], 120000)
  const expectedName = `kanjieteam-kjdraw-${CANDIDATE_VERSION}.tgz`
  if (packedName !== expectedName) fail('Published npm tarball name differs from the exact candidate')
  const packedPath = join(vendor, expectedName)
  const packedInfo = await item(packedPath)
  if (!packedInfo?.isFile() || packedInfo.isSymbolicLink() || packedInfo.size > 64 * 1024 * 1024) fail('Candidate tarball is not a bounded regular file')
  validatePackedTarball(await readFile(packedPath), options.integrity)
  npm(npmCli, ['install', '--offline', '--prefix', vendor, packedPath, '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', '--package-lock=false', '--omit=optional', '--omit=peer'], 120000)
  const packageDir = join(vendor, 'node_modules/@kanjieteam/kjdraw')
  const installed = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  const connect = join(packageDir, 'bin/kjdraw-connect.mjs')
  const connectEntry = await item(connect)
  if (installed.name !== PACKAGE || installed.version !== CANDIDATE_VERSION || !connectEntry?.isFile() || connectEntry.isSymbolicLink()) fail('Installed candidate package identity or connect binary failed verification')
  const run = spawnSync(process.execPath, [connect, '--all', '--apply', '--workspace', project, '--blank', options.blank, '--units', options.units,
    ...(options.geologyColumnPack ? ['--geology-column-pack', options.geologyColumnPack, '--geology-column-pack-sha256', options.geologyColumnPackSha256] : []),
    ...(options.geologySectionPack ? ['--geology-section-pack', options.geologySectionPack, '--geology-section-pack-sha256', options.geologySectionPackSha256] : [])], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true,
  })
  if (run.status !== 0 || run.error) fail('Installed candidate connect failed; candidate package remains in the explicit project vendor directory for inspection')
  let connected
  try { connected = JSON.parse(run.stdout.trim()) }
  catch { fail('Installed candidate connect returned invalid receipt') }
  if (!connected.applied || connected.clients?.length !== 4 || connected.configurationEvidence?.guiVerified !== false) fail('Installed candidate connect did not confirm four scoped configuration candidates')
  process.stdout.write(`${JSON.stringify({ ...receipt, dryRun: false, connectConfigured: true, clients: connected.clients.map(client => ({ client: client.client, status: client.status })) })}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Never print raw npm diagnostics, environment, absolute project paths or keys.
    process.stderr.write(`KJDraw installer: ${error instanceof InstallerError ? error.message : 'Candidate verification or local file inspection failed safely'}\n`)
    process.exitCode = 1
  })
}
