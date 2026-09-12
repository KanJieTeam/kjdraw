import { getGeometryBackendStatus } from './geometry/index.js'
import { listStandardEntityTypes } from './standard-entities.js'
import { KJValidationError } from './errors.js'
import type { KJFileAdapterCapability } from './file-adapters.js'

export interface KJCapabilityCommand {
  id: string
  title?: string
  aliases?: readonly string[]
  transactional?: boolean
  owner?: string
  capabilities?: Record<string, unknown>
}

export interface KJCapabilitySDK {
  version: unknown
  activeDocument?: { schemaVersion?: number } | null
  commands: {
    list(): readonly KJCapabilityCommand[]
    resolve(id: unknown): unknown
  }
  fileAdapters: {
    capabilityMatrix(): KJFileAdapterCapability[]
  }
}

export interface KJFormatReadinessRequirement {
  format: string
  operation: 'read' | 'write'
  versions: readonly string[]
  certification?: string
}

export interface KJSDKReadinessProfile {
  id: string
  requiredCommands?: readonly string[]
  requiredEntityTypes?: readonly string[]
  requiredFormats?: readonly KJFormatReadinessRequirement[]
  authoritativeGeometry?: boolean
}

export interface KJReadinessFinding {
  severity: 'error'
  code: 'COMMAND_MISSING' | 'ENTITY_TYPE_MISSING' | 'FORMAT_VERSION_MISSING' | 'AUTHORITATIVE_GEOMETRY_UNAVAILABLE'
  capability: string
  versions?: readonly string[]
}

export interface KJCommandBinding {
  id?: unknown
  binding?: {
    kind?: unknown
    command?: unknown
    action?: unknown
  } | null
}

export interface KJCommandBindingFinding {
  id: string | null
  code: 'command-id-missing' | 'binding-missing' | 'sdk-command-missing' | 'host-action-missing'
  message: string
}

function commandDescriptor(command: KJCapabilityCommand) {
  return Object.freeze({
    id: command.id,
    title: command.title,
    aliases: Object.freeze([...(command.aliases ?? [])]),
    transactional: command.transactional !== false,
    owner: command.owner,
    capabilities: Object.freeze(structuredClone(command.capabilities ?? {})),
  })
}

export const KJDRAW_1_0_READINESS_PROFILE: Readonly<KJSDKReadinessProfile> = Object.freeze({
  id: 'kjdraw-sdk-1.0',
  requiredCommands: Object.freeze([
    'UNDO', 'REDO', 'SELECT', 'SELECTIONSAVE', 'SELECTIONRESTORE', 'CREATE', 'ERASE',
    'RESTORE', 'PROPERTIES', 'SETVAR', 'LAYERNEW', 'LAYERCURRENT', 'LAYERUPDATE',
    'LAYERDELETE', 'MOVE', 'ROTATE', 'SCALE', 'COPY', 'MIRROR', 'ARRAYRECT',
    'ARRAYPOLAR', 'OFFSET', 'BREAK', 'EXPLODE', 'TRIM', 'EXTEND', 'CHAMFER',
    'FILLET', 'GRIPEDIT', 'LENGTH', 'AREA', 'DISTANCE', 'ANGLE', 'INTERSECT',
    'NEAREST', 'ORTHO', 'SNAPSETTINGS', 'BLOCKCREATE', 'BLOCKINSERT',
    'BLOCKINSTANCEUPDATE', 'BLOCKDEFINITIONUPDATE', 'GROUP',
    'XREFATTACH', 'XREFRELOAD', 'XREFDETACH', 'HATCH', 'DIMSTYLE', 'TEXTSTYLE',
    'LINETYPE', 'LAYOUT', 'VIEWPORT', 'PLOTSETUP', 'PLOTSTYLE', 'UCS',
    'COMPARE', 'SEARCH',
    'SOLIDBOX', 'SOLIDCYLINDER', 'SOLIDCONE', 'SOLIDSPHERE', 'SOLIDSWEEP',
    'SOLIDLOFT', 'SOLIDTRANSFORM', 'SOLIDBOOLEAN', 'SOLIDVALIDATE', 'SOLIDVOLUME',
  ]),
  requiredEntityTypes: Object.freeze([
    'LINE', 'RAY', 'XLINE', 'POINT', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE',
    'SPLINE', 'ELLIPSE', 'TEXT', 'MTEXT', 'INSERT', 'IMAGE', 'HATCH', 'LEADER',
    'MLEADER', 'DIMENSION', 'VIEWPORT', 'PROXY_ENTITY',
    'SOLID3D',
  ]),
  requiredFormats: Object.freeze([
    { format: 'KJD', operation: 'read', versions: ['1'], certification: 'schema-roundtrip' },
    { format: 'KJD', operation: 'write', versions: ['1'], certification: 'schema-roundtrip' },
    { format: 'DXF', operation: 'read', versions: ['R14', '2000', '2004', '2010', '2013', '2018', '2024'], certification: 'cross-implementation-subset' },
    { format: 'DXF', operation: 'write', versions: ['R14', '2000', '2004', '2010', '2013', '2018', '2024'], certification: 'cross-implementation-subset' },
  ] satisfies KJFormatReadinessRequirement[]),
  authoritativeGeometry: true,
})

function formatSupport(adapters: readonly KJFileAdapterCapability[], requirement: KJFormatReadinessRequirement): string[] {
  const versions = new Set<string>()
  for (const adapter of adapters) {
    if (requirement.certification && adapter.capabilities?.certification !== requirement.certification) continue
    const descriptor = adapter.formats?.[requirement.format]
    for (const version of descriptor?.[requirement.operation] ?? []) versions.add(String(version))
  }
  return requirement.versions.filter(version => !versions.has('*') && !versions.has(String(version)))
}

/** Release gate used by CI and product surfaces. It reports gaps; it never upgrades
 * roadmap intentions into supported capabilities. */
export function auditSDKReadiness(
  sdk: KJCapabilitySDK,
  profile: KJSDKReadinessProfile = KJDRAW_1_0_READINESS_PROFILE,
) {
  const manifest = buildSDKCapabilityManifest(sdk)
  const findings: KJReadinessFinding[] = []
  for (const id of profile.requiredCommands ?? []) {
    if (!manifest.commandIds.includes(id)) findings.push({ severity: 'error', code: 'COMMAND_MISSING', capability: id })
  }
  const entityTypes = new Set<string>(manifest.entityTypes)
  for (const type of profile.requiredEntityTypes ?? []) {
    if (!entityTypes.has(type)) findings.push({ severity: 'error', code: 'ENTITY_TYPE_MISSING', capability: type })
  }
  for (const requirement of profile.requiredFormats ?? []) {
    const missing = formatSupport(manifest.fileAdapters, requirement)
    if (missing.length) findings.push({ severity: 'error', code: 'FORMAT_VERSION_MISSING', capability: `${requirement.format}.${requirement.operation}`, versions: missing })
  }
  if (profile.authoritativeGeometry && !manifest.geometry.authoritative) {
    findings.push({ severity: 'error', code: 'AUTHORITATIVE_GEOMETRY_UNAVAILABLE', capability: 'geometry' })
  }
  return Object.freeze({
    profileId: profile.id,
    passed: findings.length === 0,
    status: findings.length ? 'blocked' as const : 'passed' as const,
    findings: Object.freeze(findings),
    manifest,
  })
}

/**
 * Returns a machine-readable contract for hosts, plugin loaders and product QA.
 * The manifest only reports executable registrations; roadmap items never appear
 * as supported capabilities.
 */
export function buildSDKCapabilityManifest(sdk: KJCapabilitySDK) {
  if (!sdk?.commands || !sdk?.fileAdapters) throw new KJValidationError('A KJDrawSDK instance is required')
  const commands = sdk.commands.list().map(commandDescriptor).sort((left, right) => left.id.localeCompare(right.id))
  const adapters = sdk.fileAdapters.capabilityMatrix()
  return Object.freeze({
    product: 'KJDraw SDK',
    sdkVersion: String(sdk.version),
    documentSchemaVersion: sdk.activeDocument?.schemaVersion ?? 1,
    geometry: Object.freeze({ ...getGeometryBackendStatus() }),
    commands: Object.freeze(commands),
    commandIds: Object.freeze(commands.map(command => command.id)),
    entityTypes: listStandardEntityTypes(),
    fileAdapters: Object.freeze(adapters),
  })
}

/**
 * Product-shell gate: every visible command must declare whether it is backed by
 * the public SDK or is an explicit host-only operation. Missing SDK commands are
 * rejected during startup instead of becoming inert toolbar buttons.
 */
export function auditCommandBindings(sdk: KJCapabilitySDK, bindings: readonly KJCommandBinding[] = []) {
  if (!sdk?.commands) throw new KJValidationError('A KJDrawSDK instance is required')
  const findings: KJCommandBindingFinding[] = []
  for (const source of bindings ?? []) {
    const id = String(source?.id ?? '').trim()
    const binding = source?.binding
    if (!id) {
      findings.push({ id: null, code: 'command-id-missing', message: 'Studio command id is required' })
      continue
    }
    if (!binding || !['sdk', 'host'].includes(String(binding.kind))) {
      findings.push({ id, code: 'binding-missing', message: `${id} has no declared SDK or host binding` })
      continue
    }
    if (binding.kind === 'sdk' && !sdk.commands.resolve(binding.command)) {
      findings.push({ id, code: 'sdk-command-missing', message: `${id} requires unavailable SDK command ${String(binding.command)}` })
    }
    if (!String(binding.action ?? '').trim()) {
      findings.push({ id, code: 'host-action-missing', message: `${id} has no host interaction action` })
    }
  }
  return Object.freeze({ passed: findings.length === 0, findings: Object.freeze(findings) })
}

export function assertCommandBindings(sdk: KJCapabilitySDK, bindings: readonly KJCommandBinding[] = []) {
  const audit = auditCommandBindings(sdk, bindings)
  if (!audit.passed) throw new KJValidationError('KJDraw Studio command binding audit failed', { findings: audit.findings })
  return audit
}
