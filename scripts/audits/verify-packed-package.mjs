import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
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

function visitSyntax(node, visit) {
  if (!node || typeof node !== 'object') return
  if (typeof node.type === 'string') visit(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visitSyntax(child, visit))
    else if (value && typeof value === 'object') visitSyntax(value, visit)
  }
}

async function prepareReadmeConsumers(consumerDirectory, installedPackage) {
  // Vue's existing locked dependency graph supplies the parsers. Resolve them
  // from the isolated install, so this audit adds no development dependencies.
  const requireConsumer = createRequire(join(consumerDirectory, 'package.json'))
  const { babelParse, parse: parseSfc, compileScript, compileTemplate } = requireConsumer('@vue/compiler-sfc')
  const { parse: parseTemplate, NodeTypes } = requireConsumer('@vue/compiler-dom')
  const publicImports = new Set(Object.keys(installedPackage.exports).map(subpath =>
    subpath === '.' ? installedPackage.name : `${installedPackage.name}/${subpath.slice(2)}`))
  const allowedImports = new Set([...publicImports, ...Object.keys(installedPackage.peerDependencies ?? {})])
  const report = []

  function parseScript(source, filename, tsx = false) {
    const ast = babelParse(source, { sourceType: 'module', plugins: ['typescript', ...(tsx ? ['jsx'] : [])] })
    visitSyntax(ast, node => {
      let specifier
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)) specifier = node.source
      if (node.type === 'TSImportType') specifier = node.argument
      if (node.type === 'ImportExpression') specifier = node.source
      if (node.type === 'CallExpression' && (node.callee.type === 'Import' || (node.callee.type === 'Identifier' && node.callee.name === 'require'))) specifier = node.arguments[0]
      if (specifier !== undefined && specifier !== null) {
        assert.equal(specifier.type, 'StringLiteral', `${filename}: example imports must use literal public package specifiers`)
        assert.ok(allowedImports.has(specifier.value), `${filename}: ${specifier.value} is not a public SDK export or declared framework peer`)
      }
    })
    return ast
  }

  for (const readme of ['README.md', 'README.zh-CN.md']) {
    const markdown = (await readFile(join(repositoryRoot, readme), 'utf8')).replaceAll('\r\n', '\n')
    const snippets = [...markdown.matchAll(/^```(ts|tsx|vue|html)\s*\n([\s\S]*?)^```\s*$/gm)]
      .map((match, index) => ({ language: match[1], source: match[2], name: `${readme.replaceAll('.', '-')}-${index + 1}` }))
    for (const language of ['ts', 'tsx', 'vue', 'html']) {
      assert.ok(snippets.some(snippet => snippet.language === language), `${readme}: missing ${language} integration example`)
    }
    const html = snippets.filter(snippet => snippet.language === 'html').map(snippet => snippet.source).join('\n')
    const hosts = new Map()
    function visitTemplate(node, visit) {
      if (node.type === NodeTypes.ELEMENT) visit(node)
      for (const child of node.children ?? []) visitTemplate(child, visit)
    }
    visitTemplate(parseTemplate(html), node => {
      const attributes = Object.fromEntries(node.props.filter(prop => prop.type === NodeTypes.ATTRIBUTE)
        .map(prop => [prop.name, prop.value?.content ?? '']))
      if (attributes.id) hosts.set(`#${attributes.id}`, attributes)
    })
    let checkedHosts = 0
    let checkedVueProps = 0
    for (const snippet of snippets) {
      if (snippet.language === 'html') continue
      const filename = `${snippet.name}.${snippet.language === 'tsx' ? 'tsx' : 'ts'}`
      let source = snippet.source
      if (snippet.language === 'vue') {
        const { descriptor, errors } = parseSfc(source, { filename: `${snippet.name}.vue` })
        assert.deepEqual(errors, [], `${readme}: Vue SFC parsing failed`)
        assert.ok(descriptor.scriptSetup && !descriptor.script && descriptor.template, `${readme}: audit expects a script-setup Vue example with a template`)
        const script = compileScript(descriptor, { id: snippet.name })
        const template = compileTemplate({
          source: descriptor.template.content,
          filename: `${snippet.name}.vue`,
          id: snippet.name,
          compilerOptions: { bindingMetadata: script.bindings },
        })
        assert.deepEqual(template.errors, [], `${readme}: Vue template compilation failed`)
        source = descriptor.scriptSetup.content
        const ast = parseScript(source, filename)
        const componentNames = ast.program.body.filter(node => node.type === 'ImportDeclaration' && node.source.value === `${installedPackage.name}/vue`)
          .flatMap(node => node.specifiers.filter(specifier => specifier.type === 'ImportSpecifier' && specifier.imported.name === 'KJDraw').map(specifier => specifier.local.name))
        let components = 0
        visitTemplate(parseTemplate(descriptor.template.content), node => {
          if (!componentNames.includes(node.tag)) return
          components += 1
          const props = node.props.map(prop => {
            assert.equal(prop.type, NodeTypes.ATTRIBUTE, `${readme}: extend the Vue prop audit before using template directives`)
            const name = prop.name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
            checkedVueProps += 1
            return `${JSON.stringify(name)}: ${prop.value ? JSON.stringify(prop.value.content) : 'true'}`
          })
          // This checks the actual attributes against the public component
          // props. SFC syntax compilation above is not full vue-tsc checking.
          source += `\n({ ${props.join(', ')} } satisfies InstanceType<typeof ${node.tag}>['$props'])\n`
        })
        assert.ok(components > 0, `${readme}: Vue template must use its imported KJDraw component`)
      } else {
        const ast = parseScript(source, filename, snippet.language === 'tsx')
        const editorNames = ast.program.body.filter(node => node.type === 'ImportDeclaration' && node.source.value === `${installedPackage.name}/editor`)
          .flatMap(node => node.specifiers.filter(specifier => specifier.type === 'ImportSpecifier' && specifier.imported.name === 'createKJDrawEditor').map(specifier => specifier.local.name))
        visitSyntax(ast, node => {
          if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || !editorNames.includes(node.callee.name)) return
          assert.equal(node.arguments[0]?.type, 'StringLiteral', `${readme}: editor example must name its HTML host`)
          const selector = node.arguments[0].value
          const host = hosts.get(selector)
          assert.ok(host, `${readme}: no HTML host matches ${selector}`)
          const height = host.style?.match(/(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)(px|rem|em|vh|dvh|svh|lvh)\s*(?:;|$)/i)
          assert.ok(height && Number(height[1]) > 0, `${readme}: ${selector} must have an explicit positive CSS height`)
          checkedHosts += 1
        })
      }
      await writeFile(join(consumerDirectory, 'src', filename), `${source}\n`)
    }
    assert.ok(checkedHosts > 0, `${readme}: no editor mount was checked against the HTML example`)
    report.push({
      file: readme,
      typescriptSnippets: snippets.filter(snippet => snippet.language === 'ts').length,
      reactSnippets: snippets.filter(snippet => snippet.language === 'tsx').length,
      vueSnippets: snippets.filter(snippet => snippet.language === 'vue').length,
      htmlHosts: checkedHosts,
      vueProps: checkedVueProps,
      vueValidation: 'SFC syntax compilation, script TypeScript and literal public component props; not full template typechecking',
    })
  }
  return report
}

async function main() {
  const npmCli = await findNpmCli()
  const expectedPackage = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  const fromRegistry = process.argv.includes('--registry')
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
      fromRegistry ? `${expectedPackage.name}@${expectedPackage.version}` : packageRoot,
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      packDirectory,
    ])
    const packMetadata = parsePackResult(pack.stdout)
    assert.equal(packMetadata.version, expectedPackage.version, 'The audited package must match the checkout version')
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
    if (fromRegistry) {
      for (const artifact of ['src/editor.js', 'src/workbench.js', 'src/layout.js', 'src/drafting.js', 'src/modification-controls.js', 'src/canvas-renderer.js', 'src/dxf-adapter.js', 'src/commands.js', 'src/editing.js', 'src/react.js', 'src/vue.js', 'types/editor.d.ts', 'types/workbench.d.ts', 'types/drafting.d.ts', 'types/editing.d.ts']) {
        assert.equal(await readFile(join(installedRoot, artifact), 'utf8'), await readFile(join(packageRoot, artifact), 'utf8'), `Registry artifact differs from the release checkout: ${artifact}`)
      }
    }
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

    const curveProbePath = join(consumerDirectory, 'verify-curve-editing.mjs')
    await cp(join(repositoryRoot, 'fixtures', 'consumer-runtime', 'curved-editing.mjs'), curveProbePath)
    const curveProbe = run(process.execPath, [curveProbePath], { cwd: consumerDirectory })
    assert.deepEqual(JSON.parse(curveProbe.stdout), { curveEditing: true, nativeArc: true, undoRedo: true, dxfReopen: true })

    const boundaryProbePath = join(consumerDirectory, 'verify-boundary-edit.mjs')
    await cp(join(repositoryRoot, 'fixtures', 'consumer-runtime', 'boundary-edit.mjs'), boundaryProbePath)
    const boundaryProbe = run(process.execPath, [boundaryProbePath], { cwd: consumerDirectory })
    assert.deepEqual(JSON.parse(boundaryProbe.stdout), { boundarySession: true, preview: true, reviewedAgentEdit: true, continuousUiEdit: true, separateUndo: true })

    const agentToolsProbe = run(process.execPath, [join(installedRoot, 'examples', 'agent-tools.mjs')], { cwd: consumerDirectory })
    assert.deepEqual(JSON.parse(agentToolsProbe.stdout), { agentTools: true, hostApproval: true, duplicateRejected: true, reopen: true, undo: true })
    const drawingProbe = run(process.execPath, [join(installedRoot, 'examples', 'agent-drawing.mjs')], { cwd: consumerDirectory })
    assert.deepEqual(JSON.parse(drawingProbe.stdout), { agentDrawing: true, entities: 9, preview: true, kjd: true, dxf: true, undo: true, redo: true, offline: true })
    const modelProbe = run(process.execPath, [join(installedRoot, 'examples', 'model-agent.mjs')], { cwd: consumerDirectory })
    assert.deepEqual(JSON.parse(modelProbe.stdout), { modelAdapters: true, protocols: 4, offline: true, approval: true, reopen: true, undo: true })
    const contextProbe = run(process.execPath, [join(installedRoot, 'examples', 'drawing-context.mjs')], { cwd: consumerDirectory })
    assert.deepEqual(JSON.parse(contextProbe.stdout), { drawingContext: true, units: 'millimeter', circles: 3, pagination: true, readOnly: true })

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
    const readmeConsumers = await prepareReadmeConsumers(consumerDirectory, installedPackage)
    // Exercise the actual maintained guide, not a separately retyped example.
    const agentGuide = (await readFile(join(repositoryRoot, 'docs/site/pages/agent.md'), 'utf8')).replaceAll('\r\n', '\n')
    for (const locale of ['en', 'zh']) {
      const localized = agentGuide.split(`:::${locale}\n`)[1]?.split('\n:::')[0]
      const section = localized?.split('{#geometric-preview}\n')[1]?.split('\n## ')[0]
      assert.ok(section, `Missing ${locale} geometric-preview guide`)
      const snippets = [...section.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(match => match[1])
      assert.equal(snippets.length, 2, `Expected setup and approval snippets in ${locale} guide`)
      const guideProbePath = join(consumerSources, `agent-boundary-guide-${locale}.ts`)
      await writeFile(guideProbePath, `${snippets.join('\n\n')}\n
const beforeApproval = drawing.revision
if (beforeApproval !== 2 || !drawing.getObject(circle.id)) throw new Error('Guide planning mutated the drawing')
const approved = await applyApprovedTrim('automated-guide-test-reviewer')
if (approved.status !== 'committed' || drawing.revision !== beforeApproval + 1) throw new Error('Guide approval did not commit once')
if (drawing.getObject(circle.id) || drawing.listEntities({ type: 'ARC' }).length !== 1) throw new Error('Guide did not retain a native arc')
await sdk.executeCommand('UNDO')
if (drawing.getObject(circle.id)?.type !== 'CIRCLE' || drawing.listEntities({ type: 'ARC' }).length) throw new Error('Guide undo did not restore the circle')
console.log(JSON.stringify({ guide: '${locale}', geometricPreview: true, reviewedEdit: true, undo: true }))
`)
      const guideProbe = run(process.execPath, ['--experimental-strip-types', guideProbePath], { cwd: consumerDirectory })
      assert.deepEqual(JSON.parse(guideProbe.stdout), { guide: locale, geometricPreview: true, reviewedEdit: true, undo: true })

      const contextSection = localized.split('{#drawing-context}\n')[1]?.split('\n## ')[0]
      const contextSnippets = [...(contextSection ?? '').matchAll(/```ts\n([\s\S]*?)\n```/g)].map(match => match[1])
      assert.equal(contextSnippets.length, 1, `Expected the actual ${locale} drawing-context example`)
      const contextGuidePath = join(consumerSources, `agent-context-guide-${locale}.ts`)
      await writeFile(contextGuidePath, `${contextSnippets[0]}\nif (context.entities.length !== 1 || context.entities[0]?.geometry?.radius !== 4 || context.truncated || drawing.revision !== 1) throw new Error('Drawing context guide failed')\n`)
      run(process.execPath, ['--experimental-strip-types', contextGuidePath], { cwd: consumerDirectory })
    }
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
      source: fromRegistry ? 'npm-registry' : 'local-pack',
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
      readmeConsumers,
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
