export const EXTERNAL_ACCEPTANCE_SCHEMA = 'com.kanjie.kjdraw.audit.external-acceptance@1'

const sha256 = value => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
const text = (value, label, maximum = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\r\n]/.test(value)) throw new Error(`${label} is invalid`)
  return value.trim()
}
const requiredTrue = (value, label) => {
  if (value !== true) throw new Error(`${label} must be independently confirmed`)
  return true
}

export function buildExternalAcceptanceEvidence(input, options) {
  const repository = text(options?.repository, 'Repository')
  const commit = text(options?.commit, 'Candidate commit')
  const packageName = text(options?.packageName, 'Package name')
  const packageVersion = text(options?.packageVersion, 'Package version')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Repository must be owner/name')
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('Candidate commit must be a full SHA')
  if (!/^@[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(packageName)) throw new Error('Package name must be a scoped npm package')
  if (!/^1\.\d+\.\d+(?:-rc\.\d+)?$/.test(packageVersion)) throw new Error('Package version must be a 1.x stable or release candidate')

  const tester = input?.tester ?? {}
  const testerId = text(tester.id, 'Opaque tester id', 64)
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/.test(testerId)) throw new Error('Opaque tester id is invalid')
  const environment = input?.environment ?? {}, install = input?.install ?? {}, workflow = input?.workflow ?? {}
  const packageSource = text(install.source, 'Package source', 32)
  if (!['candidate-tarball', 'npm-registry'].includes(packageSource)) throw new Error('Package source must be candidate-tarball or npm-registry')
  if (install.packageName !== packageName || install.packageVersion !== packageVersion) throw new Error('Installed package does not match the candidate')
  if (!sha256(install.artifactSha256)) throw new Error('Installed package artifact SHA-256 is invalid')
  const hashes = workflow.artifacts ?? {}
  for (const name of ['kjdSha256', 'dxfSha256']) if (!sha256(hashes[name])) throw new Error(`${name} is invalid`)
  const checks = workflow.geometryChecks
  if (!Array.isArray(checks) || checks.length < 1 || checks.length > 64 || checks.some(check => !check || typeof check.id !== 'string' || !check.id.trim() || check.id.length > 96 || check.passed !== true)) throw new Error('Every external geometry check must be named and pass')
  if (new Set(checks.map(check => check.id)).size !== checks.length) throw new Error('External geometry check ids must be unique')
  const completedAt = text(input?.completedAt, 'Completion time', 40)
  if (!Number.isFinite(Date.parse(completedAt))) throw new Error('Completion time must be ISO-compatible')

  return {
    schema: EXTERNAL_ACCEPTANCE_SCHEMA,
    repository,
    commit,
    package: {
      name: packageName,
      version: packageVersion,
      source: packageSource,
      artifactSha256: install.artifactSha256.toLowerCase(),
      cleanProject: requiredTrue(install.cleanProject, 'Clean project installation'),
      installedWithoutRepositorySource: requiredTrue(install.installedWithoutRepositorySource, 'Package-only installation'),
    },
    tester: {
      id: testerId,
      independent: requiredTrue(tester.independent, 'Tester independence'),
      didNotContributeToCandidate: requiredTrue(tester.didNotContributeToCandidate, 'Candidate non-contribution'),
      noMaintainerGuidanceDuringRun: requiredTrue(tester.noMaintainerGuidanceDuringRun, 'No maintainer guidance'),
    },
    environment: {
      operatingSystem: text(environment.operatingSystem, 'Operating system'),
      nodeVersion: text(environment.nodeVersion, 'Node version', 32),
      framework: text(environment.framework, 'Framework', 64),
      locale: text(environment.locale, 'Locale', 32),
    },
    workflow: {
      taskId: text(workflow.taskId, 'External task id', 96),
      startedBlank: requiredTrue(workflow.startedBlank, 'Blank-start workflow'),
      usedPublishedInstructionsOnly: requiredTrue(workflow.usedPublishedInstructionsOnly, 'Published-instructions-only workflow'),
      createdEditableGeometry: requiredTrue(workflow.createdEditableGeometry, 'Editable geometry creation'),
      modifiedExistingGeometry: requiredTrue(workflow.modifiedExistingGeometry, 'Existing geometry modification'),
      undoRedoPassed: requiredTrue(workflow.undoRedoPassed, 'Undo/redo'),
      savedAndReopened: requiredTrue(workflow.savedAndReopened, 'Save/reopen'),
      dxfAuditPassed: requiredTrue(workflow.dxfAuditPassed, 'Independent DXF audit'),
      geometryChecks: checks.map(check => ({ id: check.id.trim(), passed: true })),
      artifacts: { kjdSha256: hashes.kjdSha256.toLowerCase(), dxfSha256: hashes.dxfSha256.toLowerCase() },
    },
    completedAt: new Date(completedAt).toISOString(),
  }
}

export function isExternalAcceptanceEvidence(value, { repository, commit, packageName, packageVersion } = {}) {
  if (value?.schema !== EXTERNAL_ACCEPTANCE_SCHEMA || value.repository !== repository || value.commit !== commit) return false
  if (value.package?.name !== packageName || value.package?.version !== packageVersion || !['candidate-tarball', 'npm-registry'].includes(value.package?.source) || !sha256(value.package?.artifactSha256)) return false
  if (value.package.cleanProject !== true || value.package.installedWithoutRepositorySource !== true) return false
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/.test(value.tester?.id ?? '') || value.tester?.independent !== true || value.tester?.didNotContributeToCandidate !== true || value.tester?.noMaintainerGuidanceDuringRun !== true) return false
  if (!value.environment || ['operatingSystem', 'nodeVersion', 'framework', 'locale'].some(name => typeof value.environment[name] !== 'string' || !value.environment[name])) return false
  const workflow = value.workflow
  if (!workflow || ['startedBlank', 'usedPublishedInstructionsOnly', 'createdEditableGeometry', 'modifiedExistingGeometry', 'undoRedoPassed', 'savedAndReopened', 'dxfAuditPassed'].some(name => workflow[name] !== true)) return false
  if (typeof workflow.taskId !== 'string' || !workflow.taskId || !Array.isArray(workflow.geometryChecks) || !workflow.geometryChecks.length || workflow.geometryChecks.some(check => check?.passed !== true || typeof check.id !== 'string' || !check.id)) return false
  if (new Set(workflow.geometryChecks.map(check => check.id)).size !== workflow.geometryChecks.length || !sha256(workflow.artifacts?.kjdSha256) || !sha256(workflow.artifacts?.dxfSha256)) return false
  return typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt))
}
