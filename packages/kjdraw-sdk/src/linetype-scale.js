// Generated from linetype-scale.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from './errors.js';
function positive(value, name) {
    const result = Number(value);
    if (!Number.isFinite(result) || result <= 0) throw new KJValidationError(`${name} must be positive and finite`);
    return result;
}
export function effectiveLinetypeScale(systemVariables, payload) {
    return positive(systemVariables.LTSCALE ?? 1, 'LTSCALE') * positive(payload.linetypeScale ?? 1, 'linetypeScale');
}
