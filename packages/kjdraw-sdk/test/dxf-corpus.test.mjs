import assert from 'node:assert/strict'
import test from 'node:test'
import { auditDxfCorpus } from '../../../scripts/audit-dxf-corpus.mjs'

test('public synthetic DXF corpus passes every declared target version', async () => {
  const report = await auditDxfCorpus()
  assert.equal(report.caseCount, 7)
  assert.equal(report.passedCount, 7, JSON.stringify(report.cases.filter(row => !row.passed), null, 2))
  assert.equal(report.passed, true)
  assert.deepEqual(report.cases.map(row => row.requestedVersion), ['R14', '2000', '2004', '2010', '2013', '2018', '2024'])
  assert.ok(report.cases.every(row => row.entities === 3 && row.roundTrip === 'passed'))
  assert.ok(report.cases.every(row => /^[a-f0-9]{64}$/.test(row.sha256)))
})
