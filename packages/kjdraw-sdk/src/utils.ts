import { KJValidationError } from './errors.js'

export type ReadonlyDeep<T> =
  T extends (...arguments_: never[]) => unknown ? T
    : T extends readonly unknown[] ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
      : T extends object ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
        : T

export type KJClockConstructor = new () => { toISOString(): string }

export function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet<object>()): ReadonlyDeep<T> {
  if (!value || typeof value !== 'object' || seen.has(value)) return value as ReadonlyDeep<T>
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value) as ReadonlyDeep<T>
}

export function assertPlainObject<T extends object>(value: T, label: string): T & Record<string, unknown>
export function assertPlainObject(value: unknown, label: string): Record<string, unknown>
export function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KJValidationError(`${label} must be an object`, { label, value })
  }
  return value as Record<string, unknown>
}

export function normalizeName(value: unknown): string {
  const text = String(value ?? '').trim()
  return /^[\x00-\x7f]*$/.test(text) ? text.toUpperCase() : text.toLocaleUpperCase('en-US')
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record).sort().map(key => [key, canonicalize(record[key])]),
  )
}

export function canonicalStringify(value: unknown, space: number | string = 0): string | undefined {
  return JSON.stringify(canonicalize(value), null, space)
}

export function fnv1a64(text: unknown): string {
  // FNV's 64-bit prime is 2^40 + 435. Two unsigned words preserve exactly the
  // existing modulo-2^64 result without allocating BigInts for every UTF-8 byte.
  let high = 0xcbf29ce4, low = 0x84222325
  for (const byte of new TextEncoder().encode(String(text))) {
    low = (low ^ byte) >>> 0
    const carry = Math.floor(low * 435 / 0x100000000)
    high = (Math.imul(high, 435) + (low << 8) + carry) >>> 0
    low = Math.imul(low, 435) >>> 0
  }
  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0')
}

export function stableHash(value: unknown): string {
  return fnv1a64(canonicalStringify(value))
}

export type KJHandleSource = string | number | bigint | boolean

export function toHexHandle(value: KJHandleSource): string {
  const number = typeof value === 'bigint' ? value : BigInt(value)
  if (number < 1n) throw new KJValidationError('Handle counter must be positive')
  return number.toString(16).toUpperCase()
}

export function fromHexHandle(value: unknown): bigint {
  const text = String(value ?? '').trim()
  if (!/^[0-9A-F]+$/i.test(text)) throw new KJValidationError(`Invalid handle: ${text}`)
  return BigInt(`0x${text}`)
}

export function nowIso(clock: KJClockConstructor = Date): string {
  return new clock().toISOString()
}
