export const KJDRAW_HOTKEY_SETTINGS_VERSION = 1
export const KJDRAW_HOTKEY_STORAGE_KEY = `kjdraw.hotkeys.v${KJDRAW_HOTKEY_SETTINGS_VERSION}`

const DEFINITIONS = [
  ['LINE', 'Line', '直线', ['LINE', 'L']],
  ['PLINE', 'Polyline', '多段线', ['PLINE', 'PL']],
  ['CIRCLE', 'Circle', '圆', ['CIRCLE', 'C']],
  ['ARC', 'Arc', '圆弧', ['ARC', 'A']],
  ['RECTANGLE', 'Rectangle', '矩形', ['RECTANGLE', 'REC']],
  ['HATCH', 'Hatch', '填充', ['HATCH', 'H']],
  ['DIMALIGNED', 'Aligned dimension', '对齐标注', ['DIMALIGNED', 'DAL']],
  ['MOVE', 'Move', '移动', ['MOVE', 'M']],
  ['COPY', 'Copy', '复制', ['COPY', 'CO']],
  ['ROTATE', 'Rotate', '旋转', ['ROTATE', 'RO']],
  ['OFFSET', 'Offset', '偏移', ['OFFSET', 'O']],
  ['TRIM', 'Trim', '修剪', ['TRIM', 'TR']],
  ['FILLET', 'Fillet', '圆角', ['FILLET', 'F']],
  ['UNDO', 'Undo', '撤销', ['UNDO', 'U']],
  ['REDO', 'Redo', '重做', ['REDO']],
  ['PAGESETUP', 'Page setup', '页面设置', ['PAGESETUP']],
  ['PRINT', 'Print / PDF', '打印 / PDF', ['PRINT']],
]

export const KJDRAW_HOTKEY_DEFINITIONS = Object.freeze(DEFINITIONS.map(([command, en, zh, shortcuts]) => Object.freeze({
  command,
  label: Object.freeze({ en, zh }),
  shortcuts: Object.freeze([...shortcuts]),
})))
export const KJDRAW_ALLOWED_HOTKEY_COMMANDS = Object.freeze(KJDRAW_HOTKEY_DEFINITIONS.map(item => item.command))

const allowed = new Set(KJDRAW_ALLOWED_HOTKEY_COMMANDS)
const labels = new Map(KJDRAW_HOTKEY_DEFINITIONS.map(item => [item.command, item.label]))
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const copy = settings => ({
  version: KJDRAW_HOTKEY_SETTINGS_VERSION,
  bindings: Object.fromEntries(KJDRAW_ALLOWED_HOTKEY_COMMANDS.map(command => [command, [...settings.bindings[command]]])),
})
const defaults = () => ({
  version: KJDRAW_HOTKEY_SETTINGS_VERSION,
  bindings: Object.fromEntries(KJDRAW_HOTKEY_DEFINITIONS.map(item => [item.command, [...item.shortcuts]])),
})
const browserStorage = () => { try { return globalThis.localStorage ?? null } catch { return null } }

export const KJDRAW_DEFAULT_HOTKEY_SETTINGS = (() => {
  const settings = defaults()
  for (const shortcuts of Object.values(settings.bindings)) Object.freeze(shortcuts)
  return Object.freeze({ version: settings.version, bindings: Object.freeze(settings.bindings) })
})()

export function normalizeHotkey(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^[A-Z][A-Z0-9]{0,31}$/.test(normalized) ? normalized : null
}

export function createDefaultHotkeySettings() {
  return defaults()
}

export function validateHotkeySettings(settings) {
  const errors = [], conflicts = []
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) errors.push({ code: 'invalid-settings', message: 'Hotkey settings must be an object.' })
  if (settings?.version !== KJDRAW_HOTKEY_SETTINGS_VERSION) errors.push({ code: 'unsupported-version', message: `Hotkey settings version must be ${KJDRAW_HOTKEY_SETTINGS_VERSION}.` })
  const bindings = settings?.bindings
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) errors.push({ code: 'invalid-bindings', message: 'Hotkey bindings must be an object.' })
  const normalized = { version: KJDRAW_HOTKEY_SETTINGS_VERSION, bindings: {} }
  const claims = new Map()
  if (bindings && typeof bindings === 'object' && !Array.isArray(bindings)) {
    for (const command of Object.keys(bindings)) if (!allowed.has(command)) errors.push({ code: 'unknown-command', command, message: `Command ${command} is not allowed.` })
    for (const command of KJDRAW_ALLOWED_HOTKEY_COMMANDS) {
      if (!own(bindings, command)) { errors.push({ code: 'missing-command', command, message: `Command ${command} is missing.` }); continue }
      const source = bindings[command]
      if (!Array.isArray(source)) { errors.push({ code: 'invalid-shortcuts', command, message: `Shortcuts for ${command} must be an array.` }); continue }
      if (source.length > 8) errors.push({ code: 'too-many-shortcuts', command, message: `Command ${command} has more than 8 shortcuts.` })
      const shortcuts = [], seen = new Set()
      for (const value of source) {
        const shortcut = normalizeHotkey(value)
        if (!shortcut) { errors.push({ code: 'invalid-shortcut', command, shortcut: value, message: `Shortcut for ${command} must contain letters and numbers only.` }); continue }
        if (seen.has(shortcut)) { errors.push({ code: 'duplicate-shortcut', command, shortcut, message: `Shortcut ${shortcut} is duplicated for ${command}.` }); continue }
        seen.add(shortcut); shortcuts.push(shortcut)
        if (!claims.has(shortcut)) claims.set(shortcut, [])
        claims.get(shortcut).push(command)
      }
      normalized.bindings[command] = shortcuts
    }
  }
  for (const [shortcut, commands] of claims) if (commands.length > 1) conflicts.push({ shortcut, commands: [...commands] })
  return { ok: errors.length === 0 && conflicts.length === 0, errors, conflicts, ...(errors.length === 0 && conflicts.length === 0 ? { value: normalized } : {}) }
}

export class HotkeySettingsValidationError extends Error {
  constructor(validation) {
    const conflict = validation.conflicts[0], issue = validation.errors[0]
    super(conflict ? `Shortcut ${conflict.shortcut} is assigned to ${conflict.commands.join(' and ')}.` : issue?.message ?? 'Invalid hotkey settings.')
    this.name = 'HotkeySettingsValidationError'
    this.validation = validation
  }
}

function validOrThrow(settings) {
  const validation = validateHotkeySettings(settings)
  if (!validation.ok) throw new HotkeySettingsValidationError(validation)
  return validation.value
}

export function setHotkeyBinding(settings, command, shortcuts) {
  const current = validOrThrow(settings), canonical = typeof command === 'string' ? command.trim().toUpperCase() : ''
  if (!allowed.has(canonical)) throw new HotkeySettingsValidationError({ errors: [{ code: 'unknown-command', command, message: `Command ${command} is not allowed.` }], conflicts: [] })
  const candidate = copy(current)
  candidate.bindings[canonical] = Array.isArray(shortcuts) ? [...shortcuts] : [shortcuts]
  return validOrThrow(candidate)
}

export function resolveHotkey(input, settings = KJDRAW_DEFAULT_HOTKEY_SETTINGS) {
  const shortcut = normalizeHotkey(input)
  if (!shortcut) return null
  const validation = validateHotkeySettings(settings)
  if (!validation.ok) return null
  for (const command of KJDRAW_ALLOWED_HOTKEY_COMMANDS) if (validation.value.bindings[command].includes(shortcut)) return command
  return null
}

export function searchHotkeySettings(query, settings = KJDRAW_DEFAULT_HOTKEY_SETTINGS, locale = 'en') {
  const validation = validateHotkeySettings(settings), source = validation.ok ? validation.value : KJDRAW_DEFAULT_HOTKEY_SETTINGS
  const needle = String(query ?? '').trim().toLocaleLowerCase()
  const language = String(locale).toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return KJDRAW_ALLOWED_HOTKEY_COMMANDS.flatMap(command => {
    const shortcuts = source.bindings[command], label = labels.get(command)
    const haystack = [command, ...shortcuts, label.en, label.zh].join(' ').toLocaleLowerCase()
    return !needle || haystack.includes(needle) ? [{ command, label: label[language], shortcuts: [...shortcuts] }] : []
  })
}

export function loadHotkeySettings(storage = browserStorage(), key = KJDRAW_HOTKEY_STORAGE_KEY) {
  try {
    const raw = storage?.getItem(key)
    if (!raw) return createDefaultHotkeySettings()
    const validation = validateHotkeySettings(JSON.parse(raw))
    return validation.ok ? validation.value : createDefaultHotkeySettings()
  } catch { return createDefaultHotkeySettings() }
}

export function saveHotkeySettings(settings, storage = browserStorage(), key = KJDRAW_HOTKEY_STORAGE_KEY) {
  const validation = validateHotkeySettings(settings)
  if (!validation.ok) return validation
  try {
    if (!storage?.setItem) throw new Error('Storage is unavailable.')
    storage.setItem(key, JSON.stringify(validation.value))
    return { ...validation, stored: true }
  } catch (error) {
    return { ok: false, errors: [{ code: 'storage-unavailable', message: error?.message ?? 'Storage is unavailable.' }], conflicts: [] }
  }
}

export function restoreDefaultHotkeySettings(storage = browserStorage(), key = KJDRAW_HOTKEY_STORAGE_KEY) {
  try { storage?.removeItem(key) } catch {}
  return createDefaultHotkeySettings()
}
