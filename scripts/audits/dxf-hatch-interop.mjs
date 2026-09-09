import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { transformEntityPayload } from '../../packages/kjdraw-sdk/src/geometry/transform.js'
import { multiply3, translation3, rotation3, scale3 } from '../../packages/kjdraw-sdk/src/geometry/matrix3.js'

const bridge = fileURLToPath(new URL('./dxf-hatch-interop.py', import.meta.url))
const python = (action, path) => {
  const p = spawnSync(process.env.KJDRAW_PYTHON || 'python', [bridge, action, path], { encoding: 'utf8' })
  assert.equal(p.status, 0, `${p.stdout}\n${p.stderr}`)
  return p.stdout.trim() ? JSON.parse(p.stdout) : null
}
const directory = await mkdtemp(join(tmpdir(), 'kjdraw-hatch-interop-'))
try {
  const source = join(directory, 'source.dxf'), target = join(directory, 'edited.dxf')
  python('generate', source)
  const sdk = createKJDrawSDK(), doc = await sdk.readDocument(await readFile(source), { format: 'DXF' })
  const hatch = doc.listEntities({ type: 'HATCH' })[0]
  // (x,y) -> (10-2y, -5+2x); check independently after rotation, scale and move.
  const matrix = multiply3(translation3(10, -5), multiply3(rotation3(Math.PI / 2), scale3(2, 2)))
  await doc.transact('transform imported hatch', tx => tx.updateObject(hatch.id, { payload: transformEntityPayload('HATCH', hatch.payload, matrix) }))
  await writeFile(target, await sdk.writeDocument(doc, { format: 'DXF', version: '2018' }))
  const result = python('inspect', target)
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)
  const expected = [{ angle: 90, base: [10, -3], offset: [-8, 4], dashes: [4, -4, 0, -4] }, { angle: 180, base: [8, -5], offset: [-2, -12], dashes: [] }]
  for (let i = 0; i < expected.length; i++) {
    near(result.lines[i].angle, expected[i].angle)
    for (const key of ['base', 'offset', 'dashes']) { assert.equal(result.lines[i][key].length, expected[i][key].length); result.lines[i][key].forEach((v, j) => near(v, expected[i][key][j])) }
  }
  for (const [index, point] of [[0, [10, -5]], [1, [-6, 11]]]) result.paths[index][0].slice(0, 2).forEach((v, j) => near(v, point[j]))
  await sdk.executeCommand('UNDO'); await sdk.executeCommand('REDO')
  await writeFile(target, await sdk.writeDocument(doc, { format: 'DXF', version: '2018' }))
  assert.deepEqual(python('inspect', target), result)
  console.log(JSON.stringify({ ok: true, independentReader: `ezdxf ${result.version}`, checks: ['pattern angles', 'base phase', 'offset vectors', 'dash lengths and dots', 'outer/hole coordinates', 'undo/redo', 'zero audit repairs'] }))
} finally { await rm(directory, { recursive: true, force: true }) }
