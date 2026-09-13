import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

test('packed npm artifact works from an isolated JavaScript and TypeScript consumer', { timeout: 120_000 }, () => {
  const result = spawnSync(process.execPath, ['scripts/audits/verify-packed-package.mjs'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

  const report = JSON.parse(result.stdout)
  assert.equal(report.ok, true)
  assert.equal(report.package.startsWith('@kanjieteam/kjdraw@'), true)
  assert.equal(report.publicEntryPoints > 1, true)
  assert.equal(report.frameworkInstall.mode, 'locked-offline-npm-ci')
  assert.deepEqual(report.frameworkInstall.packages, {
    react: '19.2.8',
    'react-dom': '19.2.8',
    '@types/react': '19.2.18',
    '@types/react-dom': '19.2.7',
    vue: '3.5.42',
  })
  assert.deepEqual(report.typedConsumers, ['Vanilla TypeScript', 'React TSX', 'Vue composable'])
  assert.equal(report.productionWorkflows.source, 'installed-tarball')
  assert.equal(report.productionWorkflows.blankDocuments, 3)
  assert.deepEqual(report.productionWorkflows.workflows.map(workflow => workflow.id), ['mechanical', 'architecture', 'site'])
  for (const workflow of report.productionWorkflows.workflows) {
    assert.ok(workflow.entities > 0)
    assert.equal(typeof workflow.edit, 'string')
    assert.equal(workflow.undoRedo, true)
    assert.deepEqual(workflow.reopen, { KJD: true, DXF: true })
    assert.equal(workflow.output.format, 'SVG')
    assert.ok(workflow.output.millimetersPerModelUnit > 0)
  }
  assert.deepEqual(report.productionWorkflows.workflows.map(workflow => ({
    id: workflow.id,
    units: workflow.units,
    edit: workflow.edit,
    paper: workflow.output.paper,
    scale: workflow.output.scale,
    millimetersPerModelUnit: workflow.output.millimetersPerModelUnit,
  })), [
    { id: 'mechanical', units: 'millimeter', edit: 'move-counterbored-hole', paper: 'A3', scale: '1:2', millimetersPerModelUnit: 0.5 },
    { id: 'architecture', units: 'millimeter', edit: 'move-door-instance', paper: 'A3', scale: '1:100', millimetersPerModelUnit: 0.01 },
    { id: 'site', units: 'meter', edit: 'move-road-layer-selection', paper: 'A1', scale: '1:500', millimetersPerModelUnit: 2 },
  ])
  assert.equal(report.quickstart.entities, 1)
})
