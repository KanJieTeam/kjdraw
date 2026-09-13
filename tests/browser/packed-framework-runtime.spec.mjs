import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path'
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
      try {
        const target = await realpath(path)
        add(target)
      } catch {
        // Continue after stale PATH entries.
      }
    }
  }
  const found = [...candidates].find(candidate => existsSync(candidate))
  if (!found) throw new Error('Unable to locate npm-cli.js for the packed framework audit')
  return found
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
  throw new Error(`Root lock does not contain ${dependency} required from ${fromKey || '<consumer>'}`)
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

function packResult(stdout) {
  const start = stdout.indexOf('['), end = stdout.lastIndexOf(']')
  if (start === -1 || end === -1) throw new Error(`npm pack did not return JSON:\n${stdout}`)
  const entries = JSON.parse(stdout.slice(start, end + 1))
  assert.equal(entries.length, 1)
  assert.match(entries[0]?.integrity ?? '', /^sha512-/)
  return entries[0]
}

const browserConsumer = String.raw`
import { createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { KJDraw as ReactKJDraw } from '@kanjieteam/kjdraw/react'
import { createApp, h, nextTick } from 'vue'
import { KJDraw as VueKJDraw } from '@kanjieteam/kjdraw/vue'

const editorOptions = { document: 'blank', grid: false, toolbar: false, layers: false, properties: false }

async function reactLifecycle() {
  const host = document.querySelector('#react-consumer')
  const firstRef = createRef()
  let firstReady
  const firstReadyPromise = new Promise(resolve => { firstReady = resolve })
  const firstRoot = createRoot(host)
  firstRoot.render(createElement(ReactKJDraw, { ...editorOptions, ref: firstRef, onReady: firstReady }))
  const first = await firstReadyPromise
  await first.ready
  const created = await firstRef.current.execute('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [80, 0, 0] } })
  await firstRef.current.execute('MOVE', { id: created.result.id, dx: 12, dy: 8 })
  const saved = await firstRef.current.save({ format: 'KJD', download: false })
  firstRoot.unmount()
  const firstDisposed = host.querySelectorAll('.kjwb').length === 0 && firstRef.current === null

  const secondRef = createRef()
  let secondReady
  const secondReadyPromise = new Promise(resolve => { secondReady = resolve })
  const secondRoot = createRoot(host)
  secondRoot.render(createElement(ReactKJDraw, { ...editorOptions, ref: secondRef, onReady: secondReady }))
  await secondReadyPromise
  await secondRef.current.open(saved, { format: 'KJD' })
  const reopened = secondRef.current.document.getObject(created.result.id)
  const result = {
    type: reopened?.type,
    start: reopened?.payload.start,
    end: reopened?.payload.end,
    entities: secondRef.current.document.listEntities().length,
    firstDisposed,
  }
  secondRoot.unmount()
  result.finalDisposed = host.querySelectorAll('.kjwb').length === 0 && secondRef.current === null
  return result
}

async function mountVue(host) {
  let exposed = null
  const app = createApp({
    render: () => h(VueKJDraw, { ...editorOptions, ref: value => { exposed = value } }),
  })
  app.mount(host)
  await nextTick()
  if (!exposed?.ready) throw new Error('Vue KJDraw did not expose its editor API')
  await exposed.ready
  return { app, api: exposed }
}

async function vueLifecycle() {
  const host = document.querySelector('#vue-consumer')
  const first = await mountVue(host)
  const created = await first.api.execute('CREATE', { type: 'CIRCLE', payload: { center: [40, 30, 0], radius: 12 } })
  await first.api.execute('MOVE', { id: created.result.id, dx: 5, dy: -3 })
  const saved = await first.api.save({ format: 'KJD', download: false })
  first.app.unmount()
  const firstDisposed = host.querySelectorAll('.kjwb').length === 0 && first.api.instance === null

  const second = await mountVue(host)
  await second.api.open(saved, { format: 'KJD' })
  const reopened = second.api.instance.document.getObject(created.result.id)
  const result = {
    type: reopened?.type,
    center: reopened?.payload.center,
    radius: reopened?.payload.radius,
    entities: second.api.instance.document.listEntities().length,
    firstDisposed,
  }
  second.app.unmount()
  result.finalDisposed = host.querySelectorAll('.kjwb').length === 0 && second.api.instance === null
  return result
}

Promise.all([reactLifecycle(), vueLifecycle()]).then(([react, vue]) => {
  window.__kjdrawPackedFrameworks = { react, vue }
}).catch(error => {
  window.__kjdrawPackedFrameworks = { error: error?.stack || error?.message || String(error) }
})
`

test.beforeAll(async () => {
  test.setTimeout(180_000)
  const npmCli = await findNpmCli()
  scratch = await mkdtemp(join(resolve(process.env.KJDRAW_AUDIT_TMPDIR || tmpdir()), 'kjdraw-packed-frameworks-'))
  const packedDirectory = join(scratch, 'packed')
  const consumerDirectory = join(scratch, 'consumer')
  await mkdir(packedDirectory, { recursive: true })
  await mkdir(consumerDirectory, { recursive: true })

  const packed = packResult(run(process.execPath, [
    npmCli, 'pack', packageRoot, '--ignore-scripts', '--json', '--pack-destination', packedDirectory,
  ]).stdout)
  const tarball = join(packedDirectory, basename(packed.filename))
  assert.ok(existsSync(tarball))
  const repositoryPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  const repositoryLock = JSON.parse(await readFile(join(repositoryRoot, 'package-lock.json'), 'utf8'))
  const frameworkNames = ['react', 'react-dom', 'vue']
  const frameworkVersions = Object.fromEntries(frameworkNames.map(name => [name, repositoryPackage.devDependencies[name]]))
  for (const [name, version] of Object.entries(frameworkVersions)) assert.match(version ?? '', /^\d+\.\d+\.\d+$/, `Pin ${name}`)

  const tarballSpecifier = `file:${relative(consumerDirectory, tarball).replaceAll('\\', '/')}`
  const consumerPackage = {
    name: 'kjdraw-packed-framework-runtime-audit',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: { '@kanjieteam/kjdraw': tarballSpecifier, ...frameworkVersions },
  }
  const lockedPackages = collectLockedDependencyClosure(repositoryLock, frameworkNames)
  lockedPackages['node_modules/@kanjieteam/kjdraw'] = {
    version: packed.version,
    resolved: tarballSpecifier,
    integrity: packed.integrity,
    license: 'Apache-2.0',
  }
  const consumerLock = {
    name: consumerPackage.name,
    version: consumerPackage.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: consumerPackage.name, version: consumerPackage.version, dependencies: consumerPackage.dependencies },
      ...lockedPackages,
    },
  }
  await writeFile(join(consumerDirectory, 'package.json'), `${JSON.stringify(consumerPackage, null, 2)}\n`)
  await writeFile(join(consumerDirectory, 'package-lock.json'), `${JSON.stringify(consumerLock, null, 2)}\n`)
  run(process.execPath, [npmCli, 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumerDirectory })

  const installedRoot = join(consumerDirectory, 'node_modules', '@kanjieteam', 'kjdraw')
  const installedPackage = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
  packageVersion = installedPackage.version
  assert.equal(packageVersion, packed.version)
  assert.notEqual(await realpath(installedRoot), await realpath(packageRoot), 'The browser must load the extracted tarball')
  for (const name of frameworkNames) {
    const manifest = JSON.parse(await readFile(join(consumerDirectory, 'node_modules', name, 'package.json'), 'utf8'))
    assert.equal(manifest.version, frameworkVersions[name])
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
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  bundle = built.outputFiles[0]?.text ?? ''
  assert.ok(bundle)
  const bundledInputs = Object.keys(built.metafile.inputs).map(path => path.replaceAll('\\', '/'))
  for (const suffix of [
    'node_modules/@kanjieteam/kjdraw/src/react.js',
    'node_modules/@kanjieteam/kjdraw/src/vue.js',
    'node_modules/react-dom/client.js',
    'node_modules/vue/dist/vue.runtime.esm-bundler.js',
  ]) assert.ok(bundledInputs.some(path => path.endsWith(suffix)), `Bundle did not load ${suffix}`)
})

test.afterAll(async () => {
  if (!scratch) return
  const parent = resolve(process.env.KJDRAW_AUDIT_TMPDIR || tmpdir())
  if (dirname(scratch) !== parent || !basename(scratch).startsWith('kjdraw-packed-frameworks-')) {
    throw new Error(`Refusing unsafe packed framework cleanup: ${scratch}`)
  }
  await rm(scratch, { recursive: true, force: true })
})

test('React and Vue mount the installed tarball and preserve editable CAD through reopen', async ({ page }) => {
  await page.goto('about:blank')
  await page.setContent('<!doctype html><meta charset="utf-8"><section id="react-consumer" style="width:900px;height:560px"></section><section id="vue-consumer" style="width:900px;height:560px"></section>')
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
  await page.addScriptTag({ content: bundle })
  await page.waitForFunction(() => window.__kjdrawPackedFrameworks, null, { timeout: 30_000 })
  const observed = await page.evaluate(() => window.__kjdrawPackedFrameworks)

  expect(observed.error).toBeUndefined()
  expect(pageErrors).toEqual([])
  expect(observed.react).toEqual({
    type: 'LINE', start: [12, 8, 0], end: [92, 8, 0], entities: 1, firstDisposed: true, finalDisposed: true,
  })
  expect(observed.vue).toEqual({
    type: 'CIRCLE', center: [45, 27, 0], radius: 12, entities: 1, firstDisposed: true, finalDisposed: true,
  })
  expect(packageVersion).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
})
