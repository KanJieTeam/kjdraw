import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { findDrawingText } from '../packages/kjdraw-sdk/src/drawing-text-search.js'
import { runImportedDrawingEditJourney } from './helpers/imported-drawing-edit-journey.mjs'

const configured = process.env.KJDRAW_PRIVATE_DRAWING_ROOTS
async function drawings(directory, depth = 0) {
  assert.ok(depth <= 64, 'private drawing directory nesting exceeds the bounded scan')
  const result = []
  // Dirents do not follow symlinks; only scan roots explicitly supplied by the host.
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await drawings(path, depth + 1))
    else if (entry.isFile() && /\.dxf$/i.test(entry.name)) result.push(path)
  }
  return result.sort()
}

test('private local plan and section roots: cumulative CAD edits preserve all untouched entities and original files', {
  skip: !configured,
}, async t => {
  const roots = JSON.parse(configured)
  assert.ok(Array.isArray(roots) && roots.length > 0 && roots.length <= 8)
  const paths = (await Promise.all(roots.map(root => drawings(root)))).flat()
  assert.ok(paths.length > 0)
  const seen = new Set()
  let completed = 0, rounds = 0
  for (const path of paths) {
    const bytes = new Uint8Array(await readFile(path))
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (seen.has(hash)) continue
    seen.add(hash)
    // Keep project names, labels and drawing content out of shared test reports.
    await t.test('private-drawing-' + hash.slice(0, 12), async () => {
      const drawing = await createKJDrawSDK().readDocument(bytes, { format: 'DXF' })
      const label = drawing.listEntities({ type: 'TEXT', ownerId: drawing.spaces.modelSpaceId }).find(entity => {
        if (!entity.payload.text?.trim() || entity.payload.text.length > 250) return false
        return findDrawingText(drawing, { expectedRevision: drawing.revision, search: entity.payload.text, match: 'exact', limit: 100 })
          .matches.some(match => match.id === entity.id && match.textEditCandidate)
      })
      assert.ok(label, 'an explicit editable annotation is required for this CAD journey')
      const result = await runImportedDrawingEditJourney(bytes, { targetHandle: label.handle })
      assert.equal(result.naturalLanguageModelCalls, 0)
      assert.equal(result.rounds.length, 10)
      assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), hash,
        'original private DXF must remain unchanged')
      completed++; rounds += result.rounds.length
    })
  }
  assert.equal(completed, seen.size)
  t.diagnostic('unique local DXF: ' + completed + '; cumulative reviewed CAD edits: ' + rounds + '; actual model calls: 0')
})
