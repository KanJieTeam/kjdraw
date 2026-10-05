import test from 'node:test'
import assert from 'node:assert/strict'

import { buildExternalAcceptanceEvidence, EXTERNAL_ACCEPTANCE_SCHEMA, isExternalAcceptanceEvidence } from '../../../scripts/audits/external-acceptance-evidence.mjs'

const commit = 'a'.repeat(40), hash = 'b'.repeat(64)
const options = { repository: 'KanJieTeam/kjdraw', commit, packageName: '@kanjieteam/kjdraw', packageVersion: '1.0.0-rc.3' }
const input = () => ({
  tester: { id: 'external-tester-01', independent: true, didNotContributeToCandidate: true, noMaintainerGuidanceDuringRun: true },
  environment: { operatingSystem: 'Windows 11', nodeVersion: '22.19.0', framework: 'React 19 clean project', locale: 'en-US' },
  install: { source: 'candidate-tarball', packageName: '@kanjieteam/kjdraw', packageVersion: '1.0.0-rc.3', artifactSha256: hash, cleanProject: true, installedWithoutRepositorySource: true },
  workflow: {
    taskId: 'external-edit-save-reopen-01', startedBlank: true, usedPublishedInstructionsOnly: true, createdEditableGeometry: true,
    modifiedExistingGeometry: true, undoRedoPassed: true, savedAndReopened: true, dxfAuditPassed: true,
    geometryChecks: [{ id: 'plate-width', passed: true }, { id: 'hole-spacing', passed: true }], artifacts: { kjdSha256: 'c'.repeat(64), dxfSha256: 'd'.repeat(64) },
  },
  completedAt: '2026-09-14T00:00:00.000Z',
})

test('external acceptance binds an independent package-only drawing workflow to one exact candidate', () => {
  const evidence = buildExternalAcceptanceEvidence(input(), options)
  assert.equal(evidence.schema, EXTERNAL_ACCEPTANCE_SCHEMA)
  assert.equal(isExternalAcceptanceEvidence(evidence, options), true)
  assert.deepEqual(evidence.workflow.geometryChecks.map(check => check.id), ['plate-width', 'hole-spacing'])
  assert.equal(JSON.stringify(evidence).includes('email'), false)
})

test('external acceptance fails closed on maintainer help, source checkout, wrong artifact or incomplete geometry evidence', () => {
  const mutations = [
    value => { value.tester.independent = false },
    value => { value.tester.didNotContributeToCandidate = false },
    value => { value.tester.noMaintainerGuidanceDuringRun = false },
    value => { value.install.installedWithoutRepositorySource = false },
    value => { value.install.source = 'source-checkout' },
    value => { value.install.artifactSha256 = 'not-a-hash' },
    value => { value.workflow.modifiedExistingGeometry = false },
    value => { value.workflow.geometryChecks[0].passed = false },
    value => { value.workflow.geometryChecks.push({ id: 'plate-width', passed: true }) },
  ]
  for (const mutate of mutations) {
    const value = input(); mutate(value)
    assert.throws(() => buildExternalAcceptanceEvidence(value, options))
  }
  const valid = buildExternalAcceptanceEvidence(input(), options)
  assert.equal(isExternalAcceptanceEvidence(valid, { ...options, commit: 'e'.repeat(40) }), false)
  valid.workflow.dxfAuditPassed = false
  assert.equal(isExternalAcceptanceEvidence(valid, options), false)
})
