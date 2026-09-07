import { KJValidationError } from './errors.js'
import { KJDocument } from './document.js'
import { canonicalStringify } from './utils.js'

export const KJP_MEDIA_TYPE = 'application/vnd.kanjie.kjdraw-project+zip'
export const KJP_SCHEMA = 'com.kanjie.kjdraw.project@1'
export const KJP_PACKAGE_VERSION = 1

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const ZIP_SIGNATURE = Object.freeze({ local: 0x04034b50, central: 0x02014b50, zip64End: 0x06064b50, zip64Locator: 0x07064b50, end: 0x06054b50 })

function bytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (typeof value === 'string') return textEncoder.encode(value)
  return textEncoder.encode(canonicalStringify(value))
}

function concat(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (!Number.isSafeInteger(length)) throw new KJValidationError('KJP 包超过当前运行时可安全寻址的大小')
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

function header(length) { const data = new Uint8Array(length); return { data, view: new DataView(data.buffer) } }
function u16(view, offset, value) { view.setUint16(offset, value, true) }
function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true) }
function u64(view, offset, value) { view.setBigUint64(offset, BigInt(value), true) }

function safeNumber(value, label) {
  value = BigInt(value)
  if (value < 0n || value > MAX_SAFE_BIGINT) throw new KJValidationError(`${label} 超过 JavaScript 安全寻址范围`)
  return Number(value)
}

function normalizePath(value) {
  const path = String(value ?? '').replaceAll('\\', '/')
  const segments = path.split('/')
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || segments.some(part => !part || part === '.' || part === '..') || path.includes('\0')) {
    throw new KJValidationError(`KJP 包含不安全路径：${path || '(empty)'}`)
  }
  return path
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

function crc32(data) {
  let value = 0xffffffff
  for (const byte of data) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff]
  return (value ^ 0xffffffff) >>> 0
}

function zip64Extra(values) {
  const { data, view } = header(4 + values.length * 8)
  u16(view, 0, 0x0001); u16(view, 2, values.length * 8)
  values.forEach((value, index) => u64(view, 4 + index * 8, value))
  return data
}

function normalizeZipEntries(input) {
  const source = input instanceof Map ? [...input] : Array.isArray(input) ? input.map(row => [row.path, row.data]) : Object.entries(input ?? {})
  const seen = new Set()
  return source.map(([entryPath, value]) => {
    const path = normalizePath(entryPath)
    if (seen.has(path)) throw new KJValidationError(`KJP 包含重复条目：${path}`)
    seen.add(path)
    const data = bytes(value)
    return { path, name: textEncoder.encode(path), data, crc: crc32(data) }
  }).sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

/** Always emits ZIP64 records, even for small projects, so package semantics do not change at 4 GiB. */
export function encodeZip64(input) {
  const entries = normalizeZipEntries(input)
  const chunks = [], central = []
  let offset = 0n
  for (const entry of entries) {
    const size = BigInt(entry.data.length), localExtra = zip64Extra([size, size])
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
  const centralSize = offset - centralOffset, zip64EndOffset = offset
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

function signature(view, offset, expected, label) {
  if (offset < 0 || offset + 4 > view.byteLength || view.getUint32(offset, true) !== expected) throw new KJValidationError(`KJP ZIP64 ${label} 损坏`)
}

function findEnd(view) {
  const start = Math.max(0, view.byteLength - 65557)
  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) if (view.getUint32(offset, true) === ZIP_SIGNATURE.end) return offset
  throw new KJValidationError('KJP 缺少 ZIP 结束记录')
}

function readExtra(data, start, length, requiredValues) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = start, end = start + length
  while (offset + 4 <= end) {
    const id = view.getUint16(offset, true), size = view.getUint16(offset + 2, true); offset += 4
    if (offset + size > end) throw new KJValidationError('KJP ZIP64 扩展字段越界')
    if (id === 0x0001) {
      if (size < requiredValues * 8) throw new KJValidationError('KJP ZIP64 扩展字段不完整')
      return Array.from({ length: requiredValues }, (_, index) => view.getBigUint64(offset + index * 8, true))
    }
    offset += size
  }
  throw new KJValidationError('KJP 条目缺少 ZIP64 扩展字段')
}

export function decodeZip64(source, limits = {}) {
  const data = bytes(source), view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const maxEntries = Math.max(1, Number(limits.maxEntries ?? 100000)), maxBytes = Math.max(1, Number(limits.maxUncompressedBytes ?? 8 * 1024 ** 3))
  const endOffset = findEnd(view), locatorOffset = endOffset - 20
  signature(view, locatorOffset, ZIP_SIGNATURE.zip64Locator, '定位器')
  const zip64EndOffset = safeNumber(view.getBigUint64(locatorOffset + 8, true), 'ZIP64 结束记录偏移')
  signature(view, zip64EndOffset, ZIP_SIGNATURE.zip64End, '结束记录')
  const count = safeNumber(view.getBigUint64(zip64EndOffset + 32, true), 'KJP 条目数量')
  if (count > maxEntries) throw new KJValidationError(`KJP 条目数量超过限制：${count}`)
  let offset = safeNumber(view.getBigUint64(zip64EndOffset + 48, true), '中央目录偏移'), totalBytes = 0
  const entries = new Map()
  for (let index = 0; index < count; index += 1) {
    signature(view, offset, ZIP_SIGNATURE.central, '中央目录')
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), expectedCrc = view.getUint32(offset + 16, true)
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true)
    if (!(flags & 0x0800)) throw new KJValidationError('KJP 条目名称必须使用 UTF-8')
    if (method !== 0) throw new KJValidationError('KJP 当前仅接受 STORE 条目，拒绝未知压缩实现')
    const nameStart = offset + 46, extraStart = nameStart + nameLength
    if (extraStart + extraLength + commentLength > data.length) throw new KJValidationError('KJP 中央目录越界')
    const path = normalizePath(textDecoder.decode(data.subarray(nameStart, extraStart)))
    if (entries.has(path)) throw new KJValidationError(`KJP 包含重复条目：${path}`)
    const [uncompressedSize, compressedSize, localOffsetBig] = readExtra(data, extraStart, extraLength, 3)
    if (uncompressedSize !== compressedSize) throw new KJValidationError(`KJP STORE 条目大小不一致：${path}`)
    const size = safeNumber(uncompressedSize, `${path} 大小`), localOffset = safeNumber(localOffsetBig, `${path} 本地头偏移`)
    totalBytes += size
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) throw new KJValidationError('KJP 解包大小超过限制')
    signature(view, localOffset, ZIP_SIGNATURE.local, `${path} 本地头`)
    const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true)
    const contentStart = localOffset + 30 + localNameLength + localExtraLength, contentEnd = contentStart + size
    if (contentEnd > data.length) throw new KJValidationError(`KJP 条目数据越界：${path}`)
    const content = data.slice(contentStart, contentEnd)
    if (crc32(content) !== expectedCrc) throw new KJValidationError(`KJP 条目 CRC 校验失败：${path}`)
    entries.set(path, content)
    offset = extraStart + extraLength + commentLength
  }
  return entries
}

async function sha256Hex(value) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new KJValidationError('当前运行时缺少 SHA-256，不能创建权威 KJP 工程包')
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes(value)))
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('')
}

function normalizedDrawings(input) {
  const rows = input instanceof Map ? [...input] : Array.isArray(input) ? input.map(row => [row.id, row.document ?? row.data ?? row]) : Object.entries(input ?? {})
  if (!rows.length) throw new KJValidationError('KJP 至少需要一张 KJD 图纸')
  const seen = new Set()
  return rows.map(([rawId, source]) => {
    const id = String(rawId || source?.id || source?.documentId || '').trim()
    if (!id || !/^[A-Za-z0-9._:-]+$/.test(id) || seen.has(id)) throw new KJValidationError(`KJP 图纸标识无效或重复：${id || '(empty)'}`)
    seen.add(id)
    const document = source instanceof KJDocument ? source : KJDocument.open(source)
    return { id, document, path: `drawings/${id}.kjd`, data: bytes(document.serialize()) }
  }).sort((left, right) => left.id.localeCompare(right.id, 'en'))
}

function appendOptionalEntries(entries, family, input) {
  for (const [rawPath, value] of input instanceof Map ? input : Object.entries(input ?? {})) entries.set(`${family}/${normalizePath(rawPath)}`, bytes(value))
}

export async function createKjpPackage(options = {}) {
  const drawings = normalizedDrawings(options.drawings)
  const activeDrawing = String(options.activeDrawing ?? drawings[0].id)
  if (!drawings.some(row => row.id === activeDrawing)) throw new KJValidationError(`KJP 活动图纸不存在：${activeDrawing}`)
  const entries = new Map(drawings.map(row => [row.path, row.data]))
  const commandRows = options.commands ?? []
  entries.set('history/commands.ndjson', bytes(commandRows.map(row => canonicalStringify(row)).join('\n') + (commandRows.length ? '\n' : '')))
  appendOptionalEntries(entries, 'assets', options.assets)
  appendOptionalEntries(entries, 'snapshots', options.snapshots)
  appendOptionalEntries(entries, 'recovery', options.recovery)
  appendOptionalEntries(entries, 'diagnostics', options.diagnostics)
  const contentHashes = {}
  for (const [path, data] of entries) contentHashes[path] = await sha256Hex(data)
  const at = String(options.modifiedAt ?? options.createdAt ?? new Date().toISOString())
  const manifest = {
    schema: KJP_SCHEMA,
    packageVersion: KJP_PACKAGE_VERSION,
    mediaType: KJP_MEDIA_TYPE,
    projectId: String(options.projectId ?? options.id ?? '').trim(),
    title: String(options.title ?? 'Untitled'),
    activeDrawing,
    drawings: drawings.map(row => ({ id: row.id, path: row.path, revision: row.document.revision, sha256: contentHashes[row.path] })),
    contentHashes,
    application: { name: 'KJDraw', minReaderVersion: '1.0.0', writerVersion: String(options.writerVersion ?? '1.0.0') },
    createdAt: String(options.createdAt ?? at),
    modifiedAt: at,
    migrations: [...(options.migrations ?? [])],
    metadata: options.metadata ?? {},
  }
  if (!manifest.projectId) throw new KJValidationError('KJP projectId 不能为空')
  entries.set('manifest.json', bytes(canonicalStringify(manifest)))
  return encodeZip64(entries)
}

function jsonEntry(entries, path) {
  const value = entries.get(path)
  if (!value) throw new KJValidationError(`KJP 缺少必需条目：${path}`)
  try { return JSON.parse(textDecoder.decode(value)) } catch (error) { throw new KJValidationError(`KJP ${path} 不是有效 UTF-8 JSON`, { path }, error) }
}

export async function openKjpPackage(source, options = {}) {
  const entries = decodeZip64(source, options.limits)
  const manifest = jsonEntry(entries, 'manifest.json')
  if (manifest.schema !== KJP_SCHEMA || manifest.packageVersion !== KJP_PACKAGE_VERSION || manifest.mediaType !== KJP_MEDIA_TYPE) {
    throw new KJValidationError(`不支持的 KJP 契约：${manifest.schema ?? 'unknown'} / ${manifest.packageVersion ?? 'unknown'}`)
  }
  if (!manifest.projectId || !Array.isArray(manifest.drawings) || !manifest.drawings.length) throw new KJValidationError('KJP manifest 缺少工程或图纸信息')
  if (!entries.has('history/commands.ndjson')) throw new KJValidationError('KJP 缺少必需条目：history/commands.ndjson')
  for (const [path, expected] of Object.entries(manifest.contentHashes ?? {})) {
    const value = entries.get(normalizePath(path))
    if (!value) throw new KJValidationError(`KJP manifest 引用了缺失条目：${path}`)
    if (await sha256Hex(value) !== String(expected).toLowerCase()) throw new KJValidationError(`KJP 内容哈希校验失败：${path}`)
  }
  const drawings = new Map()
  for (const row of manifest.drawings) {
    const path = normalizePath(row.path)
    if (!path.startsWith('drawings/') || !path.endsWith('.kjd')) throw new KJValidationError(`KJP 图纸路径无效：${path}`)
    const raw = entries.get(path)
    if (!raw) throw new KJValidationError(`KJP 图纸条目缺失：${path}`)
    let value
    try { value = JSON.parse(textDecoder.decode(raw)) } catch (error) { throw new KJValidationError(`KJP 图纸不是有效 KJD：${path}`, { path }, error) }
    const document = KJDocument.open(value)
    if (document.id !== row.id) throw new KJValidationError(`KJP 图纸 id 与 manifest 不一致：${row.id}`)
    drawings.set(row.id, document)
  }
  if (!drawings.has(manifest.activeDrawing)) throw new KJValidationError(`KJP 活动图纸不存在：${manifest.activeDrawing}`)
  const historyText = textDecoder.decode(entries.get('history/commands.ndjson'))
  const commands = historyText.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) } catch (error) { throw new KJValidationError(`KJP 命令日志第 ${index + 1} 行损坏`, { line: index + 1 }, error) }
  })
  return { manifest, drawings, activeDocument: drawings.get(manifest.activeDrawing), commands, entries }
}
