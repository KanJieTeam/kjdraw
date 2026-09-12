export type KJErrorDetails = unknown;
export interface KJDrawErrorOptions {
    code?: string;
    details?: KJErrorDetails;
    cause?: unknown;
}
export declare class KJDrawError extends Error {
    readonly code: string;
    readonly details: KJErrorDetails;
    constructor(message: string, { code, details, cause }?: KJDrawErrorOptions);
}
export declare class KJValidationError extends KJDrawError {
    constructor(message: string, details?: KJErrorDetails);
}
export declare class KJTransactionError extends KJDrawError {
    constructor(message: string, details?: KJErrorDetails, cause?: unknown);
}
export declare class KJRevisionConflictError extends KJDrawError {
    readonly expected: unknown;
    readonly actual: unknown;
    constructor(expected: unknown, actual: unknown, details?: Readonly<Record<string, unknown>> | null);
}
export declare class KJFileConflictError extends KJDrawError {
    readonly expected: unknown;
    readonly actual: unknown;
    constructor(expected: unknown, actual: unknown, details?: Readonly<Record<string, unknown>> | null);
}
export declare class KJRegistrationError extends KJDrawError {
    constructor(message: string, details?: KJErrorDetails);
}
export declare class KJAdapterError extends KJDrawError {
    constructor(message: string, details?: KJErrorDetails, cause?: unknown);
}
