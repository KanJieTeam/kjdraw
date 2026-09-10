import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/index.js'

const python = (action, path) => {
  const result = spawnSync(process.env.KJDRAW_PYTHON || 'python', [fileURLToPath(new URL('./dxf-lines-interop.py', import.meta.url)), action, path], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}
const verify = (actual, expected) => {
  assert.equal(actual.inserts, 1); assert.equal(actual.lines.length, expected.lines.length)
  actual.lines.forEach((line, index) => {
    const wanted = expected.lines[index]
    for (const field of ['space', 'type', 'color', 'trueColor', 'lineweight']) assert.equal(line[field], wanted[field], field)
    for (const field of ['origin', 'direction']) line[field].forEach((n, i) => assert.ok(Math.abs(n-wanted[field][i])<1e-9, `${field}: ${n} != ${wanted[field][i]}`))
  })
}
const directory = await mkdtemp(join(tmpdir(), 'kjdraw-lines-interop-'))
try {
  const source = join(directory, 'source.dxf'), target = join(directory, 'output.dxf')
  const expected = python('generate', source), sdk = createKJDrawSDK()
  const doc = await sdk.readDocument(await readFile(source), { format: 'DXF' })
  assert.equal(doc.listEntities().filter(e => e.type === 'PROXY_ENTITY').length, 0)
  assert.equal(doc.listEntities().filter(e => ['XLINE', 'RAY'].includes(e.type)).length, 4)
  const save = async wanted => {
    const before = doc.serialize()
    await writeFile(target, await sdk.writeDocument(doc, { format: 'DXF', version: '2018' }))
    assert.equal(doc.serialize(), before)
    verify(python('inspect', target), wanted)
  }
  await save(expected)
  const model = doc.listEntities({ ownerId: doc.snapshot().spaces.modelSpaceId }).find(e => e.type === 'XLINE')
  await sdk.executeCommand('MOVE', { id: model.id, dx: 5, dy: -2 })
  const moved = structuredClone(expected); moved.lines[0].origin = [15,18,3]
  await save(moved)
  await sdk.executeCommand('ROTATE', { id: model.id, center: [0,0], angleDegrees: 90 })
  const rotated = structuredClone(moved)
  rotated.lines[0].origin = [-18,15,3]; rotated.lines[0].direction = [-.8,.6,0]
  await save(rotated)
  await sdk.executeCommand('UNDO'); await save(moved)
  await sdk.executeCommand('REDO'); await save(rotated)
  const paper = doc.getObject(doc.snapshot().spaces.layoutIds[1])
  const ray = doc.listEntities({ ownerId: paper.payload.blockRecordId }).find(e => e.type === 'RAY')
  await sdk.executeCommand('ROTATE', { id: ray.id, center: [0,0], angleDegrees: 180 })
  const reversed = structuredClone(rotated)
  reversed.lines[1].origin = [10,-5,6]; reversed.lines[1].direction = [.6,0,.8]
  await save(reversed)
  console.log(JSON.stringify({ ok: true, independentReader: `ezdxf ${expected.reader}`, nativeLines: 4, checks: ['model/paper/block ownership', '3D unit directions and ray sense', 'style and insert preservation', 'move/rotate/undo/redo', 'source unchanged on export', 'zero audit repairs'] }))
} finally { await rm(directory, { recursive: true, force: true }) }
