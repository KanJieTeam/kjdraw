import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('TypeScript-owned modules reproduce their committed browser ESM exactly', async () => {
  const root = new URL('../../../', import.meta.url)
  const result = spawnSync(process.execPath, ['--no-warnings', 'scripts/build-typescript.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /Verified 2 TypeScript-owned ESM modules/)
  const source = await readFile(new URL('../src/deployment.ts', import.meta.url), 'utf8')
  const output = await readFile(new URL('../src/deployment.js', import.meta.url), 'utf8')
  assert.match(source, /export interface KJProjectStoreProvider/)
  assert.match(source, /export interface KJComputeProvider/)
  assert.match(source, /export interface KJSceneProvider/)
  assert.match(output, /^\/\/ Generated from deployment\.ts/)
  const agentSource = await readFile(new URL('../src/agent-plans.ts', import.meta.url), 'utf8')
  const agentOutput = await readFile(new URL('../src/agent-plans.js', import.meta.url), 'utf8')
  assert.match(agentSource, /export class KJAgentPlanRegistry/)
  assert.match(agentOutput, /^\/\/ Generated from agent-plans\.ts/)
})
