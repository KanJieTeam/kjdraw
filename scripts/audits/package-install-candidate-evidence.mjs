import { isHostedCandidateEvidence } from './hosted-candidate-evidence.mjs'

export const PACKAGE_INSTALL_CANDIDATE_SCHEMA = 'com.kanjie.kjdraw.audit.package-install-candidate@1'
export const REQUIRED_CONSUMERS = Object.freeze(['vanilla', 'react', 'vue'])

const sha256 = value => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
const exactList = (actual, expected) => Array.isArray(actual)
  && actual.length === expected.length
  && expected.every(value => actual.filter(candidate => candidate === value).length === 1)

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}

function expectedTarball(packageName, packageVersion) {
  return `${packageName.replace(/^@/, '').replace('/', '-')}-${packageVersion}.tgz`
}

function repositoryMatches(value, repository) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value.replace(/^git\+/, ''))
    return url.hostname.toLowerCase() === 'github.com' && url.pathname.replace(/^\//, '').replace(/\.git$/i, '') === repository
  } catch { return false }
}

function validateWorkflow(workflow, id) {
  requireValue(workflow?.id === id, `Installed package audit is missing the ${id} blank-to-output workflow`)
  requireValue(Number.isSafeInteger(workflow.entities) && workflow.entities > 0, `${id} workflow entity count is invalid`)
  requireValue(typeof workflow.edit === 'string' && workflow.edit.length > 0, `${id} workflow did not record an edit`)
  requireValue(workflow.undoRedo === true, `${id} workflow did not prove undo and redo`)
  requireValue(workflow.reopen?.KJD === true && workflow.reopen?.DXF === true, `${id} workflow did not reopen KJD and DXF`)
  requireValue(workflow.output?.format === 'SVG' && Number(workflow.output?.millimetersPerModelUnit) > 0, `${id} workflow output is invalid`)
}

function validatePackageAudit(value, identity, artifact) {
  requireValue(value?.ok === true, 'Installed package audit did not pass')
  requireValue(value.package === `${identity.packageName}@${identity.packageVersion}`, 'Installed package audit package does not match the candidate')
  requireValue(value.sourceCommit === identity.commit, 'Installed package audit commit does not match the candidate')
  requireValue(value.source === 'local-pack', 'Installed package audit must use the candidate tarball')
  requireValue(value.tarball === artifact.name && value.artifactSha256 === artifact.sha256, 'Installed package audit tarball does not match the release artifact')
  requireValue(value.frameworkInstall?.mode === 'locked-offline-npm-ci', 'Installed package audit did not use an isolated locked install')
  requireValue(exactList(value.typedConsumers, ['Vanilla TypeScript', 'React TSX', 'Vue composable']), 'Installed package audit must typecheck Vanilla, React and Vue consumers')
  requireValue(Number.isSafeInteger(value.publicEntryPoints) && value.publicEntryPoints > 0, 'Installed package audit did not import public entry points')
  requireValue(Number.isSafeInteger(value.importedBindings) && value.importedBindings > 0, 'Installed package audit did not import public bindings')
  requireValue(value.quickstart?.revision > 0 && value.quickstart?.entities > 0, 'Installed package quickstart did not run')
  requireValue(value.productionWorkflows?.source === 'installed-tarball' && value.productionWorkflows?.blankDocuments === 3, 'Production workflows did not start from three blank installed-package documents')
  const workflows = value.productionWorkflows?.workflows
  requireValue(Array.isArray(workflows) && workflows.length === 3, 'Installed package audit must contain three production workflows')
  for (const id of ['mechanical', 'architecture', 'site']) validateWorkflow(workflows.find(row => row?.id === id), id)
  requireValue(Array.isArray(value.readmeConsumers) && value.readmeConsumers.length === 2, 'Both maintained integration guides must be checked')
  for (const guide of value.readmeConsumers) {
    requireValue(guide.typescriptSnippets > 0 && guide.reactSnippets > 0 && guide.vueSnippets > 0 && guide.htmlHosts > 0 && guide.vueProps > 0, `Integration guide ${guide.file ?? '<unknown>'} was not fully validated`)
  }
}

function validateLifecycle(value, identity, artifact) {
  requireValue(value?.ok === true, 'Packed editor lifecycle audit did not pass')
  requireValue(value.package === `${identity.packageName}@${identity.packageVersion}`, 'Lifecycle package does not match the candidate')
  requireValue(value.sourceCommit === identity.commit, 'Lifecycle audit commit does not match the candidate')
  requireValue(value.tarball === artifact.name && value.artifactSha256 === artifact.sha256, 'Lifecycle audit tarball does not match the release artifact')
  requireValue(value.install === 'npm install --offline from npm pack tarball', 'Lifecycle audit was not isolated from repository source')
  requireValue(value.browser === 'chromium', 'Lifecycle audit must execute in Chromium')
  const lifecycle = ['mount', 'create', 'edit', 'save', 'dispose', 'remount', 'reopen', 'undo', 'redo', 'dispose']
  requireValue(JSON.stringify(value.lifecycle) === JSON.stringify(lifecycle), 'Vanilla lifecycle is incomplete')
  const frameworks = value.frameworks
  requireValue(Array.isArray(frameworks) && frameworks.length === 2, 'React and Vue runtime results are required')
  for (const framework of ['react', 'vue']) {
    const row = frameworks.find(candidate => candidate?.framework === framework)
    requireValue(row && row.entityCount >= 20, `${framework} runtime did not build a substantive drawing`)
    for (const field of ['approval', 'previewWasReadOnly', 'saved', 'reopened', 'undoRedo', 'disposed']) requireValue(row[field] === true, `${framework} runtime did not prove ${field}`)
    requireValue(row.roots === 0 && row.documentsAfterRelease === 0, `${framework} runtime leaked mounted resources`)
  }
}

export function buildPackageInstallCandidateEvidence(input, options) {
  const identity = {
    repository: text(options?.repository, 'Repository'),
    commit: text(options?.commit, 'Candidate commit'),
    packageName: text(options?.packageName, 'Package name'),
    packageVersion: text(options?.packageVersion, 'Package version'),
  }
  requireValue(/^[0-9a-f]{40}$/i.test(identity.commit), 'Candidate commit must be a full SHA')
  requireValue(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(identity.repository), 'Repository must be owner/name')
  requireValue(/^@[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(identity.packageName), 'Package name must be scoped')
  requireValue(/^1\.\d+\.\d+(?:-rc\.\d+)?$/.test(identity.packageVersion), 'Package version must be a 1.x candidate or stable release')

  const manifest = input?.releaseManifest
  requireValue(manifest?.schema === 'com.kanjie.kjdraw.release-artifacts@1', 'Release manifest schema is invalid')
  requireValue(manifest.package?.name === identity.packageName && manifest.package?.version === identity.packageVersion, 'Release manifest package does not match the candidate')
  requireValue(manifest.source?.commit === identity.commit && repositoryMatches(manifest.source?.repository, identity.repository), 'Release manifest source does not match the candidate')
  requireValue(Array.isArray(manifest.artifacts) && manifest.artifacts.length === 1, 'Release manifest must describe exactly one package artifact')
  const artifact = manifest.artifacts[0]
  requireValue(artifact?.name === expectedTarball(identity.packageName, identity.packageVersion) && sha256(artifact?.sha256), 'Release tarball identity or SHA-256 is invalid')
  requireValue(sha256(input?.releaseManifestSha256), 'Release manifest SHA-256 is required')

  const releaseVerification = input?.releaseVerification
  requireValue(releaseVerification?.ok === true && releaseVerification.sourceCommit === identity.commit, 'Release artifact verification does not match the candidate')
  requireValue(releaseVerification.package === `${identity.packageName}@${identity.packageVersion}` && releaseVerification.tarball === artifact.name, 'Verified release artifact does not match the manifest')
  requireValue(releaseVerification.manifest === `kjdraw-sdk-${identity.packageVersion}.release.json` && releaseVerification.sbom === `kjdraw-sdk-${identity.packageVersion}.spdx.json` && releaseVerification.checksumEntries >= 3, 'Release metadata bundle was not independently verified')
  validatePackageAudit(input?.packageAudit, identity, artifact)
  validateLifecycle(input?.lifecycleAudit, identity, artifact)
  requireValue(isHostedCandidateEvidence(input?.hostedCandidate, { commit: identity.commit, repository: identity.repository }), 'Hosted Demo/Docs evidence does not match the exact candidate')

  return {
    schema: PACKAGE_INSTALL_CANDIDATE_SCHEMA,
    ...identity,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    artifact: { name: artifact.name, sha256: artifact.sha256.toLowerCase(), manifestSha256: input.releaseManifestSha256.toLowerCase() },
    consumers: [
      { id: 'vanilla', typed: true, built: true, ran: true, isolatedInstall: true },
      ...input.lifecycleAudit.frameworks.map(row => ({ id: row.framework, typed: true, built: true, ran: true, isolatedInstall: true, entities: row.entityCount })),
    ],
    workflows: input.packageAudit.productionWorkflows.workflows.map(row => ({ id: row.id, entities: row.entities, edit: row.edit, undoRedo: true, reopen: ['KJD', 'DXF'], output: row.output.format })),
    demoAndDocs: {
      exactCandidate: true,
      pagesRunId: input.hostedCandidate.pages.runId,
      pagesJobId: input.hostedCandidate.pages.jobId,
      verificationStep: input.hostedCandidate.pages.verificationStep,
      workbench: true,
      documentation: true,
    },
  }
}

export function isPackageInstallCandidateEvidence(value, options = {}) {
  return value?.schema === PACKAGE_INSTALL_CANDIDATE_SCHEMA
    && value.repository === options.repository
    && value.commit === options.commit
    && value.packageName === options.packageName
    && value.packageVersion === options.packageVersion
    && value.artifact?.name === expectedTarball(options.packageName ?? '', options.packageVersion ?? '')
    && sha256(value.artifact?.sha256)
    && sha256(value.artifact?.manifestSha256)
    && exactList(value.consumers?.map(row => row?.id), REQUIRED_CONSUMERS)
    && value.consumers.every(row => row.typed === true && row.built === true && row.ran === true && row.isolatedInstall === true && (row.id === 'vanilla' || row.entities >= 20))
    && exactList(value.workflows?.map(row => row?.id), ['mechanical', 'architecture', 'site'])
    && value.workflows.every(row => row.entities > 0 && row.edit && row.undoRedo === true && exactList(row.reopen, ['KJD', 'DXF']) && row.output === 'SVG')
    && value.demoAndDocs?.exactCandidate === true
    && value.demoAndDocs?.workbench === true
    && value.demoAndDocs?.documentation === true
    && Number.isSafeInteger(value.demoAndDocs?.pagesRunId) && value.demoAndDocs.pagesRunId > 0
    && Number.isSafeInteger(value.demoAndDocs?.pagesJobId) && value.demoAndDocs.pagesJobId > 0
    && value.demoAndDocs?.verificationStep === 'Verify the deployed workbench and documentation match this commit'
}
