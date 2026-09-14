import assert from 'node:assert/strict'
import test from 'node:test'

import {
  KJDRAW_ALLOWED_HOTKEY_COMMANDS,
  KJDRAW_HOTKEY_SETTINGS_VERSION,
  KJDRAW_HOTKEY_STORAGE_KEY,
  createDefaultHotkeySettings,
  loadHotkeySettings,
  normalizeHotkey,
  resolveHotkey,
  restoreDefaultHotkeySettings,
  saveHotkeySettings,
  searchHotkeySettings,
  setHotkeyBinding,
  validateHotkeySettings,
} from '../../../apps/playground/hotkey-settings.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values,
  }
}

test('default hotkeys resolve case-insensitively to the fixed command allowlist', () => {
  const required = ['LINE','PLINE','CIRCLE','ARC','RECTANGLE','HATCH','DIMALIGNED','MOVE','COPY','ROTATE','OFFSET','TRIM','FILLET','UNDO','REDO','PAGESETUP','PRINT']
  assert.deepEqual(KJDRAW_ALLOWED_HOTKEY_COMMANDS, required)
  assert.equal(resolveHotkey(' l '), 'LINE')
  assert.equal(resolveHotkey('Pl'), 'PLINE')
  assert.equal(resolveHotkey('dal'), 'DIMALIGNED')
  assert.equal(resolveHotkey('pageSetup'), 'PAGESETUP')
  assert.equal(resolveHotkey('print'), 'PRINT')
  assert.equal(resolveHotkey('unknown'), null)
  assert.equal(normalizeHotkey('  ro  '), 'RO')
})

test('custom bindings validate, search and round-trip through versioned storage', () => {
  const storage = memoryStorage()
  let settings = createDefaultHotkeySettings()
  settings = setHotkeyBinding(settings, 'line', ['LINE', 'LN'])
  settings = setHotkeyBinding(settings, 'redo', ['REDO', 'RDO'])
  assert.equal(resolveHotkey('ln', settings), 'LINE')
  assert.deepEqual(searchHotkeySettings('ln', settings), [{ command: 'LINE', label: 'Line', shortcuts: ['LINE', 'LN'] }])
  assert.equal(searchHotkeySettings('页面', settings, 'zh-CN')[0].command, 'PAGESETUP')
  assert.deepEqual(saveHotkeySettings(settings, storage), { ok: true, errors: [], conflicts: [], value: settings, stored: true })
  assert.equal(JSON.parse(storage.values.get(KJDRAW_HOTKEY_STORAGE_KEY)).version, KJDRAW_HOTKEY_SETTINGS_VERSION)
  assert.deepEqual(loadHotkeySettings(storage), settings)
  assert.equal(resolveHotkey('rdo', loadHotkeySettings(storage)), 'REDO')
  assert.equal(resolveHotkey('l', loadHotkeySettings(storage)), null)
})

test('case-insensitive conflicts and unsafe shortcut text are rejected', () => {
  const defaults = createDefaultHotkeySettings()
  const conflicted = structuredClone(defaults)
  conflicted.bindings.COPY = ['copy', 'l']
  const conflict = validateHotkeySettings(conflicted)
  assert.equal(conflict.ok, false)
  assert.deepEqual(conflict.conflicts, [{ shortcut: 'L', commands: ['LINE', 'COPY'] }])
  assert.throws(() => setHotkeyBinding(defaults, 'COPY', ['CO', 'line']), /assigned to LINE and COPY/)
  assert.throws(() => setHotkeyBinding(defaults, 'LINE', ['LINE', 'alert(1)']), /letters and numbers only/)
  assert.equal(normalizeHotkey('MOVE 10 0'), null)
  assert.equal(resolveHotkey('javascript:alert(1)'), null)
  assert.equal(saveHotkeySettings(conflicted, memoryStorage()).ok, false)
})

test('unknown commands, hostile persisted data and unavailable storage safely use defaults', () => {
  const storage = memoryStorage(), hostile = createDefaultHotkeySettings()
  hostile.bindings['DO_SCRIPT'] = ['RUNME']
  storage.setItem(KJDRAW_HOTKEY_STORAGE_KEY, JSON.stringify(hostile))
  assert.equal(resolveHotkey('runme', loadHotkeySettings(storage)), null)
  assert.equal(resolveHotkey('l', loadHotkeySettings(storage)), 'LINE')
  assert.throws(() => setHotkeyBinding(createDefaultHotkeySettings(), 'DO_SCRIPT', ['RUNME']), /not allowed/)

  const throwing = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.equal(resolveHotkey('c', loadHotkeySettings(throwing)), 'CIRCLE')
  assert.equal(saveHotkeySettings(createDefaultHotkeySettings(), throwing).ok, false)
  assert.equal(resolveHotkey('u', restoreDefaultHotkeySettings(throwing)), 'UNDO')
})

test('restoring defaults removes persisted customization', () => {
  const storage = memoryStorage(), settings = setHotkeyBinding(createDefaultHotkeySettings(), 'LINE', ['LN'])
  assert.equal(saveHotkeySettings(settings, storage).ok, true)
  const restored = restoreDefaultHotkeySettings(storage)
  assert.equal(storage.getItem(KJDRAW_HOTKEY_STORAGE_KEY), null)
  assert.equal(resolveHotkey('l', restored), 'LINE')
  assert.equal(resolveHotkey('ln', restored), null)
})
