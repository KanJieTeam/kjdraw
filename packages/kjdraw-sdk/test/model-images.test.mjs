import test from 'node:test'
import assert from 'node:assert/strict'
import { createKJModelAdapter } from '../src/model-adapters.js'

// Real tiny raster files generated locally; no user drawing, network or model call is involved.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII='
const jpeg = '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z'
const dataUrl = `data:image/png;base64,${png}`
const protocols = ['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content']
const signal = () => new AbortController().signal
const user = (protocol, body) => protocol === 'responses' ? body.input[0] : protocol === 'gemini-generate-content' ? body.contents[0] : body.messages[protocol === 'chat-completions' ? 1 : 0]
function wire(protocol, call = false) {
  if (protocol === 'responses') return { status: 'completed', output: call ? [{ type: 'reasoning', encrypted_content: 'opaque' }, { type: 'function_call', call_id: 'read', name: 'cad_read_drawing', arguments: '{}' }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Received' }] }] }
  if (protocol === 'chat-completions') return { choices: [{ finish_reason: call ? 'tool_calls' : 'stop', message: { role: 'assistant', content: call ? null : 'Received', reasoning_content: 'opaque', ...(call ? { tool_calls: [{ id: 'read', type: 'function', function: { name: 'cad_read_drawing', arguments: '{}' } }] } : {}) } }] }
  if (protocol === 'anthropic-messages') return { role: 'assistant', stop_reason: call ? 'tool_use' : 'end_turn', content: call ? [{ type: 'thinking', thinking: 'thought', signature: 'opaque' }, { type: 'tool_use', id: 'read', name: 'cad_read_drawing', input: {} }] : [{ type: 'text', text: 'Received' }] }
  return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: call ? [{ thoughtSignature: 'opaque', functionCall: { id: 'read', name: 'cad_read_drawing', args: {} } }] : [{ text: 'Received' }] } }] }
}
function setup(protocol, request, options = {}) { return createKJModelAdapter({ protocol, model: 'host-selected-model', request, ...options }).createConversation({ instructions: 'Inspect the supplied raster, if supported.', tools: [] }) }
for (const protocol of protocols) {
  test(`${protocol}: explicit images map to provider blocks and survive tool continuation without mutable host references`, async () => {
    const bodies = [], observations = []
    const conversation = setup(protocol, async ({ body }) => { bodies.push(body); return wire(protocol, bodies.length === 1) }, { onUsage: usage => observations.push(usage) })
    const prompt = { kind: 'prompt', text: 'Inspect this drawing', images: [{ dataUrl }, { mimeType: 'image/jpeg', base64: jpeg }] }
    const first = await conversation.next(prompt, signal())
    const initial = user(protocol, bodies[0])
    if (protocol === 'responses') assert.deepEqual(initial.content, [{ type: 'input_text', text: prompt.text }, { type: 'input_image', image_url: dataUrl }, { type: 'input_image', image_url: `data:image/jpeg;base64,${jpeg}` }])
    else if (protocol === 'chat-completions') assert.deepEqual(initial.content, [{ type: 'text', text: prompt.text }, { type: 'image_url', image_url: { url: dataUrl } }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg}` } }])
    else if (protocol === 'anthropic-messages') assert.deepEqual(initial.content, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg } }, { type: 'text', text: prompt.text }])
    else assert.deepEqual(initial.parts, [{ text: prompt.text }, { inlineData: { mimeType: 'image/png', data: png } }, { inlineData: { mimeType: 'image/jpeg', data: jpeg } }])
    assert.ok(Object.isFrozen(initial)); assert.equal(first.calls[0].id, 'read')
    prompt.images[0].dataUrl = 'https://not-transmitted.invalid/secret.png'
    prompt.images.length = 0
    const final = await conversation.next({ kind: 'tool-results', results: [{ id: 'read', name: 'cad_read_drawing', result: { ok: true, value: { revision: 0 } } }] }, signal())
    assert.deepEqual(user(protocol, bodies[1]), initial)
    assert.match(JSON.stringify(bodies[1]), /opaque/)
    assert.doesNotMatch(JSON.stringify(bodies[1]), /not-transmitted/)
    assert.equal(final.text, 'Received'); assert.equal(observations.length, 2)
    assert.ok(observations.every(usage => usage.inputTokens === null && usage.latencyMs >= 0))
    assert.doesNotMatch(JSON.stringify(observations), /iVBOR|data:image|Inspect/)
  })
  test(`${protocol}: text-only wire remains unchanged and image-like text is not auto-attached`, async () => {
    let body
    await setup(protocol, async request => { body = request.body; return wire(protocol) }).next({ kind: 'prompt', text: dataUrl }, signal())
    const message = user(protocol, body)
    assert.deepEqual(message, protocol === 'gemini-generate-content' ? { role: 'user', parts: [{ text: dataUrl }] } : { role: 'user', content: dataUrl })
  })
}

test('invalid attachments, URLs, MIME mismatches, corrupt/truncated image containers and base64 fail before transport', async () => {
  let requests = 0
  const corrupt = Buffer.from(png, 'base64'); corrupt[40] ^= 1
  const bad = [
    [{ dataUrl: 'https://example.invalid/drawing.png' }], [{ dataUrl: 'file:///C:/drawing.png' }],
    [{ mimeType: 'image/svg+xml', base64: btoa('<svg/>') }], [{ mimeType: 'image/jpeg', base64: png }],
    [{ mimeType: 'image/png', base64: jpeg }], [{ mimeType: 'image/png', base64: corrupt.toString('base64') }],
    [{ mimeType: 'image/png', base64: Buffer.from(png, 'base64').subarray(0, 35).toString('base64') }],
    [{ mimeType: 'image/jpeg', base64: Buffer.from(jpeg, 'base64').subarray(0, -2).toString('base64') }],
    [{ dataUrl, base64: png }], [{ dataUrl, remoteUrl: 'https://example.invalid' }], [{ dataUrl: dataUrl + '\n' }],
    [{ mimeType: 'image/png', base64: png.slice(0, -1) }], [{ mimeType: 'image/png', base64: '@@@@' }],
    [{ mimeType: 'image/png', base64: 'AAAA' }], [null], null, Array(1), [{ dataUrl }, { dataUrl }, { dataUrl }],
  ]
  for (const images of bad) await assert.rejects(setup('chat-completions', async () => { requests++; return wire('chat-completions') }).next({ kind: 'prompt', text: 'Read', images }, signal()))
  assert.equal(requests, 0)
})

test('image descriptors and array entries never invoke getters or inherited image sources', async () => {
  let requests = 0, reads = 0
  const callback = async () => { requests++; return wire('chat-completions') }
  const promptGetter = { kind: 'prompt', text: 'Read', get images() { reads++; return [{ dataUrl }] } }
  const imageGetter = [{ get dataUrl() { reads++; return dataUrl } }]
  const arrayGetter = []; Object.defineProperty(arrayGetter, '0', { enumerable: true, get() { reads++; return { dataUrl } } })
  const inherited = Object.assign(Object.create({ images: [{ dataUrl }] }), { kind: 'prompt', text: 'Read' })
  for (const value of [promptGetter, inherited, ...[imageGetter, arrayGetter].map(images => ({ kind: 'prompt', text: 'Read', images }))]) await assert.rejects(setup('chat-completions', callback).next(value, signal()))
  assert.equal(reads, 0); assert.equal(requests, 0)
})

function paddedPng(size) {
  const original = Buffer.from(png, 'base64'), chunk = Buffer.alloc(size - original.length)
  chunk.writeUInt32BE(chunk.length - 12); chunk.write('kjDr', 4)
  let crc = 0xffffffff
  for (const value of chunk.subarray(4, -4)) { crc ^= value; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4)
  return Buffer.concat([original.subarray(0, -12), chunk, original.subarray(-12)]).toString('base64')
}
test('one-MiB decoded image bound and whole conversation history budget both apply without dropping attachments', async () => {
  let requests = 0
  const callback = async () => { requests++; return wire('chat-completions') }
  const image = { mimeType: 'image/png', base64: paddedPng(1048576) }
  await setup('chat-completions', callback).next({ kind: 'prompt', text: 'Read', images: [image] }, signal())
  assert.equal(requests, 1)
  await assert.rejects(setup('chat-completions', callback).next({ kind: 'prompt', text: 'Read', images: [{ ...image, base64: paddedPng(1048577) }] }, signal()), error => error.code === 'KJMODEL_SIZE_LIMIT')
  await assert.rejects(setup('chat-completions', callback).next({ kind: 'prompt', text: 'Read', images: [image, image] }, signal()), error => error.code === 'KJMODEL_SIZE_LIMIT')
  assert.equal(requests, 1)
  await setup('chat-completions', callback, { maxHistoryBytes: 4194304 }).next({ kind: 'prompt', text: 'Read', images: [image, image] }, signal())
  assert.equal(requests, 2)
})

test('pre-cancelled prompts send no image and transport failures remain failures without dropping images or retrying', async () => {
  let requests = 0; const cancelled = new AbortController(); cancelled.abort()
  const conversation = setup('chat-completions', async () => { requests++; throw new Error('vision unsupported by selected model') })
  await assert.rejects(conversation.next({ kind: 'prompt', text: 'Read', images: [{ dataUrl }] }, cancelled.signal)); assert.equal(requests, 0)
  const failed = setup('chat-completions', async ({ body }) => { requests++; assert.equal(body.messages[1].content[1].image_url.url, dataUrl); throw new Error('vision unsupported by selected model') })
  await assert.rejects(failed.next({ kind: 'prompt', text: 'Read', images: [{ dataUrl }] }, signal()), /vision unsupported/)
  assert.equal(requests, 1)
})


test('a structurally checksummed PNG with an excessive decoded pixel extent is refused before transport', async () => {
  const bytes = Buffer.from(png, 'base64'); bytes.writeUInt32BE(16384, 16); bytes.writeUInt32BE(16384, 20)
  let crc = 0xffffffff
  for (const value of bytes.subarray(12, 29)) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29)
  let requests = 0
  await assert.rejects(setup('responses', async () => { requests++; return wire('responses') }).next({ kind: 'prompt', text: 'Read', images: [{ mimeType: 'image/png', base64: bytes.toString('base64') }] }, signal()), /16-megapixel/)
  assert.equal(requests, 0)
})
