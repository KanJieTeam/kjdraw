import { KJRegistrationError, KJValidationError } from './errors.js'
import { assertPlainObject, clone, deepFreeze } from './utils.js'

export const KJDRAW_PLUGIN_SCHEMA = 'com.kanjie.kjdraw.plugin'
export const KJDRAW_PLUGIN_SCHEMA_VERSION = 1

export const KJDRAW_PLUGIN_PERMISSIONS = Object.freeze([
  'commands.register',
  'commands.execute',
  'extensions.register',
  'file-adapters.register',
  'algorithms.register',
  'keymaps.register',
  'workspaces.register',
  'scene-sources.register',
  'ribbons.register',
  'panels.register',
  'symbols.register',
])

const CONTRIBUTION_KINDS = Object.freeze([
  'commands', 'extensions', 'fileAdapters', 'algorithms', 'keymaps',
  'workspaces', 'sceneSources', 'ribbons', 'panels', 'symbols',
])

function parseVersion(value, label) {
  const match = String(value ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) throw new KJValidationError(`${label} must be a semantic version`)
  return Object.freeze({ major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null })
}

function compareVersion(left, right) {
  for (const key of ['major', 'minor', 'patch']) if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  if (left.prerelease === right.prerelease) return 0
  if (left.prerelease == null) return 1
  if (right.prerelease == null) return -1
  return left.prerelease.localeCompare(right.prerelease)
}

function testComparator(version, comparator) {
  const match = comparator.match(/^(\^|>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/)
  if (!match) throw new KJValidationError(`Unsupported semantic-version comparator: ${comparator}`)
  const operator = match[1] || '=', target = parseVersion(match[2], 'Compatibility version'), comparison = compareVersion(version, target)
  if (operator === '=') return comparison === 0
  if (operator === '>=') return comparison >= 0
  if (operator === '<=') return comparison <= 0
  if (operator === '>') return comparison > 0
  if (operator === '<') return comparison < 0
  const upper = target.major > 0
    ? { ...target, major: target.major + 1, minor: 0, patch: 0, prerelease: null }
    : { ...target, minor: target.minor + 1, patch: 0, prerelease: null }
  return comparison >= 0 && compareVersion(version, upper) < 0
}

export function satisfiesVersion(version, range = '*') {
  const parsed = parseVersion(version, 'Runtime version')
  const normalized = String(range ?? '*').trim()
  if (!normalized || normalized === '*') return true
  return normalized.split(/\s+/).every(comparator => testComparator(parsed, comparator))
}

function normalizeIds(value, kind) {
  if (value == null) return []
  if (!Array.isArray(value)) throw new KJValidationError(`Plugin contributes.${kind} must be an array`)
  const ids = value.map(id => String(id ?? '').trim())
  if (ids.some(id => !id)) throw new KJValidationError(`Plugin contributes.${kind} contains an empty id`)
  if (new Set(ids).size !== ids.length) throw new KJValidationError(`Plugin contributes.${kind} contains duplicate ids`)
  return ids
}

export function validatePluginManifest(input) {
  const source = clone(assertPlainObject(input, 'Plugin manifest'))
  if (source.schema !== KJDRAW_PLUGIN_SCHEMA || Number(source.schemaVersion) !== KJDRAW_PLUGIN_SCHEMA_VERSION) {
    throw new KJValidationError(`Unsupported KJDraw plugin schema: ${source.schema ?? '<missing>'}@${source.schemaVersion ?? '<missing>'}`)
  }
  source.id = String(source.id ?? '').trim().toLowerCase()
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(source.id)) throw new KJValidationError('Plugin id must be a stable lowercase identifier')
  source.name = String(source.name ?? source.id).trim()
  source.version = String(source.version ?? '').trim()
  parseVersion(source.version, 'Plugin version')
  source.compatibility = clone(assertPlainObject(source.compatibility ?? {}, 'Plugin compatibility'))
  source.compatibility.sdk = String(source.compatibility.sdk ?? '*').trim() || '*'
  source.compatibility.kernel = String(source.compatibility.kernel ?? '*').trim() || '*'
  // Parse ranges during inspection so an invalid manifest never reaches activation.
  satisfiesVersion('0.0.0', source.compatibility.sdk)
  satisfiesVersion('0.0.0', source.compatibility.kernel)
  if (!Array.isArray(source.permissions)) throw new KJValidationError('Plugin permissions must be an array')
  source.permissions = source.permissions.map(value => String(value ?? '').trim())
  if (new Set(source.permissions).size !== source.permissions.length) throw new KJValidationError('Plugin permissions contain duplicates')
  for (const permission of source.permissions) if (!KJDRAW_PLUGIN_PERMISSIONS.includes(permission)) {
    throw new KJValidationError(`Unknown KJDraw plugin permission: ${permission}`)
  }
  const contributions = clone(assertPlainObject(source.contributes ?? {}, 'Plugin contributions'))
  for (const kind of Object.keys(contributions)) if (!CONTRIBUTION_KINDS.includes(kind)) throw new KJValidationError(`Unknown plugin contribution kind: ${kind}`)
  source.contributes = Object.fromEntries(CONTRIBUTION_KINDS.map(kind => [kind, normalizeIds(contributions[kind], kind)]))
  return deepFreeze(source)
}

export function assertPluginCompatibility(manifestInput, { sdkVersion, kernelVersion } = {}) {
  const manifest = validatePluginManifest(manifestInput)
  if (sdkVersion && !satisfiesVersion(sdkVersion, manifest.compatibility.sdk)) {
    throw new KJRegistrationError(`Plugin ${manifest.id} requires SDK ${manifest.compatibility.sdk}; current ${sdkVersion}`)
  }
  if (kernelVersion && !satisfiesVersion(kernelVersion, manifest.compatibility.kernel)) {
    throw new KJRegistrationError(`Plugin ${manifest.id} requires kernel ${manifest.compatibility.kernel}; current ${kernelVersion}`)
  }
  return manifest
}

export function createPluginGrant(manifestInput, grantedPermissions = []) {
  const manifest = validatePluginManifest(manifestInput)
  const granted = new Set((grantedPermissions ?? []).map(value => String(value)))
  for (const permission of granted) if (!KJDRAW_PLUGIN_PERMISSIONS.includes(permission)) throw new KJRegistrationError(`Unknown granted plugin permission: ${permission}`)
  const missing = manifest.permissions.filter(permission => !granted.has(permission))
  if (missing.length) throw new KJRegistrationError(`Plugin ${manifest.id} is missing permission grants: ${missing.join(', ')}`)
  return Object.freeze({ manifest, permissions: Object.freeze([...manifest.permissions]) })
}

export function assertPluginPermission(grant, permission) {
  if (!grant?.permissions?.includes(permission)) throw new KJRegistrationError(`Plugin ${grant?.manifest?.id ?? '<unknown>'} lacks permission ${permission}`)
}

export function assertPluginContribution(manifest, kind, id) {
  id = String(id ?? '').trim()
  const declared = manifest?.contributes?.[kind] ?? []
  const matches = declared.some(pattern => pattern === id || (pattern.endsWith('*') && id.startsWith(pattern.slice(0, -1))))
  if (!matches) throw new KJRegistrationError(`Plugin ${manifest?.id ?? '<unknown>'} did not declare ${kind}/${id}`)
  return id
}
