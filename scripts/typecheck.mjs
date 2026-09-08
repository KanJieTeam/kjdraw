import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = ['--project', 'packages/kjdraw-sdk/tsconfig.json', '--noEmit']
const classic = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

let command = process.execPath
let commandArgs = [classic, ...args]

if (!existsSync(classic)) {
  const scope = fileURLToPath(new URL('../node_modules/@typescript/', import.meta.url))
  const platform = `${process.platform}-${process.arch === 'x64' ? 'x64' : process.arch}`
  const packageName = (await readdir(scope)).find(name => name === `typescript-${platform}`)
  if (!packageName) throw new Error(`TypeScript 7 compiler binary is unavailable for ${platform}. Run npm ci.`)
  const binary = fileURLToPath(new URL(`../node_modules/@typescript/${packageName}/lib/tsc${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
  if (!existsSync(binary)) throw new Error(`TypeScript compiler binary is missing: ${binary}`)
  command = binary
  commandArgs = args
}

const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' })
process.exit(result.status ?? 1)
