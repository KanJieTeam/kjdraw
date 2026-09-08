// Generated from tolerance.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from '../errors.js';
export class KJTolerance {
    absolute;
    relative;
    angular;
    constructor({ absolute = 1e-9, relative = 1e-12, angular = 1e-10 } = {}){
        this.absolute = positive(absolute, 'absolute tolerance');
        this.relative = positive(relative, 'relative tolerance');
        this.angular = positive(angular, 'angular tolerance');
        Object.freeze(this);
    }
    distanceFor(...values) {
        const scale = Math.max(1, ...values.map((value)=>Math.abs(Number(value) || 0)));
        return Math.max(this.absolute, this.relative * scale);
    }
    equal(a, b) {
        return Math.abs(a - b) <= this.distanceFor(a, b);
    }
    zero(value, scale = 1) {
        return Math.abs(value) <= this.distanceFor(scale);
    }
    angleEqual(a, b) {
        return Math.abs(normalizeAngle(a - b)) <= this.angular;
    }
}
function positive(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new KJValidationError(`${label} must be a positive finite number`);
    }
    return number;
}
export function normalizeAngle(value) {
    const turn = Math.PI * 2;
    let angle = Number(value) % turn;
    if (angle <= -Math.PI) angle += turn;
    if (angle > Math.PI) angle -= turn;
    return angle;
}
export const DEFAULT_TOLERANCE = new KJTolerance();
