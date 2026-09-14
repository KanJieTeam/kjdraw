import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { buildModelHoldoutEvidence, isModelHoldoutEvidence, MODEL_HOLDOUT_EVIDENCE_SCHEMA, MODEL_HOLDOUT_MANIFEST_SCHEMA } from '../../../scripts/audits/model-holdout-evidence.mjs'
import { buildExternalAcceptanceEvidence } from '../../../scripts/audits/external-acceptance-evidence.mjs'
import { buildProvenanceCandidateEvidence, PROVENANCE_JOB, PROVENANCE_STEPS } from '../../../scripts/audits/provenance-candidate-evidence.mjs'
import { releaseHoldoutBehavioralTasks, releaseHoldoutGenerationTasks } from '../../../scripts/benchmarks/release-holdout-task-suite.mjs'

const root = resolve(new URL('../../..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'))
const digest = value => createHash('sha256').update(value).digest('hex')
const usage = (inputTokens = 100, outputTokens = 20) => ({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cacheReadInputTokens: 0 })

async function sources() {
  const values = {}
  for (const name of ['paired-model-benchmark.mjs', 'release-holdout-behavioral-runner.mjs', 'release-holdout-task-suite.mjs', 'release-holdout-validator.py']) values[name] = digest(await readFile(resolve(root, 'scripts/benchmarks', name)))
  values['chat-model-settings.js'] = digest(await readFile(resolve(root, 'apps/playground/chat-model-settings.js')))
  values['model-usage.js'] = digest(await readFile(resolve(root, 'packages/kjdraw-sdk/src/model-usage.js')))
  const folder = resolve(root, 'packages/kjdraw-sdk/src'), sdk = createHash('sha256')
  for (const name of (await readdir(folder, { recursive: true })).map(name => name.replaceAll('\\', '/')).filter(name => name.endsWith('.js')).sort()) { sdk.update(name); sdk.update(await readFile(resolve(folder, name))) }
  values.sdkRuntimeSha256 = sdk.digest('hex')
  return values
}

async function makeReports(directory, model, source) {
  const request = Buffer.from('{"request":true}'), response = Buffer.from('{"response":true}'), dxf = Buffer.from('0\nEOF\n'), kjd = Buffer.from('{"kjd":true}')
  await Promise.all([writeFile(resolve(directory, 'request.json'), request), writeFile(resolve(directory, 'response.json'), response), writeFile(resolve(directory, 'drawing.dxf'), dxf), writeFile(resolve(directory, 'drawing.kjd'), kjd)])
  const generationRuns = []
  for (let repetition = 1; repetition <= 5; repetition++) for (const task of releaseHoldoutGenerationTasks) for (const arm of ['kjdraw-tool', 'direct-dxf']) generationRuns.push({
    taskId: task.id, taskVersion: task.version, taskCategory: task.category, acceptanceSha256: task.acceptanceSha256,
    arm, repetition, status: 'passed', requestedModel: model.requested, returnedModel: model.returned,
    humanInterventionCount: 0, humanInterventionEvidence: 'noninteractive-harness', totalMs: 10, transportLatencyMs: 8, validation: { passed: true },
    budget: structuredClone(task.budget), modelToolCallCount: arm === 'kjdraw-tool' ? 1 : 0,
    budgetCompliance: { passed: true, observed: { inputTokens: 100, outputTokens: 20, toolCalls: arm === 'kjdraw-tool' ? 1 : 0, wallTimeMs: 10, humanInterventions: 0 } }, usage: usage(), cost: null,
    files: { request: 'request.json', response: 'response.json', dxf: 'drawing.dxf' }, requestSha256: digest(request), responseSha256: digest(response), dxfSha256: digest(dxf),
  })
  const generation = {
    schema: 'com.kanjie.kjdraw.benchmark.paired-model@1', mode: 'live', exploratory: false, fixtureWarning: null, taskSuite: 'release-holdout-generation', status: 'complete',
    repetitions: 5, plannedRequests: 170, attemptedRequests: 170, unexecutedRequests: 0, model: model.requested, returnedModels: [model.returned], consistentReturnedModel: true,
    endpointOrigin: 'https://provider.example', timingDefinition: 'complete wall time', latencyDefinition: 'provider request wall time', tasks: releaseHoldoutGenerationTasks.map(task => ({ id: task.id, version: task.version, category: task.category, acceptanceSha256: task.acceptanceSha256, budget: structuredClone(task.budget) })),
    runtime: structuredClone(model.runtime),
    validator: { manufacturing: { validator: 'ezdxf-manufacturing', version: '1.4.0' }, 'release-holdout': { validator: 'ezdxf-release-holdout', version: '1.4.0' } }, source,
    pricing: null, cost: null, humanInterventionCount: 0, runs: generationRuns,
  }
  const behavioralRuns = []
  for (let repetition = 1; repetition <= 5; repetition++) for (const task of releaseHoldoutBehavioralTasks) {
    const responses = task.turns.map((turn, index) => ({ turnId: turn.id, requestedModel: model.requested, returnedModel: model.returned, transportLatencyMs: 4, usage: usage(50, 10), requestSha256: digest(request), responseSha256: digest(response), files: { request: 'request.json', response: 'response.json' } }))
    const runUsage = usage(50 * task.turns.length, 10 * task.turns.length)
    behavioralRuns.push({
      taskId: task.id, taskVersion: task.version, taskCategory: task.category, acceptanceSha256: task.acceptanceSha256, repetition, status: 'passed',
      requestedModels: [model.requested], returnedModels: [model.returned], humanInterventionCount: 0, totalMs: 12, providerLatencyMs: 4 * task.turns.length,
      humanInterventionEvents: [], modelToolCallCount: Math.min(1, task.budget.maxToolCalls), state: { passed: true },
      budget: { passed: true, observed: { inputTokens: runUsage.inputTokens, outputTokens: runUsage.outputTokens, toolCalls: Math.min(1, task.budget.maxToolCalls), wallTimeMs: 12, humanInterventions: 0 } },
      reopenStateMatches: true, turnStates: task.turns.map(turn => ({ turnId: turn.id, passed: true })), responses,
      usage: runUsage, cost: null, files: { seedKjd: 'drawing.kjd', finalKjd: 'drawing.kjd' }, seedKjdSha256: digest(kjd), finalKjdSha256: digest(kjd),
    })
  }
  const totalUsage = Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadInputTokens'].map(name => [name, behavioralRuns.reduce((sum, run) => sum + run.usage[name], 0)]))
  const behavioral = {
    schema: 'com.kanjie.kjdraw.benchmark.behavioral-suite@2', mode: 'live', fixtureWarning: null, status: 'complete', repetitions: 5, plannedRuns: 65, attemptedRuns: 65, unexecutedRuns: 0,
    model: model.requested, returnedModels: [model.returned], consistentReturnedModel: true, endpointOrigin: 'https://provider.example', timingDefinition: 'complete wall time', latencyDefinition: 'provider request wall time',
    runtime: structuredClone(model.runtime),
    tasks: releaseHoldoutBehavioralTasks.map(task => ({ id: task.id, version: task.version, category: task.category, acceptanceSha256: task.acceptanceSha256, budget: structuredClone(task.budget) })), source,
    pricing: null, cost: null, humanInterventionCount: 0, usage: totalUsage, totalMs: behavioralRuns.reduce((sum, run) => sum + run.totalMs, 0), providerLatencyMs: behavioralRuns.reduce((sum, run) => sum + run.providerLatencyMs, 0), runs: behavioralRuns,
    humanInterventionLedger: { eventCount: 0, sourceSha256: 'f'.repeat(64) },
  }
  const generationPath = resolve(directory, 'generation.json'), behavioralPath = resolve(directory, 'behavioral.json')
  await writeFile(generationPath, JSON.stringify(generation)); await writeFile(behavioralPath, JSON.stringify(behavioral))
  return { generation, behavioral, generationPath, behavioralPath }
}

async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'kjdraw-model-holdout-')), source = await sources()
  const definitions = [
    { id: 'cn-a', vendor: { id: 'vendor-cn-a', name: 'Domestic A', classification: 'domestic-cn' }, requested: 'model-cn-a', returned: 'model-cn-a-202609', runtime: { node: 'v22.19.0', platform: 'win32', architecture: 'x64' } },
    { id: 'cn-b', vendor: { id: 'vendor-cn-b', name: 'Domestic B', classification: 'domestic-cn' }, requested: 'model-cn-b', returned: 'model-cn-b-202609', runtime: { node: 'v22.19.0', platform: 'linux', architecture: 'x64' } },
    { id: 'global-c', vendor: { id: 'vendor-global-c', name: 'International C', classification: 'international' }, requested: 'model-global-c', returned: 'model-global-c-202609', runtime: { node: 'v22.19.0', platform: 'linux', architecture: 'arm64' } },
  ]
  const reports = []
  for (const definition of definitions) {
    const modelDirectory = resolve(directory, definition.id)
    await import('node:fs/promises').then(({ mkdir }) => mkdir(modelDirectory))
    reports.push(await makeReports(modelDirectory, definition, source))
  }
  const manifest = {
    schema: MODEL_HOLDOUT_MANIFEST_SCHEMA, repository: 'KanJieTeam/kjdraw', commit: 'a'.repeat(40), package: { name: '@kanjieteam/kjdraw', version: '1.0.0-rc.3' },
    models: definitions.map((definition, index) => ({
      id: definition.id, vendor: definition.vendor, requestedModel: definition.requested, returnedModel: definition.returned,
      runtimeEnvironment: { kind: 'node-sdk', ...definition.runtime },
      generationReport: reports[index].generationPath, behavioralReport: reports[index].behavioralPath,
      generationReportSha256: digest(Buffer.from(JSON.stringify(reports[index].generation))), behavioralReportSha256: digest(Buffer.from(JSON.stringify(reports[index].behavioral))),
    })),
  }
  return { directory, manifest, reports }
}

const options = { repository: 'KanJieTeam/kjdraw', commit: 'a'.repeat(40), packageName: '@kanjieteam/kjdraw', packageVersion: '1.0.0-rc.3' }

test('three-model holdout evidence verifies complete live 30-task runs and exact candidate identity', async t => {
  const value = await fixture(); t.after(() => rm(value.directory, { recursive: true, force: true }))
  const evidence = await buildModelHoldoutEvidence(value.manifest, options)
  assert.equal(evidence.schema, MODEL_HOLDOUT_EVIDENCE_SCHEMA)
  assert.equal(evidence.models.length, 3)
  assert.equal(evidence.models.every(model => model.evaluatedRuns === 150 && model.repetitions === 5), true)
  assert.deepEqual(evidence.runtimeCoverage.platforms, ['linux', 'win32'])
  assert.equal(evidence.thresholds.overallRate, 1)
  assert.equal(isModelHoldoutEvidence(evidence, options), true)
  assert.equal(isModelHoldoutEvidence(evidence, { ...options, commit: 'b'.repeat(40) }), false)
})

test('three-model holdout verifier fails closed on simulated, incomplete, unknown or inconsistent evidence', async t => {
  const value = await fixture(); t.after(() => rm(value.directory, { recursive: true, force: true }))
  const update = async (modelIndex, kind, mutate) => {
    const report = structuredClone(value.reports[modelIndex][kind]); mutate(report)
    const path = value.reports[modelIndex][`${kind}Path`], bytes = Buffer.from(JSON.stringify(report))
    await writeFile(path, bytes)
    value.manifest.models[modelIndex][`${kind}ReportSha256`] = digest(bytes)
  }
  await update(0, 'generation', report => { report.mode = 'fixture' })
  await assert.rejects(buildModelHoldoutEvidence(value.manifest, options), /not a non-exploratory live run/)
  await update(0, 'generation', report => { report.runs.pop() })
  await assert.rejects(buildModelHoldoutEvidence(value.manifest, options), /incomplete/)
  await update(0, 'generation', report => { report.runs[0].usage.cacheReadInputTokens = null })
  await assert.rejects(buildModelHoldoutEvidence(value.manifest, options), /cacheReadInputTokens is unknown/)
  await update(0, 'generation', report => { delete report.runs[0].validation.passed })
  await assert.rejects(buildModelHoldoutEvidence(value.manifest, options), /lacks independent geometry judgment/)
  await update(0, 'generation', () => {})
  await update(0, 'behavioral', report => { report.runs[0].state.passed = 'yes' })
  await assert.rejects(buildModelHoldoutEvidence(value.manifest, options), /lacks independent behavior/)
  await update(0, 'behavioral', () => {})
  await update(0, 'generation', report => { report.runs[0].returnedModel = 'different-model' })
  await assert.rejects(buildModelHoldoutEvidence(value.manifest, options), /returned model mismatch/)
})

test('three-model holdout verifier enforces vendor diversity and per-model 95 percent thresholds', async t => {
  const value = await fixture(); t.after(() => rm(value.directory, { recursive: true, force: true }))
  value.manifest.models[2].vendor.classification = 'domestic-cn'
  await assert.rejects(buildModelHoldoutEvidence(value.manifest, options), /two domestic Chinese vendors and one international/)
  value.manifest.models[2].vendor.classification = 'international'
  const report = structuredClone(value.reports[0].generation)
  for (const run of report.runs.filter(run => run.arm === 'kjdraw-tool').slice(0, 8)) { run.status = 'geometry-failed'; run.validation.passed = false }
  const bytes = Buffer.from(JSON.stringify(report)); await writeFile(value.reports[0].generationPath, bytes); value.manifest.models[0].generationReportSha256 = digest(bytes)
  await assert.rejects(buildModelHoldoutEvidence(value.manifest, options), /overall completion is below 95%/)
})

test('three-model holdout runtime coverage is report-bound and needs two real platforms', async t => {
  const value = await fixture(); t.after(() => rm(value.directory, { recursive: true, force: true }))
  value.manifest.models[1].runtimeEnvironment.platform = 'win32'
  await assert.rejects(buildModelHoldoutEvidence(value.manifest, options), /report runtime does not match/)
  for (const index of [1, 2]) {
    value.manifest.models[index].runtimeEnvironment = { kind: 'node-sdk', node: 'v22.19.0', platform: 'win32', architecture: 'x64' }
    for (const kind of ['generation', 'behavioral']) {
      const report = structuredClone(value.reports[index][kind]); report.runtime = { node: 'v22.19.0', platform: 'win32', architecture: 'x64' }
      const bytes = Buffer.from(JSON.stringify(report)); await writeFile(value.reports[index][`${kind}Path`], bytes); value.manifest.models[index][`${kind}ReportSha256`] = digest(bytes)
    }
  }
  await assert.rejects(buildModelHoldoutEvidence(value.manifest, options), /two distinct real runtime platforms/)
})

test('release readiness reports external, model holdout and provenance evidence state', () => {
  const missing = resolve(tmpdir(), `kjdraw-missing-${process.pid}.json`)
  const result = spawnSync(process.execPath, ['scripts/audits/release-readiness.mjs', '--require-ready'], { cwd: root, encoding: 'utf8', env: { ...process.env, KJDRAW_EXTERNAL_ACCEPTANCE_EVIDENCE: missing, KJDRAW_MODEL_HOLDOUT_EVIDENCE: missing, KJDRAW_PROVENANCE_CANDIDATE_EVIDENCE: missing } })
  assert.equal(result.status, 1)
  const report = JSON.parse(result.stdout)
  assert.equal(report.findings.some(finding => finding.code === 'EXTERNAL_ACCEPTANCE_EVIDENCE_REQUIRED'), true)
  assert.equal(report.findings.some(finding => finding.code === 'THREE_MODEL_HOLDOUT_EVIDENCE_REQUIRED'), true)
  assert.equal(report.findings.some(finding => finding.code === 'PROVENANCE_CANDIDATE_EVIDENCE_REQUIRED'), true)
  assert.equal(report.externalAcceptance.valid, false)
  assert.equal(report.modelHoldout.valid, false)
  assert.equal(report.provenanceCandidate.valid, false)
})

test('release readiness accepts all three evidence files only for the exact checkout', async t => {
  const value = await fixture(); t.after(() => rm(value.directory, { recursive: true, force: true }))
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
  const exact = { repository: 'KanJieTeam/kjdraw', commit, packageName: '@kanjieteam/kjdraw', packageVersion: '1.0.0-rc.3' }
  value.manifest.commit = commit
  const model = await buildModelHoldoutEvidence(value.manifest, exact)
  const external = buildExternalAcceptanceEvidence({
    tester: { id: 'external-tester-01', independent: true, didNotContributeToCandidate: true, noMaintainerGuidanceDuringRun: true },
    environment: { operatingSystem: 'Linux', nodeVersion: '22.19.0', framework: 'React clean project', locale: 'en-US' },
    install: { source: 'candidate-tarball', packageName: exact.packageName, packageVersion: exact.packageVersion, artifactSha256: '1'.repeat(64), cleanProject: true, installedWithoutRepositorySource: true },
    workflow: { taskId: 'external-01', startedBlank: true, usedPublishedInstructionsOnly: true, createdEditableGeometry: true, modifiedExistingGeometry: true, undoRedoPassed: true, savedAndReopened: true, dxfAuditPassed: true, geometryChecks: [{ id: 'geometry', passed: true }], artifacts: { kjdSha256: '2'.repeat(64), dxfSha256: '3'.repeat(64) } },
    completedAt: '2026-09-14T00:00:00.000Z',
  }, exact)
  const provenance = buildProvenanceCandidateEvidence({ run: { id: 10, head_sha: commit, event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success' }, jobs: [{ id: 11, name: PROVENANCE_JOB, status: 'completed', conclusion: 'success', steps: PROVENANCE_STEPS.map(name => ({ name, status: 'completed', conclusion: 'success' })) }] }, { repository: exact.repository, commit })
  const paths = { model: resolve(value.directory, 'model.json'), external: resolve(value.directory, 'external.json'), provenance: resolve(value.directory, 'provenance.json') }
  await Promise.all([writeFile(paths.model, JSON.stringify(model)), writeFile(paths.external, JSON.stringify(external)), writeFile(paths.provenance, JSON.stringify(provenance))])
  const result = spawnSync(process.execPath, ['scripts/audits/release-readiness.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, KJDRAW_MODEL_HOLDOUT_EVIDENCE: paths.model, KJDRAW_EXTERNAL_ACCEPTANCE_EVIDENCE: paths.external, KJDRAW_PROVENANCE_CANDIDATE_EVIDENCE: paths.provenance } })
  assert.equal(result.status, 0)
  const report = JSON.parse(result.stdout)
  assert.equal(report.modelHoldout.valid, true)
  assert.equal(report.externalAcceptance.valid, true)
  assert.equal(report.provenanceCandidate.valid, true)
  assert.deepEqual(report.modelHoldout.runtimeEnvironments, ['linux', 'win32'])
  assert.equal(report.verifiedCandidateGates.some(gate => gate.gate === 'security.release-provenance'), true)
})
