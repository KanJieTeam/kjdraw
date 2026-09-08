import { KJValidationError } from './errors.js'
import { createId } from './ids.js'
import { assertPlainObject, clone, deepFreeze, nowIso, type KJClockConstructor } from './utils.js'

export const KJ_COMMAND_SCHEMA = 'com.kanjie.kjdraw.command'
export const KJ_COMMAND_SCHEMA_VERSION = 1
export const KJ_COMMAND_ORIGINS = Object.freeze(['ui', 'sdk', 'plugin', 'ai', 'system', 'migration', 'recovery', 'test'] as const)
export const KJ_COMMAND_MODES = Object.freeze(['plan', 'execute'] as const)

export type KJCommandOriginKind = typeof KJ_COMMAND_ORIGINS[number]
export type KJCommandMode = typeof KJ_COMMAND_MODES[number]
export type KJCommandConfirmationStatus = 'not-required' | 'pending' | 'confirmed' | 'rejected'

export interface KJCommandOrigin {
  kind: KJCommandOriginKind
  owner?: string
  [key: string]: unknown
}

export interface KJCommandConfirmation {
  status: KJCommandConfirmationStatus
  planId?: string
  confirmedBy?: string
  rejectedBy?: string
  [key: string]: unknown
}

export interface KJCommandEnvelope<TArguments extends Record<string, unknown> = Record<string, unknown>> {
  schema: typeof KJ_COMMAND_SCHEMA
  schemaVersion: typeof KJ_COMMAND_SCHEMA_VERSION
  id: string
  command: string
  documentId: string
  expectedRevision: number | null
  mode: KJCommandMode
  arguments: TArguments
  origin: KJCommandOrigin
  confirmation: KJCommandConfirmation
  createdAt: string
  metadata: Record<string, unknown>
  [key: string]: unknown
}

export interface KJCreateCommandOptions {
  id?: string
  documentId?: string
  expectedRevision?: number | null
  mode?: KJCommandMode
  origin?: KJCommandOriginKind | Partial<KJCommandOrigin>
  confirmation?: Partial<KJCommandConfirmation>
  createdAt?: string
  clock?: KJClockConstructor
  metadata?: Record<string, unknown>
}

export interface KJCommandReceipt<TResult = unknown> {
  schema: 'com.kanjie.kjdraw.command-receipt'
  schemaVersion: 1
  commandEnvelopeId: string
  command: string
  documentId: string
  status: string
  beforeRevision: number
  afterRevision: number
  result: TResult | null
}

export interface KJCommandReceiptOptions<TResult = unknown> {
  status?: string
  beforeRevision?: number
  afterRevision?: number
  result?: TResult | null
}

/** Public release matrix. R12 remains an import-migration implementation detail. */
export const KJDRAW_CAD_VERSION_MATRIX = deepFreeze([
  { label: 'R14', code: 'AC1014' },
  { label: '2000', code: 'AC1015' },
  { label: '2004', code: 'AC1018' },
  { label: '2010', code: 'AC1024' },
  { label: '2013', code: 'AC1027' },
  { label: '2018', code: 'AC1032' },
  { label: '2024', code: 'AC1032' },
] as const)

/** Machine-readable KJDraw 1.0 boundary used by hosts, plugins and release QA. */
export const KJDRAW_1_0_PRODUCT_CONTRACT = deepFreeze({
  id: 'com.kanjie.kjdraw.product@1',
  deployment: 'provider-neutral',
  deploymentModes: ['browser-local', 'desktop-local', 'self-hosted', 'cloud-assisted', 'hybrid'],
  defaultDeployment: 'browser-local',
  projectAuthority: 'host-selected-provider',
  providerContracts: ['project-store', 'compute', 'scene'],
  authorities: {
    geometry: 'kjcore-rust', topology: 'kjcore-rust', spatialIndex: 'kjcore-rust', fileIntermediateModel: 'kjcore-rust',
    workbench: 'typescript-sdk-client', renderer: 'read-only-projection',
  },
  projectFile: {
    extension: '.kjp', mediaType: 'application/vnd.kanjie.kjdraw-project+zip', schema: 'com.kanjie.kjdraw.project@1', container: 'zip64',
    requiredEntries: ['manifest.json', 'drawings/', 'history/commands.ndjson'],
    optionalEntries: ['assets/', 'snapshots/', 'recovery/', 'diagnostics/'], durability: 'write-temp-fsync-atomic-replace',
  },
  documentFile: { extension: '.kjd', mediaType: 'application/vnd.kanjie.kjdraw-document+json', schema: 'com.kanjie.kjdraw.document@1' },
  commandProtocol: `${KJ_COMMAND_SCHEMA}@${KJ_COMMAND_SCHEMA_VERSION}`,
  cadVersions: KJDRAW_CAD_VERSION_MATRIX,
  domainExtensions: { included: false, policy: 'separate-packages' },
  extensionRule: 'official-and-third-party-capabilities-use-the-same-public-sdk',
} as const)

function normalizeOrigin(value: unknown): KJCommandOrigin {
  const raw = typeof value === 'string' ? { kind: value } : clone(value ?? { kind: 'sdk' })
  const source = assertPlainObject(raw, 'Command origin')
  const kind = String(source.kind ?? '').trim().toLowerCase()
  if (!KJ_COMMAND_ORIGINS.includes(kind as KJCommandOriginKind)) throw new KJValidationError(`Unsupported command origin: ${kind}`)
  const result: KJCommandOrigin = { ...source, kind: kind as KJCommandOriginKind }
  if (source.owner != null) result.owner = String(source.owner)
  return result
}

function normalizeConfirmation(value: unknown, origin: KJCommandOrigin, mode: KJCommandMode): KJCommandConfirmation {
  const raw = clone(value ?? { status: origin.kind === 'ai' && mode === 'execute' ? 'pending' : 'not-required' })
  const source = assertPlainObject(raw, 'Command confirmation')
  const status = String(source.status ?? '').trim().toLowerCase()
  if (!['not-required', 'pending', 'confirmed', 'rejected'].includes(status)) throw new KJValidationError(`Unsupported command confirmation status: ${status}`)
  const result: KJCommandConfirmation = { ...source, status: status as KJCommandConfirmationStatus }
  if (origin.kind === 'ai' && mode === 'execute') {
    if (result.status !== 'confirmed') throw new KJValidationError('AI command plans require explicit user confirmation before execution')
    if (!String(result.planId ?? '').trim()) throw new KJValidationError('Confirmed AI command execution requires a planId')
  }
  return result
}

export function validateCommandEnvelope(input: unknown): Readonly<KJCommandEnvelope> {
  const source = clone(assertPlainObject(input, 'Command envelope'))
  if (source.schema !== KJ_COMMAND_SCHEMA || Number(source.schemaVersion) !== KJ_COMMAND_SCHEMA_VERSION) {
    throw new KJValidationError(`Unsupported command protocol: ${String(source.schema ?? '<missing>')}@${String(source.schemaVersion ?? '<missing>')}`)
  }
  const id = String(source.id ?? '').trim(), command = String(source.command ?? '').trim().toUpperCase(), documentId = String(source.documentId ?? '').trim()
  const mode = String(source.mode ?? 'execute').trim().toLowerCase()
  if (!id) throw new KJValidationError('Command envelope id is required')
  if (!command) throw new KJValidationError('Command id is required')
  if (!documentId) throw new KJValidationError('Command documentId is required')
  if (!KJ_COMMAND_MODES.includes(mode as KJCommandMode)) throw new KJValidationError(`Unsupported command mode: ${mode}`)
  const arguments_ = clone(source.arguments ?? {})
  assertPlainObject(arguments_, 'Command arguments')
  const expectedRevision = source.expectedRevision == null ? null : Number(source.expectedRevision)
  if (expectedRevision != null && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) throw new KJValidationError('expectedRevision must be a non-negative integer or null')
  const origin = normalizeOrigin(source.origin)
  const confirmation = normalizeConfirmation(source.confirmation, origin, mode as KJCommandMode)
  const createdAt = String(source.createdAt ?? nowIso())
  if (!Number.isFinite(Date.parse(createdAt))) throw new KJValidationError('Command createdAt must be an ISO timestamp')
  return deepFreeze({ ...source, schema: KJ_COMMAND_SCHEMA, schemaVersion: KJ_COMMAND_SCHEMA_VERSION, id, command, documentId, expectedRevision, mode: mode as KJCommandMode, arguments: arguments_, origin, confirmation, createdAt, metadata: clone(assertPlainObject(source.metadata ?? {}, 'Command metadata')) })
}

export function createCommandEnvelope<TArguments extends Record<string, unknown> = Record<string, unknown>>(command: string, args: TArguments = {} as TArguments, options: KJCreateCommandOptions = {}): Readonly<KJCommandEnvelope<TArguments>> {
  const origin = normalizeOrigin(options.origin)
  const mode = options.mode ?? 'execute'
  return validateCommandEnvelope({ schema: KJ_COMMAND_SCHEMA, schemaVersion: KJ_COMMAND_SCHEMA_VERSION, id: options.id ?? createId('command'), command, documentId: options.documentId, expectedRevision: options.expectedRevision ?? null, mode, arguments: args, origin, confirmation: options.confirmation, createdAt: options.createdAt ?? nowIso(options.clock), metadata: clone(options.metadata ?? {}) }) as Readonly<KJCommandEnvelope<TArguments>>
}

export function createCommandReceipt<TResult = unknown>(envelope: KJCommandEnvelope, { status, beforeRevision, afterRevision, result = null }: KJCommandReceiptOptions<TResult> = {}): Readonly<KJCommandReceipt<TResult>> {
  return deepFreeze({ schema: 'com.kanjie.kjdraw.command-receipt', schemaVersion: 1, commandEnvelopeId: envelope.id, command: envelope.command, documentId: envelope.documentId, status: String(status), beforeRevision: Number(beforeRevision), afterRevision: Number(afterRevision), result }) as Readonly<KJCommandReceipt<TResult>>
}
