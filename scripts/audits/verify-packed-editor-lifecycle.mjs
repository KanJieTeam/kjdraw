import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const packageRoot = join(repositoryRoot, 'packages', 'kjdraw-sdk')

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
  const candidates = new Set([
    process.env.KJDRAW_NPM_CLI,
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean).map(value => resolve(value)))
  const pathValue = process.env.PATH ?? process.env.Path ?? process.env.path ?? ''
  for (const value of pathValue.split(delimiter)) {
    const root = value.trim().replace(/^"|"$/g, '')
    if (!root) continue
    candidates.add(join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    for (const launcher of ['npm', 'npm-cli.js']) {
      const path = join(root, launcher)
      if (!existsSync(path)) continue
      try {
        const target = await realpath(path)
        if (target.toLowerCase().endsWith('.js')) candidates.add(target)
      } catch {
        // Keep checking PATH after stale launchers.
      }
    }
  }
  const found = [...candidates].find(candidate => existsSync(candidate))
  if (found) return { command: process.execPath, args: [found] }
  if (process.platform !== 'win32') return { command: 'npm', args: [] }
  throw new Error('Unable to locate npm-cli.js. Set KJDRAW_NPM_CLI to run the packed browser audit.')
}

function packResult(stdout) {
  const start = stdout.indexOf('['), end = stdout.lastIndexOf(']')
  if (start === -1 || end === -1) throw new Error(`npm pack did not return JSON:\n${stdout}`)
  const entries = JSON.parse(stdout.slice(start, end + 1))
  assert.equal(entries.length, 1, 'npm pack must produce exactly one tarball')
  return entries[0]
}

async function listen(root) {
  const types = new Map([
    ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ])
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const requested = pathname === '/' ? '/index.html' : pathname
      const file = resolve(root, `.${decodeURIComponent(requested)}`)
      const fromRoot = relative(root, file)
      if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
        response.writeHead(403).end('Forbidden')
        return
      }
      const content = await readFile(file)
      response.writeHead(200, { 'content-type': types.get(extname(file)) ?? 'application/octet-stream' }).end(content)
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end(error?.code === 'ENOENT' ? 'Not found' : 'Server error')
    }
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

const scratchParent = resolve(process.env.KJDRAW_AUDIT_TMPDIR || tmpdir())
await mkdir(scratchParent, { recursive: true })
const scratch = await mkdtemp(join(scratchParent, 'kjdraw-packed-editor-'))
let server, browser
try {
  const npm = await findNpmCli()
  const packDirectory = join(scratch, 'packed')
  const consumerDirectory = join(scratch, 'consumer')
  await mkdir(packDirectory, { recursive: true })
  await mkdir(consumerDirectory, { recursive: true })
  const packed = packResult(run(npm.command, [
    ...npm.args, 'pack', packageRoot, '--ignore-scripts', '--json', '--pack-destination', packDirectory,
  ]).stdout)
  const tarball = join(packDirectory, basename(packed.filename))
  assert.ok(existsSync(tarball), `Packed tarball is missing: ${tarball}`)
  const tarballSpecifier = `file:${relative(consumerDirectory, tarball).replaceAll('\\', '/')}`
  await writeFile(join(consumerDirectory, 'package.json'), `${JSON.stringify({
    name: 'kjdraw-packed-browser-consumer-audit',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: { '@kanjieteam/kjdraw': tarballSpecifier },
  }, null, 2)}\n`)
  run(npm.command, [
    ...npm.args, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
  ], { cwd: consumerDirectory })

  const installedRoot = join(consumerDirectory, 'node_modules', '@kanjieteam', 'kjdraw')
  const installed = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
  assert.equal(installed.version, packed.version)
  assert.notEqual(await realpath(installedRoot), await realpath(packageRoot), 'Consumer must use extracted tarball files')
  assert.ok(installed.exports?.['.']?.import && installed.exports?.['.']?.types, 'Packed root export needs runtime and type targets')
  for (const target of [installed.exports['.'].import, installed.exports['.'].types]) {
    assert.ok(existsSync(join(installedRoot, target)), `Packed root export target is missing: ${target}`)
  }

  const source = `
import { createKJDrawEditor, createKJDrawSDK } from '@kanjieteam/kjdraw'

async function verify() {
  const host = document.querySelector('#editor')
  const options = { document: 'blank', grid: false, toolbar: false, layers: false, properties: false }
  const first = createKJDrawEditor(host, options)
  await first.ready
  const created = await first.execute('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [20, 0, 0] } })
  await first.execute('MOVE', { id: created.result.id, dx: 5, dy: 7 })
  const firstRevision = first.document.revision
  const firstBytes = await first.save({ format: 'KJD', download: false })
  const firstSDK = first.sdk
  first.dispose()
  first.dispose()
  let disposedError = ''
  try { await first.save({ download: false }) } catch (error) { disposedError = error.message }
  const afterFirstDispose = { roots: host.querySelectorAll('.kjwb').length, documents: firstSDK.documents.size }

  const second = createKJDrawEditor(host, options)
  await second.ready
  await second.open(firstBytes, { format: 'KJD' })
  const reopenedId = second.document.id
  const reopenedLine = second.document.getObject(created.result.id)
  const afterReopen = { revision: second.document.revision, start: reopenedLine.payload.start, end: reopenedLine.payload.end }
  await second.execute('CREATE', { type: 'CIRCLE', payload: { center: [10, 10, 0], radius: 3 } })
  const changedCount = second.document.listEntities().length
  await second.undo()
  const undoneCount = second.document.listEntities().length
  await second.redo()
  const redoneCount = second.document.listEntities().length
  const finalFingerprint = second.document.fingerprint()
  const finalBytes = await second.save({ format: 'KJD', download: false })
  const secondSDK = second.sdk
  second.dispose()
  const afterSecondDispose = { roots: host.querySelectorAll('.kjwb').length, documents: secondSDK.documents.size }
  secondSDK.closeDocument(reopenedId)
  const afterSecondRelease = { roots: host.querySelectorAll('.kjwb').length, documents: secondSDK.documents.size }

  const verificationSDK = createKJDrawSDK()
  const verified = await verificationSDK.readDocument(finalBytes, { format: 'KJD' })
  const result = {
    firstRevision,
    disposedError,
    afterFirstDispose,
    afterReopen,
    changedCount,
    undoneCount,
    redoneCount,
    finalTypes: verified.listEntities().map(entity => entity.type).sort(),
    fingerprintMatch: verified.fingerprint() === finalFingerprint,
    afterSecondDispose,
    afterSecondRelease,
  }
  verificationSDK.closeDocument(verified.id)
  return result
}

verify().then(result => { window.__kjdrawPackedLifecycle = { result } }).catch(error => {
  window.__kjdrawPackedLifecycle = { error: error?.stack || error?.message || String(error) }
})
`
  const frameworkWorkflow = `
import {
  KJAgentToolSession,
  KJDRAW_ARCHITECTURE_PLAN_VERSION,
} from '@kanjieteam/kjdraw'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function value(result) {
  if (!result.ok) throw new Error(result.error?.message || 'KJDraw agent operation failed')
  return result.value
}

export async function runArchitectureLifecycle(editor, framework) {
  await editor.ready
  const drawing = editor.document
  assert(drawing, 'framework editor did not expose a drawing')
  assert(drawing.revision === 0, 'framework drawing did not start at revision zero')
  assert(drawing.listEntities().length === 0, 'framework drawing did not start blank')
  const before = drawing.fingerprint()
  const session = new KJAgentToolSession(editor.sdk, drawing)
  const proposal = value(await session.call('cad_propose_architecture_plan', {
    version: KJDRAW_ARCHITECTURE_PLAN_VERSION,
    expectedRevision: 0,
    units: 'millimeter',
    drawingId: 'PACKED-FRAMEWORK-ARCH',
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
  }))
  assert(proposal.status === 'awaiting-host-approval', 'semantic proposal bypassed host approval')
  assert(drawing.revision === 0, 'semantic preview changed the revision')
  assert(drawing.fingerprint() === before, 'semantic preview changed the drawing')
  assert(drawing.listEntities().length === 0, 'semantic preview created entities')

  const approval = value(await session.approve(proposal.planId, framework + '-packed-auditor'))
  assert(approval.status === 'committed', 'semantic proposal was not committed')
  assert(drawing.revision === 1, 'semantic drawing was not one atomic revision')
  const entityCount = drawing.listEntities().length
  assert(entityCount >= 20, 'semantic drawing is unexpectedly small')
  assert(drawing.listEntities({ type: 'INSERT' }).length === 4, 'semantic openings were not retained as block inserts')
  assert(drawing.listEntities({ type: 'DIMENSION' }).length === 2, 'semantic dimensions are missing')
  assert(drawing.getTable('blockRecords').records.filter(record => record.name.startsWith('KJ_ARCH_')).length === 2, 'semantic block definitions are missing')
  assert(drawing.listObjects({ kind: 'layout' }).some(layout => /^KJ_ARCH_.*_A3$/.test(layout.name)), 'semantic A3 layout is missing')

  const saved = await editor.save({ format: 'KJD', download: false })
  await editor.undo()
  const undoneEntities = editor.document.listEntities().length
  await editor.redo()
  const redoneEntities = editor.document.listEntities().length
  assert(undoneEntities === 0, 'framework undo did not remove the atomic semantic drawing')
  assert(redoneEntities === entityCount, 'framework redo did not restore the semantic drawing')

  await editor.open(saved, { format: 'KJD' })
  const reopened = editor.document
  assert(reopened, 'framework reopen did not expose a drawing')
  assert(reopened.validate().valid === true, 'reopened semantic drawing is invalid')
  assert(reopened.listEntities().length === entityCount, 'reopen changed the semantic entity count')
  assert(reopened.listEntities({ type: 'INSERT' }).length === 4, 'reopen lost semantic block inserts')
  assert(reopened.listEntities({ type: 'PROXY_ENTITY' }).length === 0, 'reopen introduced proxy entities')
  assert(reopened.listObjects({ kind: 'layout' }).some(layout => /^KJ_ARCH_.*_A3$/.test(layout.name)), 'reopen lost the semantic A3 layout')
  return { framework, entityCount, approval: true, previewWasReadOnly: true, saved: true, reopened: true, undoRedo: true }
}
`
  const reactSource = `
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { KJDraw } from '@kanjieteam/kjdraw/react'
import { runArchitectureLifecycle } from './framework-workflow.mjs'

let resolveReady
const ready = new Promise(resolve => { resolveReady = resolve })
const host = document.querySelector('#editor')
const root = createRoot(host)
root.render(createElement(KJDraw, {
  document: 'blank', grid: false, toolbar: false, layers: false, properties: false,
  onReady: resolveReady,
}))
try {
  const editor = await ready
  const result = await runArchitectureLifecycle(editor, 'react')
  const reopenedId = editor.document.id
  root.unmount()
  await Promise.resolve()
  const documentsAfterDispose = editor.sdk.documents.size
  editor.sdk.closeDocument(reopenedId)
  window.__kjdrawFrameworkLifecycle = { result: { ...result, disposed: editor.disposed, roots: host.querySelectorAll('.kjwb').length, documentsAfterDispose, documentsAfterRelease: editor.sdk.documents.size } }
} catch (error) {
  root.unmount()
  window.__kjdrawFrameworkLifecycle = { error: error?.stack || error?.message || String(error) }
}
`
  const vueSource = `
import { createApp, h } from 'vue'
import { KJDraw } from '@kanjieteam/kjdraw/vue'
import { runArchitectureLifecycle } from './framework-workflow.mjs'

let resolveReady
const ready = new Promise(resolve => { resolveReady = resolve })
const host = document.querySelector('#editor')
const app = createApp({
  render: () => h(KJDraw, {
    document: 'blank', grid: false, toolbar: false, layers: false, properties: false,
    onReady: resolveReady,
  }),
})
app.mount(host)
try {
  const editor = await ready
  const result = await runArchitectureLifecycle(editor, 'vue')
  const reopenedId = editor.document.id
  app.unmount()
  await Promise.resolve()
  const documentsAfterDispose = editor.sdk.documents.size
  editor.sdk.closeDocument(reopenedId)
  window.__kjdrawFrameworkLifecycle = { result: { ...result, disposed: editor.disposed, roots: host.querySelectorAll('.kjwb').length, documentsAfterDispose, documentsAfterRelease: editor.sdk.documents.size } }
} catch (error) {
  app.unmount()
  window.__kjdrawFrameworkLifecycle = { error: error?.stack || error?.message || String(error) }
}
`
  await writeFile(join(consumerDirectory, 'consumer.mjs'), source)
  await writeFile(join(consumerDirectory, 'framework-workflow.mjs'), frameworkWorkflow)
  await writeFile(join(consumerDirectory, 'react-consumer.mjs'), reactSource)
  await writeFile(join(consumerDirectory, 'vue-consumer.mjs'), vueSource)
  await writeFile(join(consumerDirectory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="editor" style="width:960px;height:640px"></div><script type="module" src="./bundle.mjs"></script>\n')
  for (const framework of ['react', 'vue']) {
    await writeFile(join(consumerDirectory, `${framework}.html`), `<!doctype html><meta charset="utf-8"><div id="editor" style="width:960px;height:640px"></div><script type="module" src="./${framework}-bundle.mjs"></script>\n`)
  }
  const esbuild = join(repositoryRoot, 'node_modules', 'esbuild', 'bin', 'esbuild')
  assert.ok(existsSync(esbuild), 'The repository esbuild dependency is required for the clean browser consumer')
  run(process.execPath, [
    esbuild, 'consumer.mjs', '--bundle', '--format=esm', '--platform=browser', '--target=es2022', '--outfile=bundle.mjs',
  ], { cwd: consumerDirectory })
  for (const framework of ['react', 'vue']) {
    const metaName = `${framework}-meta.json`
    run(process.execPath, [
      esbuild, `${framework}-consumer.mjs`, '--bundle', '--format=esm', '--platform=browser', '--target=es2022',
      `--outfile=${framework}-bundle.mjs`, `--metafile=${metaName}`,
    ], { cwd: consumerDirectory, env: { ...process.env, NODE_PATH: join(repositoryRoot, 'node_modules') } })
    const meta = JSON.parse(await readFile(join(consumerDirectory, metaName), 'utf8'))
    const packageInputs = Object.keys(meta.inputs).filter(path => path.replaceAll('\\', '/').includes('node_modules/@kanjieteam/kjdraw/'))
    assert.ok(packageInputs.length > 0, `${framework} bundle did not consume the installed KJDraw package`)
    assert.ok(packageInputs.every(path => path.replaceAll('\\', '/').startsWith('node_modules/@kanjieteam/kjdraw/')), `${framework} bundle escaped the installed KJDraw package`)
    assert.ok(Object.keys(meta.inputs).every(path => !path.replaceAll('\\', '/').includes('/packages/kjdraw-sdk/')), `${framework} bundle referenced repository SDK source`)
  }

  const listening = await listen(consumerDirectory)
  server = listening.server
  browser = await chromium.launch({
    headless: true,
    ...(process.env.KJDRAW_CHROME_PATH ? { executablePath: process.env.KJDRAW_CHROME_PATH } : {}),
  })
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(listening.origin, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__kjdrawPackedLifecycle, null, { timeout: 30_000 })
  const observed = await page.evaluate(() => window.__kjdrawPackedLifecycle)
  assert.equal(observed.error, undefined, observed.error)
  assert.deepEqual(pageErrors, [])
  assert.equal(observed.result.firstRevision, 2)
  assert.match(observed.result.disposedError, /disposed/i)
  assert.deepEqual(observed.result.afterFirstDispose, { roots: 0, documents: 0 })
  assert.deepEqual(observed.result.afterReopen, { revision: 2, start: [5, 7, 0], end: [25, 7, 0] })
  assert.equal(observed.result.changedCount, 2)
  assert.equal(observed.result.undoneCount, 1)
  assert.equal(observed.result.redoneCount, 2)
  assert.deepEqual(observed.result.finalTypes, ['CIRCLE', 'LINE'])
  assert.equal(observed.result.fingerprintMatch, true)
  assert.deepEqual(observed.result.afterSecondDispose, { roots: 0, documents: 1 })
  assert.deepEqual(observed.result.afterSecondRelease, { roots: 0, documents: 0 })
  const frameworkResults = []
  for (const framework of ['react', 'vue']) {
    const frameworkPage = await browser.newPage()
    const frameworkErrors = []
    frameworkPage.on('pageerror', error => frameworkErrors.push(error.message))
    await frameworkPage.goto(`${listening.origin}/${framework}.html`, { waitUntil: 'networkidle' })
    await frameworkPage.waitForFunction(() => window.__kjdrawFrameworkLifecycle, null, { timeout: 30_000 })
    const frameworkObserved = await frameworkPage.evaluate(() => window.__kjdrawFrameworkLifecycle)
    await frameworkPage.close()
    assert.equal(frameworkObserved.error, undefined, frameworkObserved.error)
    assert.deepEqual(frameworkErrors, [])
    assert.equal(frameworkObserved.result.framework, framework)
    assert.ok(frameworkObserved.result.entityCount >= 20)
    assert.equal(frameworkObserved.result.approval, true)
    assert.equal(frameworkObserved.result.previewWasReadOnly, true)
    assert.equal(frameworkObserved.result.saved, true)
    assert.equal(frameworkObserved.result.reopened, true)
    assert.equal(frameworkObserved.result.undoRedo, true)
    assert.equal(frameworkObserved.result.disposed, true)
    assert.equal(frameworkObserved.result.roots, 0)
    assert.equal(frameworkObserved.result.documentsAfterDispose, 1)
    assert.equal(frameworkObserved.result.documentsAfterRelease, 0)
    frameworkResults.push(frameworkObserved.result)
  }
  console.log(JSON.stringify({
    ok: true,
    package: `${installed.name}@${installed.version}`,
    install: 'npm install --offline from npm pack tarball',
    browser: 'chromium',
    lifecycle: ['mount', 'create', 'edit', 'save', 'dispose', 'remount', 'reopen', 'undo', 'redo', 'dispose'],
    finalTypes: observed.result.finalTypes,
    frameworks: frameworkResults,
  }, null, 2))
} finally {
  await browser?.close()
  if (server) await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  if (dirname(scratch) !== scratchParent || !basename(scratch).startsWith('kjdraw-packed-editor-')) {
    throw new Error(`Refusing unsafe packed-editor cleanup: ${scratch}`)
  }
  await rm(scratch, { recursive: true, force: true })
}
