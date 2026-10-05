import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { recordExternalAcceptance } from '../../../scripts/audits/record-external-acceptance.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const candidate = { repository: 'KanJieTeam/kjdraw', commit: 'a'.repeat(40), packageName: '@kanjieteam/kjdraw', packageVersion: '1.0.0-rc.3' }

test('independent acceptance recorder checks the actual package, KJD and DXF bytes', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kjdraw-external-record-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const paths = { artifactPath: resolve(directory, 'candidate.tgz'), kjdPath: resolve(directory, 'drawing.kjd'), dxfPath: resolve(directory, 'drawing.dxf') }
  const bytes = { artifactPath: 'candidate tarball', kjdPath: 'editable drawing', dxfPath: 'independently audited DXF' }
  for (const name of Object.keys(paths)) await writeFile(paths[name], bytes[name])
  const input = {
    tester: { id: 'independent-tester', independent: true, didNotContributeToCandidate: true, noMaintainerGuidanceDuringRun: true },
    environment: { operatingSystem: 'Windows 11', nodeVersion: '22.18.0', framework: 'React', locale: 'en-US' },
    install: { source: 'candidate-tarball', packageName: candidate.packageName, packageVersion: candidate.packageVersion, artifactSha256: hash(bytes.artifactPath), cleanProject: true, installedWithoutRepositorySource: true },
    workflow: {
      taskId: 'plate-edit-reopen', startedBlank: true, usedPublishedInstructionsOnly: true, createdEditableGeometry: true,
      modifiedExistingGeometry: true, undoRedoPassed: true, savedAndReopened: true, dxfAuditPassed: true,
      geometryChecks: [{ id: 'hole-radius', passed: true }],
      artifacts: { kjdSha256: hash(bytes.kjdPath), dxfSha256: hash(bytes.dxfPath) },
    },
    completedAt: '2026-09-25T00:00:00.000Z',
  }
  const result = await recordExternalAcceptance(input, { candidate, ...paths })
  assert.equal(result.commit, candidate.commit)
  assert.equal(result.workflow.geometryChecks[0].id, 'hole-radius')
  await writeFile(paths.dxfPath, 'changed DXF')
  await assert.rejects(recordExternalAcceptance(input, { candidate, ...paths }), /DXF SHA-256/)
  input.tester.independent = false
  await assert.rejects(recordExternalAcceptance(input, { candidate, ...paths }), /independently confirmed/)
})
