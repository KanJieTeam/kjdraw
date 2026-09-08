import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const packageRoot = join(repositoryRoot, 'packages', 'kjdraw-sdk')
const committedRoot = join(packageRoot, 'types')
const check = process.argv.includes('--check')

async function findCompiler() {
  const classic = join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  if (existsSync(classic)) return { command: process.execPath, args: [classic] }

  const scope = join(repositoryRoot, 'node_modules', '@typescript')
  const platform = `${process.platform}-${process.arch === 'x64' ? 'x64' : process.arch}`
  const packageName = (await readdir(scope)).find(name => name === `typescript-${platform}`)
  if (!packageName) throw new Error(`TypeScript compiler unavailable for ${platform}. Run npm ci.`)
  const binary = join(scope, packageName, 'lib', `tsc${process.platform === 'win32' ? '.exe' : ''}`)
  if (!existsSync(binary)) throw new Error(`TypeScript compiler binary is missing: ${binary}`)
  return { command: binary, args: [] }
}

async function filesUnder(root) {
  if (!existsSync(root)) return []
  const paths = []
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) paths.push(relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  }
  return paths.sort()
}

const scratch = await mkdtemp(join(tmpdir(), 'kjdraw-declarations-'))
const generatedRoot = join(scratch, 'types')
try {
  const compiler = await findCompiler()
  const result = spawnSync(compiler.command, [
    ...compiler.args,
    '--project', join(packageRoot, 'tsconfig.declarations.json'),
    '--outDir', generatedRoot,
  ], { cwd: repositoryRoot, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)

  const generated = await filesUnder(generatedRoot)
  if (!generated.length) throw new Error('TypeScript emitted no declarations')

  if (check) {
    const committed = await filesUnder(committedRoot)
    const all = [...new Set([...generated, ...committed])].sort()
    const stale = []
    for (const path of all) {
      const left = await readFile(join(generatedRoot, path), 'utf8').catch(() => null)
      const right = await readFile(join(committedRoot, path), 'utf8').catch(() => null)
      if (left !== right) stale.push(path)
    }
    if (stale.length) {
      console.error(`Generated declarations are stale:\n${stale.map(path => `- ${path}`).join('\n')}`)
      process.exitCode = 1
    } else {
      console.log(`Verified ${generated.length} generated declaration files.`)
    }
  } else {
    await rm(committedRoot, { recursive: true, force: true })
    await mkdir(committedRoot, { recursive: true })
    await cp(generatedRoot, committedRoot, { recursive: true })
    console.log(`Built ${generated.length} declaration files from strict TypeScript sources.`)
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}
