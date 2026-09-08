import { KJValidationError } from '../errors.js'

const EXPECTED_ABI_MAGIC = 0x4b4a4301
const EXPECTED_MODEL_VERSION = 1
const MODEL_ERRORS: Readonly<Record<number, string>> = Object.freeze({
  101: 'KJD JSON/UTF-8 解析失败',
  102: 'KJD 对象图校验失败',
  103: '文档修订冲突',
  104: '对象标识重复',
  105: '文档会话或对象不存在',
  106: 'KJCore 文档操作无效',
})

type WasmNumberFunction = (...values: number[]) => number | bigint

export interface KJCoreDocumentExports {
  memory: WebAssembly.Memory
  kjcore_abi_magic: WasmNumberFunction
  kjcore_document_model_version: WasmNumberFunction
  kjcore_alloc_u8: WasmNumberFunction
  kjcore_free_u8: WasmNumberFunction
  kjcore_document_open_kjd: WasmNumberFunction
  kjcore_document_close: WasmNumberFunction
  kjcore_document_validate: WasmNumberFunction
  kjcore_document_revision: WasmNumberFunction
  kjcore_document_serialize_kjd: WasmNumberFunction
  kjcore_document_fingerprint: WasmNumberFunction
  kjcore_document_commit_kjd: WasmNumberFunction
  kjcore_byte_result_len: WasmNumberFunction
  kjcore_byte_result_value: WasmNumberFunction
  kjcore_last_error?: WasmNumberFunction
}

export type KJCoreDocumentModule = KJCoreDocumentExports | { exports: KJCoreDocumentExports }
export type KJCoreDocumentInput = string | Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function rawExports(source: unknown): Record<string, unknown> {
  if (!isRecord(source)) return {}
  const nested = source.exports
  return isRecord(nested) ? nested : source
}

function lastError(exports: KJCoreDocumentExports): number {
  return Number(exports.kjcore_last_error?.() ?? 0)
}

function failure(exports: KJCoreDocumentExports, operation: string, result: number): KJValidationError {
  const code = Math.abs(Number(result) || lastError(exports))
  return new KJValidationError(`KJCore ${operation} 失败：${MODEL_ERRORS[code] ?? `错误 ${code || 'unknown'}`}`, { code, operation })
}

function assertDocumentAbi(source: unknown): KJCoreDocumentExports {
  const candidate = rawExports(source)
  if (typeof candidate.kjcore_abi_magic !== 'function') throw new KJValidationError('KJCore WASM 导出缺失')
  const magic = Number(candidate.kjcore_abi_magic()) >>> 0
  if (magic !== EXPECTED_ABI_MAGIC) throw new KJValidationError(`KJCore WASM ABI 不兼容：0x${magic.toString(16)}`)
  if (typeof candidate.kjcore_document_model_version !== 'function') throw new KJValidationError('KJCore 文档模型版本不兼容：missing')
  const modelVersion = Number(candidate.kjcore_document_model_version())
  if (modelVersion !== EXPECTED_MODEL_VERSION) throw new KJValidationError(`KJCore 文档模型版本不兼容：${modelVersion || 'missing'}`)
  for (const name of [
    'kjcore_alloc_u8', 'kjcore_free_u8', 'kjcore_document_open_kjd', 'kjcore_document_close',
    'kjcore_document_validate', 'kjcore_document_revision', 'kjcore_document_serialize_kjd',
    'kjcore_document_fingerprint', 'kjcore_document_commit_kjd', 'kjcore_byte_result_len', 'kjcore_byte_result_value',
  ]) if (typeof candidate[name] !== 'function') throw new KJValidationError(`KJCore 文档 ABI 缺失 ${name}`)
  if (!(candidate.memory instanceof WebAssembly.Memory)) throw new KJValidationError('KJCore 文档 ABI 缺失共享内存')
  return candidate as unknown as KJCoreDocumentExports
}

function withUtf8<Result>(exports: KJCoreDocumentExports, source: KJCoreDocumentInput, callback: (pointer: number, length: number) => Result): Result {
  const bytes = new TextEncoder().encode(typeof source === 'string' ? source : JSON.stringify(source))
  const pointer = Number(exports.kjcore_alloc_u8(bytes.length))
  if (bytes.length && !pointer) throw new KJValidationError('KJCore 无法分配 KJD 输入缓冲区')
  try {
    new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes)
    return callback(pointer, bytes.length)
  } finally {
    exports.kjcore_free_u8(pointer, bytes.length)
  }
}

function readByteResult(exports: KJCoreDocumentExports, operation: string, result: number): string {
  if (!Number.isInteger(result) || result < 0) throw failure(exports, operation, result)
  const length = Number(exports.kjcore_byte_result_len())
  if (length !== result) throw new KJValidationError(`KJCore ${operation} 返回了不兼容的字节长度`)
  const bytes = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) {
    const value = Number(exports.kjcore_byte_result_value(index))
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new KJValidationError(`KJCore ${operation} 返回了无效字节`)
    bytes[index] = value
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export class KJCoreDocumentSession {
  #exports: KJCoreDocumentExports
  #handle: number

  constructor(exports: KJCoreDocumentExports, handle: number) {
    this.#exports = exports
    this.#handle = handle
  }

  get closed(): boolean { return this.#handle === 0 }

  get revision(): number {
    this.#assertOpen()
    const value = Number(this.#exports.kjcore_document_revision(this.#handle))
    if (!Number.isSafeInteger(value) || value < 0) throw failure(this.#exports, 'document_revision', lastError(this.#exports))
    return value
  }

  validate(): true {
    this.#assertOpen()
    const result = Number(this.#exports.kjcore_document_validate(this.#handle))
    if (result !== 1) throw failure(this.#exports, 'document_validate', result)
    return true
  }

  serialize(): string {
    this.#assertOpen()
    return readByteResult(this.#exports, 'document_serialize_kjd', Number(this.#exports.kjcore_document_serialize_kjd(this.#handle)))
  }

  fingerprint(): string {
    this.#assertOpen()
    return readByteResult(this.#exports, 'document_fingerprint', Number(this.#exports.kjcore_document_fingerprint(this.#handle)))
  }

  commit(source: KJCoreDocumentInput, expectedRevision: number = this.revision): string {
    this.#assertOpen()
    expectedRevision = Number(expectedRevision)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new KJValidationError('KJCore expectedRevision 必须是非负安全整数')
    const result = withUtf8(this.#exports, source, (pointer, length) => Number(
      this.#exports.kjcore_document_commit_kjd(this.#handle, pointer, length, expectedRevision),
    ))
    if (result !== 1) throw failure(this.#exports, 'document_commit_kjd', result)
    if (this.revision !== expectedRevision + 1) throw new KJValidationError('KJCore 提交后的修订号不连续')
    return this.serialize()
  }

  close(): boolean {
    if (this.closed) return false
    const handle = this.#handle
    this.#handle = 0
    const result = Number(this.#exports.kjcore_document_close(handle))
    if (result !== 1) throw failure(this.#exports, 'document_close', result)
    return true
  }

  #assertOpen(): void {
    if (this.closed) throw new KJValidationError('KJCore 文档会话已经关闭')
  }
}

export function openKJCoreDocumentSession(wasmModuleOrInstance: KJCoreDocumentModule | unknown, source: KJCoreDocumentInput): KJCoreDocumentSession {
  const exports = assertDocumentAbi(wasmModuleOrInstance)
  const handle = withUtf8(exports, source, (pointer, length) => Number(exports.kjcore_document_open_kjd(pointer, length)))
  if (!Number.isInteger(handle) || handle <= 0) throw failure(exports, 'document_open_kjd', handle)
  return new KJCoreDocumentSession(exports, handle)
}

export function canonicalizeKjdWithKJCore(wasmModuleOrInstance: KJCoreDocumentModule | unknown, source: KJCoreDocumentInput): string {
  const session = openKJCoreDocumentSession(wasmModuleOrInstance, source)
  try { return session.serialize() } finally { session.close() }
}

export interface KJCoreDocumentAuthority {
  readonly id: 'kanjie.kjcore.document-wasm'
  readonly authoritative: true
  readonly modelVersion: number
  open(source: KJCoreDocumentInput): KJCoreDocumentSession
}

export function createKJCoreDocumentAuthority(wasmModuleOrInstance: KJCoreDocumentModule | unknown): Readonly<KJCoreDocumentAuthority> {
  assertDocumentAbi(wasmModuleOrInstance)
  return Object.freeze({
    id: 'kanjie.kjcore.document-wasm',
    authoritative: true,
    modelVersion: EXPECTED_MODEL_VERSION,
    open: (source: KJCoreDocumentInput) => openKJCoreDocumentSession(wasmModuleOrInstance, source),
  })
}

export const KJCORE_DOCUMENT_MODEL_VERSION = EXPECTED_MODEL_VERSION
