import { readFile, readdir } from 'node:fs/promises'

const root = new URL('../../', import.meta.url)
const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'))

const repositoryPackage = await readJson('package.json')
const sdkPackage = await readJson('packages/kjdraw-sdk/package.json')
const matrix = await readJson('docs/KJDRAW_1_0_ACCEPTANCE_MATRIX.json')
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
    if (isReleaseCandidate && gate.verifyOnCandidate === true && gate.status === 'partial') {
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
}

console.log(JSON.stringify(report, null, 2))

const requiredReadiness = isReleaseCandidate ? candidateReady : ready
if ((isStableOne || process.argv.includes('--require-ready')) && !requiredReadiness) process.exitCode = 1
