// Generated from plugin-contract.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJRegistrationError, KJValidationError } from './errors.js';
import { assertPlainObject, clone, deepFreeze } from './utils.js';
export const KJDRAW_PLUGIN_SCHEMA = 'com.kanjie.kjdraw.plugin';
export const KJDRAW_PLUGIN_SCHEMA_VERSION = 1;
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
    'symbols.register'
]);
const CONTRIBUTION_KINDS = Object.freeze([
    'commands',
    'extensions',
    'fileAdapters',
    'algorithms',
    'keymaps',
    'workspaces',
    'sceneSources',
    'ribbons',
    'panels',
    'symbols'
]);
function parseVersion(value, label) {
    const match = String(value ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
        throw new KJValidationError(`${label} must be a semantic version`);
    }
    return Object.freeze({
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ?? null
    });
}
function compareVersion(left, right) {
    if (left.major !== right.major) return left.major < right.major ? -1 : 1;
    if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
    if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
    if (left.prerelease === right.prerelease) return 0;
    if (left.prerelease == null) return 1;
    if (right.prerelease == null) return -1;
    return left.prerelease.localeCompare(right.prerelease);
}
function testComparator(version, comparator) {
    const match = comparator.match(/^(\^|>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/);
    if (!match || match[2] === undefined) throw new KJValidationError(`Unsupported semantic-version comparator: ${comparator}`);
    const operator = match[1] || '=';
    const target = parseVersion(match[2], 'Compatibility version');
    const comparison = compareVersion(version, target);
    if (operator === '=') return comparison === 0;
    if (operator === '>=') return comparison >= 0;
    if (operator === '<=') return comparison <= 0;
    if (operator === '>') return comparison > 0;
    if (operator === '<') return comparison < 0;
    const upper = target.major > 0 ? {
        ...target,
        major: target.major + 1,
        minor: 0,
        patch: 0,
        prerelease: null
    } : {
        ...target,
        minor: target.minor + 1,
        patch: 0,
        prerelease: null
    };
    return comparison >= 0 && compareVersion(version, upper) < 0;
}
export function satisfiesVersion(version, range = '*') {
    const parsed = parseVersion(version, 'Runtime version');
    const normalized = String(range ?? '*').trim();
    if (!normalized || normalized === '*') return true;
    return normalized.split(/\s+/).every((comparator)=>testComparator(parsed, comparator));
}
function normalizeIds(value, kind) {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new KJValidationError(`Plugin contributes.${kind} must be an array`);
    const ids = value.map((id)=>String(id ?? '').trim());
    if (ids.some((id)=>!id)) throw new KJValidationError(`Plugin contributes.${kind} contains an empty id`);
    if (new Set(ids).size !== ids.length) throw new KJValidationError(`Plugin contributes.${kind} contains duplicate ids`);
    return ids;
}
function isPluginPermission(value) {
    return KJDRAW_PLUGIN_PERMISSIONS.includes(value);
}
function isContributionKind(value) {
    return CONTRIBUTION_KINDS.includes(value);
}
export function validatePluginManifest(input) {
    const source = clone(assertPlainObject(input, 'Plugin manifest'));
    if (source.schema !== KJDRAW_PLUGIN_SCHEMA || Number(source.schemaVersion) !== KJDRAW_PLUGIN_SCHEMA_VERSION) {
        throw new KJValidationError(`Unsupported KJDraw plugin schema: ${String(source.schema ?? '<missing>')}@${String(source.schemaVersion ?? '<missing>')}`);
    }
    const id = String(source.id ?? '').trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(id)) throw new KJValidationError('Plugin id must be a stable lowercase identifier');
    const name = String(source.name ?? id).trim();
    const version = String(source.version ?? '').trim();
    parseVersion(version, 'Plugin version');
    const compatibilitySource = clone(assertPlainObject(source.compatibility ?? {}, 'Plugin compatibility'));
    const compatibility = {
        ...compatibilitySource,
        sdk: String(compatibilitySource.sdk ?? '*').trim() || '*',
        kernel: String(compatibilitySource.kernel ?? '*').trim() || '*'
    };
    satisfiesVersion('0.0.0', compatibility.sdk);
    satisfiesVersion('0.0.0', compatibility.kernel);
    if (!Array.isArray(source.permissions)) throw new KJValidationError('Plugin permissions must be an array');
    const permissions = source.permissions.map((value)=>String(value ?? '').trim());
    if (new Set(permissions).size !== permissions.length) throw new KJValidationError('Plugin permissions contain duplicates');
    for (const permission of permissions){
        if (!isPluginPermission(permission)) throw new KJValidationError(`Unknown KJDraw plugin permission: ${permission}`);
    }
    const contributionsSource = clone(assertPlainObject(source.contributes ?? {}, 'Plugin contributions'));
    for (const kind of Object.keys(contributionsSource)){
        if (!isContributionKind(kind)) throw new KJValidationError(`Unknown plugin contribution kind: ${kind}`);
    }
    const contributes = Object.fromEntries(CONTRIBUTION_KINDS.map((kind)=>[
            kind,
            normalizeIds(contributionsSource[kind], kind)
        ]));
    return deepFreeze({
        ...source,
        schema: KJDRAW_PLUGIN_SCHEMA,
        schemaVersion: KJDRAW_PLUGIN_SCHEMA_VERSION,
        id,
        name,
        version,
        compatibility,
        permissions: permissions,
        contributes
    });
}
export function assertPluginCompatibility(manifestInput, { sdkVersion, kernelVersion } = {}) {
    const manifest = validatePluginManifest(manifestInput);
    if (sdkVersion && !satisfiesVersion(sdkVersion, manifest.compatibility.sdk)) {
        throw new KJRegistrationError(`Plugin ${manifest.id} requires SDK ${manifest.compatibility.sdk}; current ${sdkVersion}`);
    }
    if (kernelVersion && !satisfiesVersion(kernelVersion, manifest.compatibility.kernel)) {
        throw new KJRegistrationError(`Plugin ${manifest.id} requires kernel ${manifest.compatibility.kernel}; current ${kernelVersion}`);
    }
    return manifest;
}
export function createPluginGrant(manifestInput, grantedPermissions = []) {
    const manifest = validatePluginManifest(manifestInput);
    const granted = new Set(grantedPermissions.map((value)=>String(value)));
    for (const permission of granted){
        if (!isPluginPermission(permission)) throw new KJRegistrationError(`Unknown granted plugin permission: ${permission}`);
    }
    const missing = manifest.permissions.filter((permission)=>!granted.has(permission));
    if (missing.length) throw new KJRegistrationError(`Plugin ${manifest.id} is missing permission grants: ${missing.join(', ')}`);
    return Object.freeze({
        manifest,
        permissions: Object.freeze([
            ...manifest.permissions
        ])
    });
}
export function assertPluginPermission(grant, permission) {
    if (!grant?.permissions?.includes(permission)) {
        throw new KJRegistrationError(`Plugin ${grant?.manifest?.id ?? '<unknown>'} lacks permission ${permission}`);
    }
}
export function assertPluginContribution(manifest, kind, inputId) {
    const id = String(inputId ?? '').trim();
    const declared = manifest?.contributes?.[kind] ?? [];
    const matches = declared.some((pattern)=>pattern === id || pattern.endsWith('*') && id.startsWith(pattern.slice(0, -1)));
    if (!matches) throw new KJRegistrationError(`Plugin ${manifest?.id ?? '<unknown>'} did not declare ${kind}/${id}`);
    return id;
}
