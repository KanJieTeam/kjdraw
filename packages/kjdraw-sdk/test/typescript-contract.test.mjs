import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createKJDrawSDK } from '../src/index.js'

const packageUrl = new URL('../package.json', import.meta.url)
const declarationUrl = new URL('../types/index.d.ts', import.meta.url)

test('package exposes the public TypeScript declarations', async () => {
  const manifest = JSON.parse(await readFile(packageUrl, 'utf8'))
  const declarations = await readFile(declarationUrl, 'utf8')

  assert.equal(manifest.types, './types/index.d.ts')
  assert.ok(manifest.files.includes('types'))
  assert.match(declarations, /export class KJDrawSDK/)
  assert.match(declarations, /export class KJDocument/)
  assert.match(declarations, /export interface KJCommandEnvelope/)
  assert.match(declarations, /export class KJProjectSession/)
  assert.match(declarations, /export class KJDeploymentRegistry/)
  assert.match(declarations, /export function createDeploymentProfile/)
})

test('runtime SDK version matches the published package version', async () => {
  const manifest = JSON.parse(await readFile(packageUrl, 'utf8'))
  assert.equal(createKJDrawSDK().version, manifest.version)
})
