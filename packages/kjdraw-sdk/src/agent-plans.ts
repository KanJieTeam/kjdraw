import { KJValidationError } from './errors.js'
import { validateCommandEnvelope } from './product-contract.js'
import { clone, deepFreeze, stableHash } from './utils.js'

export interface KJAgentPlanDocument {
  id: string
  revision: number
  fingerprint(): string
}

export interface KJAgentPlanRecord {
  schema: 'com.kanjie.kjdraw.agent-plan@1'
  planId: string
  command: string
  documentId: string
  expectedRevision: number
  documentFingerprint: string
  binding: string
  status: 'active' | 'consumed' | 'rejected' | 'expired'
  createdAt: string
  expiresAt: string
  consumedAt?: string
  rejectedAt?: string
  confirmedBy?: string
  rejectedBy?: string
  executionEnvelopeId?: string
}

type CommandEnvelope = Record<string, any>

function bindingFor(envelope: CommandEnvelope, documentFingerprint: string): string {
  return stableHash({
    command: envelope.command,
    arguments: envelope.arguments,
    documentId: envelope.documentId,
    expectedRevision: envelope.expectedRevision,
    documentFingerprint,
  })
}

export class KJAgentPlanRegistry {
  #plans = new Map<string, KJAgentPlanRecord>()
  #clock: () => number
  #defaultTtlMs: number

  constructor({ clock = Date.now, defaultTtlMs = 5 * 60 * 1000 }: { clock?: () => number; defaultTtlMs?: number } = {}) {
    if (typeof clock !== 'function') throw new KJValidationError('Agent plan clock must be a function')
    if (!Number.isFinite(defaultTtlMs) || defaultTtlMs <= 0) throw new KJValidationError('Agent plan TTL must be positive')
    this.#clock = clock
    this.#defaultTtlMs = Number(defaultTtlMs)
  }

  #now(): number {
    const value = Number(this.#clock())
    if (!Number.isFinite(value)) throw new KJValidationError('Agent plan clock returned an invalid timestamp')
    return value
  }

  #snapshot(record: KJAgentPlanRecord): Readonly<KJAgentPlanRecord> {
    return deepFreeze(clone(record))
  }

  register(input: CommandEnvelope, document: KJAgentPlanDocument, { ttlMs = this.#defaultTtlMs }: { ttlMs?: number } = {}): Readonly<KJAgentPlanRecord> {
    const envelope = validateCommandEnvelope(input)
    if (envelope.mode !== 'plan' || envelope.origin.kind !== 'ai') throw new KJValidationError('Agent plan registry accepts only AI plan envelopes')
    if (envelope.documentId !== document?.id) throw new KJValidationError('Agent plan document mismatch')
    if (envelope.expectedRevision == null || envelope.expectedRevision !== document.revision) throw new KJValidationError('Agent plan must bind the current document revision')
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new KJValidationError('Agent plan TTL must be positive')
    if (this.#plans.has(envelope.id)) throw new KJValidationError(`Agent plan already registered: ${envelope.id}`)
    const now = this.#now(), documentFingerprint = document.fingerprint()
    const record: KJAgentPlanRecord = {
      schema: 'com.kanjie.kjdraw.agent-plan@1',
      planId: envelope.id,
      command: envelope.command,
      documentId: envelope.documentId,
      expectedRevision: envelope.expectedRevision,
      documentFingerprint,
      binding: bindingFor(envelope, documentFingerprint),
      status: 'active',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Number(ttlMs)).toISOString(),
    }
    this.#plans.set(record.planId, record)
    return this.#snapshot(record)
  }

  consume(input: CommandEnvelope, document: KJAgentPlanDocument): Readonly<KJAgentPlanRecord> {
    const envelope = validateCommandEnvelope(input)
    if (envelope.mode !== 'execute' || envelope.origin.kind !== 'ai') throw new KJValidationError('Agent plan execution requires an AI execute envelope')
    const planId = String(envelope.confirmation?.planId ?? '').trim()
    const record = this.#plans.get(planId)
    if (!record) throw new KJValidationError(`Unknown or unregistered agent plan: ${planId}`)
    if (record.status !== 'active') throw new KJValidationError(`Agent plan is ${record.status}: ${planId}`)
    const now = this.#now()
    if (now > Date.parse(record.expiresAt)) {
      record.status = 'expired'
      throw new KJValidationError(`Agent plan expired: ${planId}`)
    }
    const confirmedBy = String(envelope.confirmation?.confirmedBy ?? '').trim()
    if (!confirmedBy) throw new KJValidationError('Agent plan execution requires confirmedBy')
    if (document?.id !== record.documentId || document.revision !== record.expectedRevision || document.fingerprint() !== record.documentFingerprint) {
      throw new KJValidationError(`Agent plan document state changed: ${planId}`)
    }
    if (bindingFor(envelope, record.documentFingerprint) !== record.binding) throw new KJValidationError(`Agent plan arguments do not match the reviewed proposal: ${planId}`)
    record.status = 'consumed'
    record.consumedAt = new Date(now).toISOString()
    record.confirmedBy = confirmedBy
    record.executionEnvelopeId = envelope.id
    return this.#snapshot(record)
  }

  reject(planId: string, rejectedBy: string): Readonly<KJAgentPlanRecord> {
    const record = this.#plans.get(String(planId))
    if (!record) throw new KJValidationError(`Unknown agent plan: ${planId}`)
    if (record.status !== 'active') throw new KJValidationError(`Agent plan is ${record.status}: ${planId}`)
    record.status = 'rejected'
    record.rejectedAt = new Date(this.#now()).toISOString()
    record.rejectedBy = String(rejectedBy ?? '').trim() || 'host'
    return this.#snapshot(record)
  }

  get(planId: string): Readonly<KJAgentPlanRecord> | null {
    const record = this.#plans.get(String(planId))
    return record ? this.#snapshot(record) : null
  }

  list(): ReadonlyArray<Readonly<KJAgentPlanRecord>> {
    return [...this.#plans.values()].map(record => this.#snapshot(record))
  }

  prune(): number {
    const now = this.#now()
    let removed = 0
    for (const [id, record] of this.#plans) if (record.status !== 'active' || now > Date.parse(record.expiresAt)) {
      this.#plans.delete(id)
      removed += 1
    }
    return removed
  }
}
