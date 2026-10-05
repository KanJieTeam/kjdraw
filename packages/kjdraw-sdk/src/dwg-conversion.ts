import { createDXFFileAdapter } from './dxf-adapter.js'
import { KJDocument } from './document.js'
import { KJValidationError } from './errors.js'
import { defineFileAdapter } from './file-adapters.js'
import type { KJFileAdapter, KJFileAdapterOptions, KJFileReadProgress } from './file-adapters.js'
import { createKJDFileAdapter } from './kjd-adapter.js'
import { clone, deepFreeze } from './utils.js'
import type { ReadonlyDeep } from './utils.js'

export type KJDwgConversionTarget = 'DXF' | 'KJD'
export type KJDwgConversionLocality = 'local' | 'self-hosted' | 'cloud'

export interface KJDwgConversionLimits {
  maxSourceBytes: number
  maxResultBytes: number
}

export interface KJDwgConversionProgress {
  phase: 'validate' | 'upload' | 'convert' | 'download'
  completed: number
  total?: number
  unit: 'bytes' | 'percent' | 'steps'
}

export interface KJDwgConversionSource {
  /** A bounded display name. It is not a path and must not be treated as one. */
  name: string
  /** A private copy of the source bytes. KJDraw does not retain these in the document. */
  bytes: Uint8Array
  sha256: string
  dwgVersion: string
}

export interface KJDwgConversionRequest {
  source: KJDwgConversionSource
  target: KJDwgConversionTarget
  signal?: AbortSignal
  onProgress?: (progress: Readonly<KJDwgConversionProgress>) => void
}

export interface KJDwgConversionResult {
  format: KJDwgConversionTarget
  data: string | Uint8Array | ArrayBuffer | Blob
  /** When supplied, these digests are verified before parsing. */
  sourceSha256?: string
  sha256?: string
  providerVersion?: string
  warnings?: readonly unknown[]
  approximations?: readonly unknown[]
}

export interface KJDwgConversionProvider {
  id: string
  version?: string
  locality: KJDwgConversionLocality
  outputFormats: readonly KJDwgConversionTarget[]
  limits: Readonly<KJDwgConversionLimits>
  convert(request: Readonly<KJDwgConversionRequest>): KJDwgConversionResult | Promise<KJDwgConversionResult>
}

export interface KJDwgConversionProvenance {
  schema: 'kjdraw.dwg-import'
  schemaVersion: 1
  provider: { id: string; version: string | null; locality: KJDwgConversionLocality }
  sourceSha256: string
  sourceName: string
  sourceBytes: number
  sourceVersion: string
  target: KJDwgConversionTarget
  targetSha256: string
  targetBytes: number
  warnings: readonly string[]
  approximations: readonly string[]
}

export interface KJDwgConversionReadOptions extends KJFileAdapterOptions {
  fileName?: string
  targetFormat?: KJDwgConversionTarget
  limits?: Partial<KJDwgConversionLimits>
  onConversionProgress?: (progress: Readonly<KJDwgConversionProgress>) => void
}

export interface KJDwgConversionAdapterOptions {
  provider: KJDwgConversionProvider
  id?: string
  priority?: number
}

export const KJ_DWG_CONVERSION_DEFAULT_LIMITS: Readonly<KJDwgConversionLimits> = Object.freeze({
  maxSourceBytes: 128 * 1024 ** 2,
  maxResultBytes: 256 * 1024 ** 2,
})

const MAX_NAME_LENGTH = 255
const MAX_ID_LENGTH = 128
const MAX_DIAGNOSTIC_ITEMS = 64
const MAX_DIAGNOSTIC_LENGTH = 512
const TARGETS = new Set<KJDwgConversionTarget>(['DXF', 'KJD'])
const LOCALITIES = new Set<KJDwgConversionLocality>(['local', 'self-hosted', 'cloud'])

function invalid(message: string, details: Record<string, unknown> | null = null): never {
  throw new KJValidationError(message, details)
}

function boundedText(value: unknown, label: string, maximum: number, { allowEmpty = false }: { allowEmpty?: boolean } = {}): string {
  const text = String(value ?? '').trim()
  if ((!allowEmpty && !text) || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) invalid(`Invalid ${label}`)
  return text
}

function providerIdentifier(value: unknown): string {
  const id = boundedText(value, 'DWG provider id', MAX_ID_LENGTH)
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(id)) invalid('Invalid DWG provider id')
  return id
}

function positiveLimit(value: unknown, label: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) invalid(`${label} must be a positive safe integer`)
  return number
}

function normalizeTarget(value: unknown): KJDwgConversionTarget {
  const target = String(value ?? '').trim().toUpperCase()
  if (!TARGETS.has(target as KJDwgConversionTarget)) invalid('DWG conversion target must be DXF or KJD')
  return target as KJDwgConversionTarget
}

function throwIfAborted(signal: AbortSignal | undefined, phase: string): void {
  if (signal?.aborted) invalid(`DWG ${phase} aborted`)
}

async function sourceBytes(source: unknown, maximum: number): Promise<Uint8Array> {
  let bytes: Uint8Array
  if (source instanceof Uint8Array) {
    if (source.byteLength > maximum) invalid(`DWG source exceeds the ${maximum} byte read limit`)
    bytes = new Uint8Array(source)
  } else if (source instanceof ArrayBuffer) {
    if (source.byteLength > maximum) invalid(`DWG source exceeds the ${maximum} byte read limit`)
    bytes = new Uint8Array(source.slice(0))
  }
  else if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (source.size > maximum) invalid(`DWG source exceeds the ${maximum} byte read limit`)
    bytes = new Uint8Array(await source.arrayBuffer())
  } else invalid('DWG source must be bytes or a Blob/File')
  if (bytes.byteLength > maximum) invalid(`DWG source exceeds the ${maximum} byte read limit`)
  return bytes
}

async function firstBytes(source: unknown, count: number): Promise<Uint8Array | null> {
  if (source instanceof Uint8Array) return source.subarray(0, count)
  if (source instanceof ArrayBuffer) return new Uint8Array(source, 0, Math.min(source.byteLength, count))
  if (typeof Blob !== 'undefined' && source instanceof Blob) return new Uint8Array(await source.slice(0, count).arrayBuffer())
  return null
}

function dwgVersion(bytes: Uint8Array): string {
  if (bytes.byteLength < 6) invalid('DWG source is missing its AC10xx header')
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 6))
  if (!/^AC10\d{2}$/.test(header)) invalid('DWG source is missing a valid AC10xx header')
  return header
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) invalid('SHA-256 is unavailable in this runtime')
  const input = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function report(options: KJDwgConversionReadOptions, progress: KJFileReadProgress): void {
  options.onProgress?.(deepFreeze({ ...progress }))
}

function normalizeConversionProgress(value: Readonly<KJDwgConversionProgress>): Readonly<KJDwgConversionProgress> {
  if (!value || !['validate', 'upload', 'convert', 'download'].includes(value.phase) || !['bytes', 'percent', 'steps'].includes(value.unit)) invalid('Invalid DWG conversion progress')
  const completed = Number(value.completed), total = value.total === undefined ? undefined : Number(value.total)
  if (!Number.isFinite(completed) || completed < 0 || (total !== undefined && (!Number.isFinite(total) || total < 0 || completed > total))) invalid('Invalid DWG conversion progress')
  if (value.unit === 'percent' && (completed > 100 || (total !== undefined && total > 100))) invalid('Invalid DWG conversion percentage')
  return deepFreeze({ phase: value.phase, completed, ...(total === undefined ? {} : { total }), unit: value.unit })
}

function diagnostics(value: readonly unknown[] | undefined, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_DIAGNOSTIC_ITEMS) invalid(`DWG ${label} exceed the bounded diagnostic limit`)
  return value.map(item => {
    if (typeof item !== 'string') invalid(`DWG ${label} items must be strings`)
    return boundedText(item, `DWG ${label} item`, MAX_DIAGNOSTIC_LENGTH, { allowEmpty: false })
  })
}

async function resultBytes(source: unknown, maximum: number): Promise<Uint8Array> {
  let bytes: Uint8Array
  if (typeof source === 'string') bytes = new TextEncoder().encode(source)
  else if (source instanceof Uint8Array) {
    if (source.byteLength > maximum) invalid(`DWG conversion result exceeds the ${maximum} byte read limit`)
    bytes = new Uint8Array(source)
  } else if (source instanceof ArrayBuffer) {
    if (source.byteLength > maximum) invalid(`DWG conversion result exceeds the ${maximum} byte read limit`)
    bytes = new Uint8Array(source.slice(0))
  }
  else if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (source.size > maximum) invalid(`DWG conversion result exceeds the ${maximum} byte read limit`)
    bytes = new Uint8Array(await source.arrayBuffer())
  } else invalid('DWG converter returned unsupported result data')
  if (!bytes.byteLength) invalid('DWG converter returned an empty result')
  if (bytes.byteLength > maximum) invalid(`DWG conversion result exceeds the ${maximum} byte read limit`)
  return bytes
}

function assertResultEnvelope(bytes: Uint8Array, target: KJDwgConversionTarget): void {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '')
  const prefix = text.slice(0, 4096)
  if (/^\s*<(?:!doctype\s+html|html|head|body)(?:\s|>)/i.test(prefix)) invalid('DWG converter returned HTML instead of a drawing')
  if (target === 'KJD') {
    if (!/^\s*\{/.test(prefix)) invalid('DWG converter mislabeled a non-KJD result')
    return
  }
  const normalized = text.replaceAll('\r', '')
  if (!/^\s*0\s*\n\s*SECTION(?:\s|$)/i.test(normalized)) invalid('DWG converter mislabeled a non-DXF result')
  const lines = normalized.split('\n')
  while (lines.length && !lines.at(-1)?.trim()) lines.pop()
  if (lines.length % 2 !== 0) invalid('DWG converter returned malformed DXF tag pairs')
  let sections = 0, sectionCount = 0, eof = false
  for (let index = 0; index < lines.length; index += 2) {
    const code = lines[index]!, value = lines[index + 1]!
    if (!/^\s*[+-]?\d+\s*$/.test(code)) invalid('DWG converter returned malformed DXF group codes')
    if (Number(code) !== 0) continue
    const marker = value.trim().toUpperCase()
    if (marker === 'SECTION') { sections += 1; sectionCount += 1 }
    else if (marker === 'ENDSEC') { sections -= 1; if (sections < 0) invalid('DWG converter returned malformed DXF section structure') }
    else if (marker === 'EOF') { if (sections !== 0 || index + 2 !== lines.length) invalid('DWG converter returned malformed DXF section structure'); eof = true }
  }
  if (!sectionCount || sections !== 0 || !eof) invalid('DWG converter returned malformed DXF section structure')
}

function attachProvenance(document: KJDocument, provenance: KJDwgConversionProvenance): KJDocument {
  const state = document.toJSON()
  state.metadata.custom = { ...state.metadata.custom, kjdrawImport: clone(provenance) }
  return KJDocument.open(state)
}

/** Returns the bounded import record persisted in KJD metadata, when present. */
export function getDwgConversionProvenance(document: KJDocument): ReadonlyDeep<KJDwgConversionProvenance> | null {
  if (!(document instanceof KJDocument)) invalid('Expected a KJDocument')
  const value = document.metadata.custom.kjdrawImport
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<KJDwgConversionProvenance>
  if (record.schema !== 'kjdraw.dwg-import' || record.schemaVersion !== 1) return null
  if (!record.provider || typeof record.provider !== 'object' || !LOCALITIES.has(record.provider.locality)) return null
  if (!/^[0-9a-f]{64}$/.test(String(record.sourceSha256)) || !/^[0-9a-f]{64}$/.test(String(record.targetSha256))) return null
  try {
    return deepFreeze({
      schema: 'kjdraw.dwg-import', schemaVersion: 1,
      provider: {
        id: providerIdentifier(record.provider.id),
        version: record.provider.version == null ? null : boundedText(record.provider.version, 'DWG provider version', MAX_ID_LENGTH),
        locality: record.provider.locality,
      },
      sourceSha256: String(record.sourceSha256),
      sourceName: boundedText(record.sourceName, 'DWG source name', MAX_NAME_LENGTH),
      sourceBytes: positiveLimit(record.sourceBytes, 'DWG source bytes'),
      sourceVersion: /^AC10\d{2}$/.test(String(record.sourceVersion)) ? String(record.sourceVersion) : invalid('Invalid DWG source version'),
      target: normalizeTarget(record.target),
      targetSha256: String(record.targetSha256),
      targetBytes: positiveLimit(record.targetBytes, 'DWG target bytes'),
      warnings: diagnostics(record.warnings, 'warnings'),
      approximations: diagnostics(record.approximations, 'approximations'),
    })
  } catch { return null }
}

/**
 * Creates a read-only DWG boundary. KJDraw never embeds a converter, endpoint,
 * credential, or source DWG in the document; the host owns that policy.
 */
export function createDwgConversionFileAdapter(options: KJDwgConversionAdapterOptions): Readonly<KJFileAdapter<KJDocument, never>> {
  if (!options || !options.provider || typeof options.provider !== 'object') invalid('DWG conversion provider is required')
  const sourceProvider = options.provider
  const providerId = providerIdentifier(sourceProvider.id)
  const providerVersion = sourceProvider.version == null ? null : boundedText(sourceProvider.version, 'DWG provider version', MAX_ID_LENGTH)
  if (!LOCALITIES.has(sourceProvider.locality)) invalid('Invalid DWG provider locality')
  const locality = sourceProvider.locality
  if (!Array.isArray(sourceProvider.outputFormats) || !sourceProvider.outputFormats.length) invalid('DWG provider must declare outputFormats')
  const outputFormats = [...new Set(sourceProvider.outputFormats.map(normalizeTarget))]
  const providerLimits = {
    maxSourceBytes: positiveLimit(sourceProvider.limits?.maxSourceBytes, 'DWG provider maxSourceBytes'),
    maxResultBytes: positiveLimit(sourceProvider.limits?.maxResultBytes, 'DWG provider maxResultBytes'),
  }
  if (typeof sourceProvider.convert !== 'function') invalid('DWG provider must implement convert')
  const convert = sourceProvider.convert.bind(sourceProvider)
  const dxf = createDXFFileAdapter(), kjd = createKJDFileAdapter()

  return defineFileAdapter<KJDocument, never>({
    id: options.id ?? `kanjie.dwg-conversion.${providerId}`,
    vendor: providerId,
    priority: Number(options.priority ?? 900),
    formats: { DWG: { read: ['*'], notes: ['Host-provided DWG conversion to validated editable DXF or KJD; fidelity depends on the selected provider'] } },
    capabilities: { conversion: true, nativeDwg: false, lossless: false, locality, outputFormats },
    preservation: { source: 'external-asset', diagnostics: 'document-metadata', fidelity: 'provider-reported-and-validated-subset' },
    sniff: async source => {
      try {
        const prefix = await firstBytes(source, 6)
        return Boolean(prefix && /^AC10\d{2}$/.test(new TextDecoder('ascii').decode(prefix)))
      } catch { return false }
    },
    read: async (source, rawOptions = {}) => {
      const readOptions = rawOptions as KJDwgConversionReadOptions
      throwIfAborted(readOptions.signal, 'read')
      const target = normalizeTarget(readOptions.targetFormat ?? outputFormats[0])
      if (!outputFormats.includes(target)) invalid(`DWG provider ${providerId} does not support ${target}`)
      const effectiveLimits = {
        maxSourceBytes: Math.min(providerLimits.maxSourceBytes, positiveLimit(readOptions.limits?.maxSourceBytes ?? KJ_DWG_CONVERSION_DEFAULT_LIMITS.maxSourceBytes, 'DWG maxSourceBytes')),
        maxResultBytes: Math.min(providerLimits.maxResultBytes, positiveLimit(readOptions.limits?.maxResultBytes ?? KJ_DWG_CONVERSION_DEFAULT_LIMITS.maxResultBytes, 'DWG maxResultBytes')),
      }
      const bytes = await sourceBytes(source, effectiveLimits.maxSourceBytes)
      throwIfAborted(readOptions.signal, 'read')
      const version = dwgVersion(bytes)
      const sourceDigest = await sha256(bytes)
      const candidateName = readOptions.fileName ?? (source && typeof source === 'object' && 'name' in source ? (source as { name?: unknown }).name : undefined) ?? 'drawing.dwg'
      const name = boundedText(candidateName, 'DWG source name', MAX_NAME_LENGTH)
      report(readOptions, { phase: 'source', completed: bytes.byteLength, total: bytes.byteLength, unit: 'bytes' })
      const conversionProgress = (value: Readonly<KJDwgConversionProgress>): void => {
        throwIfAborted(readOptions.signal, 'conversion')
        const normalized = normalizeConversionProgress(value)
        readOptions.onConversionProgress?.(normalized)
        readOptions.onProgress?.(normalized)
      }
      const result = await convert(Object.freeze({
        source: Object.freeze({ name, bytes, sha256: sourceDigest, dwgVersion: version }),
        target,
        ...(readOptions.signal ? { signal: readOptions.signal } : {}),
        onProgress: conversionProgress,
      }))
      throwIfAborted(readOptions.signal, 'conversion')
      if (!result || typeof result !== 'object' || Array.isArray(result)) invalid('DWG converter returned an invalid result')
      const actualTarget = normalizeTarget(result.format)
      if (actualTarget !== target) invalid(`DWG converter returned ${actualTarget} when ${target} was requested`)
      if (result.sourceSha256 !== undefined && String(result.sourceSha256).toLowerCase() !== sourceDigest) invalid('DWG converter response does not match the source SHA-256')
      const convertedBytes = await resultBytes(result.data, effectiveLimits.maxResultBytes)
      throwIfAborted(readOptions.signal, 'conversion')
      const targetDigest = await sha256(convertedBytes)
      throwIfAborted(readOptions.signal, 'conversion')
      if (result.sha256 !== undefined && String(result.sha256).toLowerCase() !== targetDigest) invalid('DWG converter result SHA-256 does not match its payload')
      assertResultEnvelope(convertedBytes, target)
      const warnings = diagnostics(result.warnings, 'warnings')
      const approximations = diagnostics(result.approximations, 'approximations')
      const nestedOptions = { ...readOptions, format: target, adapterId: null }
      const imported = target === 'DXF'
        ? await dxf.read?.(convertedBytes, nestedOptions)
        : await kjd.read?.(convertedBytes, nestedOptions)
      if (!(imported instanceof KJDocument)) invalid('DWG conversion result did not produce a KJDocument')
      const provenance: KJDwgConversionProvenance = {
        schema: 'kjdraw.dwg-import', schemaVersion: 1,
        provider: { id: providerId, version: result.providerVersion == null ? providerVersion : boundedText(result.providerVersion, 'DWG result provider version', MAX_ID_LENGTH), locality },
        sourceSha256: sourceDigest, sourceName: name, sourceBytes: bytes.byteLength, sourceVersion: version,
        target, targetSha256: targetDigest, targetBytes: convertedBytes.byteLength,
        warnings, approximations,
      }
      return attachProvenance(imported, provenance)
    },
  })
}
