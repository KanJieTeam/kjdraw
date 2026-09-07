import { KJValidationError } from './errors.js'
import { createId } from './ids.js'
import { assertPlainObject, clone, deepFreeze, nowIso } from './utils.js'

export const KJ_COMMAND_SCHEMA = 'com.kanjie.kjdraw.command'
export const KJ_COMMAND_SCHEMA_VERSION = 1
export const KJ_COMMAND_ORIGINS = Object.freeze(['ui', 'sdk', 'plugin', 'ai', 'system', 'migration', 'recovery', 'test'])
export const KJ_COMMAND_MODES = Object.freeze(['plan', 'execute'])

/** Public release matrix. R12 remains an import-migration implementation detail;
 * it is deliberately not an advertised KJDraw 1.0 target. AutoCAD 2007 is not
 * present anywhere in the product contract. */
export const KJDRAW_CAD_VERSION_MATRIX = deepFreeze([
  { label: 'R14', code: 'AC1014' },
  { label: '2000', code: 'AC1015' },
  { label: '2004', code: 'AC1018' },
  { label: '2010', code: 'AC1024' },
  { label: '2013', code: 'AC1027' },
  { label: '2018', code: 'AC1032' },
  { label: '2024', code: 'AC1032' },
])

/** Machine-readable KJDraw 1.0 boundary used by hosts, plugins and release QA. */
export const KJDRAW_1_0_PRODUCT_CONTRACT = deepFreeze({
  id: 'com.kanjie.kjdraw.product@1',
  deployment: 'provider-neutral',
  deploymentModes: ['browser-local', 'desktop-local', 'self-hosted', 'cloud-assisted', 'hybrid'],
  defaultDeployment: 'browser-local',
  projectAuthority: 'host-selected-provider',
  providerContracts: ['project-store', 'compute', 'scene'],
  authorities: {
    geometry: 'kjcore-rust',
    topology: 'kjcore-rust',
    spatialIndex: 'kjcore-rust',
    fileIntermediateModel: 'kjcore-rust',
    workbench: 'typescript-sdk-client',
    renderer: 'read-only-projection',
  },
  projectFile: {
    extension: '.kjp',
    mediaType: 'application/vnd.kanjie.kjdraw-project+zip',
    schema: 'com.kanjie.kjdraw.project@1',
    container: 'zip64',
    requiredEntries: ['manifest.json', 'drawings/', 'history/commands.ndjson'],
    optionalEntries: ['assets/', 'snapshots/', 'recovery/', 'diagnostics/'],
    durability: 'write-temp-fsync-atomic-replace',
  },
  documentFile: {
    extension: '.kjd',
    mediaType: 'application/vnd.kanjie.kjdraw-document+json',
    schema: 'com.kanjie.kjdraw.document@1',
  },
  commandProtocol: `${KJ_COMMAND_SCHEMA}@${KJ_COMMAND_SCHEMA_VERSION}`,
  cadVersions: KJDRAW_CAD_VERSION_MATRIX,
  domainExtensions: { included: false, policy: 'separate-packages' },
  extensionRule: 'official-and-third-party-capabilities-use-the-same-public-sdk',
})

function normalizeOrigin(value) {
  const origin = typeof value === 'string' ? { kind: value } : clone(value ?? { kind: 'sdk' })
  assertPlainObject(origin, 'Command origin')
  origin.kind = String(origin.kind ?? '').trim().toLowerCase()
  if (!KJ_COMMAND_ORIGINS.includes(origin.kind)) throw new KJValidationError(`Unsupported command origin: ${origin.kind}`)
  if (origin.owner != null) origin.owner = String(origin.owner)
  return origin
}

function normalizeConfirmation(value, origin, mode) {
  const confirmation = clone(value ?? { status: origin.kind === 'ai' && mode === 'execute' ? 'pending' : 'not-required' })
  assertPlainObject(confirmation, 'Command confirmation')
  confirmation.status = String(confirmation.status ?? '').trim().toLowerCase()
  if (!['not-required', 'pending', 'confirmed', 'rejected'].includes(confirmation.status)) {
    throw new KJValidationError(`Unsupported command confirmation status: ${confirmation.status}`)
  }
  if (origin.kind === 'ai' && mode === 'execute') {
    if (confirmation.status !== 'confirmed') throw new KJValidationError('AI command plans require explicit user confirmation before execution')
    if (!String(confirmation.planId ?? '').trim()) throw new KJValidationError('Confirmed AI command execution requires a planId')
  }
  return confirmation
}

export function validateCommandEnvelope(input) {
  const source = clone(assertPlainObject(input, 'Command envelope'))
  if (source.schema !== KJ_COMMAND_SCHEMA || Number(source.schemaVersion) !== KJ_COMMAND_SCHEMA_VERSION) {
    throw new KJValidationError(`Unsupported command protocol: ${source.schema ?? '<missing>'}@${source.schemaVersion ?? '<missing>'}`)
  }
  source.id = String(source.id ?? '').trim()
  source.command = String(source.command ?? '').trim().toUpperCase()
  source.documentId = String(source.documentId ?? '').trim()
  source.mode = String(source.mode ?? 'execute').trim().toLowerCase()
  if (!source.id) throw new KJValidationError('Command envelope id is required')
  if (!source.command) throw new KJValidationError('Command id is required')
  if (!source.documentId) throw new KJValidationError('Command documentId is required')
  if (!KJ_COMMAND_MODES.includes(source.mode)) throw new KJValidationError(`Unsupported command mode: ${source.mode}`)
  source.arguments = clone(source.arguments ?? {})
  assertPlainObject(source.arguments, 'Command arguments')
  if (source.expectedRevision != null) {
    source.expectedRevision = Number(source.expectedRevision)
    if (!Number.isInteger(source.expectedRevision) || source.expectedRevision < 0) throw new KJValidationError('expectedRevision must be a non-negative integer or null')
  } else source.expectedRevision = null
  source.origin = normalizeOrigin(source.origin)
  source.confirmation = normalizeConfirmation(source.confirmation, source.origin, source.mode)
  source.createdAt = String(source.createdAt ?? nowIso())
  if (!Number.isFinite(Date.parse(source.createdAt))) throw new KJValidationError('Command createdAt must be an ISO timestamp')
  return deepFreeze(source)
}

export function createCommandEnvelope(command, args = {}, options = {}) {
  const origin = normalizeOrigin(options.origin)
  const mode = String(options.mode ?? 'execute').toLowerCase()
  return validateCommandEnvelope({
    schema: KJ_COMMAND_SCHEMA,
    schemaVersion: KJ_COMMAND_SCHEMA_VERSION,
    id: options.id ?? createId('command'),
    command,
    documentId: options.documentId,
    expectedRevision: options.expectedRevision ?? null,
    mode,
    arguments: args,
    origin,
    confirmation: options.confirmation,
    createdAt: options.createdAt ?? nowIso(options.clock),
    metadata: clone(options.metadata ?? {}),
  })
}

export function createCommandReceipt(envelope, { status, beforeRevision, afterRevision, result = null } = {}) {
  return deepFreeze({
    schema: 'com.kanjie.kjdraw.command-receipt',
    schemaVersion: 1,
    commandEnvelopeId: envelope.id,
    command: envelope.command,
    documentId: envelope.documentId,
    status: String(status),
    beforeRevision: Number(beforeRevision),
    afterRevision: Number(afterRevision),
    result: clone(result),
  })
}
