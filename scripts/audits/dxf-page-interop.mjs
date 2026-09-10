import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'

const python = (action, path) => {
  const result = spawnSync(process.env.KJDRAW_PYTHON || 'python', [fileURLToPath(new URL('./dxf-page-interop.py', import.meta.url)), action, path], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}
const directory = await mkdtemp(join(tmpdir(), 'kjdraw-page-interop-'))
try {
  const source = join(directory, 'source.dxf'), target = join(directory, 'output.dxf')
  const expected = python('generate', source), sdk = createKJDrawSDK()
  const doc = await sdk.readDocument(await readFile(source), { format: 'DXF' })
  const save = async () => {
    await writeFile(target, await sdk.writeDocument(doc, { format: 'DXF', version: '2018' }))
    return python('inspect', target)
  }
  assert.deepEqual(await save(), expected)
  await sdk.executeCommand('PAGESETUP', { layoutName: 'Layout1', dxf: { paperWidth: 594, paperHeight: 841, scaleNumerator: 1, scaleDenominator: 100, rotation: 3 } })
  const edited = structuredClone(expected)
  Object.assign(edited.layouts.Layout1, { paper_width: 594, paper_height: 841, scale_numerator: 1, scale_denominator: 100, plot_rotation: 3 })
  assert.deepEqual(await save(), edited)
  await sdk.executeCommand('UNDO'); assert.deepEqual(await save(), expected)
  await sdk.executeCommand('REDO'); assert.deepEqual(await save(), edited)
  console.log(JSON.stringify({ ok: true, independentReader: `ezdxf ${expected.version}`, layouts: Object.keys(expected.layouts).length, fieldsPerLayout: 30, checks: ['model and empty layouts', 'paper dimensions and margins', 'units and rotation', 'window and scale', 'names and flags', 'partial page edits', 'undo/redo', 'zero audit repairs'] }))
} finally { await rm(directory, { recursive: true, force: true }) }
