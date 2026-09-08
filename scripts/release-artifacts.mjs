import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const sdkPackage = JSON.parse(await readFile(new URL('packages/kjdraw-sdk/package.json', root), 'utf8'))
const subjects = process.argv.slice(2).map(path => resolve(path))

if (subjects.length === 0) {
  console.error('Usage: node scripts/release-artifacts.mjs <release-file> [...]')
  process.exit(2)
}

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const subjectRecords = []
for (const path of subjects) subjectRecords.push({ path, name: basename(path), sha256: await sha256(path) })

const outputDirectory = dirname(subjectRecords[0].path)
if (subjectRecords.some(record => dirname(record.path) !== outputDirectory)) {
  throw new Error('All release artifacts must be in one directory')
}

const primary = subjectRecords[0]
const sbomName = `kjdraw-sdk-${sdkPackage.version}.spdx.json`
const sbomPath = resolve(outputDirectory, sbomName)
const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `${sdkPackage.name}-${sdkPackage.version}`,
  documentNamespace: `https://github.com/KanJieTeam/kjdraw/sbom/${sdkPackage.version}/${primary.sha256}`,
  creationInfo: {
    created: new Date().toISOString(),
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
    annotationDate: new Date().toISOString(),
    annotationType: 'OTHER',
    annotator: `Tool: KJDraw release-artifacts@1 (${randomUUID()})`,
    comment: 'The published SDK has zero runtime npm dependencies; development-only dependencies are intentionally excluded.',
  }],
}

await writeFile(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`)
const allRecords = [...subjectRecords, { path: sbomPath, name: sbomName, sha256: await sha256(sbomPath) }]
await writeFile(
  resolve(outputDirectory, 'SHA256SUMS'),
  `${allRecords.sort((left, right) => left.name.localeCompare(right.name)).map(record => `${record.sha256}  ${record.name}`).join('\n')}\n`,
)

console.log(`Created SPDX SBOM and SHA-256 checksums for ${subjectRecords.length} release artifact(s).`)
