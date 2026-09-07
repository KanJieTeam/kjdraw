let fallbackCounter = 0

export function createId(prefix = 'obj') {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}-${uuid}`
  fallbackCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`
}
