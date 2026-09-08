import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createKJDrawSDK } from '../src/index.js'

const packageUrl = new URL('../package.json', import.meta.url)
const declarationUrl = new URL('../types/index.d.ts', import.meta.url)

const declarationModules = {
  agentPlans: new URL('../types/agent-plans.d.ts', import.meta.url),
  deployment: new URL('../types/deployment.d.ts', import.meta.url),
  document: new URL('../types/document.d.ts', import.meta.url),
  productContract: new URL('../types/product-contract.d.ts', import.meta.url),
  projectSession: new URL('../types/project-session.d.ts', import.meta.url),
  sdk: new URL('../types/sdk.d.ts', import.meta.url),
}

test('package exposes the public TypeScript declarations', async () => {
  const manifest = JSON.parse(await readFile(packageUrl, 'utf8'))
  const declarations = await readFile(declarationUrl, 'utf8')
  const modules = Object.fromEntries(
    await Promise.all(
      Object.entries(declarationModules).map(async ([name, url]) => [name, await readFile(url, 'utf8')]),
    ),
  )

  assert.equal(manifest.types, './types/index.d.ts')
  assert.ok(manifest.files.includes('types'))
  for (const moduleName of [
    'agent-plans',
    'deployment',
    'document',
    'product-contract',
    'project-session',
    'sdk',
  ]) {
    assert.match(declarations, new RegExp(`export \\* from './${moduleName}\\.js';`))
  }
  assert.match(modules.sdk, /export declare class KJDrawSDK/)
  assert.match(modules.document, /export declare class KJDocument/)
  assert.match(modules.productContract, /export interface KJCommandEnvelope/)
  assert.match(modules.projectSession, /export declare class KJProjectSession/)
  assert.match(modules.deployment, /export declare class KJDeploymentRegistry/)
  assert.match(modules.deployment, /export declare function createDeploymentProfile/)
  assert.match(modules.agentPlans, /export declare class KJAgentPlanRegistry/)
  assert.match(modules.agentPlans, /export interface KJAgentPlanRecord/)
})

test('runtime SDK version matches the published package version', async () => {
  const manifest = JSON.parse(await readFile(packageUrl, 'utf8'))
  assert.equal(createKJDrawSDK().version, manifest.version)
})
