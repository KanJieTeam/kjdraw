import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildPackageInstallCandidateEvidence, isPackageInstallCandidateEvidence, PACKAGE_INSTALL_CANDIDATE_SCHEMA } from '../../../scripts/audits/package-install-candidate-evidence.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const hash = character => character.repeat(64)
const fixed = { repository: 'KanJieTeam/kjdraw', commit: 'a'.repeat(40), packageName: '@kanjieteam/kjdraw', packageVersion: '1.0.0-rc.3', generatedAt: '2026-09-14T00:00:00.000Z' }
const tarball = 'kanjieteam-kjdraw-1.0.0-rc.3.tgz'

function hosted(commit = fixed.commit, repository = fixed.repository) {
  return {
    schema: 'com.kanjie.kjdraw.audit.hosted-candidate@1', repository, commit,
    ci: { runId: 101, conclusion: 'success', browsers: ['chromium', 'firefox', 'webkit'].map((engine, index) => ({ engine, jobId: 200 + index, executed: true, conclusion: 'success', stepName: `Run ${engine} acceptance`, stepConclusion: 'success' })) },
    pages: { runId: 301, jobId: 302, conclusion: 'success', verificationStep: 'Verify the deployed workbench and documentation match this commit', verificationConclusion: 'success' },
  }
}

function workflow(id) {
  return { id, units: id === 'site' ? 'meter' : 'millimeter', entities: 40, edit: `edit-${id}`, undoRedo: true, reopen: { KJD: true, DXF: true }, output: { format: 'SVG', paper: 'A3', scale: '1:2', millimetersPerModelUnit: 0.5 } }
}

function fixture(identity = fixed) {
  const name = `${identity.packageName.replace(/^@/, '').replace('/', '-')}-${identity.packageVersion}.tgz`
  return {
    releaseManifestSha256: hash('b'),
    releaseManifest: {
      schema: 'com.kanjie.kjdraw.release-artifacts@1', package: { name: identity.packageName, version: identity.packageVersion },
      source: { repository: `https://github.com/${identity.repository}.git`, commit: identity.commit }, artifacts: [{ name, sha256: hash('c') }],
    },
    releaseVerification: { ok: true, package: `${identity.packageName}@${identity.packageVersion}`, sourceCommit: identity.commit, tarball: name, manifest: `kjdraw-sdk-${identity.packageVersion}.release.json`, sbom: `kjdraw-sdk-${identity.packageVersion}.spdx.json`, checksumEntries: 3 },
    packageAudit: {
      ok: true, package: `${identity.packageName}@${identity.packageVersion}`, sourceCommit: identity.commit, source: 'local-pack', tarball: name, artifactSha256: hash('c'),
      publicEntryPoints: 42, importedBindings: 300, frameworkInstall: { mode: 'locked-offline-npm-ci' }, typedConsumers: ['Vanilla TypeScript', 'React TSX', 'Vue composable'],
      productionWorkflows: { source: 'installed-tarball', blankDocuments: 3, workflows: ['mechanical', 'architecture', 'site'].map(workflow) },
      readmeConsumers: ['README.md', 'README.zh-CN.md'].map(file => ({ file, typescriptSnippets: 1, reactSnippets: 1, vueSnippets: 1, htmlHosts: 1, vueProps: 1 })),
      quickstart: { documentId: 'quickstart', revision: 1, entities: 1 },
    },
    lifecycleAudit: {
      ok: true, package: `${identity.packageName}@${identity.packageVersion}`, sourceCommit: identity.commit, tarball: name, artifactSha256: hash('c'), browser: 'chromium',
      install: 'npm install --offline from npm pack tarball', lifecycle: ['mount', 'create', 'edit', 'save', 'dispose', 'remount', 'reopen', 'undo', 'redo', 'dispose'],
      frameworks: ['react', 'vue'].map(framework => ({ framework, entityCount: 30, approval: true, previewWasReadOnly: true, saved: true, reopened: true, undoRedo: true, disposed: true, roots: 0, documentsAfterDispose: 1, documentsAfterRelease: 0 })),
    },
    hostedCandidate: hosted(identity.commit, identity.repository),
  }
}

test('package candidate evidence binds one tarball to clean Vanilla, React, Vue and exact hosted Demo/Docs', () => {
  const evidence = buildPackageInstallCandidateEvidence(fixture(), fixed)
  assert.equal(evidence.schema, PACKAGE_INSTALL_CANDIDATE_SCHEMA)
  assert.equal(isPackageInstallCandidateEvidence(evidence, fixed), true)
  assert.equal(evidence.artifact.name, tarball)
  assert.deepEqual(evidence.consumers.map(row => row.id), ['vanilla', 'react', 'vue'])
  assert.deepEqual(evidence.workflows.map(row => row.id), ['mechanical', 'architecture', 'site'])
  assert.equal(evidence.demoAndDocs.exactCandidate, true)
})

test('package candidate evidence rejects a different tarball, commit, source install or manifest', () => {
  const mutations = [
    input => { input.packageAudit.artifactSha256 = hash('d') },
    input => { input.lifecycleAudit.sourceCommit = 'd'.repeat(40) },
    input => { input.packageAudit.source = 'npm-registry' },
    input => { input.releaseManifest.source.commit = 'd'.repeat(40) },
    input => { input.releaseManifest.artifacts.push({ name: 'extra.tgz', sha256: hash('e') }) },
  ]
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.throws(() => buildPackageInstallCandidateEvidence(input, fixed)) }
})

test('package candidate evidence rejects incomplete framework, workflow and hosted execution', () => {
  const mutations = [
    input => { input.lifecycleAudit.frameworks.pop() },
    input => { input.lifecycleAudit.frameworks[0].reopened = false },
    input => { input.packageAudit.productionWorkflows.workflows[1].reopen.DXF = false },
    input => { input.hostedCandidate.pages.verificationConclusion = 'failure' },
  ]
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.throws(() => buildPackageInstallCandidateEvidence(input, fixed)) }
})

test('package candidate CLI writes reviewable evidence for the checked-out candidate', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kjdraw-package-candidate-evidence-'))
  t.after(async () => { await import('node:fs/promises').then(({ rm }) => rm(directory, { recursive: true, force: true })) })
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const packageJson = JSON.parse(await readFile(join(root, 'packages/kjdraw-sdk/package.json'), 'utf8'))
  const identity = { ...fixed, commit, packageName: packageJson.name, packageVersion: packageJson.version }
  const inputPath = join(directory, 'input.json'), outputPath = join(directory, 'evidence.json')
  await writeFile(inputPath, JSON.stringify(fixture(identity)))
  const result = spawnSync(process.execPath, ['scripts/audits/verify-package-install-candidate.mjs', '--input', inputPath, '--output', outputPath], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const evidence = JSON.parse(await readFile(outputPath, 'utf8'))
  assert.equal(isPackageInstallCandidateEvidence(evidence, identity), true)
  const readiness = spawnSync(process.execPath, ['scripts/audits/release-readiness.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, KJDRAW_PACKAGE_INSTALL_CANDIDATE_EVIDENCE: outputPath },
  })
  assert.equal(JSON.parse(readiness.stdout).packageInstallCandidate.valid, true)
  const before = await readFile(outputPath)
  const duplicate = spawnSync(process.execPath, ['scripts/audits/verify-package-install-candidate.mjs', '--input', inputPath, '--output', outputPath], { cwd: root, encoding: 'utf8' })
  assert.notEqual(duplicate.status, 0)
  assert.match(duplicate.stderr, /EEXIST/)
  assert.deepEqual(await readFile(outputPath), before)
})

test('release readiness requires exact package install candidate evidence', () => {
  const missing = join(tmpdir(), `kjdraw-missing-package-install-${process.pid}.json`)
  const result = spawnSync(process.execPath, ['scripts/audits/release-readiness.mjs', '--require-ready'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, KJDRAW_PACKAGE_INSTALL_CANDIDATE_EVIDENCE: missing },
  })
  assert.equal(result.status, 1)
  const report = JSON.parse(result.stdout)
  assert.equal(report.findings.some(finding => finding.code === 'PACKAGE_INSTALL_CANDIDATE_EVIDENCE_REQUIRED'), true)
  assert.equal(report.packageInstallCandidate.valid, false)
})
