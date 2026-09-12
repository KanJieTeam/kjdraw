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
  await writeFile(join(consumerDirectory, 'consumer.mjs'), source)
  await writeFile(join(consumerDirectory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="editor" style="width:960px;height:640px"></div><script type="module" src="./bundle.mjs"></script>\n')
  const esbuild = join(repositoryRoot, 'node_modules', 'esbuild', 'bin', 'esbuild')
  assert.ok(existsSync(esbuild), 'The repository esbuild dependency is required for the clean browser consumer')
  run(process.execPath, [
    esbuild, 'consumer.mjs', '--bundle', '--format=esm', '--platform=browser', '--target=es2022', '--outfile=bundle.mjs',
  ], { cwd: consumerDirectory })

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
  console.log(JSON.stringify({
    ok: true,
    package: `${installed.name}@${installed.version}`,
    install: 'npm install --offline from npm pack tarball',
    browser: 'chromium',
    lifecycle: ['mount', 'create', 'edit', 'save', 'dispose', 'remount', 'reopen', 'undo', 'redo', 'dispose'],
    finalTypes: observed.result.finalTypes,
  }, null, 2))
} finally {
  await browser?.close()
  if (server) await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  if (dirname(scratch) !== scratchParent || !basename(scratch).startsWith('kjdraw-packed-editor-')) {
    throw new Error(`Refusing unsafe packed-editor cleanup: ${scratch}`)
  }
  await rm(scratch, { recursive: true, force: true })
}
