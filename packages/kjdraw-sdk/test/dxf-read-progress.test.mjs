import assert from 'node:assert/strict'
import test from 'node:test'

import { createDXFFileAdapter, DXF_DEFAULT_READ_LIMITS } from '../src/index.js'

const line = index => `0\nLINE\n5\n${(index + 1).toString(16).toUpperCase()}\n10\n${index}\n20\n0\n11\n${index + 1}\n21\n1\n`
const drawing = count => `0\nSECTION\n2\nENTITIES\n${Array.from({ length: count }, (_, index) => line(index)).join('')}0\nENDSEC\n0\nEOF\n`

test('DXF read progress is bounded metadata and covers source, parse and import', async () => {
  assert.equal(DXF_DEFAULT_READ_LIMITS.maxTags, 4_000_000)
  const events = []
  const document = await createDXFFileAdapter().read(drawing(3), { onProgress: event => {
    assert.ok(Object.isFrozen(event))
    assert.deepEqual(Object.keys(event).sort(), ['completed', 'phase', 'total', 'unit'])
    events.push(event)
  } })
  assert.equal(Object.values(document.snapshot().objects).filter(object => object.kind === 'entity' && object.type === 'LINE').length, 3)
  assert.deepEqual(events.map(event => event.phase), ['source', 'parse', 'import', 'import'])
  assert.deepEqual(events.map(event => event.unit), ['bytes', 'tags', 'entities', 'entities'])
  assert.equal(events.at(-1).completed, 3)
  assert.equal(events.at(-1).total, 3)
})

test('DXF parsing yields to a host abort before any document is committed', async () => {
  const controller = new AbortController()
  const padding = Array.from({ length: 20_000 }, () => `999\n${'x'.repeat(20)}\n`).join('')
  const source = `0\nSECTION\n2\nHEADER\n${padding}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n`
  let parseEvents = 0
  await assert.rejects(createDXFFileAdapter().read(source, {
    signal: controller.signal,
    onProgress: event => {
      if (event.phase === 'parse') { parseEvents += 1; controller.abort() }
    },
  }), error => /DXF read aborted/.test(error.cause?.message ?? error.message))
  assert.equal(parseEvents, 1)
})

test('DXF Blob streaming reports byte progress and can be cancelled before decoding', async () => {
  const controller = new AbortController(), source = new Blob([drawing(1_024)])
  let sourceEvents = 0
  await assert.rejects(createDXFFileAdapter().read(source, {
    signal: controller.signal,
    onProgress: event => {
      if (event.phase === 'source') { sourceEvents += 1; controller.abort() }
    },
  }), error => /DXF read aborted/.test(error.cause?.message ?? error.message))
  assert.equal(sourceEvents, 1)
})

test('DXF entity import yields to a host abort and retains explicit safety budgets', async () => {
  const controller = new AbortController()
  await assert.rejects(createDXFFileAdapter().read(drawing(1_024), {
    signal: controller.signal,
    onProgress: event => { if (event.phase === 'import' && event.completed === 512) controller.abort() },
  }), error => /DXF read aborted/.test(error.cause?.message ?? error.message))
  await assert.rejects(createDXFFileAdapter().read(drawing(2), { limits: { maxTags: 4 } }), error => /tag count/.test(error.cause?.message ?? error.message))
})
