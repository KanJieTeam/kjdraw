import { readFile, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { isHostedCandidateEvidence } from './hosted-candidate-evidence.mjs'

const root = new URL('../../', import.meta.url)
const readJson = async path => JSON.parse(await readFile(isAbsolute(path) ? path : new URL(path, root), 'utf8'))

const repositoryPackage = await readJson('package.json')
const sdkPackage = await readJson('packages/kjdraw-sdk/package.json')
const matrix = await readJson('docs/KJDRAW_1_0_ACCEPTANCE_MATRIX.json')
const requireReady = process.argv.includes('--require-ready')
const candidateEvidencePath = process.env.KJDRAW_THREE_INDUSTRY_EVIDENCE ?? '.cache/release-evidence/three-industry-candidate.json'
const hostedEvidencePath = process.env.KJDRAW_HOSTED_CANDIDATE_EVIDENCE ?? '.cache/release-evidence/hosted-candidate.json'
const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
let threeIndustryEvidence = null
try { threeIndustryEvidence = await readJson(candidateEvidencePath) } catch {}
let hostedEvidence = null
try { hostedEvidence = await readJson(hostedEvidencePath) } catch {}
const repositoryUrl = String(repositoryPackage.repository?.url ?? repositoryPackage.repository ?? '')
const hostedRepository = process.env.GITHUB_REPOSITORY ?? repositoryUrl.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/i)?.[1] ?? null
const hostedEvidenceValid = isHostedCandidateEvidence(hostedEvidence, { commit: headCommit, repository: hostedRepository })
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
}

console.log(JSON.stringify(report, null, 2))

const requiredReadiness = isReleaseCandidate ? candidateReady : ready
if ((isStableOne || requireReady) && !requiredReadiness) process.exitCode = 1
