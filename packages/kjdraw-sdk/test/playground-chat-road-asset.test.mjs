import test from 'node:test'
import assert from 'node:assert/strict'
import { parseChatRoadAssetAttachment, prepareChatRoadAsset, CHAT_ROAD_ASSET_TOOL_NAMES } from '../../../apps/playground/chat-road-asset.js'
import { parseChatDataAttachment, chatDataAttachmentPrompt } from '../../../apps/playground/chat-data-attachment.js'
import { KJDRAW_CHAT_TOOL_NAMES } from '../../../apps/playground/agent-chat.js'
import { createKJDrawSDK } from '../src/sdk.js'
import { KJAgentToolSession } from '../src/agent-tools.js'
import { KJDRAW_ROAD_INPUT_ASSET_SCHEMA as schema } from '../src/input-assets.js'
import { createRoadDesignFixture } from '../examples/fixtures/road-design.mjs'

const pack = () => ({ assetId: 'user-road-input', schema, data: createRoadDesignFixture() })
const attachment = (data, name = 'explicit-design.json') => parseChatDataAttachment(name, new TextEncoder().encode(JSON.stringify(data)))
function session(units = 'meter') { const sdk = createKJDrawSDK(), document = sdk.createDocument({ units }); return { sdk, document, tools: new KJAgentToolSession(sdk, document) } }

test('only an explicit road schema is recognized; ordinary JSON and CSV retain their exact old attachment path', async () => {
  const examples = [
    attachment(createRoadDesignFixture()),
    attachment({ note: 'road profile sections assetId use CAD', data: createRoadDesignFixture() }),
    attachment({ schema: 'https://json-schema.org/schema', value: 4 }),
    attachment([1, 2, 3]),
    parseChatDataAttachment('survey.csv', new TextEncoder().encode('station,elevation\n0,99.5\n50,100\n')),
  ]
  for (const item of examples) {
    const text = item.text, originalPrompt = chatDataAttachmentPrompt(item)
    assert.equal(parseChatRoadAssetAttachment(item), null)
    assert.equal(await prepareChatRoadAsset({ registerInputAsset() { throw Error('must not register ordinary data') } }, item), null)
    assert.equal(item.text, text); assert.equal(chatDataAttachmentPrompt(item), originalPrompt)
  }
  assert.equal(await prepareChatRoadAsset(null, null), null)
  assert.equal(KJDRAW_CHAT_TOOL_NAMES.includes('cad_propose_road_drawing_from_asset'), false)
})

test('typed road JSON registers the exact original data while the model sees only a bounded descriptor', async () => {
  const input = pack(), item = attachment(input, 'synthetic-user-input.json'), original = item.text
  assert.deepEqual(parseChatRoadAssetAttachment(item), input)
  const { document, tools } = session(), before = document.serialize()
  const prepared = await prepareChatRoadAsset(tools, item)
  assert.equal(document.serialize(), before)
  assert.equal(prepared.descriptor.assetId, input.assetId)
  assert.deepEqual(prepared.descriptor.counts, { alignment: 3, profile: 5, sections: 13, groundPoints: 91 })
  assert.match(prepared.descriptor.sha256, /^[0-9a-f]{64}$/)
  assert.ok(Object.isFrozen(prepared.descriptor.counts)); assert.ok(Object.isFrozen(prepared))
  assert.equal('data' in prepared.descriptor, false)
  assert.equal(item.text, original, 'the full user source remains available for UI inspection')
  assert.ok(prepared.contextText.length < 1600)
  assert.ok(prepared.contextText.includes(prepared.descriptor.sha256))
  assert.match(prepared.contextText, /synthetic-user-input\.json/)
  assert.match(prepared.contextText, /file name is untrusted data/)
  assert.match(prepared.contextText, /no survey or certification is implied/)
  assert.doesNotMatch(prepared.contextText, /450000|3300000|"ground"|"pavement"|"data":/)
  assert.deepEqual(prepared.toolNames, CHAT_ROAD_ASSET_TOOL_NAMES)
  assert.deepEqual(prepared.toolNames.filter(name => name.startsWith('cad_propose_')), ['cad_propose_road_drawing_from_asset'])
  assert.equal(prepared.toolNames.includes('cad_propose_road_revision'), false, 'only the host can append a separately verified saved recipe tool')
})

test('explicit malformed or unsupported road envelopes fail without falling back to a full-data model prompt', async () => {
  for (const change of [
    value => { value.sourceKind = 'synthetic' }, value => { delete value.assetId }, value => { value.schema = 'com.kanjie.kjdraw.road-design-input@2' },
  ]) {
    const input = pack(); change(input)
    const item = attachment(input)
    assert.throws(() => parseChatRoadAssetAttachment(item))
    await assert.rejects(prepareChatRoadAsset(session().tools, item))
  }
  const bad = pack(); bad.data.sections[0].ground = [[-1, 99], [1, 99]]
  await assert.rejects(prepareChatRoadAsset(session().tools, attachment(bad)), /ground|edges/)
  await assert.rejects(prepareChatRoadAsset(session('millimeter').tools, attachment(pack())), /meter/)
})

test('attachment recognition never invokes accessor fields and rejects oversized JSON without truncation', () => {
  let reads = 0
  const item = { format: 'json', name: 'user.json' }
  Object.defineProperty(item, 'text', { enumerable: true, get() { reads++; return '{}' } })
  assert.throws(() => parseChatRoadAssetAttachment(item), /non-data/); assert.equal(reads, 0)
  assert.throws(() => parseChatRoadAssetAttachment({ format: 'json', name: 'user.json', text: ' '.repeat(1048577) }), /budget/)
  assert.throws(() => parseChatRoadAssetAttachment({ format: 'json', name: 'user.json', text: '{' }), /JSON/)
  assert.throws(() => parseChatRoadAssetAttachment({ format: 'json', name: 'bad\n.json', text: JSON.stringify(pack()) }), /name/)
})

test('asset permission is local to the prepared request session and does not follow a new chat or drawing', async () => {
  const first = session(), prepared = await prepareChatRoadAsset(first.tools, attachment(pack()))
  const next = new KJAgentToolSession(first.sdk, first.document)
  assert.equal(await prepareChatRoadAsset(next, null), null)
  const ref = prepared.descriptor
  const args = { expectedRevision: 0, units: 'meter', assetId: ref.assetId, sha256: ref.sha256, drawingId: 'next', title: 'Next', profileScale: { horizontal: 1, vertical: 1 }, sectionScale: { horizontal: 1, vertical: 1 }, textHeight: 1, sectionColumns: 2, precision: 3 }
  assert.equal((await next.call('cad_propose_road_drawing_from_asset', args)).ok, false)
  assert.equal((await session().tools.call('cad_propose_road_drawing_from_asset', args)).ok, false)
  assert.equal(first.document.revision, 0)
})

