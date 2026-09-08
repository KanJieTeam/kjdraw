import { KJValidationError } from './errors.js'
import { validateCommandEnvelope } from './product-contract.js'
import { clone, deepFreeze } from './utils.js'
import type { KJCommandEnvelope } from './product-contract.js'

export const KJ_AGENT_PLAN_BINDING_CANONICALIZATION = 'com.kanjie.kjdraw.canonical-json@1' as const
export const KJ_AGENT_PLAN_BINDING_DOMAIN = 'com.kanjie.kjdraw.agent-plan-binding@1' as const

export interface KJAgentPlanDocument {
  id: string
  revision: number
  fingerprint(): string
  serialize(options?: { pretty?: boolean; includeRevisions?: boolean }): string
}

export interface KJAgentPlanBindingContext {
  phase: 'create' | 'verify'
  planId: string
  command: string
  documentId: string
  expectedRevision: number
}

/**
 * Host-injected approval binding. A deterministic HMAC provider can implement
 * create/verify with the same secret; a signature provider can sign in create
 * and verify with its public key. Implementations must fail closed.
 */
export interface KJAgentPlanBindingProvider {
  readonly algorithm: string
  create(canonicalContent: string, context: Readonly<KJAgentPlanBindingContext>): Promise<string>
  verify(canonicalContent: string, binding: string, context: Readonly<KJAgentPlanBindingContext>): Promise<boolean>
}

export interface KJAgentPlanRegistryOptions {
  clock?: () => number
  defaultTtlMs?: number
  bindingProvider?: KJAgentPlanBindingProvider
}

export interface KJAgentPlanRecord {
  schema: 'com.kanjie.kjdraw.agent-plan@1'
  planId: string
  command: string
  documentId: string
  expectedRevision: number
  documentFingerprint: string
  documentContentDigest: string
  bindingCanonicalization: typeof KJ_AGENT_PLAN_BINDING_CANONICALIZATION
  bindingAlgorithm: string
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

interface KJAgentPlanBindingPayload {
  schema: typeof KJ_AGENT_PLAN_BINDING_DOMAIN
  canonicalization: typeof KJ_AGENT_PLAN_BINDING_CANONICALIZATION
  planId: string
  command: string
  arguments: Readonly<Record<string, unknown>>
  document: {
    id: string
    expectedRevision: number
    fingerprint: string
    contentDigest: string
  }
}

function canonicalJson(value: unknown, path = '$', ancestors = new Set<object>()): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new KJValidationError(`Agent plan binding contains a non-finite number at ${path}`)
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (typeof value !== 'object') throw new KJValidationError(`Agent plan binding contains unsupported data at ${path}`)
  if (ancestors.has(value)) throw new KJValidationError(`Agent plan binding contains a cycle at ${path}`)

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const items: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new KJValidationError(`Agent plan binding contains a sparse array at ${path}[${index}]`)
        items.push(canonicalJson(value[index], `${path}[${index}]`, ancestors))
      }
      return `[${items.join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new KJValidationError(`Agent plan binding contains a non-JSON object at ${path}`)
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new KJValidationError(`Agent plan binding contains symbol keys at ${path}`)
    }
    const record = value as Record<string, unknown>
    const properties = Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key], `${path}.${key}`, ancestors)}`)
    return `{${properties.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

export function canonicalizeAgentPlanBinding(value: unknown): string {
  return canonicalJson(value)
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new KJValidationError('Agent plan SHA-256 binding requires the Web Crypto API')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function equalStringsConstantWork(left: string, right: string): boolean {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

export function createSha256AgentPlanBindingProvider(): KJAgentPlanBindingProvider {
  return Object.freeze({
    algorithm: 'SHA-256',
    async create(canonicalContent: string): Promise<string> {
      return sha256Hex(canonicalContent)
    },
    async verify(canonicalContent: string, binding: string): Promise<boolean> {
      return equalStringsConstantWork(await sha256Hex(canonicalContent), binding)
    },
  })
}

function assertDocument(document: KJAgentPlanDocument): void {
  if (!document || typeof document.id !== 'string' || !Number.isInteger(document.revision) || typeof document.fingerprint !== 'function' || typeof document.serialize !== 'function') {
    throw new KJValidationError('Agent plan requires a document with id, revision, fingerprint and serialize')
  }
}

function assertBindingProvider(provider: KJAgentPlanBindingProvider): void {
  if (!provider || typeof provider !== 'object') throw new KJValidationError('Agent plan bindingProvider must be an object')
  if (!String(provider.algorithm ?? '').trim()) throw new KJValidationError('Agent plan bindingProvider.algorithm is required')
  if (typeof provider.create !== 'function' || typeof provider.verify !== 'function') {
    throw new KJValidationError('Agent plan bindingProvider must expose async create and verify functions')
  }
}

function assertBinding(value: unknown): string {
  const binding = String(value ?? '').trim()
  if (!binding || binding.length > 16_384) throw new KJValidationError('Agent plan binding provider returned an invalid binding')
  return binding
}

function createBindingContext(
  phase: KJAgentPlanBindingContext['phase'],
  envelope: Readonly<KJCommandEnvelope>,
  planId: string,
): Readonly<KJAgentPlanBindingContext> {
  return Object.freeze({
    phase,
    planId,
    command: envelope.command,
    documentId: envelope.documentId,
    expectedRevision: envelope.expectedRevision as number,
  })
}

function createBindingContent(
  envelope: Readonly<KJCommandEnvelope>,
  planId: string,
  documentFingerprint: string,
  documentContentDigest: string,
): string {
  const payload: KJAgentPlanBindingPayload = {
    schema: KJ_AGENT_PLAN_BINDING_DOMAIN,
    canonicalization: KJ_AGENT_PLAN_BINDING_CANONICALIZATION,
    planId,
    command: envelope.command,
    arguments: envelope.arguments,
    document: {
      id: envelope.documentId,
      expectedRevision: envelope.expectedRevision as number,
      fingerprint: documentFingerprint,
      contentDigest: documentContentDigest,
    },
  }
  return canonicalizeAgentPlanBinding(payload)
}

async function digestDocument(document: KJAgentPlanDocument): Promise<string> {
  const serialized = document.serialize({ pretty: false, includeRevisions: true })
  if (typeof serialized !== 'string') throw new KJValidationError('Agent plan document serialize must return a string')
  return sha256Hex(serialized)
}

export class KJAgentPlanRegistry {
  #plans = new Map<string, KJAgentPlanRecord>()
  #registering = new Set<string>()
  #consuming = new Set<string>()
  #clock: () => number
  #defaultTtlMs: number
  #bindingProvider: KJAgentPlanBindingProvider

  constructor({
    clock = Date.now,
    defaultTtlMs = 5 * 60 * 1000,
    bindingProvider = createSha256AgentPlanBindingProvider(),
  }: KJAgentPlanRegistryOptions = {}) {
    if (typeof clock !== 'function') throw new KJValidationError('Agent plan clock must be a function')
    if (!Number.isFinite(defaultTtlMs) || defaultTtlMs <= 0) throw new KJValidationError('Agent plan TTL must be positive')
    assertBindingProvider(bindingProvider)
    this.#clock = clock
    this.#defaultTtlMs = Number(defaultTtlMs)
    this.#bindingProvider = bindingProvider
  }

  #now(): number {
    const value = Number(this.#clock())
    if (!Number.isFinite(value)) throw new KJValidationError('Agent plan clock returned an invalid timestamp')
    return value
  }

  #snapshot(record: KJAgentPlanRecord): Readonly<KJAgentPlanRecord> {
    return deepFreeze(clone(record)) as Readonly<KJAgentPlanRecord>
  }

  #expireIfNeeded(record: KJAgentPlanRecord, now: number): void {
    if (now >= Date.parse(record.expiresAt)) record.status = 'expired'
  }

  async register(
    input: unknown,
    document: KJAgentPlanDocument,
    { ttlMs = this.#defaultTtlMs }: { ttlMs?: number } = {},
  ): Promise<Readonly<KJAgentPlanRecord>> {
    const envelope = validateCommandEnvelope(input)
    assertDocument(document)
    if (envelope.mode !== 'plan' || envelope.origin.kind !== 'ai') throw new KJValidationError('Agent plan registry accepts only AI plan envelopes')
    if (envelope.documentId !== document.id) throw new KJValidationError('Agent plan document mismatch')
    if (envelope.expectedRevision == null || envelope.expectedRevision !== document.revision) throw new KJValidationError('Agent plan must bind the current document revision')
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new KJValidationError('Agent plan TTL must be positive')
    if (this.#plans.has(envelope.id) || this.#registering.has(envelope.id)) throw new KJValidationError(`Agent plan already registered: ${envelope.id}`)

    const expectedRevision = envelope.expectedRevision
    const documentFingerprint = String(document.fingerprint())
    this.#registering.add(envelope.id)
    try {
      const documentContentDigest = await digestDocument(document)
      const canonicalContent = createBindingContent(envelope, envelope.id, documentFingerprint, documentContentDigest)
      const context = createBindingContext('create', envelope, envelope.id)
      const binding = assertBinding(await this.#bindingProvider.create(canonicalContent, context))
      if (document.id !== envelope.documentId || document.revision !== expectedRevision || String(document.fingerprint()) !== documentFingerprint || await digestDocument(document) !== documentContentDigest) {
        throw new KJValidationError(`Agent plan document state changed while registering: ${envelope.id}`)
      }
      if (this.#plans.has(envelope.id)) throw new KJValidationError(`Agent plan already registered: ${envelope.id}`)
      const now = this.#now()
      const record: KJAgentPlanRecord = {
        schema: 'com.kanjie.kjdraw.agent-plan@1',
        planId: envelope.id,
        command: envelope.command,
        documentId: envelope.documentId,
        expectedRevision,
        documentFingerprint,
        documentContentDigest,
        bindingCanonicalization: KJ_AGENT_PLAN_BINDING_CANONICALIZATION,
        bindingAlgorithm: String(this.#bindingProvider.algorithm).trim(),
        binding,
        status: 'active',
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + Number(ttlMs)).toISOString(),
      }
      this.#plans.set(record.planId, record)
      return this.#snapshot(record)
    } finally {
      this.#registering.delete(envelope.id)
    }
  }

  async consume(input: unknown, document: KJAgentPlanDocument): Promise<Readonly<KJAgentPlanRecord>> {
    const envelope = validateCommandEnvelope(input)
    assertDocument(document)
    if (envelope.mode !== 'execute' || envelope.origin.kind !== 'ai') throw new KJValidationError('Agent plan execution requires an AI execute envelope')
    const planId = String(envelope.confirmation?.planId ?? '').trim()
    const record = this.#plans.get(planId)
    if (!record) throw new KJValidationError(`Unknown or unregistered agent plan: ${planId}`)
    this.#expireIfNeeded(record, this.#now())
    if (record.status !== 'active') throw new KJValidationError(`Agent plan is ${record.status}: ${planId}`)
    if (this.#consuming.has(planId)) throw new KJValidationError(`Agent plan is already being consumed: ${planId}`)
    const confirmedBy = String(envelope.confirmation?.confirmedBy ?? '').trim()
    if (!confirmedBy) throw new KJValidationError('Agent plan execution requires confirmedBy')
    if (document.id !== record.documentId || document.revision !== record.expectedRevision || String(document.fingerprint()) !== record.documentFingerprint) {
      throw new KJValidationError(`Agent plan document state changed: ${planId}`)
    }
    if (record.bindingCanonicalization !== KJ_AGENT_PLAN_BINDING_CANONICALIZATION || record.bindingAlgorithm !== String(this.#bindingProvider.algorithm).trim()) {
      throw new KJValidationError(`Agent plan binding provider mismatch: ${planId}`)
    }

    this.#consuming.add(planId)
    try {
      const documentContentDigest = await digestDocument(document)
      if (documentContentDigest !== record.documentContentDigest) throw new KJValidationError(`Agent plan document content changed: ${planId}`)
      const canonicalContent = createBindingContent(envelope, planId, record.documentFingerprint, documentContentDigest)
      const context = createBindingContext('verify', envelope, planId)
      const matches = await this.#bindingProvider.verify(canonicalContent, record.binding, context)
      this.#expireIfNeeded(record, this.#now())
      if (record.status !== 'active') throw new KJValidationError(`Agent plan is ${record.status}: ${planId}`)
      if (document.id !== record.documentId || document.revision !== record.expectedRevision || String(document.fingerprint()) !== record.documentFingerprint || await digestDocument(document) !== record.documentContentDigest) {
        throw new KJValidationError(`Agent plan document state changed: ${planId}`)
      }
      if (matches !== true) throw new KJValidationError(`Agent plan arguments or document content do not match the reviewed proposal: ${planId}`)
      record.status = 'consumed'
      record.consumedAt = new Date(this.#now()).toISOString()
      record.confirmedBy = confirmedBy
      record.executionEnvelopeId = envelope.id
      return this.#snapshot(record)
    } finally {
      this.#consuming.delete(planId)
    }
  }

  reject(planId: string, rejectedBy: string): Readonly<KJAgentPlanRecord> {
    const normalizedPlanId = String(planId)
    const record = this.#plans.get(normalizedPlanId)
    if (!record) throw new KJValidationError(`Unknown agent plan: ${planId}`)
    this.#expireIfNeeded(record, this.#now())
    if (record.status !== 'active') throw new KJValidationError(`Agent plan is ${record.status}: ${planId}`)
    if (this.#consuming.has(normalizedPlanId)) throw new KJValidationError(`Agent plan is already being consumed: ${planId}`)
    record.status = 'rejected'
    record.rejectedAt = new Date(this.#now()).toISOString()
    record.rejectedBy = String(rejectedBy ?? '').trim() || 'host'
    return this.#snapshot(record)
  }

  get(planId: string): Readonly<KJAgentPlanRecord> | null {
    const record = this.#plans.get(String(planId))
    if (!record) return null
    this.#expireIfNeeded(record, this.#now())
    return this.#snapshot(record)
  }

  list(): ReadonlyArray<Readonly<KJAgentPlanRecord>> {
    const now = this.#now()
    return [...this.#plans.values()].map(record => {
      this.#expireIfNeeded(record, now)
      return this.#snapshot(record)
    })
  }

  prune(): number {
    const now = this.#now()
    let removed = 0
    for (const [id, record] of this.#plans) {
      this.#expireIfNeeded(record, now)
      if (record.status !== 'active' && !this.#consuming.has(id)) {
        this.#plans.delete(id)
        removed += 1
      }
    }
    return removed
  }
}
