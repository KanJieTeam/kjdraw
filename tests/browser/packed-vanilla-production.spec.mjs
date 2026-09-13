import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { expect, test } from '@playwright/test'

test.use({ bypassCSP: true })

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const packageRoot = join(repositoryRoot, 'packages', 'kjdraw-sdk')
let scratch = ''
let bundle = ''
let packageVersion = ''
let packedIntegrity = ''
let packedSourceInputs = []

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error([
    `$ ${command} ${args.join(' ')}`,
    result.stdout?.trim(),
    result.stderr?.trim(),
  ].filter(Boolean).join('\n'))
  return result
}

async function findNpmCli() {
  const candidates = new Set()
  const add = value => {
    if (typeof value !== 'string' || !value.trim()) return
    const path = resolve(value.trim().replace(/^"|"$/g, ''))
    if (/\.(?:cmd|bat)$/i.test(path)) candidates.add(join(dirname(path), 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    else candidates.add(path)
  }
  add(process.env.KJDRAW_NPM_CLI)
  add(process.env.npm_execpath)
  add(join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  add(join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  const pathValue = process.env.PATH ?? process.env.Path ?? process.env.path ?? ''
  for (const value of pathValue.split(delimiter)) {
    const root = value.trim().replace(/^"|"$/g, '')
    if (!root) continue
    add(join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    for (const launcher of process.platform === 'win32' ? ['npm.cmd', 'npm', 'npm-cli.js'] : ['npm', 'npm-cli.js']) {
      const path = join(root, launcher)
      if (!existsSync(path)) continue
      try { add(await realpath(path)) } catch { /* Ignore stale PATH entries. */ }
    }
  }
  const found = [...candidates].find(candidate => existsSync(candidate))
  if (!found) throw new Error('Unable to locate npm-cli.js for the packed Vanilla production audit')
  return found
}

function packResult(stdout) {
  const start = stdout.indexOf('['), end = stdout.lastIndexOf(']')
  if (start === -1 || end === -1) throw new Error(`npm pack did not return JSON:\n${stdout}`)
  const entries = JSON.parse(stdout.slice(start, end + 1))
  assert.equal(entries.length, 1)
  assert.match(entries[0]?.integrity ?? '', /^sha512-/)
  return entries[0]
}

function normalized(value) {
  return value.replaceAll('\\', '/').toLowerCase()
}

const browserConsumer = String.raw`
import {
  KJDRAW_ARCHITECTURE_PLAN_VERSION,
  buildAgentArchitecturePlan,
  createKJDrawEditor,
  createKJDrawSDK,
  exportDrawingSvg,
} from '@kanjieteam/kjdraw'

const editorOptions = { document: 'blank', grid: false, toolbar: false, layers: false, properties: false }
const input = {
  version: KJDRAW_ARCHITECTURE_PLAN_VERSION,
  expectedRevision: 0,
  units: 'millimeter',
  drawingId: 'PACKED-VANILLA-ARCH-101',
  title: 'TWO ROOM OFFICE PLAN',
  width: 10000,
  depth: 8000,
  wallThickness: 200,
  exteriorOpenings: [
    { wall: 'south', offset: 1200, width: 900, kind: 'door' },
    { wall: 'north', offset: 3000, width: 1500, kind: 'window' },
    { wall: 'east', offset: 3000, width: 1500, kind: 'window' },
  ],
  partitions: [
    { id: 'P1', axis: 'vertical', position: 5000, start: 200, end: 7800, openings: [{ offset: 3100, width: 900, kind: 'door' }] },
  ],
  rooms: [
    { id: 'R101', name: 'MEETING', bounds: [200, 200, 4700, 7600] },
    { id: 'R102', name: 'STUDIO', bounds: [5100, 200, 4700, 7600] },
  ],
  textHeight: 250,
}

function inspect(document, layoutName) {
  const layout = document.snapshot().spaces.layoutIds
    .map(id => document.getObject(id))
    .find(item => item?.name === layoutName)
  if (!layout) throw new Error('Physical A3 layout is missing')
  const viewport = document.listEntities({ ownerId: layout.payload.blockRecordId, type: 'VIEWPORT' })[0]
  if (!viewport) throw new Error('Paper-space viewport is missing')
  const svg = exportDrawingSvg(document, { layoutId: layout.id })
  return {
    valid: document.validate().valid,
    units: document.snapshot().header.units,
    entities: document.listEntities().length,
    walls: document.listEntities({ type: 'LWPOLYLINE' }).filter(item => {
      const layer = document.getObject(item.payload.layerId)
      return layer?.name === 'A-WALL'
    }).length,
    inserts: document.listEntities({ type: 'INSERT' }).length,
    dimensions: document.listEntities({ type: 'DIMENSION' }).length,
    blocks: document.getTable('blockRecords').records.filter(item => item.name.startsWith('KJ_ARCH_')).length,
    paper: [layout.payload.dxfPlotSettings.paperWidth, layout.payload.dxfPlotSettings.paperHeight],
    viewport: {
      width: viewport.payload.width,
      height: viewport.payload.height,
      viewHeight: viewport.payload.viewHeight,
      millimetersPerModelUnit: viewport.payload.height / viewport.payload.viewHeight,
    },
    output: {
      diagnostics: svg.report.diagnostics.length,
      viewports: svg.report.viewports.length,
      paperSize: /width="420mm"[^>]+height="297mm"/.test(svg.svg),
    },
  }
}

async function productionLifecycle() {
  const host = document.querySelector('#vanilla-consumer')
  const first = createKJDrawEditor(host, editorOptions)
  await first.ready
  const blank = first.document.listEntities().length === 0
  const initialLayoutCount = first.document.snapshot().spaces.layoutIds.length
  const compiled = buildAgentArchitecturePlan(first.document, input)
  const receipt = await first.execute('CREATEBATCH', compiled.commandArgs)
  const initial = inspect(first.document, compiled.commandArgs.layout.name)
  const revisionAfterCreate = first.document.revision
  await first.undo()
  const undone = first.document.listEntities().length === 0
    && first.document.snapshot().spaces.layoutIds.length === initialLayoutCount
  await first.redo()
  const redone = first.document.listEntities().length === compiled.evidence.entityCount
  const saved = await first.save({ format: 'KJD', download: false })
  const firstSdk = first.sdk
  const firstDocumentId = first.document.id
  first.dispose()
  first.dispose()
  const firstDisposed = first.disposed && host.querySelectorAll('.kjwb').length === 0
  let disposedRejected = false
  try { await first.execute('UNDO') } catch (error) { disposedRejected = /disposed/i.test(String(error?.message ?? error)) }
  firstSdk.closeDocument(firstDocumentId)

  const second = createKJDrawEditor(host, editorOptions)
  await second.ready
  const blankBeforeOpen = second.document.listEntities().length === 0
  const blankDocumentId = second.document.id
  const reopenedDocument = await second.open(saved, { format: 'KJD' })
  const reopened = inspect(reopenedDocument, compiled.commandArgs.layout.name)
  const reopenedDocumentId = reopenedDocument.id
  const savedAgain = await second.save({ format: 'KJD', download: false })
  const secondSdk = second.sdk
  second.dispose()
  const secondDisposed = second.disposed && host.querySelectorAll('.kjwb').length === 0
  for (const id of new Set([blankDocumentId, reopenedDocumentId])) secondSdk.closeDocument(id)

  const verifier = createKJDrawSDK()
  const finalDocument = await verifier.readDocument(savedAgain, { format: 'KJD' })
  const final = inspect(finalDocument, compiled.commandArgs.layout.name)
  verifier.closeDocument(finalDocument.id)

  return {
    blank,
    blankBeforeOpen,
    command: receipt.command,
    revisionAfterCreate,
    expectedEntities: compiled.evidence.entityCount,
    initial,
    undone,
    redone,
    firstDisposed,
    disposedRejected,
    reopened,
    secondDisposed,
    final,
  }
}

productionLifecycle().then(result => {
  window.__kjdrawPackedVanillaProduction = { result }
}).catch(error => {
  window.__kjdrawPackedVanillaProduction = { error: error?.stack || error?.message || String(error) }
})
`

test.beforeAll(async () => {
  test.setTimeout(180_000)
  const npmCli = await findNpmCli()
  scratch = await mkdtemp(join(resolve(process.env.KJDRAW_AUDIT_TMPDIR || tmpdir()), 'kjdraw-packed-vanilla-production-'))
  const packedDirectory = join(scratch, 'packed')
  const consumerDirectory = join(scratch, 'consumer')
  await mkdir(packedDirectory, { recursive: true })
  await mkdir(consumerDirectory, { recursive: true })

  const packed = packResult(run(process.execPath, [
    npmCli, 'pack', packageRoot, '--ignore-scripts', '--json', '--pack-destination', packedDirectory,
  ]).stdout)
  packedIntegrity = packed.integrity
  const tarball = join(packedDirectory, basename(packed.filename))
  assert.ok(existsSync(tarball))
  const tarballSpecifier = `file:${relative(consumerDirectory, tarball).replaceAll('\\', '/')}`
  await writeFile(join(consumerDirectory, 'package.json'), `${JSON.stringify({
    name: 'kjdraw-packed-vanilla-production-audit',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: { '@kanjieteam/kjdraw': tarballSpecifier },
  }, null, 2)}\n`)
  run(process.execPath, [npmCli, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--omit=peer'], { cwd: consumerDirectory })

  const installedRoot = join(consumerDirectory, 'node_modules', '@kanjieteam', 'kjdraw')
  const installedPackage = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
  packageVersion = installedPackage.version
  assert.equal(packageVersion, packed.version)
  assert.equal(installedPackage.name, '@kanjieteam/kjdraw')
  assert.notEqual(await realpath(installedRoot), await realpath(packageRoot), 'The Vanilla consumer must use the extracted tarball')
  for (const file of ['src/index.js', 'src/editor.js', 'src/agent-architecture-plan.js', 'types/index.d.ts']) {
    assert.ok(existsSync(join(installedRoot, file)), `Packed package is missing ${file}`)
  }

  const entry = join(consumerDirectory, 'consumer.mjs')
  await writeFile(entry, browserConsumer)
  const built = await build({
    absWorkingDir: consumerDirectory,
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    metafile: true,
  })
  bundle = built.outputFiles[0].text
  const installedRootReal = normalized(await realpath(installedRoot))
  const packageRootReal = normalized(await realpath(packageRoot))
  packedSourceInputs = Object.keys(built.metafile.inputs).filter(input => normalized(input).includes('@kanjieteam/kjdraw/'))
  assert.ok(packedSourceInputs.length > 10, 'The browser bundle must include KJDraw modules from the installed package')
  assert.ok(packedSourceInputs.some(input => normalized(input).endsWith('/src/editor.js')))
  assert.ok(packedSourceInputs.some(input => normalized(input).endsWith('/src/agent-architecture-plan.js')))
  for (const input of packedSourceInputs) {
    const absolute = isAbsolute(input) ? input : resolve(consumerDirectory, input)
    const inputReal = normalized(await realpath(absolute))
    assert.ok(inputReal === installedRootReal || inputReal.startsWith(`${installedRootReal}/`), `Bundle input escaped installed tarball: ${input}`)
    assert.ok(inputReal !== packageRootReal && !inputReal.startsWith(`${packageRootReal}/`), `Bundle referenced source working tree: ${input}`)
  }
  assert.ok(!normalized(bundle).includes(packageRootReal), 'Bundle embedded the source working-tree path')
})

test.afterAll(async () => {
  if (!scratch) return
  const root = resolve(process.env.KJDRAW_AUDIT_TMPDIR || tmpdir())
  const target = resolve(scratch)
  if (dirname(target) !== root || !basename(target).startsWith('kjdraw-packed-vanilla-production-')) {
    throw new Error(`Refusing unsafe packed Vanilla cleanup: ${target}`)
  }
  await rm(target, { recursive: true, force: true })
})

test('packed Vanilla editor creates, reopens, verifies and disposes a production architecture sheet', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<main><div id="vanilla-consumer" style="width:1000px;height:700px"></div></main>')
  await page.addScriptTag({ content: bundle })
  await expect.poll(() => page.evaluate(() => Boolean(window.__kjdrawPackedVanillaProduction)), { timeout: 60_000 }).toBe(true)
  const outcome = await page.evaluate(() => window.__kjdrawPackedVanillaProduction)
  expect(outcome.error).toBeUndefined()
  expect(errors).toEqual([])
  expect(packageVersion).toMatch(/^1\.0\.0-/)
  expect(packedIntegrity).toMatch(/^sha512-/)
  expect(packedSourceInputs.length).toBeGreaterThan(10)
  expect(outcome.result).toMatchObject({
    blank: true,
    blankBeforeOpen: true,
    command: 'CREATEBATCH',
    revisionAfterCreate: 1,
    undone: true,
    redone: true,
    firstDisposed: true,
    disposedRejected: true,
    secondDisposed: true,
  })
  for (const stage of [outcome.result.initial, outcome.result.reopened, outcome.result.final]) {
    expect(stage).toMatchObject({
      valid: true,
      units: 'millimeter',
      walls: 9,
      inserts: 4,
      dimensions: 2,
      blocks: 2,
      paper: [420, 297],
      viewport: { width: 420, height: 297, viewHeight: 29700, millimetersPerModelUnit: 0.01 },
      output: { diagnostics: 0, viewports: 1, paperSize: true },
    })
    expect(stage.entities).toBe(outcome.result.expectedEntities)
  }
})
