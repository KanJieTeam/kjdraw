import { KJValidationError } from './errors.js'
import { KJDocument } from './document.js'
import { canonicalStringify } from './utils.js'
import { KJDRAW_VERSION } from './version.js'

export const KJP_MEDIA_TYPE = 'application/vnd.kanjie.kjdraw-project+zip'
export const KJP_SCHEMA = 'com.kanjie.kjdraw.project@1'
export const KJP_PACKAGE_VERSION = 1

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const ZIP_SIGNATURE = Object.freeze({ local: 0x04034b50, central: 0x02014b50, zip64End: 0x06064b50, zip64Locator: 0x07064b50, end: 0x06054b50 })

export type KjpSource = string | Uint8Array | ArrayBuffer | ArrayBufferView
export type KjpEntryValue = string | Uint8Array | ArrayBuffer | ArrayBufferView | Record<string, unknown> | readonly unknown[] | null

export interface KjpEntryRow { path: string; data: KjpEntryValue }
export type KjpEntryInput = ReadonlyMap<string, KjpEntryValue> | readonly KjpEntryRow[] | Readonly<Record<string, KjpEntryValue>>

export interface KjpReadLimits {
  maxEntries: number
  maxUncompressedBytes: number
  maxEntryBytes: number
  maxArchiveBytes: number
}

export interface KjpOpenOptions {
  limits?: Partial<KjpReadLimits>
  signal?: AbortSignal
}

export const KJP_DEFAULT_READ_LIMITS: Readonly<KjpReadLimits> = Object.freeze({
  maxEntries: 10_000,
  maxUncompressedBytes: 512 * 1024 ** 2,
  maxEntryBytes: 256 * 1024 ** 2,
  maxArchiveBytes: 512 * 1024 ** 2,
})

export interface KjpManifestDrawing {
  id: string
  path: string
  revision: number
  sha256: string
}

export interface KjpManifest {
  schema: typeof KJP_SCHEMA
  packageVersion: typeof KJP_PACKAGE_VERSION
  mediaType: typeof KJP_MEDIA_TYPE
  projectId: string
  title: string
  activeDrawing: string
  drawings: KjpManifestDrawing[]
  contentHashes: Record<string, string>
  application: { name: 'KJDraw'; minReaderVersion: string; writerVersion: string }
  createdAt: string
  modifiedAt: string
  migrations: unknown[]
  metadata: Record<string, unknown>
}

export type KjpDrawingSource = KJDocument | Parameters<typeof KJDocument.open>[0]
export interface KjpDrawingRow { id?: string; document?: KjpDrawingSource; data?: KjpDrawingSource }
export type KjpDrawingInput = ReadonlyMap<string, KjpDrawingSource> | readonly KjpDrawingRow[] | Readonly<Record<string, KjpDrawingSource>>

export interface KjpCreateOptions {
  drawings?: KjpDrawingInput
  activeDrawing?: string
  commands?: readonly unknown[]
  assets?: ReadonlyMap<string, KjpEntryValue> | Readonly<Record<string, KjpEntryValue>>
  snapshots?: ReadonlyMap<string, KjpEntryValue> | Readonly<Record<string, KjpEntryValue>>
  recovery?: ReadonlyMap<string, KjpEntryValue> | Readonly<Record<string, KjpEntryValue>>
  diagnostics?: ReadonlyMap<string, KjpEntryValue> | Readonly<Record<string, KjpEntryValue>>
  projectId?: string
  id?: string
  title?: string
  createdAt?: string
  modifiedAt?: string
  migrations?: readonly unknown[]
  metadata?: Record<string, unknown>
  writerVersion?: string
}

export interface KjpOpenResult {
  manifest: KjpManifest
  drawings: Map<string, KJDocument>
  activeDocument: KJDocument
  commands: unknown[]
  entries: Map<string, Uint8Array>
}

interface NormalizedZipEntry {
  path: string
  name: Uint8Array
  data: Uint8Array
  crc: number
}

interface CentralZipEntry extends NormalizedZipEntry {
  offset: bigint
  size: bigint
}

interface NormalizedDrawing {
  id: string
  document: KJDocument
  path: string
  data: Uint8Array
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function objectEntries(value: unknown): [string, unknown][] {
  return isRecord(value) ? Object.entries(value) : []
}

function bytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (typeof value === 'string') return textEncoder.encode(value)
  return textEncoder.encode(canonicalStringify(value) ?? '')
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (!Number.isSafeInteger(length)) throw new KJValidationError('KJP 包超过当前运行时可安全寻址的大小')
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

function header(length: number): { data: Uint8Array; view: DataView } {
  const data = new Uint8Array(length)
  return { data, view: new DataView(data.buffer) }
}

function u16(view: DataView, offset: number, value: number): void { view.setUint16(offset, value, true) }
function u32(view: DataView, offset: number, value: number): void { view.setUint32(offset, value >>> 0, true) }
function u64(view: DataView, offset: number, value: number | bigint): void { view.setBigUint64(offset, BigInt(value), true) }

function safeNumber(value: number | bigint, label: string): number {
  const integer = BigInt(value)
  if (integer < 0n || integer > MAX_SAFE_BIGINT) throw new KJValidationError(`${label} 超过 JavaScript 安全寻址范围`)
  return Number(integer)
}

function normalizePath(value: unknown): string {
  const path = String(value ?? '').replaceAll('\\', '/')
  const segments = path.split('/')
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || segments.some(part => !part || part === '.' || part === '..') || path.includes('\0')) {
    throw new KJValidationError(`KJP 包含不安全路径：${path || '(empty)'}`)
  }
  return path
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new KJValidationError('KJP read aborted')
}

function normalizeReadLimits(overrides: Partial<KjpReadLimits> = {}): KjpReadLimits {
  const limits = { ...KJP_DEFAULT_READ_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 1) throw new KJValidationError(`KJP ${name} 必须是有限正数`)
    limits[name as keyof KjpReadLimits] = Math.floor(value)
  }
  return limits
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of data) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff]!
  return (value ^ 0xffffffff) >>> 0
}

function zip64Extra(values: readonly (number | bigint)[]): Uint8Array {
  const { data, view } = header(4 + values.length * 8)
  u16(view, 0, 0x0001)
  u16(view, 2, values.length * 8)
  values.forEach((value, index) => u64(view, 4 + index * 8, value))
  return data
}

function normalizeZipEntries(input: KjpEntryInput): NormalizedZipEntry[] {
  let source: [string, KjpEntryValue][]
  if (input instanceof Map) source = [...input]
  else if (Array.isArray(input)) source = input.map(row => [row.path, row.data])
  else source = Object.entries(input ?? {})
  const seen = new Set<string>()
  return source.map(([entryPath, value]) => {
    const path = normalizePath(entryPath)
    if (seen.has(path)) throw new KJValidationError(`KJP 包含重复条目：${path}`)
    seen.add(path)
    const data = bytes(value)
    return { path, name: textEncoder.encode(path), data, crc: crc32(data) }
  }).sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

/** Always emits ZIP64 records, even for small projects, so package semantics do not change at 4 GiB. */
export function encodeZip64(input: KjpEntryInput): Uint8Array {
  const entries = normalizeZipEntries(input)
  const chunks: Uint8Array[] = []
  const central: CentralZipEntry[] = []
  let offset = 0n
  for (const entry of entries) {
    const size = BigInt(entry.data.length)
    const localExtra = zip64Extra([size, size])
    const { data: local, view } = header(30)
    u32(view, 0, ZIP_SIGNATURE.local); u16(view, 4, 45); u16(view, 6, 0x0800); u16(view, 8, 0)
    u16(view, 10, 0); u16(view, 12, 0); u32(view, 14, entry.crc); u32(view, 18, 0xffffffff); u32(view, 22, 0xffffffff)
    u16(view, 26, entry.name.length); u16(view, 28, localExtra.length)
    chunks.push(local, entry.name, localExtra, entry.data)
    central.push({ ...entry, offset, size })
    offset += BigInt(local.length + entry.name.length + localExtra.length + entry.data.length)
  }

  const centralOffset = offset
  for (const entry of central) {
    const extra = zip64Extra([entry.size, entry.size, entry.offset])
    const { data, view } = header(46)
    u32(view, 0, ZIP_SIGNATURE.central); u16(view, 4, 45); u16(view, 6, 45); u16(view, 8, 0x0800); u16(view, 10, 0)
    u16(view, 12, 0); u16(view, 14, 0); u32(view, 16, entry.crc); u32(view, 20, 0xffffffff); u32(view, 24, 0xffffffff)
    u16(view, 28, entry.name.length); u16(view, 30, extra.length); u16(view, 32, 0); u16(view, 34, 0); u16(view, 36, 0)
    u32(view, 38, 0); u32(view, 42, 0xffffffff)
    chunks.push(data, entry.name, extra)
    offset += BigInt(data.length + entry.name.length + extra.length)
  }
  const centralSize = offset - centralOffset
  const zip64EndOffset = offset
  const { data: zip64End, view: z64 } = header(56)
  u32(z64, 0, ZIP_SIGNATURE.zip64End); u64(z64, 4, 44); u16(z64, 12, 45); u16(z64, 14, 45); u32(z64, 16, 0); u32(z64, 20, 0)
  u64(z64, 24, entries.length); u64(z64, 32, entries.length); u64(z64, 40, centralSize); u64(z64, 48, centralOffset)
  const { data: locator, view: loc } = header(20)
  u32(loc, 0, ZIP_SIGNATURE.zip64Locator); u32(loc, 4, 0); u64(loc, 8, zip64EndOffset); u32(loc, 16, 1)
  const { data: end, view: eocd } = header(22)
  u32(eocd, 0, ZIP_SIGNATURE.end); u16(eocd, 4, 0xffff); u16(eocd, 6, 0xffff); u16(eocd, 8, 0xffff); u16(eocd, 10, 0xffff)
  u32(eocd, 12, 0xffffffff); u32(eocd, 16, 0xffffffff); u16(eocd, 20, 0)
  chunks.push(zip64End, locator, end)
  return concat(chunks)
}

function assertRange(view: DataView, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > view.byteLength) {
    throw new KJValidationError(`KJP ZIP64 ${label} 越界`)
  }
}

function signature(view: DataView, offset: number, expected: number, label: string): void {
  assertRange(view, offset, 4, label)
  if (view.getUint32(offset, true) !== expected) throw new KJValidationError(`KJP ZIP64 ${label} 损坏`)
}

function findEnd(view: DataView): number {
  const start = Math.max(0, view.byteLength - 65557)
  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_SIGNATURE.end) return offset
  }
  throw new KJValidationError('KJP 缺少 ZIP 结束记录')
}

function readExtra(data: Uint8Array, start: number, length: number, requiredValues: number): bigint[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  assertRange(view, start, length, '扩展字段')
  let offset = start
  const end = start + length
  while (offset + 4 <= end) {
    const id = view.getUint16(offset, true)
    const size = view.getUint16(offset + 2, true)
    offset += 4
    if (offset + size > end) throw new KJValidationError('KJP ZIP64 扩展字段越界')
    if (id === 0x0001) {
      if (size < requiredValues * 8) throw new KJValidationError('KJP ZIP64 扩展字段不完整')
      return Array.from({ length: requiredValues }, (_, index) => view.getBigUint64(offset + index * 8, true))
    }
    offset += size
  }
  throw new KJValidationError('KJP 条目缺少 ZIP64 扩展字段')
}

export function decodeZip64(source: KjpSource, inputLimits: Partial<KjpReadLimits> = {}, signal?: AbortSignal): Map<string, Uint8Array> {
  throwIfAborted(signal)
  const data = bytes(source)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const limits = normalizeReadLimits(inputLimits)
  if (data.byteLength > limits.maxArchiveBytes) throw new KJValidationError('KJP archive exceeds the configured read limit')
  const endOffset = findEnd(view)
  const locatorOffset = endOffset - 20
  signature(view, locatorOffset, ZIP_SIGNATURE.zip64Locator, '定位器')
  assertRange(view, locatorOffset, 20, '定位器')
  const zip64EndOffset = safeNumber(view.getBigUint64(locatorOffset + 8, true), 'ZIP64 结束记录偏移')
  signature(view, zip64EndOffset, ZIP_SIGNATURE.zip64End, '结束记录')
  assertRange(view, zip64EndOffset, 56, '结束记录')
  const count = safeNumber(view.getBigUint64(zip64EndOffset + 32, true), 'KJP 条目数量')
  if (count > limits.maxEntries) throw new KJValidationError(`KJP 条目数量超过限制：${count}`)
  let offset = safeNumber(view.getBigUint64(zip64EndOffset + 48, true), '中央目录偏移')
  let totalBytes = 0
  const entries = new Map<string, Uint8Array>()
  for (let index = 0; index < count; index += 1) {
    throwIfAborted(signal)
    signature(view, offset, ZIP_SIGNATURE.central, '中央目录')
    assertRange(view, offset, 46, '中央目录')
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const expectedCrc = view.getUint32(offset + 16, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    if (!(flags & 0x0800)) throw new KJValidationError('KJP 条目名称必须使用 UTF-8')
    if (method !== 0) throw new KJValidationError('KJP 当前仅接受 STORE 条目，拒绝未知压缩实现')
    const nameStart = offset + 46
    const extraStart = nameStart + nameLength
    if (extraStart + extraLength + commentLength > data.length) throw new KJValidationError('KJP 中央目录越界')
    const path = normalizePath(textDecoder.decode(data.subarray(nameStart, extraStart)))
    if (entries.has(path)) throw new KJValidationError(`KJP 包含重复条目：${path}`)
    const extra = readExtra(data, extraStart, extraLength, 3)
    const uncompressedSize = extra[0]!
    const compressedSize = extra[1]!
    const localOffsetBig = extra[2]!
    if (uncompressedSize !== compressedSize) throw new KJValidationError(`KJP STORE 条目大小不一致：${path}`)
    const size = safeNumber(uncompressedSize, `${path} 大小`)
    const localOffset = safeNumber(localOffsetBig, `${path} 本地头偏移`)
    if (size > limits.maxEntryBytes) throw new KJValidationError(`KJP 条目超过单文件限制：${path}`)
    totalBytes += size
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxUncompressedBytes) throw new KJValidationError('KJP 解包大小超过限制')
    signature(view, localOffset, ZIP_SIGNATURE.local, `${path} 本地头`)
    assertRange(view, localOffset, 30, `${path} 本地头`)
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const contentStart = localOffset + 30 + localNameLength + localExtraLength
    const contentEnd = contentStart + size
    if (contentEnd > data.length) throw new KJValidationError(`KJP 条目数据越界：${path}`)
    const content = data.slice(contentStart, contentEnd)
    if (crc32(content) !== expectedCrc) throw new KJValidationError(`KJP 条目 CRC 校验失败：${path}`)
    entries.set(path, content)
    offset = extraStart + extraLength + commentLength
  }
  return entries
}

async function sha256Hex(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new KJValidationError('当前运行时缺少 SHA-256，不能创建权威 KJP 工程包')
  const input = Uint8Array.from(bytes(value))
  const digest = new Uint8Array(await subtle.digest('SHA-256', input.buffer))
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('')
}

function drawingSourceId(source: KjpDrawingSource | undefined): unknown {
  if (source instanceof KJDocument) return source.id
  return isRecord(source) ? source.id ?? source.documentId : undefined
}

function normalizedDrawings(input: KjpDrawingInput | undefined): NormalizedDrawing[] {
  let rows: [string | undefined, KjpDrawingSource | undefined][]
  if (input instanceof Map) rows = [...input]
  else if (Array.isArray(input)) rows = input.map(row => [row.id, row.document ?? row.data ?? row as unknown as KjpDrawingSource])
  else rows = Object.entries(input ?? {})
  if (!rows.length) throw new KJValidationError('KJP 至少需要一张 KJD 图纸')
  const seen = new Set<string>()
  return rows.map(([rawId, source]) => {
    const id = String(rawId || drawingSourceId(source) || '').trim()
    if (!id || !/^[A-Za-z0-9._:-]+$/.test(id) || seen.has(id)) throw new KJValidationError(`KJP 图纸标识无效或重复：${id || '(empty)'}`)
    if (!source) throw new KJValidationError(`KJP 图纸缺少文档：${id}`)
    seen.add(id)
    const document = source instanceof KJDocument ? source : KJDocument.open(source)
    return { id, document, path: `drawings/${id}.kjd`, data: bytes(document.serialize()) }
  }).sort((left, right) => left.id.localeCompare(right.id, 'en'))
}

function appendOptionalEntries(
  entries: Map<string, KjpEntryValue>,
  family: string,
  input: ReadonlyMap<string, KjpEntryValue> | Readonly<Record<string, KjpEntryValue>> | undefined,
): void {
  const rows = input instanceof Map ? input : Object.entries(input ?? {})
  for (const [rawPath, value] of rows) entries.set(`${family}/${normalizePath(rawPath)}`, bytes(value))
}

export async function createKjpPackage(options: KjpCreateOptions = {}): Promise<Uint8Array> {
  const drawings = normalizedDrawings(options.drawings)
  const firstDrawing = drawings[0]!
  const activeDrawing = String(options.activeDrawing ?? firstDrawing.id)
  if (!drawings.some(row => row.id === activeDrawing)) throw new KJValidationError(`KJP 活动图纸不存在：${activeDrawing}`)
  const entries = new Map<string, KjpEntryValue>(drawings.map(row => [row.path, row.data]))
  const commandRows = options.commands ?? []
  entries.set('history/commands.ndjson', bytes(commandRows.map(row => canonicalStringify(row)).join('\n') + (commandRows.length ? '\n' : '')))
  appendOptionalEntries(entries, 'assets', options.assets)
  appendOptionalEntries(entries, 'snapshots', options.snapshots)
  appendOptionalEntries(entries, 'recovery', options.recovery)
  appendOptionalEntries(entries, 'diagnostics', options.diagnostics)
  const contentHashes: Record<string, string> = {}
  for (const [path, data] of entries) contentHashes[path] = await sha256Hex(data)
  const at = String(options.modifiedAt ?? options.createdAt ?? new Date().toISOString())
  const manifest: KjpManifest = {
    schema: KJP_SCHEMA,
    packageVersion: KJP_PACKAGE_VERSION,
    mediaType: KJP_MEDIA_TYPE,
    projectId: String(options.projectId ?? options.id ?? '').trim(),
    title: String(options.title ?? 'Untitled'),
    activeDrawing,
    drawings: drawings.map(row => ({ id: row.id, path: row.path, revision: row.document.revision, sha256: contentHashes[row.path]! })),
    contentHashes,
    application: { name: 'KJDraw', minReaderVersion: KJDRAW_VERSION, writerVersion: String(options.writerVersion ?? KJDRAW_VERSION) },
    createdAt: String(options.createdAt ?? at),
    modifiedAt: at,
    migrations: [...(options.migrations ?? [])],
    metadata: options.metadata ?? {},
  }
  if (!manifest.projectId) throw new KJValidationError('KJP projectId 不能为空')
  entries.set('manifest.json', bytes(canonicalStringify(manifest)))
  return encodeZip64(entries)
}

function jsonEntry(entries: ReadonlyMap<string, Uint8Array>, path: string): unknown {
  const value = entries.get(path)
  if (!value) throw new KJValidationError(`KJP 缺少必需条目：${path}`)
  try { return JSON.parse(textDecoder.decode(value)) as unknown }
  catch (error) { throw new KJValidationError(`KJP ${path} 不是有效 UTF-8 JSON`, { path, cause: error }) }
}

function manifestFrom(value: unknown): KjpManifest {
  if (!isRecord(value)) throw new KJValidationError('KJP manifest 必须是对象')
  if (value.schema !== KJP_SCHEMA || value.packageVersion !== KJP_PACKAGE_VERSION || value.mediaType !== KJP_MEDIA_TYPE) {
    throw new KJValidationError(`不支持的 KJP 契约：${String(value.schema ?? 'unknown')} / ${String(value.packageVersion ?? 'unknown')}`)
  }
  if (!value.projectId || !Array.isArray(value.drawings) || !value.drawings.length) throw new KJValidationError('KJP manifest 缺少工程或图纸信息')
  const drawings = value.drawings.map((row, index): KjpManifestDrawing => {
    if (!isRecord(row)) throw new KJValidationError(`KJP manifest drawings[${index}] 无效`)
    return { id: String(row.id ?? ''), path: String(row.path ?? ''), revision: Number(row.revision ?? 0), sha256: String(row.sha256 ?? '') }
  })
  const application = isRecord(value.application) ? value.application : {}
  return {
    schema: KJP_SCHEMA,
    packageVersion: KJP_PACKAGE_VERSION,
    mediaType: KJP_MEDIA_TYPE,
    projectId: String(value.projectId),
    title: String(value.title ?? 'Untitled'),
    activeDrawing: String(value.activeDrawing ?? ''),
    drawings,
    contentHashes: Object.fromEntries(objectEntries(value.contentHashes).map(([path, hash]) => [path, String(hash)])),
    application: { name: 'KJDraw', minReaderVersion: String(application.minReaderVersion ?? ''), writerVersion: String(application.writerVersion ?? '') },
    createdAt: String(value.createdAt ?? ''),
    modifiedAt: String(value.modifiedAt ?? ''),
    migrations: Array.isArray(value.migrations) ? value.migrations : [],
    metadata: isRecord(value.metadata) ? value.metadata : {},
  }
}

export async function openKjpPackage(source: KjpSource, options: KjpOpenOptions = {}): Promise<KjpOpenResult> {
  throwIfAborted(options.signal)
  const entries = decodeZip64(source, options.limits, options.signal)
  const manifest = manifestFrom(jsonEntry(entries, 'manifest.json'))
  if (!entries.has('history/commands.ndjson')) throw new KJValidationError('KJP 缺少必需条目：history/commands.ndjson')
  for (const [path, expected] of Object.entries(manifest.contentHashes ?? {})) {
    throwIfAborted(options.signal)
    const value = entries.get(normalizePath(path))
    if (!value) throw new KJValidationError(`KJP manifest 引用了缺失条目：${path}`)
    if (await sha256Hex(value) !== String(expected).toLowerCase()) throw new KJValidationError(`KJP 内容哈希校验失败：${path}`)
  }
  const drawings = new Map<string, KJDocument>()
  for (const row of manifest.drawings) {
    throwIfAborted(options.signal)
    const path = normalizePath(row.path)
    if (!path.startsWith('drawings/') || !path.endsWith('.kjd')) throw new KJValidationError(`KJP 图纸路径无效：${path}`)
    const raw = entries.get(path)
    if (!raw) throw new KJValidationError(`KJP 图纸条目缺失：${path}`)
    let value: unknown
    try { value = JSON.parse(textDecoder.decode(raw)) as unknown }
    catch (error) { throw new KJValidationError(`KJP 图纸不是有效 KJD：${path}`, { path, cause: error }) }
    if (!isRecord(value)) throw new KJValidationError(`KJP 图纸不是有效 KJD：${path}`)
    const document = KJDocument.open(value)
    if (document.id !== row.id) throw new KJValidationError(`KJP 图纸 id 与 manifest 不一致：${row.id}`)
    drawings.set(row.id, document)
  }
  const activeDocument = drawings.get(manifest.activeDrawing)
  if (!activeDocument) throw new KJValidationError(`KJP 活动图纸不存在：${manifest.activeDrawing}`)
  const historyEntry = entries.get('history/commands.ndjson')!
  const historyText = textDecoder.decode(historyEntry)
  const commands = historyText.split(/\r?\n/).filter(Boolean).map((line, index): unknown => {
    try { return JSON.parse(line) as unknown }
    catch (error) { throw new KJValidationError(`KJP 命令日志第 ${index + 1} 行损坏`, { line: index + 1, cause: error }) }
  })
  return { manifest, drawings, activeDocument, commands, entries }
}
