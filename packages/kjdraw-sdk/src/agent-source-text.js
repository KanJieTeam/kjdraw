// Generated from agent-source-text.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
export function validateAgentSourceText(input, path = 'input') {
    if (typeof input === 'string') {
        if (/[\uFFFD\uD800-\uDFFF]/u.test(input)) {
            throw new KJValidationError(`Geology source text at ${path} contains a replacement character or an unpaired surrogate. No proposal was prepared. Re-read and copy the exact caller/source value; do not guess or silently replace the damaged character. If the supplied source itself is damaged, ask for the original value.`);
        }
        return;
    }
    if (!input || typeof input !== 'object') return;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))){
        if (Array.isArray(input) && key === 'length') continue;
        if ('value' in descriptor) validateAgentSourceText(descriptor.value, Array.isArray(input) ? `${path}[${key}]` : `${path}.${key}`);
    }
}
