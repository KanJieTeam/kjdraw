import { stripTypeScriptTypes } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'

const modules = ['packages/kjdraw-sdk/src/deployment']
const check = process.argv.includes('--check')
let changed = 0

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
