import assert from 'node:assert/strict'
import test from 'node:test'

import { KJProjectSession, createAgentTask, createKJDrawSDK, readAgentTasks } from '../src/index.js'
import { spawnSyncWithFileStdin } from '../../../scripts/spawn-file-stdin.mjs'

const definition = {
  requirements: [{
    id: 'line_exists',
    description: 'The scoped construction edge remains an editable line.',
    check: { toolName: 'cad_validate_geometry', assertion: { path: 'entities.line.type', operator: 'equals', expected: 'LINE' } },
  }],
  steps: [{ id: 'draw', title: 'Create the construction edge', requirementIds: ['line_exists'] }],
  tools: { apiVersion: '1', names: ['cad_validate_geometry'], contractHash: '0123456789abcdef' },
  capabilities: [],
}

async function fixture() {
  const sdk = createKJDrawSDK()
  const document = sdk.createDocument({ documentId: 'task-files', units: 'millimeter' })
  await document.transact('Geometry', tx => tx.createEntity('LINE', { start: [0, 0, 0], end: [120, 0, 0] }, { id: 'line' }))
  await document.transact('Persistent AI task', tx => createAgentTask(document, tx, {
    id: 'task-files-1',
    expectedRevision: document.revision,
    title: 'Checked construction edge',
    goal: 'Keep the construction edge editable and verify its native type.',
    entityIds: ['line'],
    definition,
    at: '2026-09-12T02:00:00.000Z',
    actor: { kind: 'host', id: 'test' },
  }))
  return { sdk, document }
}

test('authoritative AI task survives native KJD and KJP reopen with exact identity and definition', async () => {
  const { sdk, document } = await fixture()
  const expected = readAgentTasks(document)
  const native = await createKJDrawSDK().readDocument(await sdk.writeDocument(document, { format: 'KJD' }), { format: 'KJD' })
  assert.deepEqual(readAgentTasks(native), expected)
  const project = KJProjectSession.create({ sdk, id: 'task-project', documents: [document], activeDocumentId: document.id })
  const reopened = await KJProjectSession.open(await project.package({ modifiedAt: '2026-09-12T02:01:00.000Z' }), { sdk: createKJDrawSDK() })
  assert.deepEqual(readAgentTasks(reopened.activeDocument), expected)
  assert.equal(reopened.activeDocument.getObject('task-files-1').handle, expected[0].handle)
  assert.deepEqual(reopened.activeDocument.getObject('task-files-1').payload.definition, definition)
  project.destroy(); reopened.destroy()
})

test('DXF refuses silent AI task loss and explicit omission preserves independently readable geometry', async t => {
  const { sdk, document } = await fixture()
  await assert.rejects(sdk.writeDocument(document, { format: 'DXF', version: '2018' }), error => /cannot preserve.*AI tasks/.test(error.cause?.message ?? error.message))
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018', aiTasks: 'omit' })
  const reopened = await createKJDrawSDK().readDocument(dxf, { format: 'DXF' })
  assert.equal(reopened.listEntities({ type: 'LINE' }).length, 1)
  assert.deepEqual(readAgentTasks(reopened), [])
  const python = process.env.KJDRAW_PYTHON || 'python'
  const result = spawnSyncWithFileStdin(python, ['-c', 'import io,json,ezdxf,sys; d=ezdxf.read(io.StringIO(sys.stdin.read())); a=d.audit(); print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"lines":len(d.modelspace().query("LINE"))}))'], dxf, { encoding: 'utf8', windowsHide: true })
  if (result.error?.code === 'ENOENT' || result.status !== 0 && /No module named ['\"]ezdxf/.test(result.stderr)) return t.skip('Independent ezdxf runtime is unavailable')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { errors: 0, fixes: 0, lines: 1 })
})
