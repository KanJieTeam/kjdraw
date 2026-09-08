import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('every public SDK module is strict TypeScript-owned and reproduces committed ESM', async () => {
  const root = new URL('../../../', import.meta.url)
  const sourceRoot = new URL('../src/', import.meta.url)
  const paths = (await readdir(sourceRoot, { recursive: true })).map(path => path.replaceAll('\\', '/'))
  const typescript = paths.filter(path => path.endsWith('.ts') && !path.endsWith('.d.ts')).sort()
  const javascript = paths.filter(path => path.endsWith('.js')).sort()
  const javascriptOnly = javascript.filter(path => !typescript.includes(`${path.slice(0, -3)}.ts`))
  assert.deepEqual(javascriptOnly, [], `JavaScript-only SDK modules remain: ${javascriptOnly.join(', ')}`)

  const result = spawnSync(process.execPath, ['--no-warnings', 'scripts/build-typescript.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, new RegExp(`Verified ${typescript.length} TypeScript-owned ESM modules`))

  for (const path of typescript) {
    const source = await readFile(new URL(path, sourceRoot), 'utf8')
    const output = await readFile(new URL(path.replace(/\.ts$/, '.js'), sourceRoot), 'utf8')
    assert.doesNotMatch(source, /@ts-(?:ignore|nocheck)|:\s*any\b|\bas\s+any\b/, `${path} weakens strict TypeScript ownership`)
    assert.match(output, new RegExp(`^// Generated from ${path.split('/').at(-1).replace('.', '\\.')} by scripts/build-typescript\\.mjs`))
  }

  const declarations = spawnSync(process.execPath, ['scripts/build-declarations.mjs', '--check'], { cwd: root, encoding: 'utf8' })
  assert.equal(declarations.status, 0, `${declarations.stdout}\n${declarations.stderr}`)
})
