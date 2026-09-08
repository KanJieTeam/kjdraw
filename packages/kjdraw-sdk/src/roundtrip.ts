import { KJDocument } from './document.js'
import type { KJFileAdapterOptions } from './file-adapters.js'
import type { KJDocumentState, KJReadonlyObjectRecord } from './schema.js'
import { clone, normalizeName, stableHash } from './utils.js'

export type KJRoundTripSeverity = 'error' | 'warning'

export interface KJRoundTripFinding {
  severity: KJRoundTripSeverity
  code: string
  path: string
  expected: unknown
  actual: unknown
}

export interface KJDocumentSummary {
  schemaVersion: number
  documentId: string
  objectCount: number
  erasedObjectCount: number
  entityCount: number
  objectKinds: Record<string, number>
  entityTypes: Record<string, number>
  tableCounts: Record<string, number>
  layoutCount: number
  paperSpaceCount: number
  resourceCounts: Record<string, number>
  opaquePayloadCount: number
  handleCount: number
  ownerEdgeCount: number
}

export interface KJRoundTripOptions extends KJFileAdapterOptions {
  strictHandles?: boolean
}

export interface KJRoundTripAudit {
  passed: boolean
  status: 'passed' | 'warning' | 'failed'
  errors: number
  warnings: number
  format: string
  adapterId: string | null
  expected: KJDocumentSummary
  actual: KJDocumentSummary
  findings: KJRoundTripFinding[]
}

export interface KJRoundTripRegistry {
  write(document: unknown, options: KJFileAdapterOptions): Promise<unknown>
  read(source: unknown, options: KJFileAdapterOptions): Promise<unknown>
}

export interface KJRoundTripExecution {
  artifact: unknown
  document: KJDocument
  audit: KJRoundTripAudit
}

type KJOpenInput = Parameters<typeof KJDocument.open>[0]

function countBy<Value>(values: Iterable<Value>, selector: (value: Value) => PropertyKey): Record<string, number> {
  const output: Record<string, number> = {}
  for (const value of values) {
    const key = String(selector(value))
    output[key] = (output[key] ?? 0) + 1
  }
  return output
}

export function summarizeDocument(input: KJDocument | KJDocumentState): KJDocumentSummary {
  const state = input instanceof KJDocument ? input.toJSON() : clone(input)
  const objects = Object.values(state.objects ?? {})
  const live = objects.filter(object => !object.erased)
  return {
    schemaVersion: state.schemaVersion,
    documentId: state.documentId,
    objectCount: live.length,
    erasedObjectCount: objects.length - live.length,
    entityCount: live.filter(object => object.kind === 'entity').length,
    objectKinds: countBy(live, object => object.kind),
    entityTypes: countBy(live.filter(object => object.kind === 'entity'), object => object.type),
    tableCounts: Object.fromEntries(Object.entries(state.tables ?? {}).map(([name, table]) => [name, table.recordIds?.length ?? 0])),
    layoutCount: state.spaces?.layoutIds?.length ?? 0,
    paperSpaceCount: state.spaces?.paperSpaceIds?.length ?? 0,
    resourceCounts: Object.fromEntries(Object.entries(state.resources ?? {}).map(([name, resources]) => [name, Object.keys(resources ?? {}).length])),
    opaquePayloadCount: Object.keys(state.opaquePayloads ?? {}).length,
    handleCount: new Set(objects.map(object => object.handle)).size,
    ownerEdgeCount: objects.filter(object => object.ownerId).length,
  }
}

function comparableObject(object: KJReadonlyObjectRecord, { strictHandles }: Required<Pick<KJRoundTripOptions, 'strictHandles'>>): Record<string, unknown> {
  const value: Record<string, unknown> = { ...clone(object) }
  if (!strictHandles) {
    delete value.id
    delete value.handle
    delete value.ownerId
  }
  delete value.source
  return value
}

function compareMap(
  label: string,
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
  findings: KJRoundTripFinding[],
  severity: KJRoundTripSeverity = 'error',
): void {
  const keys = new Set([...Object.keys(expected ?? {}), ...Object.keys(actual ?? {})])
  for (const key of [...keys].sort()) {
    if ((expected?.[key] ?? 0) !== (actual?.[key] ?? 0)) {
      findings.push({
        severity,
        code: `${label.toUpperCase()}_MISMATCH`,
        path: `${label}.${key}`,
        expected: expected?.[key] ?? 0,
        actual: actual?.[key] ?? 0,
      })
    }
  }
}

function openDocument(input: KJDocument | KJOpenInput): KJDocument {
  return input instanceof KJDocument ? input : KJDocument.open(input)
}

export function auditRoundTrip(
  sourceInput: KJDocument | KJOpenInput,
  resultInput: KJDocument | KJOpenInput,
  options: KJRoundTripOptions = {},
): KJRoundTripAudit {
  const source = openDocument(sourceInput)
  const result = openDocument(resultInput)
  const strictHandles = options.strictHandles ?? true
  const expected = summarizeDocument(source)
  const actual = summarizeDocument(result)
  const findings: KJRoundTripFinding[] = []
  compareMap('entityTypes', expected.entityTypes, actual.entityTypes, findings)
  compareMap('objectKinds', expected.objectKinds, actual.objectKinds, findings)
  compareMap('tableCounts', expected.tableCounts, actual.tableCounts, findings)
  compareMap('resourceCounts', expected.resourceCounts, actual.resourceCounts, findings, 'warning')
  const scalarKeys = ['layoutCount', 'paperSpaceCount', 'opaquePayloadCount', 'ownerEdgeCount'] as const
  for (const key of scalarKeys) {
    if (expected[key] !== actual[key]) {
      findings.push({
        severity: key === 'opaquePayloadCount' ? 'error' : 'warning',
        code: `${key.toUpperCase()}_MISMATCH`,
        path: key,
        expected: expected[key],
        actual: actual[key],
      })
    }
  }

  const sourceObjects = source.listObjects({ includeErased: true })
  const resultObjects = result.listObjects({ includeErased: true })
  if (strictHandles) {
    const byHandle = new Map(resultObjects.map(object => [object.handle, object]))
    for (const object of sourceObjects) {
      const candidate = byHandle.get(object.handle)
      if (!candidate) {
        findings.push({ severity: 'error', code: 'HANDLE_LOST', path: `objects.${object.handle}`, expected: object.type, actual: null })
        continue
      }
      if (stableHash(comparableObject(object, { strictHandles })) !== stableHash(comparableObject(candidate, { strictHandles }))) {
        findings.push({ severity: 'error', code: 'OBJECT_CHANGED', path: `objects.${object.handle}`, expected: object.type, actual: candidate.type })
      }
    }
  } else {
    const expectedHashes = countBy(sourceObjects, object => stableHash(comparableObject(object, { strictHandles })))
    const actualHashes = countBy(resultObjects, object => stableHash(comparableObject(object, { strictHandles })))
    compareMap('semanticObjects', expectedHashes, actualHashes, findings)
  }

  const errors = findings.filter(finding => finding.severity === 'error').length
  const warnings = findings.filter(finding => finding.severity === 'warning').length
  return {
    passed: errors === 0,
    status: errors ? 'failed' : warnings ? 'warning' : 'passed',
    errors,
    warnings,
    format: normalizeName(options.format ?? 'KJD'),
    adapterId: options.adapterId ?? null,
    expected,
    actual,
    findings,
  }
}

export async function executeRoundTrip(
  registry: KJRoundTripRegistry,
  document: KJDocument,
  options: KJRoundTripOptions = {},
): Promise<KJRoundTripExecution> {
  const written = await registry.write(document, options)
  const read = await registry.read(written, options)
  const reopened = read instanceof KJDocument ? read : KJDocument.open(read as KJOpenInput)
  return { artifact: written, document: reopened, audit: auditRoundTrip(document, reopened, options) }
}
