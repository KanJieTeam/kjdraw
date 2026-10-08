import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createDXFFileAdapter, createKJDrawSDK } from '../src/index.js'
import { DXF_VIEWPORT_METADATA_KEY } from '../src/dxf-viewport-metadata.js'

// Wholly synthetic coordinates, labels and native handles; no customer bytes.
const tags = (...values) => values.join('\n') + '\n'
async function fixture({ target = 'FA01', external = false, type = 'DIMASSOC', extraReactorOwner = false } = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: 'millimeter' })
  await document.transact('Public associative dimension transport', tx => {
    tx.createEntity('LINE', { start: [0, 0, 0], end: [20, 0, 0] }, { id: 'geometry', handle: 'FA01' })
    tx.createEntity('DIMENSION', { dimensionType: 'ALIGNED', definitionPoints: [[0, 5, 0], [0, 0, 0], [20, 0, 0]] }, { id: 'dimension', handle: 'FA02' })
    tx.createEntity('TEXT', { position: [30, 20, 0], height: 2, text: 'PUBLIC ZK-A' }, { id: 'label', handle: 'FA03' })
    if (extraReactorOwner) tx.createEntity('LINE', { start: [40, 0, 0], end: [40, 20, 0] }, { id: 'extra-owner', handle: 'FA04' })
  })
  let source = String(createDXFFileAdapter().write(document, { version: '2007' })).replaceAll('\r\n', '\n')
  for (const [kind, handle] of [['LINE', 'FA01'], ['DIMENSION', 'FA02'], ...(extraReactorOwner ? [['LINE', 'FA04']] : [])]) {
    source = source.replace(tags(0, kind, 5, handle), tags(0, kind, 5, handle, 102, '{ACAD_REACTORS', 330, 'FB00', 102, '}'))
  }
  // Nongraphical objects need a dictionary owner. A dimension entity is the
  // association's target, not its OBJECTS-section owner. Stock ezdxf correctly
  // removes invalidly owned objects during audit on hosted runners.
  const rootHandle = /0\nSECTION\n2\nOBJECTS\n0\nDICTIONARY\n5\n([0-9A-F]+)\n/.exec(source)?.[1]
  assert.ok(rootHandle)
  const rootHeader = tags(0, 'DICTIONARY', 5, rootHandle, 330, 0, 100, 'AcDbDictionary', 281, 1)
  assert.ok(source.includes(rootHeader))
  source = source.replace(rootHeader, rootHeader + tags(3, 'PUBLIC_ASSOCIATIONS', 350, 'FB01'))
  source = source.replace(tags(0, 'ENDSEC', 0, 'EOF'), tags(0, type, 5, 'FB00',
    102, '{ACAD_REACTORS', 330, 'FA02', 102, '}', 330, 'FB01', 100, 'AcDbDimAssoc', 330, 'FA02',
    90, 3, 70, 0, 71, 0,
    1, 'AcDbOsnapPointRef', 72, 1, 331, target, 73, 1, 91, 0, 40, 0, 10, 0, 20, 0, 30, 0, 75, 0,
    1, 'AcDbOsnapPointRef', 72, 1, 331, target, 73, 1, 91, 0, 40, 1, 10, 20, 20, 0, 30, 0, 75, 0,
    ...(external ? [301, 'EXTERNAL-XREF'] : []),
    0, 'DICTIONARY', 5, 'FB01', 330, rootHandle, 100, 'AcDbDictionary', 281, 1, 3, 'PUBLIC_DIMASSOC', 350, 'FB00',
    0, 'ENDSEC', 0, 'EOF'))
  return { sdk, source, document: await sdk.readDocument(source, { format: 'DXF' }) }
}
const rejected = async (sdk, document, pattern) => assert.rejects(sdk.writeDocument(document, { format: 'DXF' }), error => pattern.test(error.cause?.message ?? error.message))

test('native DIMASSOC survives unrelated text edits, undo and repeated KJD/DXF reopen with exact references', async () => {
  const { sdk, source } = await fixture()
  let document = await sdk.readDocument(source, { format: 'DXF' })
  for (let round = 0; round < 10; round++) {
    const label = document.listEntities({ type: 'TEXT', ownerId: document.spaces.modelSpaceId })[0]
    const before = document.listEntities({ type: 'LINE', ownerId: document.spaces.modelSpaceId })[0]
    await sdk.executeCommand('TEXTEDIT', { changes: [{ id: label.id, expectedText: label.payload.text, text: 'PUBLIC ' + round }] }, { document })
    const after = document.getObject(label.id)
    await document.undo(); assert.equal(document.getObject(label.id).payload.text, label.payload.text)
    await document.redo(); assert.deepEqual(document.getObject(label.id), after)
    assert.deepEqual(document.getObject(before.id), before)
    document = await sdk.readDocument(await sdk.writeDocument(document, { format: round % 2 ? 'KJD' : 'DXF' }), { format: round % 2 ? 'KJD' : 'DXF' })
    const metadata = document.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY]
    assert.equal(metadata.records.filter(record => record.type === 'DIMASSOC').length, 1)
    const refs = metadata.entityReferences.map(reference => document.getObject(reference.id).handle).sort()
    assert.deepEqual(refs, ['FA01', 'FA02'])
    for (const entity of document.listEntities({ ownerId: document.spaces.modelSpaceId }).filter(entity => ['LINE', 'DIMENSION'].includes(entity.type))) {
      assert.deepEqual(entity.payload.dxfReactorReferences, [{ metadataHandle: 'FB00' }])
      assert.equal(entity.payload.unresolvedDxfReactorHandles, undefined)
    }
  }
})

test('opaque DIMASSOC refuses changed or erased associated geometry, missing guards and DXF downgrade', async () => {
  const { sdk, document } = await fixture()
  await sdk.executeCommand('MOVE', { id: document.listEntities({ type: 'LINE', ownerId: document.spaces.modelSpaceId })[0].id, dx: 1, dy: 0 }, { document })
  await rejected(sdk, document, /dimension-associated entity changed/)
  await document.undo()
  const output = await sdk.writeDocument(document, { format: 'DXF' })
  assert.match(output, /DIMASSOC/)
  const original = structuredClone(document.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY])
  for (const mutation of [value => delete value.dimensionAssociationEntities, value => value.dimensionAssociationEntities.pop()]) {
    const forged = structuredClone(original); mutation(forged)
    await document.transact('Public invalid association metadata', tx => tx.putOpaquePayload(DXF_VIEWPORT_METADATA_KEY, forged))
    await rejected(sdk, document, /guards are missing/)
    await document.undo()
  }
  await sdk.executeCommand('ERASE', { ids: [document.listEntities({ type: 'LINE', ownerId: document.spaces.modelSpaceId })[0].id] }, { document })
  await rejected(sdk, document, /reference target is erased/)
  await document.undo()
  await assert.rejects(sdk.writeDocument(document, { format: 'DXF', version: '2018' }), error => /source DXF format/.test(error.cause?.message ?? error.message))
})

test('missing targets, external XREF associations and unknown dependency engines remain fail-closed', async () => {
  for (const options of [{ target: 'DEAD' }, { external: true }, { type: 'ACDBASSOCGEOMDEPENDENCY' }]) {
    const { sdk, document } = await fixture(options)
    assert.equal(document.validate().valid, true, 'unsupported originals remain readable')
    await rejected(sdk, document, /unsupported source metadata|unresolved reactor/)
  }
})

test('changing native ownership or copying an opaque dimension reactor cannot forge a valid association', async () => {
  const { sdk, document } = await fixture()
  const line = document.listEntities({ type: 'LINE', ownerId: document.spaces.modelSpaceId })[0]
  const paperSpaceId = document.spaces.paperSpaceIds[0]
  assert.ok(paperSpaceId)
  await document.transact('Public cross-space move', tx => tx.reparentObject(line.id, paperSpaceId))
  await rejected(sdk, document, /dimension-associated entity changed/)
  await document.undo()
  await document.transact('Public copied opaque reactor', tx => tx.createEntity('LINE', structuredClone(line.payload)))
  await rejected(sdk, document, /dimension association owner is unregistered/)
  await document.undo()
  assert.match(await sdk.writeDocument(document, { format: 'DXF' }), /DIMASSOC/)
})

test('original reactor hosts absent from DIMASSOC geometric pointers are captured and retained, never mistaken for a copied reactor', async () => {
  const { sdk, document } = await fixture({ extraReactorOwner: true })
  const metadata = document.snapshot().opaquePayloads[DXF_VIEWPORT_METADATA_KEY]
  assert.deepEqual(metadata.entityReferences.map(reference => document.getObject(reference.id).handle).sort(), ['FA01', 'FA02', 'FA04'])
  const reopened = await sdk.readDocument(await sdk.writeDocument(document, { format: 'DXF' }), { format: 'DXF' })
  const host = reopened.listEntities({ type: 'LINE' }).find(entity => entity.handle === 'FA04')
  assert.deepEqual(host.payload.dxfReactorReferences, [{ metadataHandle: 'FB00' }])
  await reopened.transact('Copy only after import', tx => tx.createEntity('LINE', structuredClone(host.payload)))
  await rejected(sdk, reopened, /dimension association owner is unregistered/)
})

test('independent ezdxf retains DIMASSOC, reciprocal reactors and the exact geometric target without repair', {
  skip: !process.env.KJDRAW_PYTHON,
}, async () => {
  const { sdk, document } = await fixture()
  const text = document.listEntities({ type: 'TEXT', ownerId: document.spaces.modelSpaceId })[0]
  await sdk.executeCommand('TEXTEDIT', { changes: [{ id: text.id, expectedText: text.payload.text, text: 'PUBLIC VERIFIED' }] }, { document })
  const output = await sdk.writeDocument(document, { format: 'DXF' })
  const child = spawnSync(process.env.KJDRAW_PYTHON, ['-c', [
    'import io,json,sys,ezdxf',
    // StringIO's default does not normalize CRLF. Windows stdin did that for
    // us; Unix stdin does not. Use the same universal-newline reader as a DXF
    // opened from disk, preserving every tag value instead of trimming data.
    'doc=ezdxf.read(io.StringIO(sys.stdin.read(), newline=None))',
    'assert doc.dxfversion=="AC1021"',
    'before_assoc=doc.entitydb.get("FB00")',
    'before_owner=before_assoc.dxf.get("owner") if before_assoc is not None else None',
    'audit=doc.audit()',
    'assoc=doc.entitydb.get("FB00")',
    'assert assoc is not None and assoc.dxftype()=="DIMASSOC", json.dumps({"beforeType":before_assoc.dxftype() if before_assoc is not None and before_assoc.is_alive else None,"beforeOwner":before_owner,"errors":[str(e.message) for e in audit.errors],"fixes":[str(e.message) for e in audit.fixes],"objectTypes":[e.dxftype() for e in doc.objects]})',
    'assert "FB00" in doc.entitydb["FA01"].get_reactors()',
    'assert "FB00" in doc.entitydb["FA02"].get_reactors()',
    'pointers=[str(t.value) for group in assoc.xtags.subclasses for t in group if t.code==331]',
    'assert pointers==["FA01","FA01"]',
    'assert list(doc.modelspace().query("TEXT"))[0].dxf.text=="PUBLIC VERIFIED"',
    'print(json.dumps({"errors":len(audit.errors),"fixes":len(audit.fixes)}))',
  ].join('\n')], { input: output, encoding: 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 })
  assert.equal(child.status, 0, child.error ? `${child.error.message}\n${child.stderr}` : child.stderr)
  assert.deepEqual(JSON.parse(child.stdout), { errors: 0, fixes: 0 })
})

test('independent DXF text transport declares universal newlines instead of relying on Windows stdin translation', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL(import.meta.url), 'utf8')
  assert.ok(source.includes('io.StringIO(sys.stdin.read(), newline=None)'))
  assert.equal(/^\s*'doc=ezdxf\.read\(io\.StringIO\(sys\.stdin\.read\(\)\)\)',?\s*$/mu.test(source), false)
})
