#!/usr/bin/env node

import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MAX_MANIFEST_BYTES = 64 * 1024
const SCHEMA = 'com.kanjie.kjdraw.install-current@1'

function fail(message) {
  process.stderr.write(`KJDraw launcher: ${message}\n`)
  process.exitCode = 1
}

async function item(path) {
  try { return await lstat(path) } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

function inside(root, candidate) {
  const part = relative(root, candidate)
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

async function main() {
  const launcher = fileURLToPath(import.meta.url)
  const installRoot = resolve(dirname(launcher), '..')
  const manifestPath = join(installRoot, 'current.json')
  const manifestInfo = await item(manifestPath)
  if (!manifestInfo?.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > MAX_MANIFEST_BYTES) throw new Error('current.json is missing or unsafe')

  let manifest
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch { throw new Error('current.json is not valid JSON') }
  if (manifest?.schema !== SCHEMA || !/^[a-f0-9]{40}$/u.test(manifest.sourceSha ?? '') || !isAbsolute(manifest.installDirectory ?? '')) throw new Error('current.json has an invalid schema')

  const canonicalRoot = await realpath(installRoot)
  const requestedInstall = resolve(manifest.installDirectory)
  if (!inside(canonicalRoot, requestedInstall) || dirname(requestedInstall) !== canonicalRoot) throw new Error('current install must be a direct child of the KJDraw data directory')
  if (requestedInstall.split(/[\\/]/u).at(-1) !== `source-${manifest.sourceSha.slice(0, 7)}`) throw new Error('current install directory does not match sourceSha')

  const installInfo = await item(requestedInstall)
  if (!installInfo?.isDirectory() || installInfo.isSymbolicLink()) throw new Error('current install directory is missing or unsafe')
  const canonicalInstall = await realpath(requestedInstall)
  if (dirname(canonicalInstall) !== canonicalRoot) throw new Error('current install resolves outside the KJDraw data directory')

  const markerPath = join(canonicalInstall, '.kjdraw-source-sha')
  const markerInfo = await item(markerPath)
  if (!markerInfo?.isFile() || markerInfo.isSymbolicLink() || (await readFile(markerPath, 'utf8')).trim() !== manifest.sourceSha) throw new Error('current install source marker does not match current.json')

  const mcpPath = join(canonicalInstall, 'packages', 'kjdraw-sdk', 'bin', 'kjdraw-mcp.mjs')
  const mcpInfo = await item(mcpPath)
  if (!mcpInfo?.isFile() || mcpInfo.isSymbolicLink()) throw new Error('current MCP entrypoint is missing or unsafe')
  process.env.KJDRAW_KNOWLEDGE_UPDATES ??= 'on'
  await import(pathToFileURL(mcpPath).href)
}

try { await main() } catch (error) { fail(error instanceof Error ? error.message : 'unexpected failure') }
