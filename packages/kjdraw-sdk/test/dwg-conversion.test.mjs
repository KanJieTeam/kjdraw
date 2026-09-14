import assert from 'node:assert/strict'
import test from 'node:test'

import {
  KJDocument,
  createDwgConversionFileAdapter,
  createKJDrawSDK,
  getDwgConversionProvenance,
} from '../src/index.js'

const encoder = new TextEncoder()
const dwg = (body = 'synthetic-test-data') => encoder.encode(`AC1032${body}`)
const dxf = `0
SECTION
2
ENTITIES
0
LINE
8
0
10
0
20
0
11
10
21
5
0
ENDSEC
0
EOF
`

function provider(overrides = {}) {
  return {
    id: 'test.converter',
    version: '2.4.1',
    locality: 'self-hosted',
    outputFormats: ['DXF', 'KJD'],
    limits: { maxSourceBytes: 1024, maxResultBytes: 16 * 1024 },
    convert: async ({ source, target, onProgress }) => {
      for (const [index, phase] of ['validate', 'upload', 'convert', 'download'].entries()) {
        onProgress?.({ phase, completed: index + 1, total: 4, unit: 'steps' })
      }
      return {
        format: target,
        data: target === 'DXF' ? dxf : KJDocument.create({ title: 'Converted' }).serialize(),
        sourceSha256: source.sha256,
        warnings: ['Missing SHX font substituted'],
        approximations: ['Proxy object represented by its fallback geometry'],
      }
    },
    ...overrides,
  }
}

test('DWG adapter validates the source, imports editable DXF and persists bounded provenance', async () => {
  const events = [], conversionEvents = []
  const adapter = createDwgConversionFileAdapter({ provider: provider() })
  assert.equal(await adapter.sniff(dwg(), {}), true)
  assert.equal(await adapter.sniff(encoder.encode('<html>not dwg</html>'), {}), false)
  assert.deepEqual(adapter.formats.DWG.write, [])
  assert.equal(adapter.capabilities.nativeDwg, false)
  assert.equal(adapter.capabilities.lossless, false)

  const document = await adapter.read(dwg(), {
    fileName: 'pump-layout.dwg',
    targetFormat: 'DXF',
    onProgress: value => events.push(value),
    onConversionProgress: value => conversionEvents.push(value),
  })
  assert.equal(document.listEntities({ type: 'LINE' }).length, 1)
  const provenance = getDwgConversionProvenance(document)
  assert.deepEqual(provenance.provider, { id: 'test.converter', version: '2.4.1', locality: 'self-hosted' })
  assert.equal(provenance.sourceName, 'pump-layout.dwg')
  assert.equal(provenance.sourceVersion, 'AC1032')
  assert.equal(provenance.target, 'DXF')
  assert.match(provenance.sourceSha256, /^[0-9a-f]{64}$/)
  assert.match(provenance.targetSha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(provenance.warnings, ['Missing SHX font substituted'])
  assert.deepEqual(provenance.approximations, ['Proxy object represented by its fallback geometry'])
  assert.ok(events.some(event => event.phase === 'source'))
  assert.deepEqual(events.filter(event => ['validate', 'upload', 'convert', 'download'].includes(event.phase)).map(event => event.phase), ['validate', 'upload', 'convert', 'download'])
  assert.deepEqual(conversionEvents.map(event => event.phase), ['validate', 'upload', 'convert', 'download'])

  const reopened = await createKJDrawSDK().readDocument(document.serialize(), { format: 'KJD' })
  assert.deepEqual(getDwgConversionProvenance(reopened), provenance)
  assert.equal(JSON.stringify(document.toJSON()).includes('synthetic-test-data'), false)
})

test('SDK registers an injected DWG provider without exposing its connection details', async () => {
  const injected = { ...provider({ outputFormats: ['KJD'] }), endpoint: 'https://private.invalid', apiKey: 'secret' }
  const sdk = createKJDrawSDK({ dwgConversionProvider: injected })
  const adapter = sdk.fileAdapters.find({ format: 'DWG', operation: 'read' })
  assert.ok(adapter)
  assert.equal(JSON.stringify(sdk.fileAdapters.capabilityMatrix()).includes('private.invalid'), false)
  assert.equal(JSON.stringify(sdk.fileAdapters.capabilityMatrix()).includes('secret'), false)
  const document = await sdk.readDocument(dwg(), { format: 'DWG', fileName: 'assembly.dwg', targetFormat: 'KJD' })
  assert.equal(document.metadata.title, 'Converted')
  assert.equal(getDwgConversionProvenance(document).target, 'KJD')
  const converterOnly = createKJDrawSDK({ registerDefaultAdapters: false, dwgConversionProvider: injected })
  assert.ok(converterOnly.fileAdapters.find({ format: 'DWG', operation: 'read' }))
})

test('DWG adapter rejects invalid headers, bounds, target mismatches and unsafe converter results', async () => {
  const valid = dwg()
  await assert.rejects(createDwgConversionFileAdapter({ provider: provider() }).read(encoder.encode('not-a-dwg')), /AC10xx header/)
  await assert.rejects(createDwgConversionFileAdapter({ provider: provider({ limits: { maxSourceBytes: 7, maxResultBytes: 1024 } }) }).read(valid), /source exceeds/)
  await assert.rejects(createDwgConversionFileAdapter({ provider: provider({ outputFormats: ['KJD'] }) }).read(valid, { targetFormat: 'DXF' }), /does not support DXF/)

  for (const [result, message] of [
    [{ format: 'KJD', data: dxf }, /when DXF was requested/],
    [{ format: 'DXF', data: '' }, /empty result/],
    [{ format: 'DXF', data: '<!doctype html><html></html>' }, /HTML instead of a drawing/],
    [{ format: 'DXF', data: '{"schema":"not dxf"}' }, /mislabeled a non-DXF result/],
    [{ format: 'DXF', data: '0\nSECTION\n2\nENTITIES\n0\nEOF\n' }, /failed to read|ENDSEC|section/i],
    [{ format: 'DXF', data: dxf, sourceSha256: '0'.repeat(64) }, /does not match the source SHA-256/],
    [{ format: 'DXF', data: dxf, sha256: '0'.repeat(64) }, /does not match its payload/],
  ]) {
    const adapter = createDwgConversionFileAdapter({ provider: provider({ outputFormats: ['DXF'], convert: async () => result }) })
    await assert.rejects(adapter.read(valid, { targetFormat: 'DXF' }), message)
  }

  const tooMany = Array.from({ length: 65 }, (_, index) => `warning ${index}`)
  await assert.rejects(createDwgConversionFileAdapter({ provider: provider({ convert: async () => ({ format: 'DXF', data: dxf, warnings: tooMany }) }) }).read(valid), /bounded diagnostic limit/)
})

test('DWG byte limits reject typed-array and ArrayBuffer inputs before any copy', async () => {
  const limited = provider({ limits: { maxSourceBytes: 7, maxResultBytes: 7 } })
  const adapter = createDwgConversionFileAdapter({ provider: limited })

  const NativeUint8Array = globalThis.Uint8Array
  const typedSource = new NativeUint8Array(8)
  let typedCopyAttempted = false
  globalThis.Uint8Array = new Proxy(NativeUint8Array, {
    construct(target, argumentsList, newTarget) {
      typedCopyAttempted = true
      return Reflect.construct(target, argumentsList, newTarget)
    },
  })
  try {
    await assert.rejects(adapter.read(typedSource), /source exceeds/)
    assert.equal(typedCopyAttempted, false)
  } finally { globalThis.Uint8Array = NativeUint8Array }

  const arrayBufferSource = new ArrayBuffer(8)
  let sourceSliceAttempted = false
  Object.defineProperty(arrayBufferSource, 'slice', { value() { sourceSliceAttempted = true; throw new Error('source copied') } })
  await assert.rejects(adapter.read(arrayBufferSource), /source exceeds/)
  assert.equal(sourceSliceAttempted, false)

  const oversizedResult = new ArrayBuffer(8)
  let resultSliceAttempted = false
  Object.defineProperty(oversizedResult, 'slice', { value() { resultSliceAttempted = true; throw new Error('result copied') } })
  const resultAdapter = createDwgConversionFileAdapter({ provider: provider({
    limits: { maxSourceBytes: 1024, maxResultBytes: 7 },
    outputFormats: ['DXF'],
    convert: async () => ({ format: 'DXF', data: oversizedResult }),
  }) })
  await assert.rejects(resultAdapter.read(dwg(), { targetFormat: 'DXF' }), /result exceeds/)
  assert.equal(resultSliceAttempted, false)
})

test('DWG conversion cooperates with cancellation and validates provider progress', async () => {
  const before = new AbortController()
  before.abort()
  await assert.rejects(createDwgConversionFileAdapter({ provider: provider() }).read(dwg(), { signal: before.signal }), /DWG read aborted/)

  const during = new AbortController()
  const adapter = createDwgConversionFileAdapter({ provider: provider({
    convert: async ({ signal }) => {
      during.abort()
      assert.equal(signal.aborted, true)
      return { format: 'DXF', data: dxf }
    },
  }) })
  await assert.rejects(adapter.read(dwg(), { signal: during.signal }), /DWG conversion aborted/)

  const badProgress = createDwgConversionFileAdapter({ provider: provider({
    convert: async ({ onProgress }) => {
      onProgress({ phase: 'convert', completed: 101, total: 100, unit: 'percent' })
      return { format: 'DXF', data: dxf }
    },
  }) })
  await assert.rejects(badProgress.read(dwg(), { onConversionProgress() {} }), /Invalid DWG conversion progress/)
})

test('provenance reader returns an exact bounded shape and drops untrusted extra fields', () => {
  const document = KJDocument.create({ metadata: { kjdrawImport: {
    schema: 'kjdraw.dwg-import', schemaVersion: 1,
    provider: { id: 'safe.provider', version: '1', locality: 'local', endpoint: 'private' },
    sourceSha256: 'a'.repeat(64), sourceName: 'safe.dwg', sourceBytes: 6, sourceVersion: 'AC1032',
    target: 'KJD', targetSha256: 'b'.repeat(64), targetBytes: 10,
    warnings: [], approximations: [], apiKey: 'secret',
  } } })
  const provenance = getDwgConversionProvenance(document)
  assert.equal(JSON.stringify(provenance).includes('private'), false)
  assert.equal(JSON.stringify(provenance).includes('secret'), false)
})
