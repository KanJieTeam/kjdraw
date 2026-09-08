export type KJErrorDetails = unknown

export interface KJDrawErrorOptions {
  code?: string
  details?: KJErrorDetails
  cause?: unknown
}

export class KJDrawError extends Error {
  readonly code: string
  readonly details: KJErrorDetails

  constructor(message: string, { code = 'KJDRAW_ERROR', details = null, cause }: KJDrawErrorOptions = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = this.constructor.name
    this.code = code
    this.details = details
  }
}

export class KJValidationError extends KJDrawError {
  constructor(message: string, details: KJErrorDetails = null) {
    super(message, { code: 'KJDOCUMENT_INVALID', details })
  }
}

export class KJTransactionError extends KJDrawError {
  constructor(message: string, details: KJErrorDetails = null, cause?: unknown) {
    super(message, { code: 'KJTRANSACTION_FAILED', details, cause })
  }
}

export class KJRevisionConflictError extends KJDrawError {
  readonly expected: unknown
  readonly actual: unknown

  constructor(expected: unknown, actual: unknown, details: Readonly<Record<string, unknown>> | null = null) {
    super(`Document revision conflict: expected ${String(expected)}, actual ${String(actual)}`, {
      code: 'KJDOCUMENT_REVISION_CONFLICT',
      details: { expected, actual, ...(details ?? {}) },
    })
    this.expected = expected
    this.actual = actual
  }
}

export class KJRegistrationError extends KJDrawError {
  constructor(message: string, details: KJErrorDetails = null) {
    super(message, { code: 'KJREGISTRATION_FAILED', details })
  }
}

export class KJAdapterError extends KJDrawError {
  constructor(message: string, details: KJErrorDetails = null, cause?: unknown) {
    super(message, { code: 'KJFILE_ADAPTER_FAILED', details, cause })
  }
}
