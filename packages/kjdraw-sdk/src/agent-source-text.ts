import { KJValidationError } from './errors.js'

/** Validate already schema-checked FULL model source arguments. Encoding loss
 * is never repaired by guessing a material, identity or measurement label.
 * This does not verify provenance or whether a well-formed value is correct.
 */
export function validateAgentSourceText(input: unknown, path = 'input'): void {
  if (typeof input === 'string') {
    // Unicode mode matches lone surrogate code points, not valid paired emoji.
    if (/[\uFFFD\uD800-\uDFFF]/u.test(input)) {
      throw new KJValidationError(`Geology source text at ${path} contains a replacement character or an unpaired surrogate. No proposal was prepared. Re-read and copy the exact caller/source value; do not guess or silently replace the damaged character. If the supplied source itself is damaged, ask for the original value.`)
    }
    return
  }
  if (!input || typeof input !== 'object') return
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
    if (Array.isArray(input) && key === 'length') continue
    // Schema validation has already rejected accessors and non-data records.
    if ('value' in descriptor) validateAgentSourceText(descriptor.value,
      Array.isArray(input) ? `${path}[${key}]` : `${path}.${key}`)
  }
}
