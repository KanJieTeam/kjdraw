import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const packageRoot = join(repositoryRoot, 'packages', 'kjdraw-sdk')
const fixturesRoot = join(repositoryRoot, 'fixtures', 'consumer-types')
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }).trim()

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

  const pathValue = process.env.PATH ?? process.env.Path ?? process.env.path ?? ''
  for (const value of pathValue.split(delimiter)) {
    const root = value.trim().replace(/^"|"$/g, '')
    if (!root) continue
    add(join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    for (const launcher of ['npm', 'npm-cli.js']) {
      const path = join(root, launcher)
      if (!existsSync(path)) continue
      try {
        const target = await realpath(path)
        if (target.toLowerCase().endsWith('.js')) add(target)
      } catch {
        // A stale PATH entry does not invalidate the remaining candidates.
      }
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

  // The root README is the product entry point; the npm package README owns
  // the complete English integration examples alongside the Chinese guide.
  for (const readme of ['packages/kjdraw-sdk/README.md', 'README.zh-CN.md']) {
    const markdown = (await readFile(join(repositoryRoot, readme), 'utf8')).replaceAll('\r\n', '\n')
    const snippets = [...markdown.matchAll(/^```(ts|tsx|vue|html)\s*\n([\s\S]*?)^```\s*$/gm)]
      .map((match, index) => ({ language: match[1], source: match[2], name: `${readme.replace(/[./\\]/g, '-')}-${index + 1}` }))
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
          source += `\n;({ ${props.join(', ')} } satisfies InstanceType<typeof ${node.tag}>['$props'])\n`
        })
        assert.ok(components > 0, `${readme}: Vue template must use its imported KJDraw component`)
      } else {
        const ast = parseScript(source, filename, snippet.language === 'tsx')
        const editorNames = ast.program.body.filter(node => node.type === 'ImportDeclaration' && node.source.value === `${installedPackage.name}/editor`)
          .flatMap(node => node.specifiers.filter(specifier => specifier.type === 'ImportSpecifier' && specifier.imported.name === 'createKJDrawEditor').map(specifier => specifier.local.name))
        visitSyntax(ast, node => {
          if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || !editorNames.includes(node.callee.name)) return
          const argument = node.arguments[0]?.type === 'TSNonNullExpression' ? node.arguments[0].expression : node.arguments[0]
          const selector = argument?.type === 'StringLiteral' ? argument.value
            : argument?.type === 'CallExpression' && argument.callee?.type === 'MemberExpression'
              && argument.callee.object?.name === 'document' && argument.callee.property?.name === 'querySelector'
              && argument.arguments[0]?.type === 'StringLiteral' ? argument.arguments[0].value : undefined
          assert.ok(selector, `${readme}: editor example must name its HTML host with a literal selector`)
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

const productionWorkflowConsumer = String.raw`
import assert from 'node:assert/strict'
import {
  KJDRAW_MANUFACTURING_SHEET_VERSION,
  buildAgentManufacturingSheet,
  createKJDrawSDK,
  exportDrawingSvg,
} from '@kanjieteam/kjdraw'

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, String(actual) + ' != ' + String(expected))

function namedLayout(document, name) {
  const layout = document.listObjects({ kind: 'layout' }).find(item => item.name === name)
  assert.ok(layout, 'missing layout ' + name)
  return layout
}

function assertLayerCount(document, layerName, count) {
  const layer = document.getTable('layers').records.find(item => item.name === layerName)
  assert.ok(layer, 'missing layer ' + layerName)
  assert.equal(document.listEntities().filter(item => item.payload.layerId === layer.id).length, count)
}

async function reopenAndVerify(document, layoutName, scale, verify) {
  const sdk = createKJDrawSDK()
  for (const format of ['KJD', 'DXF']) {
    const source = await sdk.writeDocument(document, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
    const copy = await createKJDrawSDK().readDocument(source, { format })
    assert.equal(copy.validate().valid, true)
    assert.equal(copy.listEntities({ type: 'PROXY_ENTITY' }).length, 0)
    verify(copy)
    const output = exportDrawingSvg(copy, { layoutId: namedLayout(copy, layoutName).id })
    assert.equal(output.report.diagnostics.length, 0)
    assert.equal(output.report.viewports.length, 1)
    near(output.report.viewports[0].millimetersPerModelUnit, scale)
  }
}

async function mechanical() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'packed-mechanical', units: 'millimeter' })
  assert.equal(document.listEntities().length, 0)
  const compiled = buildAgentManufacturingSheet(document, {
    version: KJDRAW_MANUFACTURING_SHEET_VERSION,
    expectedRevision: 0,
    units: 'millimeter',
    drawingId: 'PACKED-MECH-001',
    title: 'MOUNTING PLATE',
    revision: 'A',
    material: '6061-T6',
    quantity: 2,
    length: 240,
    width: 140,
    thickness: 12,
    holePatterns: [{ rows: 2, columns: 3, origin: [30, 30], spacing: [90, 80], throughDiameter: 10, counterboreDiameter: 18, counterboreDepth: 5 }],
    slots: [{ center: [120, 70], length: 42, width: 12, orientationDegrees: 0 }],
    sheet: { origin: [15, 25], size: [420, 297] },
    textHeight: 3.5,
  })
  await sdk.executeCommand('CREATEBATCH', compiled.commandArgs, { document })
  const hole = document.listEntities({ type: 'CIRCLE' }).find(item => item.payload.radius === 5)
  assert.ok(hole)
  const counterbore = document.listEntities({ type: 'CIRCLE' }).find(item =>
    item.payload.radius === 9 && item.payload.center[0] === hole.payload.center[0] && item.payload.center[1] === hole.payload.center[1])
  assert.ok(counterbore)
  const before = hole.payload.center
  await sdk.executeCommand('MOVE', { ids: [hole.id, counterbore.id], dx: 5, dy: 0 }, { document })
  assert.deepEqual(document.getObject(hole.id)?.payload.center, [before[0] + 5, before[1], 0])
  assert.deepEqual(document.getObject(counterbore.id)?.payload.center, [before[0] + 5, before[1], 0])
  await sdk.executeCommand('UNDO', {}, { document })
  assert.deepEqual(document.getObject(hole.id)?.payload.center, before)
  assert.deepEqual(document.getObject(counterbore.id)?.payload.center, before)
  await sdk.executeCommand('REDO', {}, { document })
  assert.deepEqual(document.getObject(hole.id)?.payload.center, [before[0] + 5, before[1], 0])
  assert.deepEqual(document.getObject(counterbore.id)?.payload.center, [before[0] + 5, before[1], 0])
  const layout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: 'Mechanical A3 1:2' }, { document })
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 420, paperHeight: 297, paperUnits: 1, scaleNumerator: 1, scaleDenominator: 1, plotType: 5, flags: 0 } }, { document })
  await sdk.executeCommand('VIEWPORT', { layoutId: layout.id, center: [210, 148.5], width: 210, height: 140, viewCenter: [135, 95], viewHeight: 280 }, { document })
  const verify = copy => {
    const throughHoles = copy.listEntities({ type: 'CIRCLE' }).filter(item => item.payload.radius === 5)
    const counterbores = copy.listEntities({ type: 'CIRCLE' }).filter(item => item.payload.radius === 9)
    assert.equal(throughHoles.length, 6)
    assert.equal(counterbores.length, 6)
    for (const throughHole of throughHoles) {
      assert.ok(counterbores.some(item => item.payload.center[0] === throughHole.payload.center[0] && item.payload.center[1] === throughHole.payload.center[1]))
    }
    assert.ok(copy.listEntities({ type: 'DIMENSION' }).length >= 3)
  }
  verify(document)
  await reopenAndVerify(document, 'Mechanical A3 1:2', 0.5, verify)
  const output = exportDrawingSvg(document, { layoutId: layout.id })
  assert.match(output.svg, /width="420mm"/)
  return { id: 'mechanical', units: 'millimeter', entities: document.listEntities().length, edit: 'move-counterbored-hole', undoRedo: true, reopen: { KJD: true, DXF: true }, output: { format: 'SVG', paper: 'A3', scale: '1:2', millimetersPerModelUnit: 0.5 } }
}

async function architecture() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'packed-architecture', units: 'millimeter' })
  assert.equal(document.listEntities().length, 0)
  const wall = await sdk.executeCommand('LAYERNEW', { name: 'A-WALL', color: 7, lineweight: 50 }, { document })
  const opening = await sdk.executeCommand('LAYERNEW', { name: 'A-OPENING', color: 2, lineweight: 25 }, { document })
  const symbol = await sdk.executeCommand('LAYERNEW', { name: 'A-SYMBOL', color: 1, lineweight: 25 }, { document })
  const walls = await sdk.executeCommand('CREATEBATCH', { entities: [
    { type: 'LWPOLYLINE', payload: { vertices: [[0, 0], [10000, 0], [10000, 8000], [0, 8000]], closed: true, layerId: wall.id } },
    { type: 'LWPOLYLINE', payload: { vertices: [[200, 200], [4900, 200], [4900, 7800], [200, 7800]], closed: true, layerId: wall.id } },
    { type: 'LWPOLYLINE', payload: { vertices: [[5100, 200], [9800, 200], [9800, 7800], [5100, 7800]], closed: true, layerId: wall.id } },
  ] }, { document })
  assert.equal(walls.length, 3)
  const doorParts = await sdk.executeCommand('CREATEBATCH', { entities: [
    { type: 'LINE', payload: { start: [0, 0], end: [900, 0], layerId: symbol.id } },
    { type: 'ARC', payload: { center: [0, 0], radius: 900, startAngle: 0, endAngle: Math.PI / 2, layerId: symbol.id } },
  ] }, { document })
  const door = await sdk.executeCommand('BLOCKCREATE', { name: 'DOOR-0900', ids: doorParts.map(item => item.id), basePoint: [0, 0] }, { document })
  await sdk.executeCommand('PROPERTIES', { id: door.insert.id, patch: { payload: { layerId: opening.id } } }, { document })
  await sdk.executeCommand('MOVE', { id: door.insert.id, from: [0, 0], to: [1200, 200] }, { document })
  assert.deepEqual(document.getObject(door.insert.id)?.payload.position, [1200, 200, 0])
  await sdk.executeCommand('UNDO', {}, { document })
  assert.deepEqual(document.getObject(door.insert.id)?.payload.position, [0, 0, 0])
  await sdk.executeCommand('REDO', {}, { document })
  assert.deepEqual(document.getObject(door.insert.id)?.payload.position, [1200, 200, 0])
  await sdk.executeCommand('BLOCKINSERT', { name: 'DOOR-0900', position: [4900, 3300], rotation: Math.PI / 2, layerId: opening.id }, { document })
  const layout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: 'Architecture A3 1:100' }, { document })
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 420, paperHeight: 297, paperUnits: 1, scaleNumerator: 1, scaleDenominator: 1, plotType: 5, flags: 0 } }, { document })
  await sdk.executeCommand('VIEWPORT', { layoutId: layout.id, center: [210, 148.5], width: 100, height: 80, viewCenter: [5000, 4000], viewHeight: 8000 }, { document })
  const verify = copy => {
    assertLayerCount(copy, 'A-WALL', 3)
    const definition = copy.getTable('blockRecords').records.find(item => item.name === 'DOOR-0900')
    assert.ok(definition)
    assert.equal(copy.listEntities({ ownerId: definition.id }).length, 2)
    assert.equal(copy.listEntities({ type: 'INSERT' }).filter(item => item.payload.blockRecordId === definition.id).length, 2)
  }
  verify(document)
  await reopenAndVerify(document, 'Architecture A3 1:100', 0.01, verify)
  return { id: 'architecture', units: 'millimeter', entities: document.listEntities().length, edit: 'move-door-instance', undoRedo: true, reopen: { KJD: true, DXF: true }, output: { format: 'SVG', paper: 'A3', scale: '1:100', millimetersPerModelUnit: 0.01 } }
}

async function site() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'packed-site', units: 'meter' })
  assert.equal(document.listEntities().length, 0)
  const boundary = await sdk.executeCommand('LAYERNEW', { name: 'C-BOUNDARY', color: 2, lineweight: 50 }, { document })
  const road = await sdk.executeCommand('LAYERNEW', { name: 'C-ROAD', color: 1, lineweight: 35 }, { document })
  const building = await sdk.executeCommand('LAYERNEW', { name: 'A-BUILDING', color: 3, lineweight: 50 }, { document })
  const utility = await sdk.executeCommand('LAYERNEW', { name: 'U-WATER', color: 5, lineweight: 25 }, { document })
  await sdk.executeCommand('CREATEBATCH', { entities: [
    { type: 'LWPOLYLINE', payload: { vertices: [[500000, 3000000], [500120, 3000000], [500120, 3000080], [500000, 3000080]], closed: true, layerId: boundary.id }, options: { id: 'site-boundary' } },
    { type: 'LWPOLYLINE', payload: { vertices: [[500010, 3000040], [500110, 3000040]], layerId: road.id }, options: { id: 'road-center' } },
    { type: 'LWPOLYLINE', payload: { vertices: [[500010, 3000035], [500110, 3000035]], layerId: road.id }, options: { id: 'road-south' } },
    { type: 'LWPOLYLINE', payload: { vertices: [[500010, 3000045], [500110, 3000045]], layerId: road.id }, options: { id: 'road-north' } },
    { type: 'LWPOLYLINE', payload: { vertices: [[500025, 3000052], [500045, 3000052], [500045, 3000070], [500025, 3000070]], closed: true, layerId: building.id }, options: { id: 'building-a' } },
    { type: 'LWPOLYLINE', payload: { vertices: [[500015, 3000020], [500060, 3000030], [500105, 3000020]], layerId: utility.id }, options: { id: 'water-main' } },
  ] }, { document })
  const roads = await sdk.executeCommand('SELECTBYPROPERTY', { property: 'layer', value: 'C-ROAD' }, { document })
  assert.deepEqual(roads, ['road-center', 'road-south', 'road-north'])
  await sdk.executeCommand('MOVE', { ids: roads, dx: 5, dy: -2 }, { document })
  assert.deepEqual(document.getObject('road-center')?.payload.vertices[0].point, [500015, 3000038, 0])
  await sdk.executeCommand('UNDO', {}, { document })
  assert.deepEqual(document.getObject('road-center')?.payload.vertices[0].point, [500010, 3000040, 0])
  await sdk.executeCommand('REDO', {}, { document })
  assert.deepEqual(document.getObject('road-center')?.payload.vertices[0].point, [500015, 3000038, 0])
  const layout = await sdk.executeCommand('LAYOUT', { operation: 'create', name: 'Site A1 1:500' }, { document })
  await sdk.executeCommand('PAGESETUP', { layoutId: layout.id, dxf: { paperWidth: 841, paperHeight: 594, paperUnits: 1, scaleNumerator: 1, scaleDenominator: 1, plotType: 5, flags: 0 } }, { document })
  await sdk.executeCommand('VIEWPORT', { layoutId: layout.id, center: [200, 150], width: 300, height: 200, viewCenter: [500065, 3000040], viewHeight: 100 }, { document })
  const verify = copy => {
    assert.equal(copy.snapshot().header.units, 'meter')
    assertLayerCount(copy, 'C-BOUNDARY', 1)
    assertLayerCount(copy, 'C-ROAD', 3)
    assertLayerCount(copy, 'A-BUILDING', 1)
    assertLayerCount(copy, 'U-WATER', 1)
    const roadLayer = copy.getTable('layers').records.find(item => item.name === 'C-ROAD')
    assert.ok(roadLayer)
    const center = copy.listEntities({ type: 'LWPOLYLINE' }).find(item =>
      item.payload.layerId === roadLayer.id && item.payload.vertices[0]?.point[1] === 3000038)
    assert.ok(center)
    assert.deepEqual(center.payload.vertices[0].point, [500015, 3000038, 0])
    assert.deepEqual(center.payload.vertices[1].point, [500115, 3000038, 0])
  }
  verify(document)
  await reopenAndVerify(document, 'Site A1 1:500', 2, verify)
  return { id: 'site', units: 'meter', entities: document.listEntities().length, edit: 'move-road-layer-selection', undoRedo: true, reopen: { KJD: true, DXF: true }, output: { format: 'SVG', paper: 'A1', scale: '1:500', millimetersPerModelUnit: 2 } }
}

export async function runProductionWorkflows() {
  const workflows = await Promise.all([mechanical(), architecture(), site()])
  return { source: 'installed-tarball', blankDocuments: 3, workflows }
}
`

const productionWorkflowTypes = String.raw`
export type ProductionWorkflowEvidence = {
  id: 'mechanical' | 'architecture' | 'site'
  units: 'millimeter' | 'meter'
  entities: number
  edit: string
  undoRedo: true
  reopen: { KJD: true; DXF: true }
  output: { format: 'SVG'; paper: string; scale: string; millimetersPerModelUnit: number }
}
export declare function runProductionWorkflows(): Promise<{
  source: 'installed-tarball'
  blankDocuments: 3
  workflows: ProductionWorkflowEvidence[]
}>
`

async function prepareProductionWorkflowConsumer(consumerDirectory) {
  const consumerSources = join(consumerDirectory, 'src')
  await mkdir(consumerSources, { recursive: true })
  const helperPath = join(consumerSources, 'production-workflows.mjs')
  await writeFile(helperPath, productionWorkflowConsumer)
  await writeFile(join(consumerSources, 'production-workflows.d.mts'), productionWorkflowTypes)
  await writeFile(join(consumerSources, 'production-workflows-react.tsx'), `import { useEffect } from 'react'\nimport { runProductionWorkflows } from './production-workflows.mjs'\nexport function ProductionWorkflowReact() { useEffect(() => { void runProductionWorkflows() }, []); return null }\n`)
  await writeFile(join(consumerSources, 'production-workflows-vue.ts'), `import { defineComponent, onMounted } from 'vue'\nimport { runProductionWorkflows } from './production-workflows.mjs'\nexport const ProductionWorkflowVue = defineComponent({ setup() { onMounted(() => { void runProductionWorkflows() }); return () => null } })\n`)
  const runnerPath = join(consumerDirectory, 'verify-production-workflows.mjs')
  await writeFile(runnerPath, `import { runProductionWorkflows } from './src/production-workflows.mjs'\nconsole.log(JSON.stringify(await runProductionWorkflows()))\n`)
  const probe = run(process.execPath, [runnerPath], { cwd: consumerDirectory })
  return JSON.parse(probe.stdout)
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
    const artifactSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex')

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
    const productionWorkflows = await prepareProductionWorkflowConsumer(consumerDirectory)
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
      sourceCommit,
      source: fromRegistry ? 'npm-registry' : 'local-pack',
      tarball: basename(tarball),
      artifactSha256,
      packedFiles: packMetadata.entryCount,
      unpackedBytes: packMetadata.unpackedSize,
      publicEntryPoints: importResults.length,
      importedBindings: totalExportBindings,
      frameworkInstall: {
        mode: 'locked-offline-npm-ci',
        packages: peerVersions,
      },
      typedConsumers: ['Vanilla TypeScript', 'React TSX', 'Vue composable'],
      productionWorkflows,
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
