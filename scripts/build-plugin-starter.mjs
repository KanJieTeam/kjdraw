import { stripTypeScriptTypes } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'

const sourceUrl = new URL('../examples/plugin-starter/src/index.ts', import.meta.url)
const outputUrl = new URL('../examples/plugin-starter/src/index.js', import.meta.url)
const source = await readFile(sourceUrl, 'utf8')
const runtime = stripTypeScriptTypes(source, { mode: 'transform', sourceMap: false })
  .replace(/\n*\/\/# sourceURL=.*$/s, '')
  .trimEnd()
const output = `// Generated from examples/plugin-starter/src/index.ts. Do not edit directly.\n${runtime}\n`
const current = await readFile(outputUrl, 'utf8').catch(() => '')
if (process.argv.includes('--check')) {
  if (current !== output) {
    console.error('Generated plugin starter ESM is stale.')
    process.exitCode = 1
  } else console.log('Verified TypeScript plugin starter ESM.')
} else {
  await writeFile(outputUrl, output)
  console.log('Built TypeScript plugin starter ESM.')
}
