import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const packageRoot = join(repositoryRoot, 'packages', 'kjdraw-sdk')
const fixturesRoot = join(repositoryRoot, 'fixtures', 'consumer-types')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const rendered = [
      `$ ${command} ${args.join(' ')}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n')
    throw new Error(rendered)
  }
  return result
}

async function findNpmCli() {
  const candidates = new Set()
  const add = value => {
    if (typeof value === 'string' && value.trim()) candidates.add(resolve(value))
  }

  add(process.env.KJDRAW_NPM_CLI)
  add(process.env.npm_execpath)
  add(join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  add(join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))

  for (const root of [process.env.NVM_SYMLINK, process.env.APPDATA && join(process.env.APPDATA, 'npm')]) {
    if (root) add(join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  }

  const nvmRoots = new Set([
    process.env.NVM_HOME,
    process.env.APPDATA && join(process.env.APPDATA, 'nvm'),
  ].filter(Boolean).map(value => resolve(value)))
  for (const nvmRoot of nvmRoots) {
    try {
      const versions = (await readdir(nvmRoot, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && /^v?\d+\.\d+\.\d+/.test(entry.name))
        .map(entry => entry.name)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      for (const version of versions) add(join(nvmRoot, version, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    } catch {
      // NVM is optional. Other candidates remain available.
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error([
    'Unable to locate npm-cli.js.',
    'Run this audit through npm or set KJDRAW_NPM_CLI to an npm-cli.js path.',
  ].join(' '))
}

async function findTypeScriptCommand() {
  const classic = join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  if (existsSync(classic)) return { command: process.execPath, args: [classic] }

  const scope = join(repositoryRoot, 'node_modules', '@typescript')
  const platform = `${process.platform}-${process.arch === 'x64' ? 'x64' : process.arch}`
  let packageName
  try {
    packageName = (await readdir(scope)).find(name => name === `typescript-${platform}`)
  } catch {
    // The error below describes the remediation consistently.
  }
  if (!packageName) throw new Error(`TypeScript compiler unavailable for ${platform}. Run npm ci in the repository.`)

  const binary = join(scope, packageName, 'lib', `tsc${process.platform === 'win32' ? '.exe' : ''}`)
  if (!existsSync(binary)) throw new Error(`TypeScript compiler binary is missing: ${binary}`)
  return { command: binary, args: [] }
}

function parsePackResult(stdout) {
  const start = stdout.indexOf('[')
  const end = stdout.lastIndexOf(']')
  if (start === -1 || end === -1) throw new Error(`npm pack did not return JSON:\n${stdout}`)
  const entries = JSON.parse(stdout.slice(start, end + 1))
  assert.equal(entries.length, 1, 'npm pack must produce exactly one tarball')
  assert.equal(typeof entries[0]?.filename, 'string', 'npm pack result is missing filename')
  return entries[0]
}

function toPackageLockPath(path) {
  return path.replaceAll('\\', '/')
}

function findLockedPackageKey(packages, dependency, fromKey = '') {
  let cursor = fromKey
  while (cursor) {
    const nested = `${cursor}/node_modules/${dependency}`
    if (packages[nested]) return nested
    const parentIndex = cursor.lastIndexOf('/node_modules/')
    cursor = parentIndex === -1 ? '' : cursor.slice(0, parentIndex)
  }
  const rootKey = `node_modules/${dependency}`
  if (packages[rootKey]) return rootKey
  throw new Error(`Root package lock does not contain ${dependency} required from ${fromKey || '<consumer>'}`)
}

function collectLockedDependencyClosure(repositoryLock, directDependencies) {
  const packages = repositoryLock.packages ?? {}
  const selected = new Map()
  const queue = directDependencies.map(dependency => ({ dependency, fromKey: '' }))

  while (queue.length) {
    const request = queue.shift()
    const key = findLockedPackageKey(packages, request.dependency, request.fromKey)
    if (selected.has(key)) continue
    const record = packages[key]
    selected.set(key, record)
    for (const dependency of Object.keys({ ...record.dependencies, ...record.optionalDependencies })) {
      queue.push({ dependency, fromKey: key })
    }
    for (const dependency of Object.keys(record.peerDependencies ?? {})) {
      if (record.peerDependenciesMeta?.[dependency]?.optional !== true) queue.push({ dependency, fromKey: key })
    }
  }

  return Object.fromEntries(selected)
}

async function main() {
  const npmCli = await findNpmCli()
  const scratchParent = resolve(process.env.KJDRAW_AUDIT_TMPDIR || tmpdir())
  await mkdir(scratchParent, { recursive: true })
  const scratch = await mkdtemp(join(scratchParent, 'kjdraw-packed-consumer-'))
  const packDirectory = join(scratch, 'packed')
  const consumerDirectory = join(scratch, 'consumer')

  try {
    await mkdir(packDirectory, { recursive: true })
    await mkdir(consumerDirectory, { recursive: true })

    const pack = run(process.execPath, [
      npmCli,
      'pack',
      packageRoot,
      '--json',
      '--pack-destination',
      packDirectory,
    ])
    const packMetadata = parsePackResult(pack.stdout)
    const packedFiles = (await readdir(packDirectory, { recursive: true }))
      .filter(path => path.toLowerCase().endsWith('.tgz'))
    const expectedName = basename(packMetadata.filename)
    const packedPath = packedFiles.find(path => basename(path) === expectedName) ?? (packedFiles.length === 1 ? packedFiles[0] : null)
    assert.equal(typeof packedPath, 'string', `Unable to resolve packed tarball ${packMetadata.filename}; found ${packedFiles.join(', ')}`)
    const tarball = join(packDirectory, packedPath)
    assert.ok(existsSync(tarball), `Packed tarball is missing: ${tarball}`)

    await writeFile(join(consumerDirectory, 'package.json'), `${JSON.stringify({
      name: 'kjdraw-packed-consumer-audit',
      private: true,
      type: 'module',
    }, null, 2)}\n`)

    run(process.execPath, [
      npmCli,
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      tarball,
    ], { cwd: consumerDirectory })

    const installedRoot = join(consumerDirectory, 'node_modules', '@kanjieteam', 'kjdraw')
    const installedPackage = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
    assert.equal(installedPackage.name, '@kanjieteam/kjdraw')
    assert.equal(installedPackage.version, packMetadata.version)
    assert.deepEqual(installedPackage.dependencies ?? {}, {}, 'The public SDK must remain runtime-dependency-free')

    const publicSubpaths = Object.keys(installedPackage.exports)
    const frameworkEntries = { './react': 'react', './vue': 'vue' }
    for (const [entry, peer] of Object.entries(frameworkEntries)) {
      assert.ok(installedPackage.exports[entry], `Missing framework entry: ${entry}`)
      assert.equal(installedPackage.peerDependenciesMeta?.[peer]?.optional, true, `${peer} must remain an optional peer`)
    }
    const headlessProbePath = join(consumerDirectory, 'verify-without-frameworks.mjs')
    await writeFile(headlessProbePath, `for (const path of ${JSON.stringify(publicSubpaths.filter(path => !(path in frameworkEntries)))}) { await import(path === '.' ? '${installedPackage.name}' : '${installedPackage.name}/' + path.slice(2)) }`)
    run(process.execPath, [headlessProbePath], { cwd: consumerDirectory })

    // The first install deliberately has no framework peers. It proves every
    // headless entry before the framework-specific consumer is assembled.
    const repositoryPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
    const peerNames = ['react', 'react-dom', '@types/react', '@types/react-dom', 'vue']
    const peerVersions = Object.fromEntries(peerNames.map(name => {
      const version = repositoryPackage.devDependencies?.[name]
      assert.match(version ?? '', /^\d+\.\d+\.\d+/, `Pin the framework audit dependency: ${name}`)
      return [name, version]
    }))
    for (const name of peerNames) {
      assert.equal(existsSync(join(consumerDirectory, 'node_modules', ...name.split('/'))), false, `${name} must not be installed for the headless probe`)
    }

    // npm ci on a clean machine caches lockfile tarballs, but it does not
    // guarantee cached registry packuments for a later `npm install name@x`.
    // Reuse the repository's exact lock records and point the SDK entry at the
    // freshly packed tarball. npm ci can then install the real React/Vue graph
    // offline using resolved tarball URLs, with no registry name resolution.
    const repositoryLock = JSON.parse(await readFile(join(repositoryRoot, 'package-lock.json'), 'utf8'))
    const tarballSpecifier = `file:${toPackageLockPath(relative(consumerDirectory, tarball))}`
    const consumerPackage = {
      name: 'kjdraw-packed-framework-consumer-audit',
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies: { [installedPackage.name]: tarballSpecifier },
      devDependencies: peerVersions,
    }
    assert.match(packMetadata.integrity ?? '', /^sha512-/, 'npm pack result is missing an sha512 integrity value')
    const lockedPackages = collectLockedDependencyClosure(repositoryLock, peerNames)
    lockedPackages[`node_modules/${installedPackage.name}`] = {
      version: installedPackage.version,
      resolved: tarballSpecifier,
      integrity: packMetadata.integrity,
      license: installedPackage.license,
      bin: installedPackage.bin,
      engines: installedPackage.engines,
      peerDependencies: installedPackage.peerDependencies,
      peerDependenciesMeta: installedPackage.peerDependenciesMeta,
    }
    const consumerLock = {
      name: consumerPackage.name,
      version: consumerPackage.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: consumerPackage.name,
          version: consumerPackage.version,
          dependencies: consumerPackage.dependencies,
          devDependencies: consumerPackage.devDependencies,
        },
        ...lockedPackages,
      },
    }
    await writeFile(join(consumerDirectory, 'package.json'), `${JSON.stringify(consumerPackage, null, 2)}\n`)
    await writeFile(join(consumerDirectory, 'package-lock.json'), `${JSON.stringify(consumerLock, null, 2)}\n`)
    run(process.execPath, [npmCli, 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumerDirectory })
    for (const [name, version] of Object.entries(peerVersions)) {
      const manifest = JSON.parse(await readFile(join(consumerDirectory, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'))
      assert.equal(manifest.version, version, `${name} must match the root lock`)
    }
    const importProbe = `
const packageName = ${JSON.stringify(installedPackage.name)}
const subpaths = ${JSON.stringify(publicSubpaths)}
const results = []
for (const subpath of subpaths) {
  const specifier = subpath === '.' ? packageName : \`${'${packageName}'}\/${'${subpath.slice(2)}'}\`
  const namespace = await import(specifier)
  const exports = Object.keys(namespace).sort()
  if (exports.length === 0) throw new Error(\`Empty module namespace for ${'${specifier}'}\`)
  results.push({ specifier, exports })
}
console.log(JSON.stringify(results))
`.trimStart()
    const importProbePath = join(consumerDirectory, 'verify-imports.mjs')
    await writeFile(importProbePath, importProbe)
    const imports = run(process.execPath, [importProbePath], { cwd: consumerDirectory })
    const importResults = JSON.parse(imports.stdout)
    assert.equal(importResults.length, publicSubpaths.length, 'Not every public export was imported')

    const quickstartPath = join(installedRoot, 'examples', 'quickstart.mjs')
    assert.ok(existsSync(quickstartPath), 'The packed quickstart example is missing')
    const quickstart = run(process.execPath, [quickstartPath], { cwd: consumerDirectory })
    const quickstartResult = JSON.parse(quickstart.stdout)
    assert.equal(quickstartResult.sdkVersion, installedPackage.version)
    assert.equal(quickstartResult.documentId, 'npm-quickstart')
    assert.equal(quickstartResult.entities, 1)
    assert.deepEqual(quickstartResult.line.start, [25, 10, 0])
    assert.deepEqual(quickstartResult.line.end, [125, 10, 0])

    const cliPath = join(installedRoot, installedPackage.bin?.kjdraw ?? '')
    assert.ok(installedPackage.bin?.kjdraw && existsSync(cliPath), 'The packed kjdraw CLI is missing')
    const cliVersion = run(process.execPath, [cliPath, '--version'], { cwd: consumerDirectory })
    assert.equal(cliVersion.stdout.trim(), installedPackage.version)

    const consumerSources = join(consumerDirectory, 'src')
    await cp(fixturesRoot, consumerSources, { recursive: true })
    await writeFile(join(consumerDirectory, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        jsx: 'react-jsx',
        lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        verbatimModuleSyntax: true,
        skipLibCheck: false,
      },
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/framework-shims.d.ts'],
    }, null, 2)}\n`)
    const compiler = await findTypeScriptCommand()
    run(compiler.command, [
      ...compiler.args,
      '--project',
      join(consumerDirectory, 'tsconfig.json'),
      '--pretty',
      'false',
    ], { cwd: consumerDirectory })

    const totalExportBindings = importResults.reduce((total, entry) => total + entry.exports.length, 0)
    console.log(JSON.stringify({
      ok: true,
      package: `${installedPackage.name}@${installedPackage.version}`,
      tarball: basename(tarball),
      packedFiles: packMetadata.entryCount,
      unpackedBytes: packMetadata.unpackedSize,
      publicEntryPoints: importResults.length,
      importedBindings: totalExportBindings,
      frameworkInstall: {
        mode: 'locked-offline-npm-ci',
        packages: peerVersions,
      },
      typedConsumers: ['Vanilla TypeScript', 'React TSX', 'Vue composable'],
      cli: 'kjdraw --version',
      quickstart: {
        documentId: quickstartResult.documentId,
        revision: quickstartResult.revision,
        entities: quickstartResult.entities,
      },
    }, null, 2))
  } finally {
    if (process.env.KJDRAW_KEEP_PACK_AUDIT === '1') {
      console.error(`Packed consumer audit retained at ${scratch}`)
    } else {
      await rm(scratch, { recursive: true, force: true })
    }
  }
}

await main()
