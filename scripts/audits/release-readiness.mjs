import { readFile, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { isHostedCandidateEvidence } from './hosted-candidate-evidence.mjs'
import { isExternalAcceptanceEvidence } from './external-acceptance-evidence.mjs'
import { isModelHoldoutEvidence } from './model-holdout-evidence.mjs'
import { isPackageInstallCandidateEvidence } from './package-install-candidate-evidence.mjs'
import { isProvenanceCandidateEvidence } from './provenance-candidate-evidence.mjs'

const root = new URL('../../', import.meta.url)
const readJson = async path => JSON.parse(await readFile(isAbsolute(path) ? path : new URL(path, root), 'utf8'))

const repositoryPackage = await readJson('package.json')
const sdkPackage = await readJson('packages/kjdraw-sdk/package.json')
const matrix = await readJson('docs/KJDRAW_1_0_ACCEPTANCE_MATRIX.json')
const requireReady = process.argv.includes('--require-ready')
const candidateEvidencePath = process.env.KJDRAW_THREE_INDUSTRY_EVIDENCE ?? '.cache/release-evidence/three-industry-candidate.json'
const hostedEvidencePath = process.env.KJDRAW_HOSTED_CANDIDATE_EVIDENCE ?? '.cache/release-evidence/hosted-candidate.json'
const externalEvidencePath = process.env.KJDRAW_EXTERNAL_ACCEPTANCE_EVIDENCE ?? '.cache/release-evidence/external-acceptance.json'
const modelEvidencePath = process.env.KJDRAW_MODEL_HOLDOUT_EVIDENCE ?? '.cache/release-evidence/three-model-holdout.json'
const packageInstallEvidencePath = process.env.KJDRAW_PACKAGE_INSTALL_CANDIDATE_EVIDENCE ?? '.cache/release-evidence/package-install-candidate.json'
const provenanceEvidencePath = process.env.KJDRAW_PROVENANCE_CANDIDATE_EVIDENCE ?? '.cache/release-evidence/provenance-candidate.json'
const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
let threeIndustryEvidence = null
try { threeIndustryEvidence = await readJson(candidateEvidencePath) } catch {}
let hostedEvidence = null
try { hostedEvidence = await readJson(hostedEvidencePath) } catch {}
let externalEvidence = null
try { externalEvidence = await readJson(externalEvidencePath) } catch {}
let modelEvidence = null
try { modelEvidence = await readJson(modelEvidencePath) } catch {}
let packageInstallEvidence = null
try { packageInstallEvidence = await readJson(packageInstallEvidencePath) } catch {}
let provenanceEvidence = null
try { provenanceEvidence = await readJson(provenanceEvidencePath) } catch {}
const repositoryUrl = String(repositoryPackage.repository?.url ?? repositoryPackage.repository ?? sdkPackage.repository?.url ?? sdkPackage.repository ?? '')
const hostedRepository = process.env.GITHUB_REPOSITORY ?? repositoryUrl.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/i)?.[1] ?? null
const hostedEvidenceValid = isHostedCandidateEvidence(hostedEvidence, { commit: headCommit, repository: hostedRepository })
const candidateIdentity = { repository: hostedRepository, commit: headCommit, packageName: sdkPackage.name, packageVersion: sdkPackage.version }
const externalEvidenceValid = isExternalAcceptanceEvidence(externalEvidence, candidateIdentity)
const modelEvidenceValid = isModelHoldoutEvidence(modelEvidence, candidateIdentity)
const packageInstallEvidenceValid = isPackageInstallCandidateEvidence(packageInstallEvidence, candidateIdentity)
const provenanceEvidenceValid = isProvenanceCandidateEvidence(provenanceEvidence, { commit: headCommit, repository: hostedRepository })
const requiredIndustries = ['mechanical', 'architecture', 'site']
const threeIndustryEvidenceValid = threeIndustryEvidence?.schema === 'com.kanjie.kjdraw.audit.three-industry-candidate@1'
  && threeIndustryEvidence.commit === headCommit
  && threeIndustryEvidence.cleanCandidateSources === true
  && threeIndustryEvidence.browser === 'chromium'
  && requiredIndustries.every(kind => {
    const row = threeIndustryEvidence.scenarios?.find(candidate => candidate.kind === kind)
    return row?.startedBlank === true && row?.kjdReopened === true && row?.kjpReopened === true && row?.valid === true
      && row?.pngComplete === true && row?.svgDiagnostics === 0 && row?.svgBytes > 1_000 && row?.pngBytes > 1_000 && row?.printBytes > row?.svgBytes
  })
const sourceFiles = await readdir(new URL('packages/kjdraw-sdk/src/', root), { recursive: true })
const implementationFiles = sourceFiles.filter(path => /\.(?:js|ts)$/.test(path))
const typescriptFiles = implementationFiles.filter(path => path.endsWith('.ts'))
const javascriptOnlyFiles = implementationFiles.filter(path => {
  if (!path.endsWith('.js')) return false
  return !implementationFiles.includes(`${path.slice(0, -3)}.ts`)
})

const isStableOne = /^1\.\d+\.\d+$/.test(sdkPackage.version)
const isReleaseCandidate = /^1\.\d+\.\d+-rc\.\d+$/.test(sdkPackage.version)

const findings = []
const pendingCandidateVerification = []
const verifiedCandidateGates = []
const hostedCandidateGates = new Set(['public.workbench', 'public.documentation'])
if ((isReleaseCandidate || isStableOne) && !externalEvidenceValid) findings.push({
  code: 'EXTERNAL_ACCEPTANCE_EVIDENCE_REQUIRED',
  evidence: externalEvidencePath,
  commit: headCommit,
  repository: hostedRepository,
  package: sdkPackage.name,
  version: sdkPackage.version,
})
if ((isReleaseCandidate || isStableOne) && !modelEvidenceValid) findings.push({
  code: 'THREE_MODEL_HOLDOUT_EVIDENCE_REQUIRED',
  evidence: modelEvidencePath,
  commit: headCommit,
  repository: hostedRepository,
  package: sdkPackage.name,
  version: sdkPackage.version,
})
if ((isReleaseCandidate || isStableOne) && !packageInstallEvidenceValid) findings.push({
  code: 'PACKAGE_INSTALL_CANDIDATE_EVIDENCE_REQUIRED',
  evidence: packageInstallEvidencePath,
  commit: headCommit,
  repository: hostedRepository,
  package: sdkPackage.name,
  version: sdkPackage.version,
})
if (repositoryPackage.version !== sdkPackage.version) findings.push({
  code: 'PACKAGE_VERSION_MISMATCH',
  repository: repositoryPackage.version,
  sdk: sdkPackage.version,
})
if (matrix.release !== sdkPackage.version) findings.push({
  code: 'MATRIX_VERSION_MISMATCH',
  matrix: matrix.release,
  sdk: sdkPackage.version,
})

for (const gate of matrix.gates ?? []) {
  if (gate.requiredForStable !== false && gate.status !== 'passed') {
    const finding = {
      code: 'ACCEPTANCE_GATE_NOT_PASSED',
      gate: gate.id,
      status: gate.status,
      gap: gate.gap ?? null,
    }
    if (isReleaseCandidate && gate.verifyOnCandidate === true && gate.status === 'partial' && gate.id === 'cad.production-workflows' && threeIndustryEvidenceValid) {
      verifiedCandidateGates.push({ gate: gate.id, evidence: candidateEvidencePath, commit: headCommit })
    } else if (isReleaseCandidate && gate.verifyOnCandidate === true && gate.status === 'partial' && gate.id === 'cad.production-workflows' && requireReady) {
      findings.push({
        code: 'THREE_INDUSTRY_CANDIDATE_EVIDENCE_REQUIRED',
        gate: gate.id,
        evidence: candidateEvidencePath,
        commit: headCommit,
      })
    } else if (isReleaseCandidate && gate.verifyOnCandidate === true && gate.status === 'partial' && hostedCandidateGates.has(gate.id) && hostedEvidenceValid) {
      verifiedCandidateGates.push({ gate: gate.id, evidence: hostedEvidencePath, commit: headCommit })
    } else if (isReleaseCandidate && gate.verifyOnCandidate === true && gate.status === 'partial' && hostedCandidateGates.has(gate.id) && requireReady) {
      findings.push({
        code: 'HOSTED_CANDIDATE_EVIDENCE_REQUIRED',
        gate: gate.id,
        evidence: hostedEvidencePath,
        commit: headCommit,
      })
    } else if (isReleaseCandidate && gate.verifyOnCandidate === true && gate.status === 'partial' && gate.id === 'security.release-provenance' && provenanceEvidenceValid) {
      verifiedCandidateGates.push({ gate: gate.id, evidence: provenanceEvidencePath, commit: headCommit })
    } else if (isReleaseCandidate && gate.verifyOnCandidate === true && gate.status === 'partial' && gate.id === 'security.release-provenance' && requireReady) {
      findings.push({
        code: 'PROVENANCE_CANDIDATE_EVIDENCE_REQUIRED',
        gate: gate.id,
        evidence: provenanceEvidencePath,
        commit: headCommit,
      })
    } else if (isReleaseCandidate && gate.verifyOnCandidate === true && gate.status === 'partial') {
      pendingCandidateVerification.push(finding)
    } else {
      findings.push(finding)
    }
  }
  if (gate.status === 'passed' && !(gate.evidence?.length > 0)) findings.push({
    code: 'PASSED_GATE_WITHOUT_EVIDENCE',
    gate: gate.id,
  })
}

const candidateReady = findings.length === 0
const ready = candidateReady && pendingCandidateVerification.length === 0
const report = {
  schema: 'com.kanjie.kjdraw.audit.release-readiness@1',
  release: sdkPackage.version,
  stableOneRelease: isStableOne,
  releaseCandidate: isReleaseCandidate,
  ready,
  candidateReady,
  sourceOwnership: {
    typescriptFiles: typescriptFiles.length,
    javascriptOnlyFiles: javascriptOnlyFiles.length,
  },
  gateSummary: Object.fromEntries(
    ['passed', 'partial', 'blocked', 'out-of-scope', 'experimental'].map(status => [status, (matrix.gates ?? []).filter(gate => gate.status === status).length]),
  ),
  findings,
  pendingCandidateVerification,
  verifiedCandidateGates,
  threeIndustryCandidate: {
    evidence: candidateEvidencePath,
    valid: threeIndustryEvidenceValid,
    commit: threeIndustryEvidence?.commit ?? null,
    scenarios: threeIndustryEvidence?.scenarios?.map(row => row.kind) ?? [],
  },
  hostedCandidate: {
    evidence: hostedEvidencePath,
    valid: hostedEvidenceValid,
    commit: hostedEvidence?.commit ?? null,
    repository: hostedEvidence?.repository ?? null,
    browsers: hostedEvidence?.ci?.browsers?.map(row => row.engine) ?? [],
    pagesVerification: hostedEvidence?.pages?.verificationConclusion ?? null,
  },
  externalAcceptance: {
    evidence: externalEvidencePath,
    valid: externalEvidenceValid,
    commit: externalEvidence?.commit ?? null,
    repository: externalEvidence?.repository ?? null,
    package: externalEvidence?.package?.name ?? null,
    version: externalEvidence?.package?.version ?? null,
  },
  modelHoldout: {
    evidence: modelEvidencePath,
    valid: modelEvidenceValid,
    commit: modelEvidence?.commit ?? null,
    repository: modelEvidence?.repository ?? null,
    package: modelEvidence?.package?.name ?? null,
    version: modelEvidence?.package?.version ?? null,
    models: modelEvidence?.models?.map(model => model.id) ?? [],
    overallRate: modelEvidence?.thresholds?.overallRate ?? null,
    standardRate: modelEvidence?.thresholds?.standardRate ?? null,
    runtimeEnvironments: modelEvidence?.runtimeCoverage?.platforms ?? [],
  },
  packageInstallCandidate: {
    evidence: packageInstallEvidencePath,
    valid: packageInstallEvidenceValid,
    commit: packageInstallEvidence?.commit ?? null,
    repository: packageInstallEvidence?.repository ?? null,
    package: packageInstallEvidence?.packageName ?? null,
    version: packageInstallEvidence?.packageVersion ?? null,
    artifactSha256: packageInstallEvidence?.artifact?.sha256 ?? null,
    consumers: packageInstallEvidence?.consumers?.map(row => row.id) ?? [],
    pagesRunId: packageInstallEvidence?.demoAndDocs?.pagesRunId ?? null,
  },
  provenanceCandidate: {
    evidence: provenanceEvidencePath,
    valid: provenanceEvidenceValid,
    commit: provenanceEvidence?.commit ?? null,
    repository: provenanceEvidence?.repository ?? null,
    runId: provenanceEvidence?.run?.id ?? null,
    jobId: provenanceEvidence?.job?.id ?? null,
  },
}

console.log(JSON.stringify(report, null, 2))

const requiredReadiness = isReleaseCandidate ? candidateReady : ready
if ((isStableOne || requireReady) && !requiredReadiness) process.exitCode = 1
