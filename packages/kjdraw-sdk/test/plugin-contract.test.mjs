import assert from 'node:assert/strict'
import test from 'node:test'

import {
  KJRegistrationError,
  createKJDrawSDK,
  createPluginGrant,
  satisfiesVersion,
  validatePluginManifest,
} from '../src/index.js'

const manifest = (patch = {}) => ({
  schema: 'com.kanjie.kjdraw.plugin',
  schemaVersion: 1,
  id: 'test.public-plugin',
  name: 'Public plugin',
  version: '1.2.3',
  compatibility: { sdk: '^0.2.0', kernel: '>=1.0.0 <2.0.0' },
  permissions: ['commands.register'],
  contributes: { commands: ['TEST.*'] },
  ...patch,
})

test('plugin manifest validation locks schema, semantic compatibility and known permissions', () => {
  const value = validatePluginManifest(manifest())
  assert.equal(value.id, 'test.public-plugin')
  assert.equal(satisfiesVersion('0.2.8', value.compatibility.sdk), true)
  assert.equal(satisfiesVersion('0.3.0', value.compatibility.sdk), false)
  assert.equal(satisfiesVersion('1.9.9', value.compatibility.kernel), true)
  assert.throws(() => validatePluginManifest(manifest({ permissions: ['filesystem.unrestricted'] })), /Unknown KJDraw plugin permission/)
})

test('plugin scopes require explicit grants and declared contributions', () => {
  const sdk = createKJDrawSDK()
  assert.throws(() => createPluginGrant(manifest(), []), KJRegistrationError)
  const scope = sdk.createPluginScope(manifest(), { grantedPermissions: ['commands.register'] })
  scope.registerCommand({ id: 'TEST.RUN', transactional: false, execute: () => 7 })
  assert.equal(sdk.commands.resolve('TEST.RUN').execute(), 7)
  assert.throws(() => scope.registerCommand({ id: 'UNDECLARED', transactional: false, execute: () => 0 }), /did not declare/)
  assert.throws(() => scope.executeCommand('TEST.RUN'), /lacks permission commands.execute/)
  scope.dispose()
  assert.equal(sdk.commands.resolve('TEST.RUN'), null)
})

test('plugin compatibility refuses activation outside the SDK range', () => {
  const sdk = createKJDrawSDK({ version: '1.0.0' })
  assert.throws(() => sdk.createPluginScope(manifest(), { grantedPermissions: ['commands.register'] }), /requires SDK/)
})
