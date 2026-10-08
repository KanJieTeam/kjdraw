import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

test('recorded local-core policy defers industry acceptance without falsifying its status', async () => {
  const matrix = JSON.parse(await readFile(new URL('../docs/KJDRAW_1_0_ACCEPTANCE_MATRIX.json', import.meta.url), 'utf8'))
  assert.equal(matrix.stableReleasePolicy.mode, 'local-core-and-release-alignment')
  assert.equal(matrix.stableReleasePolicy.authorizedAt, '2026-10-08')
  for (const id of ['cad.production-workflows', 'industry.geotechnical-real-corpus', 'industry.mechanical-real-corpus']) {
    const gate = matrix.gates.find(item => item.id === id)
    assert.equal(gate.requiredForStable, false)
    assert.ok(['partial', 'blocked'].includes(gate.status), 'deferred is not passed')
  }
  for (const id of ['document.transactions', 'cad.dxf-roundtrip', 'security.input-budgets', 'sdk.npm-consumption', 'public.workbench', 'public.documentation', 'security.release-provenance']) {
    assert.equal(matrix.gates.find(item => item.id === id).requiredForStable, true)
  }
})

test('stable local-core promotion still fails without exact deployed and attested commit evidence', () => {
  const result = spawnSync(process.execPath, ['scripts/audits/release-readiness.mjs', '--require-ready'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8',
    env: { ...process.env, KJDRAW_HOSTED_CANDIDATE_EVIDENCE: '.cache/test-no-hosted.json',
      KJDRAW_PROVENANCE_CANDIDATE_EVIDENCE: '.cache/test-no-provenance.json',
      KJDRAW_EXTERNAL_ACCEPTANCE_EVIDENCE: '.cache/test-no-external.json',
      KJDRAW_MODEL_HOLDOUT_EVIDENCE: '.cache/test-no-holdout.json',
      KJDRAW_PACKAGE_INSTALL_CANDIDATE_EVIDENCE: '.cache/test-no-manual-install.json' },
  })
  assert.equal(result.status, 1)
  const report = JSON.parse(result.stdout)
  assert.equal(report.stableOneRelease, true)
  assert.equal(report.ready, false)
  assert.equal(report.verificationPolicy.mode, 'local-core-and-release-alignment')
  assert.ok(report.findings.some(row => row.code === 'HOSTED_CANDIDATE_EVIDENCE_REQUIRED'))
  assert.ok(report.findings.some(row => row.code === 'PROVENANCE_CANDIDATE_EVIDENCE_REQUIRED'))
  assert.ok(report.deferredVerification.some(row => row.code === 'THREE_MODEL_HOLDOUT_EVIDENCE_REQUIRED'))
  assert.equal(report.modelHoldout.valid, false)
})
