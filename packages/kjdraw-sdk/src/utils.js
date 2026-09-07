import { KJValidationError } from './errors.js'

export function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

export function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KJValidationError(`${label} must be an object`, { label, value })
  }
  return value
}

export function normalizeName(value) {
  return String(value ?? '').trim().toLocaleUpperCase('en-US')
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
  )
}

export function canonicalStringify(value, space = 0) {
  return JSON.stringify(canonicalize(value), null, space)
}

export function fnv1a64(text) {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(String(text))) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function stableHash(value) {
  return fnv1a64(canonicalStringify(value))
}

export function toHexHandle(value) {
  const number = typeof value === 'bigint' ? value : BigInt(value)
  if (number < 1n) throw new KJValidationError('Handle counter must be positive')
  return number.toString(16).toUpperCase()
}

export function fromHexHandle(value) {
  const text = String(value ?? '').trim()
  if (!/^[0-9A-F]+$/i.test(text)) throw new KJValidationError(`Invalid handle: ${text}`)
  return BigInt(`0x${text}`)
}

export function nowIso(clock = Date) {
  return new clock().toISOString()
}
