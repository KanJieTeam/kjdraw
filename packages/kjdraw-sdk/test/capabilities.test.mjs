import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertCommandBindings,
  auditSDKReadiness,
  auditCommandBindings,
  createKJDrawSDK,
} from '../src/index.js'

test('capability manifest only advertises registered executable contracts', () => {
  const sdk = createKJDrawSDK({ version: 'test' })
  const manifest = sdk.capabilities()
  assert.equal(manifest.sdkVersion, 'test')
  assert.ok(manifest.commandIds.includes('CREATE'))
  assert.ok(manifest.commandIds.includes('MOVE'))
  assert.ok(manifest.entityTypes.includes('LWPOLYLINE'))
  assert.equal(manifest.commands.every(command => sdk.commands.resolve(command.id)), true)
  assert.deepEqual(manifest.commands.find(command => command.id === 'OFFSET').capabilities.supportedEntityTypes, ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC'])
  assert.deepEqual(manifest.commands.find(command => command.id === 'TRIM').capabilities.targetEntityTypes, ['LINE', 'ARC', 'CIRCLE', 'ELLIPSE', 'LWPOLYLINE', 'POLYLINE'])
  assert.deepEqual(manifest.commands.find(command => command.id === 'EXTEND').capabilities.targetEntityTypes, ['LINE', 'ARC', 'LWPOLYLINE', 'POLYLINE'])
  for (const id of ['TRIM', 'EXTEND']) {
    assert.deepEqual(manifest.commands.find(command => command.id === id).capabilities.boundaryEntityTypes, ['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC'])
  }
})

test('1.0 readiness gate matches the scoped formats and reports missing native geometry', () => {
  const sdk = createKJDrawSDK()
  const audit = auditSDKReadiness(sdk)
  assert.equal(audit.passed, false)
  assert.equal(audit.findings.some(row => row.code === 'COMMAND_MISSING'), false)
  assert.equal(audit.findings.some(row => row.code === 'FORMAT_VERSION_MISSING'), false)
  assert.ok(audit.findings.some(row => row.code === 'AUTHORITATIVE_GEOMETRY_UNAVAILABLE'))
})

test('studio command audit rejects undeclared and missing SDK implementations', () => {
  const sdk = createKJDrawSDK()
  const valid = [{ id: 'draw.line', binding: { kind: 'sdk', command: 'CREATE', action: 'drawLine' } }]
  assert.equal(assertCommandBindings(sdk, valid).passed, true)
  const audit = auditCommandBindings(sdk, [
    { id: 'fake.button' },
    { id: 'edit.magic', binding: { kind: 'sdk', command: 'MAGIC', action: 'magic' } },
  ])
  assert.equal(audit.passed, false)
  assert.deepEqual(audit.findings.map(row => row.code), ['binding-missing', 'sdk-command-missing'])
})
