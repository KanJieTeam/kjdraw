#!/usr/bin/env node
// Run against an isolated npm installation, not the repository source.
// The approval callback is a labeled test fixture, not a human acceptance.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const index = process.argv.indexOf('--package-root')
if (index < 0 || !process.argv[index + 1]) {
  throw new Error(
    'Usage: node scripts/audits/verify-published-agent-first-use.mjs --package-root <isolated node_modules/@kanjieteam/kjdraw>',
  )
}
const packageRoot = await realpath(resolve(process.argv[index + 1]))
const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
assert.equal(metadata.name, '@kanjieteam/kjdraw')
const cli = join(packageRoot, 'bin', 'kjdraw.mjs')
const { reviewLedger } = await import(
  pathToFileURL(join(packageRoot, 'bin', 'kjdraw-review.mjs')).href
)
const { createKJDrawSDK } = await import(pathToFileURL(join(packageRoot, 'src', 'sdk.js')).href)
const workspace = await mkdtemp(join(tmpdir(), 'kjdraw-published-first-use-'))
const cases = [
  {
    name: 'circle',
    tool: 'cad_propose_circles',
    units: 'millimeter',
    args: {
      expectedRevision: 0,
      units: 'millimeter',
      circles: [{ center: { x: 0, y: 0 }, radius: 5 }],
    },
    minimumEntities: 1,
  },
  {
    name: 'mechanical-flange',
    tool: 'cad_propose_mechanical_flange',
    units: 'millimeter',
    args: {
      version: '1.0.0',
      expectedRevision: 0,
      units: 'millimeter',
      drawingId: 'FIRST-USE-FLANGE',
      title: 'Six-hole flange',
      outerDiameter: 120,
      boreDiameter: 40,
      thickness: 20,
      boltCount: 6,
      boltCircleDiameter: 90,
      boltHoleDiameter: 10,
    },
    minimumEntities: 10,
  },
]

function call(args) {
  const child = spawnSync(process.execPath, [cli, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  })
  assert.equal(child.status, 0, child.stderr || child.error?.message || 'KJDraw CLI failed')
  return JSON.parse(child.stdout)
}

try {
  const results = []
  for (const scenario of cases) {
    const source = `${scenario.name}-source.kjd`
    const candidate = `${scenario.name}-reviewed.kjd`
    const argsFile = `${scenario.name}-request.json`
    await writeFile(join(workspace, argsFile), JSON.stringify(scenario.args))
    const proposed = call([
      'agent',
      'call',
      scenario.tool,
      '--blank',
      source,
      '--units',
      scenario.units,
      '--args-file',
      argsFile,
    ])
    assert.equal(proposed.ok, true)
    assert.equal(proposed.value.status, 'awaiting-host-approval')
    const sourceBytes = await readFile(join(workspace, source))
    const receipt = await reviewLedger(
      {
        workspace,
        ledger: proposed.ledger,
        sequence: 1,
        candidate,
        reviewer: 'automated-smoke-fixture',
      },
      async () => true,
    )
    assert.deepEqual(
      await readFile(join(workspace, source)),
      sourceBytes,
      'Review overwrote the source',
    )
    const sdk = createKJDrawSDK()
    const reopened = {}
    for (const [format, path] of [
      ['KJD', candidate],
      ['DXF', candidate.replace(/\.kjd$/u, '.dxf')],
    ]) {
      const document = await sdk.readDocument(await readFile(join(workspace, path)), { format })
      reopened[format] = document.listEntities().length
      assert.ok(
        reopened[format] >= scenario.minimumEntities,
        `${scenario.name} ${format} lost entities`,
      )
    }
    assert.equal(receipt.execution.liveUndoRedoVerified, true)
    results.push({
      case: scenario.name,
      tool: scenario.tool,
      proposal: 'awaiting-host-approval',
      reviewer: 'automated-smoke-fixture',
      sourceUnchanged: true,
      undoRedoVerified: true,
      reopened,
    })
  }
  console.log(
    JSON.stringify(
      {
        schema: 'com.kanjie.kjdraw.published-first-use-smoke@1',
        source: 'isolated-installed-npm-package',
        package: `${metadata.name}@${metadata.version}`,
        modelInvoked: false,
        independentHumanAcceptance: false,
        results,
      },
      null,
      2,
    ),
  )
} finally {
  const safe =
    resolve(dirname(workspace)) === resolve(tmpdir()) &&
    basename(workspace).startsWith('kjdraw-published-first-use-')
  if (!safe) throw new Error('Refusing to remove an unexpected smoke-test directory')
  await rm(workspace, { recursive: true, force: true })
}
