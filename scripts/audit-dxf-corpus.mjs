import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createKJDrawSDK, summarizeDocument } from '../packages/kjdraw-sdk/src/index.js'

const corpusRoot = new URL('../fixtures/dxf/', import.meta.url)

function countLayers(document) {
  return document.getTable('layers').records.map(layer => layer.name).sort()
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}

function semanticEntities(document) {
  const referenceKeys = new Set(['layerId', 'styleId', 'blockRecordId', 'dimensionStyleId', 'lineTypeId'])
  return document.listEntities().map(entity => {
    const payload = structuredClone(entity.payload)
    for (const key of referenceKeys) if (payload[key]) {
      const reference = document.getObject(payload[key])
      payload[key] = reference ? `${reference.kind}:${reference.name ?? reference.handle}` : payload[key]
    }
    return canonical({ handle: entity.handle, type: entity.type, payload })
  }).sort((left, right) => left.handle.localeCompare(right.handle))
}

export async function auditDxfCorpus() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', corpusRoot), 'utf8'))
  const cases = []
  for (const fixture of manifest.cases) {
    const source = new Uint8Array(await readFile(new URL(fixture.file, corpusRoot)))
    const sourceHash = createHash('sha256').update(source).digest('hex')
    const sdk = createKJDrawSDK()
    const document = await sdk.readDocument(source, { format: 'DXF' })
    const sourceSummary = summarizeDocument(document)
    const sourceVersion = document.snapshot().header.sourceVersion
    const layers = countLayers(document)
    const expectedDetected = fixture.detectedVersion ?? fixture.version
    const findings = []
    if (sourceVersion !== expectedDetected) findings.push(`detected ${sourceVersion}; expected ${expectedDetected}`)
    if (!sameJson(sourceSummary.entityTypes, manifest.expected.entityTypes)) findings.push(`entity types ${JSON.stringify(sourceSummary.entityTypes)}`)
    if (!sameJson(layers, [...manifest.expected.layers].sort())) findings.push(`layers ${JSON.stringify(layers)}`)

    const artifact = await sdk.writeDocument(document, { format: 'DXF', version: fixture.version })
    const headerCode = String(artifact).match(/\$ACADVER\s*\n\s*1\s*\n\s*(AC\d+)/)?.[1] ?? null
    if (headerCode !== fixture.acadver) findings.push(`wrote ${headerCode}; expected ${fixture.acadver}`)
    const reopened = await createKJDrawSDK().readDocument(artifact, { format: 'DXF' })
    const reopenedSummary = summarizeDocument(reopened)
    if (!sameJson(sourceSummary.entityTypes, reopenedSummary.entityTypes)) findings.push(`reopened entity types ${JSON.stringify(reopenedSummary.entityTypes)}`)
    if (!sameJson(layers, countLayers(reopened))) findings.push(`reopened layers ${JSON.stringify(countLayers(reopened))}`)
    if (!sameJson(semanticEntities(document), semanticEntities(reopened))) findings.push('entity handles, geometry, text or named resource references changed')
    const roundTripStatus = findings.length === 0 ? 'passed' : 'failed'
    cases.push({
      file: fixture.file,
      requestedVersion: fixture.version,
      detectedVersion: sourceVersion,
      acadver: headerCode,
      sha256: sourceHash,
      entities: sourceSummary.entityCount,
      entityTypes: sourceSummary.entityTypes,
      layers,
      roundTrip: roundTripStatus,
      passed: findings.length === 0,
      findings,
    })
  }
  return {
    schemaVersion: 1,
    corpus: 'KJDraw synthetic ASCII DXF core',
    fixtureLicense: manifest.license,
    passed: cases.every(row => row.passed),
    caseCount: cases.length,
    passedCount: cases.filter(row => row.passed).length,
    cases,
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const report = await auditDxfCorpus()
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
  else {
    console.log('KJDraw DXF compatibility corpus')
    for (const row of report.cases) console.log(`${row.passed ? 'PASS' : 'FAIL'}  ${row.requestedVersion.padEnd(4)}  ${row.file}  ${row.entities} entities  ${row.roundTrip}`)
    console.log(`${report.passedCount}/${report.caseCount} declared-version fixtures passed.`)
  }
  if (!report.passed) process.exitCode = 1
}
