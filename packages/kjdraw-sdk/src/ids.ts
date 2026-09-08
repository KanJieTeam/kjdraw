let fallbackCounter = 0

/** Creates a process-local identifier, preferring a cryptographically random UUID. */
export function createId(prefix = 'obj'): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}-${uuid}`
  fallbackCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`
}
