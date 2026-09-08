import { stripTypeScriptTypes } from 'node:module'
import { readFile, readdir, writeFile } from 'node:fs/promises'

const sourceRoot = new URL('../packages/kjdraw-sdk/src/', import.meta.url)
const discovered = (await readdir(sourceRoot, { recursive: true }))
  .map(path => path.replaceAll('\\', '/'))
  .filter(path => path.endsWith('.ts') && !path.endsWith('.d.ts'))
  .map(path => `packages/kjdraw-sdk/src/${path.slice(0, -3)}`)
  .sort()
const only = process.argv.find(argument => argument.startsWith('--only='))?.slice('--only='.length).split(',').filter(Boolean)
const modules = only?.length
  ? discovered.filter(modulePath => only.includes(modulePath.slice('packages/kjdraw-sdk/src/'.length)))
  : discovered
const check = process.argv.includes('--check')
let changed = 0

if (only?.length && modules.length !== only.length) {
  const found = new Set(modules.map(modulePath => modulePath.slice('packages/kjdraw-sdk/src/'.length)))
  throw new Error(`Unknown TypeScript module(s): ${only.filter(name => !found.has(name)).join(', ')}`)
}

for (const modulePath of modules) {
  const source = await readFile(new URL(`../${modulePath}.ts`, import.meta.url), 'utf8')
  const compiled = stripTypeScriptTypes(source, { mode: 'transform', sourceMap: false })
    .replace(/\n*\/\/# sourceURL=.*$/s, '')
    .trimEnd()
  const output = `// Generated from ${modulePath.split('/').at(-1)}.ts by scripts/build-typescript.mjs. Do not edit directly.\n${compiled}\n`
  const target = new URL(`../${modulePath}.js`, import.meta.url)
  const current = await readFile(target, 'utf8').catch(() => '')
  if (current !== output) {
    changed += 1
    if (!check) await writeFile(target, output)
    else console.error(`Generated ESM is stale: ${modulePath}.js`)
  }
}

if (check && changed) process.exitCode = 1
else console.log(`${check ? 'Verified' : 'Built'} ${modules.length} TypeScript-owned ESM module${modules.length === 1 ? '' : 's'}.`)
