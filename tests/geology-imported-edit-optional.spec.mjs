import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runImportedDrawingEditJourney } from './helpers/imported-drawing-edit-journey.mjs'

const directory = process.env.KJDRAW_GEOLOGY_DXF_DIR
test('local imported sections survive ten cumulative annotation edits, human edits and reopen', { skip: !directory }, async t => {
  const names = (await readdir(directory)).filter(name => /\.dxf$/i.test(name)).sort()
  assert.ok(names.length)
  for (const [index, name] of names.entries()) await t.test('local-section-' + (index + 1), async () => {
    const result = await runImportedDrawingEditJourney(new Uint8Array(await readFile(join(directory, name))))
    assert.equal(result.rounds.length, 10)
    assert.equal(result.naturalLanguageModelCalls, 0)
  })
})
