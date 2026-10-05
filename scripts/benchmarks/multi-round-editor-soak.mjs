// Deterministic SDK edit/history/round-trip soak. No model request or token claim.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'

const argv = process.argv.slice(2)
function option(name, fallback) {
  const index = argv.indexOf(name)
  if (index === -1) return fallback
  if (index + 1 >= argv.length) throw new Error(`${name} needs a value`)
  return Number(argv[index + 1])
}
const rounds = option('--rounds', 1000)
const checkpointEvery = option('--checkpoint-every', 100)
const progress = argv.includes('--progress')
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10_000) throw new Error('--rounds must be 1..10000')
if (!Number.isInteger(checkpointEvery) || checkpointEvery < 1 || checkpointEvery > rounds) throw new Error('--checkpoint-every must be 1..rounds')
if (argv.some(value => value.startsWith('--') && !['--rounds', '--checkpoint-every', '--progress'].includes(value))) throw new Error('Unknown option')

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ documentId: 'multi-round-soak', units: 'millimeter' })
const line = await sdk.executeCommand('CREATE', { type: 'LINE', payload: { start: [0, 0, 0], end: [100, 0, 0] } }, { document: drawing })
const assertLine = (entity, x, y) => {
  assert.ok(entity, 'line missing')
  assert.deepEqual(entity.payload.start, [x, y, 0])
  assert.deepEqual(entity.payload.end, [x + 100, y, 0])
}
const checkpoints = []
const started = performance.now()
let maximumRssMiB = 0
for (let round = 1; round <= rounds; round += 1) {
  const priorY = (round - 1) % 2 ? -1 : 0
  const currentY = round % 2 ? -1 : 0
  await sdk.executeCommand('MOVE', { id: line.id, dx: 1, dy: round % 2 ? -1 : 1 }, { document: drawing })
  assertLine(drawing.getObject(line.id), round, currentY)
  await drawing.undo()
  assertLine(drawing.getObject(line.id), round - 1, priorY)
  await drawing.redo()
  assertLine(drawing.getObject(line.id), round, currentY)

  if (round % checkpointEvery === 0 || round === rounds) {
    const revisions = drawing.snapshot().revisions
    assert.equal(revisions.length, drawing.revision, `revision count at round ${round}`)
    for (let index = 0; index < revisions.length; index += 1) {
      assert.equal(revisions[index].revision, index + 1, `audit sequence at round ${round}`)
      if (index > 0) assert.equal(revisions[index].kind, ['commit', 'undo', 'redo'][(index - 1) % 3], `audit kind at round ${round}`)
    }
    const files = {}
    for (const format of ['KJD', 'DXF']) {
      const bytes = await sdk.writeDocument(drawing, { format, ...(format === 'DXF' ? { version: '2018' } : {}) })
      const reopened = await createKJDrawSDK().readDocument(bytes, { format })
      const entities = reopened.listEntities({ type: 'LINE' })
      assert.equal(entities.length, 1, `${format} line count at round ${round}`)
      assertLine(entities[0], round, currentY)
      if (format === 'KJD') {
        assert.equal(reopened.revision, drawing.revision, `KJD revision at round ${round}`)
        assert.equal(reopened.snapshot().revisions.length, revisions.length, `KJD audit length at round ${round}`)
      }
      files[format] = { bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') }
    }
    maximumRssMiB = Math.max(maximumRssMiB, process.memoryUsage().rss / 1024 ** 2)
    checkpoints.push({ round, files })
    if (progress) console.error(`round=${round} elapsedMs=${(performance.now() - started).toFixed(1)} rssMiB=${(process.memoryUsage().rss / 1024 ** 2).toFixed(1)}`)
  }
}
assert.equal(drawing.listEntities({ type: 'LINE' }).length, 1)
console.log(JSON.stringify({
  schema: 'com.kanjie.kjdraw.benchmark.multi-round-editor-soak@1',
  rounds,
  checkpointEvery,
  checkpointCount: checkpoints.length,
  finalRevision: drawing.revision,
  finalStart: drawing.getObject(line.id).payload.start,
  elapsedMs: Number((performance.now() - started).toFixed(1)),
  maximumSampledRssMiB: Number(maximumRssMiB.toFixed(1)),
  checkpoints,
  scope: 'One simple line in one document. Tests deterministic SDK moves, undo/redo, and KJD/DXF reopening; no language model, semantic drawing quality, or token use.',
}, null, 2))
