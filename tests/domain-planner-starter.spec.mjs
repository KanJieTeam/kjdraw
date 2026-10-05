import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createKJDrawSDK, validatePluginManifest } from '../packages/kjdraw-sdk/src/index.js'
import { planBoltCircle } from '../examples/domain-planner-starter/planner.mjs'
import { activateBoltCirclePlanner } from '../examples/domain-planner-starter/plugin.mjs'

const facts = { center: [0, 0], pitchDiameter: 90, holeDiameter: 10, count: 6 }

test('domain planner rejects missing, overlapping and excessive facts before CAD mutation', () => {
  assert.throws(() => planBoltCircle({ ...facts, count: 25 }), /3 to 24/u)
  assert.throws(() => planBoltCircle({ ...facts, holeDiameter: 50 }), /overlap/u)
  assert.throws(() => planBoltCircle({ ...facts, center: [0, Number.NaN] }), /finite/u)
})

test('external-style domain command is one transaction and reopens in KJD and DXF', async () => {
  const source = await readFile(
    new URL('../examples/domain-planner-starter/kjdraw.plugin.json', import.meta.url),
  )
  const manifest = validatePluginManifest(JSON.parse(source))
  const sdk = createKJDrawSDK({ version: '1.0.0' })
  const document = sdk.createDocument({ documentId: 'bolt-circle-starter' })
  const scope = activateBoltCirclePlanner(sdk, manifest)
  const created = await sdk.executeCommand('COMMUNITY_BOLT_CIRCLE', facts, { expectedRevision: 0 })
  assert.equal(created.length, 6)
  assert.equal(document.revision, 1)
  assert.equal(document.listEntities().length, 6)
  assert.equal(await document.undo(), true)
  assert.equal(document.listEntities().length, 0)
  assert.equal(await document.redo(), true)
  assert.equal(document.listEntities().length, 6)
  for (const format of ['KJD', 'DXF']) {
    const file = await sdk.writeDocument(document, { format })
    const reopened = await createKJDrawSDK().readDocument(file, { format })
    assert.equal(reopened.listEntities().filter((entity) => entity.type === 'CIRCLE').length, 6)
  }
  scope.dispose()
  assert.equal(sdk.commands.resolve('COMMUNITY_BOLT_CIRCLE'), null)
})
