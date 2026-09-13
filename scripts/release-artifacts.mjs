import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const repositoryRoot = fileURLToPath(root)
const subjects = process.argv.slice(2).map(path => resolve(path))

if (subjects.length === 0) {
  console.error('Usage: node scripts/release-artifacts.mjs <release-file> [...]')
  process.exit(2)
}

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }).trim()
const checkoutCommit = git('rev-parse', 'HEAD')
const sourceCommit = (process.env.GITHUB_SHA || checkoutCommit).trim()
if (!/^[a-f0-9]{40}$/i.test(sourceCommit) || sourceCommit !== checkoutCommit) {
  throw new Error('Release source commit must equal the checked-out Git HEAD')
}
const sdkPackage = JSON.parse(git('show', `${sourceCommit}:packages/kjdraw-sdk/package.json`))
const workingSdkPackage = JSON.parse(await readFile(new URL('packages/kjdraw-sdk/package.json', root), 'utf8'))
if (JSON.stringify(sdkPackage) !== JSON.stringify(workingSdkPackage)) {
  throw new Error('SDK package manifest differs from the checked-out Git HEAD')
}
const sourceTimestamp = new Date(git('show', '-s', '--format=%cI', sourceCommit)).toISOString()
const subjectRecords = []
for (const path of subjects) subjectRecords.push({ path, name: basename(path), sha256: await sha256(path) })

const outputDirectory = dirname(subjectRecords[0].path)
if (subjectRecords.some(record => dirname(record.path) !== outputDirectory)) {
  throw new Error('All release artifacts must be in one directory')
}

const primary = subjectRecords[0]
const sbomName = `kjdraw-sdk-${sdkPackage.version}.spdx.json`
const sbomPath = resolve(outputDirectory, sbomName)
const manifestName = `kjdraw-sdk-${sdkPackage.version}.release.json`
const manifestPath = resolve(outputDirectory, manifestName)
const reservedNames = new Set([sbomName, manifestName, 'SHA256SUMS'])
if (new Set(subjectRecords.map(record => record.name)).size !== subjectRecords.length || subjectRecords.some(record => reservedNames.has(record.name))) {
  throw new Error('Release artifact names must be unique and must not use generated metadata names')
}
const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `${sdkPackage.name}-${sdkPackage.version}`,
  documentNamespace: `https://github.com/KanJieTeam/kjdraw/sbom/${sdkPackage.version}/${primary.sha256}`,
  creationInfo: {
    created: sourceTimestamp,
    creators: ['Tool: KJDraw release-artifacts@1'],
    comment: `Release artifact: ${primary.name}; SHA-256: ${primary.sha256}`,
  },
  packages: [{
    SPDXID: 'SPDXRef-Package-KJDraw',
    name: sdkPackage.name,
    versionInfo: sdkPackage.version,
    downloadLocation: `https://www.npmjs.com/package/${sdkPackage.name}/v/${sdkPackage.version}`,
    filesAnalyzed: false,
    licenseConcluded: 'Apache-2.0',
    licenseDeclared: 'Apache-2.0',
    copyrightText: 'NOASSERTION',
    checksums: [{ algorithm: 'SHA256', checksumValue: primary.sha256 }],
    externalRefs: [{
      referenceCategory: 'PACKAGE-MANAGER',
      referenceType: 'purl',
      referenceLocator: `pkg:npm/%40kanjieteam/kjdraw@${sdkPackage.version}`,
    }],
  }],
  relationships: [{
    spdxElementId: 'SPDXRef-DOCUMENT',
    relationshipType: 'DESCRIBES',
    relatedSpdxElement: 'SPDXRef-Package-KJDraw',
  }],
  annotations: [{
    annotationDate: sourceTimestamp,
    annotationType: 'OTHER',
    annotator: 'Tool: KJDraw release-artifacts@1',
    comment: 'The published SDK has zero runtime npm dependencies; development-only dependencies are intentionally excluded.',
  }],
}

await writeFile(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`)
const sbomRecord = { path: sbomPath, name: sbomName, sha256: await sha256(sbomPath) }
const manifest = {
  schema: 'com.kanjie.kjdraw.release-artifacts@1',
  package: { name: sdkPackage.name, version: sdkPackage.version, license: sdkPackage.license },
  source: {
    repository: sdkPackage.repository?.url ?? null,
    commit: sourceCommit,
    committedAt: sourceTimestamp,
  },
  artifacts: subjectRecords.map(({ name, sha256 }) => ({ name, sha256 })),
  sbom: { name: sbomRecord.name, sha256: sbomRecord.sha256, format: 'SPDX-2.3' },
  provenanceBoundary: 'This manifest binds local release bytes to the checked-out commit. GitHub artifact attestation and npm provenance must still be verified from the real release run.',
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
const manifestRecord = { path: manifestPath, name: manifestName, sha256: await sha256(manifestPath) }
const allRecords = [...subjectRecords, sbomRecord, manifestRecord]
await writeFile(
  resolve(outputDirectory, 'SHA256SUMS'),
  `${allRecords.sort((left, right) => left.name.localeCompare(right.name)).map(record => `${record.sha256}  ${record.name}`).join('\n')}\n`,
)

console.log(`Created source-bound release manifest, SPDX SBOM and SHA-256 checksums for ${subjectRecords.length} release artifact(s).`)
