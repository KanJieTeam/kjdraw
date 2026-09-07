import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  KJDRAW_1_0_PRODUCT_CONTRACT,
  KJDRAW_CAD_VERSION_MATRIX,
  KJRevisionConflictError,
  KJValidationError,
  createKJDrawSDK,
} from '../src/index.js'

test('KJDraw 1.0 contract locks local authority and the supported CAD matrix', () => {
  assert.equal(KJDRAW_1_0_PRODUCT_CONTRACT.deployment, 'local-offline')
  assert.equal(KJDRAW_1_0_PRODUCT_CONTRACT.sourceOfTruth, 'local-project-file')
  assert.equal(KJDRAW_1_0_PRODUCT_CONTRACT.cloudProjectAuthority, false)
  assert.equal(KJDRAW_1_0_PRODUCT_CONTRACT.authorities.geometry, 'kjcore-rust')
  assert.equal(KJDRAW_1_0_PRODUCT_CONTRACT.authorities.fileIntermediateModel, 'kjcore-rust')
  assert.deepEqual(KJDRAW_CAD_VERSION_MATRIX.map(row => row.label), ['R14', '2000', '2004', '2010', '2013', '2018', '2024'])
  assert.equal(JSON.stringify(KJDRAW_1_0_PRODUCT_CONTRACT).includes('2007'), false)
  assert.equal(KJDRAW_1_0_PRODUCT_CONTRACT.surveyFamilies.automaticEnglishTitleBlockFallback, false)
})

test('public DXF adapter does not advertise legacy R12 or removed 2007', () => {
  const sdk = createKJDrawSDK()
  const adapter = sdk.fileAdapters.get('kanjie.dxf.ascii')
  const versions = adapter.formats.DXF
  assert.deepEqual(versions.read, ['R14', '2000', '2004', '2010', '2013', '2018', '2024'])
  assert.deepEqual(versions.write, versions.read)
  assert.equal(JSON.stringify(versions).includes('2007'), false)
  assert.deepEqual(adapter.capabilities.legacyMigrationVersions, ['R12'])
})

test('versioned command envelopes commit once and reject stale revisions atomically', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'command-protocol' })
  const first = sdk.createCommandEnvelope('CREATEBATCH', { entities: [
    { type: 'LINE', payload: { start: [0, 0], end: [10, 0] }, layerName: 'KJ-USER' },
    { type: 'CIRCLE', payload: { center: [5, 5], radius: 2 }, layerName: 'KJ-USER' },
  ] }, {
    document,
    expectedRevision: document.revision,
    origin: { kind: 'ui', owner: 'contract-test' },
  })
  const stale = sdk.createCommandEnvelope('CREATE', { type: 'CIRCLE', payload: { center: [0, 0], radius: 5 } }, {
    document,
    expectedRevision: document.revision,
    origin: 'plugin',
  })
  const receipt = await sdk.executeCommandEnvelope(first)
  assert.equal(receipt.status, 'committed')
  assert.equal(receipt.beforeRevision, 0)
  assert.equal(receipt.afterRevision, 1)
  await assert.rejects(sdk.executeCommandEnvelope(stale), error => error instanceof KJRevisionConflictError)
  assert.equal(document.revision, 1)
  assert.equal(document.listEntities().length, 2)
  assert.equal(document.getTable('layers').records.some(row => row.name === 'KJ-USER'), true)
  const revision = document.snapshot().revisions.at(-1)
  assert.equal(revision.metadata.commandEnvelopeId, first.id)
  assert.equal(revision.metadata.commandOrigin.kind, 'ui')
})

test('AI commands remain plans until a confirmed plan is executed', async () => {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'ai-command-plan' })
  const plan = sdk.createCommandEnvelope('CREATE', { type: 'POINT', payload: { position: [1, 2] } }, {
    document,
    expectedRevision: document.revision,
    mode: 'plan',
    origin: 'ai',
  })
  const planned = await sdk.executeCommandEnvelope(plan)
  assert.equal(planned.status, 'planned')
  assert.equal(document.revision, 0)
  assert.throws(() => sdk.createCommandEnvelope('CREATE', { type: 'POINT', payload: { position: [1, 2] } }, {
    document,
    expectedRevision: 0,
    origin: 'ai',
  }), error => error instanceof KJValidationError && /explicit user confirmation/.test(error.message))
  const confirmed = sdk.createCommandEnvelope('CREATE', { type: 'POINT', payload: { position: [1, 2] } }, {
    document,
    expectedRevision: 0,
    origin: 'ai',
    confirmation: { status: 'confirmed', planId: plan.id, confirmedBy: 'user' },
  })
  const committed = await sdk.executeCommandEnvelope(confirmed)
  assert.equal(committed.status, 'committed')
  assert.equal(document.revision, 1)
})

test('acceptance matrix is machine-readable and passed scope is backed by release evidence', async () => {
  const path = new URL('../../../docs/KJDRAW_1_0_ACCEPTANCE_MATRIX.json', import.meta.url)
  const matrix = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(matrix.schema, 'com.kanjie.kjdraw.acceptance-matrix@1')
  assert.ok(matrix.gates.length >= 10)
  assert.equal(new Set(matrix.gates.map(row => row.id)).size, matrix.gates.length)
  for (const gate of matrix.gates) {
    assert.ok(['passed', 'partial', 'blocked', 'not-started'].includes(gate.status), gate.id)
    if (gate.status === 'passed') assert.ok(gate.evidence?.length, `${gate.id} requires evidence`)
  }
  const localAuthority = matrix.gates.find(row => row.id === 'file.local-authority')
  assert.equal(localAuthority.status, 'partial')
  assert.ok(localAuthority.evidence.some(path => path.endsWith('/project-session.js')))
  assert.notEqual(localAuthority.status, 'passed')
  const dwgRoundtrip = matrix.gates.find(row => row.id === 'cad.dwg-roundtrip')
  assert.equal(dwgRoundtrip.status, 'blocked')
  assert.match(dwgRoundtrip.gap, /without ODA|removing ODA/i)
  assert.deepEqual([...new Set(KJDRAW_CAD_VERSION_MATRIX.map(row => row.code))], ['AC1014', 'AC1015', 'AC1018', 'AC1024', 'AC1027', 'AC1032'])
  assert.equal(KJDRAW_CAD_VERSION_MATRIX.some(row => row.code === 'AC1021'), false)
  const fileKernel = matrix.gates.find(row => row.id === 'kernel.file-intermediate-model')
  assert.equal(fileKernel.status, 'partial')
  assert.ok(fileKernel.evidence.some(path => path.endsWith('/cad.rs')))
  assert.notEqual(fileKernel.status, 'passed')
})
