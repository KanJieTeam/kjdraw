import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { availableParallelism } from 'node:os'
import { readFile } from 'node:fs/promises'

import {
  createKJDrawSDK,
  createKjpPackage,
  openKjpPackage,
} from '../../packages/kjdraw-sdk/src/index.js'

const argument = process.argv.find(value => value.startsWith('--entities='))
const entityCount = Number(argument?.split('=', 2)[1] ?? 10_000)

if (!Number.isInteger(entityCount) || entityCount < 1 || entityCount > 100_000) {
  throw new Error('--entities must be an integer from 1 to 100000')
}

const timings = {}

async function measure(name, work) {
  const startedAt = performance.now()
  const result = await work()
  timings[name] = Number((performance.now() - startedAt).toFixed(2))
  return result
}

function memory() {
  const value = process.memoryUsage()
  return Object.fromEntries(
    ['rss', 'heapUsed', 'external'].map(key => [key, Number((value[key] / 1024 / 1024).toFixed(2))]),
  )
}

const startedMemory = memory()
const sdk = createKJDrawSDK()
const document = sdk.createDocument({
  documentId: 'benchmark-core-readiness',
  title: 'Synthetic performance fixture',
  units: 'millimeter',
  createdAt: '2026-09-08T00:00:00.000Z',
})

const columns = Math.ceil(Math.sqrt(entityCount))
const entities = Array.from({ length: entityCount }, (_, index) => {
  const x = index % columns
  const y = Math.floor(index / columns)
  return {
    type: 'LINE',
    payload: { start: [x * 10, y * 10, 0], end: [x * 10 + 8, y * 10 + 6, 0] },
  }
})

const created = await measure('createBatchMs', () => sdk.executeCommand('CREATEBATCH', { entities }))
await measure('singleEntityMoveMs', () => sdk.executeCommand('MOVE', { id: created[0].id, dx: 1, dy: 1 }))
const snapshot = await measure('snapshotMs', () => document.snapshot())
const kjd = await measure('serializeKjdMs', () => sdk.writeDocument(document, { format: 'KJD' }))
const reopened = await measure('reopenKjdMs', () => createKJDrawSDK().readDocument(kjd, { format: 'KJD' }))
const kjp = await measure('packKjpMs', () => createKjpPackage({
  projectId: 'benchmark-core-readiness',
  title: 'Synthetic performance fixture',
  drawings: { [document.id]: document },
  activeDrawing: document.id,
  createdAt: '2026-09-08T00:00:00.000Z',
  modifiedAt: '2026-09-08T00:00:00.000Z',
}))
const reopenedProject = await measure('reopenKjpMs', () => openKjpPackage(kjp))

if (snapshot.revision !== 2 || reopened.listEntities().length !== entityCount || reopenedProject.activeDocument.listEntities().length !== entityCount) {
  throw new Error('Benchmark correctness check failed')
}

const report = {
  schema: 'com.kanjie.kjdraw.benchmark.core-readiness@1',
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpuCount: availableParallelism(),
  },
  fixture: {
    entityCount,
    entityType: 'LINE',
    revisions: document.revision,
    kjdBytes: Buffer.byteLength(kjd),
    kjpBytes: kjp.byteLength,
  },
  timingsMs: timings,
  memoryMiB: {
    before: startedMemory,
    after: memory(),
  },
  note: 'One local synthetic run. Use repeated runs and named hardware/browser profiles before publishing performance claims.',
}

console.log(JSON.stringify(report, null, 2))

if (process.argv.includes('--assert-budget')) {
  const budgets = JSON.parse(await readFile(new URL('../../docs/performance-budgets.json', import.meta.url), 'utf8'))
  const budget = budgets.profiles?.['core-10000-lines']
  if (!budget || entityCount !== budget.entityCount) throw new Error(`No asserted performance budget for ${entityCount} entities`)
  const failures = Object.entries(budget.maximumTimingsMs).flatMap(([name, maximum]) => {
    const actual = timings[name]
    return Number.isFinite(actual) && actual <= maximum ? [] : [`${name}: ${actual}ms > ${maximum}ms`]
  })
  const rssGrowth = Number((report.memoryMiB.after.rss - report.memoryMiB.before.rss).toFixed(2))
  if (rssGrowth > budget.maximumRssGrowthMiB) failures.push(`rssGrowthMiB: ${rssGrowth} > ${budget.maximumRssGrowthMiB}`)
  if (failures.length) {
    console.error(`Performance budget failed:\n- ${failures.join('\n- ')}`)
    process.exitCode = 1
  } else {
    console.log(`Performance budget passed for ${entityCount} entities; RSS growth ${rssGrowth} MiB.`)
  }
}
