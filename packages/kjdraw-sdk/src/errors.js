// Generated from errors.ts by scripts/build-typescript.mjs. Do not edit directly.
export class KJDrawError extends Error {
    code;
    details;
    constructor(message, { code = 'KJDRAW_ERROR', details = null, cause } = {}){
        super(message, cause ? {
            cause
        } : undefined);
        this.name = this.constructor.name;
        this.code = code;
        this.details = details;
    }
}
export class KJValidationError extends KJDrawError {
    constructor(message, details = null){
        super(message, {
            code: 'KJDOCUMENT_INVALID',
            details
        });
    }
}
export class KJTransactionError extends KJDrawError {
    constructor(message, details = null, cause){
        super(message, {
            code: 'KJTRANSACTION_FAILED',
            details,
            cause
        });
    }
}
export class KJRevisionConflictError extends KJDrawError {
    expected;
    actual;
    constructor(expected, actual, details = null){
        super(`Document revision conflict: expected ${String(expected)}, actual ${String(actual)}`, {
            code: 'KJDOCUMENT_REVISION_CONFLICT',
            details: {
                expected,
                actual,
                ...details ?? {}
            }
        });
        this.expected = expected;
        this.actual = actual;
    }
}
export class KJRegistrationError extends KJDrawError {
    constructor(message, details = null){
        super(message, {
            code: 'KJREGISTRATION_FAILED',
            details
        });
    }
}
export class KJAdapterError extends KJDrawError {
    constructor(message, details = null, cause){
        super(message, {
            code: 'KJFILE_ADAPTER_FAILED',
            details,
            cause
        });
    }
}
