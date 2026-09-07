import { KJValidationError } from '../errors.js'

const EXPECTED_ABI_MAGIC = 0x4b4a4301
const EXPECTED_MODEL_VERSION = 1
const MODEL_ERRORS = Object.freeze({
  101: 'KJD JSON/UTF-8 解析失败',
  102: 'KJD 对象图校验失败',
  103: '文档修订冲突',
  104: '对象标识重复',
  105: '文档会话或对象不存在',
  106: 'KJCore 文档操作无效',
})

function rawExports(source) { return source?.exports ?? source }

function failure(exports, operation, result) {
  const code = Math.abs(Number(result) || Number(exports.kjcore_last_error?.()) || 0)
  return new KJValidationError(`KJCore ${operation} 失败：${MODEL_ERRORS[code] ?? `错误 ${code || 'unknown'}`}`, { code, operation })
}

function assertDocumentAbi(source) {
  const exports = rawExports(source)
  if (!exports || typeof exports.kjcore_abi_magic !== 'function') throw new KJValidationError('KJCore WASM 导出缺失')
  const magic = Number(exports.kjcore_abi_magic()) >>> 0
  if (magic !== EXPECTED_ABI_MAGIC) throw new KJValidationError(`KJCore WASM ABI 不兼容：0x${magic.toString(16)}`)
  const modelVersion = Number(exports.kjcore_document_model_version?.())
  if (modelVersion !== EXPECTED_MODEL_VERSION) throw new KJValidationError(`KJCore 文档模型版本不兼容：${modelVersion || 'missing'}`)
  for (const name of [
    'kjcore_alloc_u8', 'kjcore_free_u8', 'kjcore_document_open_kjd', 'kjcore_document_close',
    'kjcore_document_validate', 'kjcore_document_revision', 'kjcore_document_serialize_kjd',
    'kjcore_document_fingerprint', 'kjcore_document_commit_kjd', 'kjcore_byte_result_len', 'kjcore_byte_result_value',
  ]) if (typeof exports[name] !== 'function') throw new KJValidationError(`KJCore 文档 ABI 缺失 ${name}`)
  if (!exports.memory?.buffer) throw new KJValidationError('KJCore 文档 ABI 缺失共享内存')
  return exports
}

function withUtf8(exports, source, callback) {
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

function readByteResult(exports, operation, result) {
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
  #exports
  #handle

  constructor(exports, handle) {
    this.#exports = exports
    this.#handle = handle
  }

  get closed() { return this.#handle === 0 }
  get revision() {
    this.#assertOpen()
    const value = Number(this.#exports.kjcore_document_revision(this.#handle))
    if (!Number.isSafeInteger(value) || value < 0) throw failure(this.#exports, 'document_revision', this.#exports.kjcore_last_error?.())
    return value
  }

  validate() {
    this.#assertOpen()
    const result = Number(this.#exports.kjcore_document_validate(this.#handle))
    if (result !== 1) throw failure(this.#exports, 'document_validate', result)
    return true
  }

  serialize() {
    this.#assertOpen()
    return readByteResult(this.#exports, 'document_serialize_kjd', Number(this.#exports.kjcore_document_serialize_kjd(this.#handle)))
  }

  fingerprint() {
    this.#assertOpen()
    return readByteResult(this.#exports, 'document_fingerprint', Number(this.#exports.kjcore_document_fingerprint(this.#handle)))
  }

  commit(source, expectedRevision = this.revision) {
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

  close() {
    if (this.closed) return false
    const handle = this.#handle
    this.#handle = 0
    const result = Number(this.#exports.kjcore_document_close(handle))
    if (result !== 1) throw failure(this.#exports, 'document_close', result)
    return true
  }

  #assertOpen() {
    if (this.closed) throw new KJValidationError('KJCore 文档会话已经关闭')
  }
}

export function openKJCoreDocumentSession(wasmModuleOrInstance, source) {
  const exports = assertDocumentAbi(wasmModuleOrInstance)
  const handle = withUtf8(exports, source, (pointer, length) => Number(exports.kjcore_document_open_kjd(pointer, length)))
  if (!Number.isInteger(handle) || handle <= 0) throw failure(exports, 'document_open_kjd', handle)
  return new KJCoreDocumentSession(exports, handle)
}

export function canonicalizeKjdWithKJCore(wasmModuleOrInstance, source) {
  const session = openKJCoreDocumentSession(wasmModuleOrInstance, source)
  try { return session.serialize() } finally { session.close() }
}

export function createKJCoreDocumentAuthority(wasmModuleOrInstance) {
  assertDocumentAbi(wasmModuleOrInstance)
  return Object.freeze({
    id: 'kanjie.kjcore.document-wasm',
    authoritative: true,
    modelVersion: EXPECTED_MODEL_VERSION,
    open: source => openKJCoreDocumentSession(wasmModuleOrInstance, source),
  })
}

export const KJCORE_DOCUMENT_MODEL_VERSION = EXPECTED_MODEL_VERSION
