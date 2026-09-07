import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const dir = 'packages/kjdraw-sdk/test'
const tests = (await readdir(new URL(`../${dir}/`, import.meta.url))).filter(x => x.endsWith('.test.mjs')).map(x => `${dir}/${x}`)
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' })
process.exit(result.status ?? 1)
