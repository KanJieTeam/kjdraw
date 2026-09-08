// Generated from backend.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from '../errors.js';
export const REQUIRED_GEOMETRY_OPERATIONS = Object.freeze([
    'intersectLineLine2',
    'intersectLineCircle2',
    'intersectCircleCircle2',
    'orientation2'
]);
const REFERENCE_BACKEND_IDENTITY = Object.freeze({
    id: 'kjdraw-js-reference',
    abi: 'kanjie.kjcore.reference.v1',
    version: '0.2.0',
    authoritative: false
});
let activeBackend = null;
let lastFailure = null;
export function registerGeometryBackend(backend) {
    if (!backend || typeof backend !== 'object') throw new KJValidationError('Geometry backend must be an object');
    for (const operation of REQUIRED_GEOMETRY_OPERATIONS){
        if (typeof backend[operation] !== 'function') {
            throw new KJValidationError(`Geometry backend is missing ${operation}`);
        }
    }
    const identity = Object.freeze({
        id: String(backend.id ?? 'unknown'),
        abi: String(backend.abi ?? 'unknown'),
        version: String(backend.version ?? 'unknown'),
        authoritative: backend.authoritative === true
    });
    activeBackend = Object.freeze({
        ...backend,
        identity
    });
    lastFailure = null;
    return identity;
}
export function unregisterGeometryBackend() {
    activeBackend = null;
}
export function recordGeometryBackendFailure(error) {
    lastFailure = Object.freeze({
        message: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString()
    });
    activeBackend = null;
}
export function getGeometryBackendStatus() {
    return Object.freeze({
        mode: activeBackend ? 'native' : 'reference',
        authoritative: activeBackend?.identity.authoritative === true,
        backend: activeBackend?.identity ?? REFERENCE_BACKEND_IDENTITY,
        operations: Object.freeze(activeBackend ? Object.keys(activeBackend).filter((key)=>typeof activeBackend?.[key] === 'function').sort() : []),
        lastFailure
    });
}
export function requireAuthoritativeGeometryBackend() {
    const status = getGeometryBackendStatus();
    if (!status.authoritative) {
        throw new KJValidationError('Authoritative KJCore geometry backend is not available');
    }
    return status.backend;
}
export function invokeGeometryBackend(operation, args, fallback) {
    const implementation = activeBackend?.[operation];
    if (typeof implementation !== 'function') return fallback();
    return implementation(...args);
}
