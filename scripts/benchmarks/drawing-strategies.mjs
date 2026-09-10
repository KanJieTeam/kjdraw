// Deterministic local CAD strategy comparison. No provider requests or token estimates.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../../packages/kjdraw-sdk/src/agent-tools.js'
import { pilotTasks } from './model-drawing-pilot.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const groups = ['lines', 'circles', 'arcs', 'polylines']
const strategies = ['per-entity', 'batched-64']
const empty = revision => ({ expectedRevision: revision, units: 'millimeter', lines: [], circles: [], arcs: [], polylines: [] })
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const xy = (x, y) => ({ x, y })

function perforatedPanel() {
  const expected = empty(0)
  expected.polylines.push({ vertices: [xy(0, 0), xy(1680, 0), xy(1680, 1280), xy(0, 1280)], closed: true })
  for (let row = 0; row < 12; row++) for (let column = 0; column < 16; column++) expected.circles.push({ center: xy(40 + column * 100, 50 + row * 100), radius: 8 })
  for (let index = 0; index < 4; index++) {
    const x = 160 + index * 400, y = 1220
    expected.lines.push({ start: xy(x, y - 10), end: xy(x + 100, y - 10) }, { start: xy(x + 100, y + 10), end: xy(x, y + 10) })
    expected.arcs.push({ center: xy(x + 100, y), radius: 10, startDegrees: 270, endDegrees: 90 }, { center: xy(x, y), radius: 10, startDegrees: 90, endDegrees: 270 })
  }
  return { id: 'perforated-panel-209', prompt: 'Create a closed 1680 × 1280 mm rectangular panel. Place 192 radius-8 holes in 16 columns and 12 rows: centers (40 + 100 column, 50 + 100 row), indices starting at zero. Add four horizontal rounded slots centered at y=1220 with semicircle centers x=160+400 index and x+100, radius 10; indices 0 through 3. No other geometry.', expected }
}

export const strategyTasks = [...pilotTasks, perforatedPanel()]

export function proposalBatches(expected, size) {
  if (![1, 64].includes(size)) throw new Error('Unsupported strategy batch size')
  const entities = groups.flatMap(group => expected[group].map(value => ({ group, value })))
  const batches = []
  for (let offset = 0; offset < entities.length; offset += size) {
    const batch = empty(0)
    for (const { group, value } of entities.slice(offset, offset + size)) batch[group].push(structuredClone(value))
    batches.push(batch)
  }
  return batches
}

const coordinate = value => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Non-finite geometry')
  return Math.round(value * 1e6) / 1e6
}
const point = values => values.slice(0, 2).map(coordinate)
const lineShape = (a, b) => ['line', ...[point(a), point(b)].sort((x, y) => x[0] - y[0] || x[1] - y[1])]
const degrees = value => coordinate(((value % 360) + 360) % 360)
function expectedShapes(expected) {
  const shapes = expected.lines.map(line => lineShape([line.start.x, line.start.y], [line.end.x, line.end.y]))
  shapes.push(...expected.circles.map(circle => ['circle', point([circle.center.x, circle.center.y]), coordinate(circle.radius)]))
  shapes.push(...expected.arcs.map(arc => ['arc', point([arc.center.x, arc.center.y]), coordinate(arc.radius), degrees(arc.startDegrees), degrees(arc.endDegrees)]))
  for (const polyline of expected.polylines) {
    const vertices = polyline.vertices.map(value => [value.x, value.y])
    for (let index = 1; index < vertices.length; index++) shapes.push(lineShape(vertices[index - 1], vertices[index]))
    if (polyline.closed) shapes.push(lineShape(vertices.at(-1), vertices[0]))
  }
  return shapes.map(JSON.stringify).sort()
}

/** Compare actual entities with task geometry, not with output from the other arm. */
export function checkDrawing(document, expected) {
  const shapes = [], entities = document.listEntities(), snapshot = document.snapshot()
  for (const entity of entities) {
    const value = entity.payload
    if (entity.ownerId !== snapshot.spaces.modelSpaceId) throw new Error('Unexpected non-model geometry')
    if (entity.type === 'LINE') {
      if (value.start[2] !== 0 || value.end[2] !== 0) throw new Error('Unexpected non-XY line')
      shapes.push(lineShape(value.start, value.end))
    } else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
      if (value.center[2] !== 0) throw new Error('Unexpected non-XY circle or arc')
      shapes.push(entity.type === 'CIRCLE' ? ['circle', point(value.center), coordinate(value.radius)] : ['arc', point(value.center), coordinate(value.radius), degrees(value.startAngle * 180 / Math.PI), degrees(value.endAngle * 180 / Math.PI)])
      if (entity.type === 'ARC' && value.clockwise) throw new Error('Unexpected clockwise arc')
    } else if (entity.type === 'LWPOLYLINE') {
      if (value.vertices.some(vertex => vertex.point[2] !== 0 || vertex.bulge !== 0) || value.elevation !== 0) throw new Error('Unexpected curved or non-XY polyline')
      for (let index = 1; index < value.vertices.length; index++) shapes.push(lineShape(value.vertices[index - 1].point, value.vertices[index].point))
      if (value.closed) shapes.push(lineShape(value.vertices.at(-1).point, value.vertices[0].point))
    } else throw new Error('Unexpected entity type')
  }
  const actual = shapes.map(JSON.stringify).sort(), wanted = expectedShapes(expected)
  const unitsCorrect = snapshot.header.units === expected.units
  const passed = unitsCorrect && JSON.stringify(actual) === JSON.stringify(wanted)
  return { passed, unitsCorrect, expectedShapes: wanted.length, actualShapes: actual.length, entities: entities.length, geometrySha256: sha256(JSON.stringify(actual)) }
}

export async function executeStrategy(task, strategy) {
  if (!strategies.includes(strategy)) throw new Error('Unknown strategy')
  const started = performance.now()
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ documentId: `strategy-${task.id}`, units: 'millimeter' })
  const batches = proposalBatches(task.expected, strategy === 'per-entity' ? 1 : 64)
  const calls = []
  const buildStarted = performance.now()
  for (const batch of batches) {
    batch.expectedRevision = document.revision
    const call = { name: 'cad_propose_drawing', arguments: batch }
    calls.push(call)
    // Both strategies use the same review path and start one session per proposal.
    // Automatic approval is restricted to these original synthetic benchmark documents.
    const session = new KJAgentToolSession(sdk, document)
    const proposal = await session.call(call.name, call.arguments)
    if (!proposal.ok) throw new Error(`Synthetic proposal failed: ${proposal.error.code}`)
    const approved = await session.approve(proposal.value.planId, 'synthetic-strategy-benchmark')
    if (!approved.ok) throw new Error(`Synthetic approval failed: ${approved.error.code}`)
  }
  const buildMs = performance.now() - buildStarted
  const original = checkDrawing(document, task.expected)
  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const rawDxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const dxf = typeof rawDxf === 'string' ? rawDxf : new TextDecoder().decode(rawDxf)
  const reopenedKjd = checkDrawing(await createKJDrawSDK().readDocument(kjd, { format: 'KJD' }), task.expected)
  const reopenedDxf = checkDrawing(await createKJDrawSDK().readDocument(dxf, { format: 'DXF' }), task.expected)
  const beforeUndo = document.listEntities().length
  await sdk.executeCommand('UNDO')
  const lastBatchSize = groups.reduce((sum, group) => sum + batches.at(-1)[group].length, 0)
  const undoPassed = document.listEntities().length === beforeUndo - lastBatchSize
  await sdk.executeCommand('REDO')
  const redoPassed = checkDrawing(document, task.expected).passed
  const totalMs = performance.now() - started
  return {
    taskId: task.id, strategy, buildMs, totalMs,
    toolCalls: calls.length, toolCallJsonBytes: calls.reduce((sum, call) => sum + bytes(call), 0),
    passed: original.passed && reopenedKjd.passed && reopenedDxf.passed && undoPassed && redoPassed,
    checks: { original, reopenedKjd, reopenedDxf, undoPassed, redoPassed },
    provider: { inputTokens: null, outputTokens: null, cachedInputTokens: null, modelLatencyMs: null, cost: null },
    artifacts: { kjd, dxf, calls, preview: drawingPreview(document, task.id, strategy) },
  }
}

const median = values => { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 }
export function summarizeRuns(runs, taskIds) {
  return taskIds.map(taskId => ({ taskId, strategies: Object.fromEntries(strategies.map(strategy => {
    const group = runs.filter(run => run.taskId === taskId && run.strategy === strategy)
    if (!group.length || group.some(run => !Number.isFinite(run.buildMs) || !Number.isFinite(run.totalMs))) throw new Error('Incomplete benchmark runs')
    return [strategy, { repetitions: group.length, passed: group.filter(run => run.passed).length, buildMedianMs: median(group.map(run => run.buildMs)), totalMedianMs: median(group.map(run => run.totalMs)), toolCallJsonBytes: median(group.map(run => run.toolCallJsonBytes)), toolCalls: median(group.map(run => run.toolCalls)) }]
  })) }))
}

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
export function drawingPreview(document, taskId, strategy) {
  const elements = [], bounds = []
  const add = point => { bounds.push(point); return `${point[0]},${-point[1]}` }
  for (const entity of document.listEntities()) {
    const value = entity.payload
    if (entity.type === 'LINE') elements.push(`<polyline points="${add(value.start)} ${add(value.end)}"/>`)
    else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
      const [x, y] = value.center, r = value.radius
      bounds.push([x - r, y - r], [x + r, y + r])
      if (entity.type === 'CIRCLE') elements.push(`<circle cx="${x}" cy="${-y}" r="${r}"/>`)
      else {
        const a = value.startAngle, b = value.endAngle, sweep = ((b - a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
        elements.push(`<path d="M ${x + r * Math.cos(a)} ${-y - r * Math.sin(a)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 0 ${x + r * Math.cos(b)} ${-y - r * Math.sin(b)}"/>`)
      }
    } else if (entity.type === 'LWPOLYLINE') {
      const points = value.vertices.map(vertex => vertex.point)
      if (value.closed) points.push(points[0])
      elements.push(`<polyline points="${points.map(add).join(' ')}"/>`)
    } else throw new Error('Unsupported benchmark preview entity')
  }
  if (!bounds.length) throw new Error('Cannot preview empty benchmark drawing')
  const x0 = Math.min(...bounds.map(point => point[0])), x1 = Math.max(...bounds.map(point => point[0]))
  const y0 = Math.min(...bounds.map(point => point[1])), y1 = Math.max(...bounds.map(point => point[1]))
  const pad = Math.max(x1 - x0, y1 - y0) * .04 || 1
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650" viewBox="0 0 1000 650" role="img" aria-label="Actual benchmark drawing ${escape(taskId)}"><rect width="1000" height="650" fill="#09141c"/><text x="24" y="35" fill="#e5edf5" font-family="Arial,sans-serif" font-size="22">${escape(taskId)} · ${escape(strategy)}</text><text x="24" y="60" fill="#9cabbc" font-family="Arial,sans-serif" font-size="14">Actual editable CAD output · ${document.listEntities().length} entities · millimeters · deterministic fixture, not model-generated</text><svg x="24" y="86" width="952" height="524" viewBox="${x0 - pad} ${-y1 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}" preserveAspectRatio="xMidYMid meet"><style>polyline,path,circle{fill:none;stroke:#9ee4f0;stroke-width:1.2;vector-effect:non-scaling-stroke}</style>${elements.join('')}</svg><text x="24" y="633" fill="#9cabbc" font-family="Arial,sans-serif" font-size="13">Synthetic geometry only; not a production-ready engineering design. Download matching KJD/DXF and inspect report.json.</text></svg>`
}

export function comparisonCharts(report) {
  const charts = [
    ['tool-payload.svg', 'Tool-call payload', 'UTF-8 JSON bytes · lower is smaller · not model tokens', arm => arm.toolCallJsonBytes, value => `${Math.round(value).toLocaleString('en-US')} B`],
    ['local-time.svg', 'Local proposal + approval time', 'Median milliseconds · local SDK only · not AI inference latency', arm => arm.buildMedianMs, value => `${value.toFixed(2)} ms`],
    ['geometry-correctness.svg', 'Geometry and persistence checks', 'Passing repetitions · both strategies draw the same requested geometry', arm => arm.passed / arm.repetitions * 100, value => `${value.toFixed(0)}%`],
  ]
  return Object.fromEntries(charts.map(([name, title, subtitle, select, format]) => {
    const max = Math.max(1, ...report.summary.flatMap(row => strategies.map(strategy => select(row.strategies[strategy]))))
    const height = 228 + report.summary.length * 114
    const rows = report.summary.map((row, index) => {
      const y = 136 + index * 114
      return `<text x="30" y="${y}" class="task">${escape(row.taskId)}</text>` + strategies.map((strategy, arm) => {
        const value = select(row.strategies[strategy]), width = value / max * 640
        return `<rect x="30" y="${y + 12 + arm * 28}" width="${width.toFixed(2)}" height="19" rx="3" fill="${arm ? '#2863f0' : '#758397'}"/><text x="${Math.min(820, 40 + width).toFixed(2)}" y="${y + 27 + arm * 28}" class="value">${escape(format(value))}</text>`
      }).join('')
    }).join('')
    return [name, `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}" role="img" aria-label="${escape(title)}"><rect width="1000" height="${height}" fill="#f5f7fb"/><style>text{font-family:Arial,sans-serif;fill:#17233c}.title{font-size:30px;font-weight:700}.subtitle{font-size:15px;fill:#53647c}.task{font-size:16px;font-weight:700}.value{font-size:14px}</style><text x="30" y="27" class="subtitle">LOCAL SDK STRATEGY BENCHMARK · NO MODEL CALLS</text><text x="30" y="67" class="title">${escape(title)}</text><text x="30" y="92" class="subtitle">${escape(subtitle)}</text><rect x="690" y="20" width="14" height="14" fill="#758397"/><text x="712" y="32" class="value">Per-entity proposals</text><rect x="690" y="45" width="14" height="14" fill="#2863f0"/><text x="712" y="57" class="value">Batched proposals (≤64)</text>${rows}<text x="30" y="${height - 54}" class="subtitle">Same KJDraw core in both arms · ${report.repetitions} repetitions · ${escape(report.environment.node)}</text><text x="30" y="${height - 28}" class="subtitle">Real model tokens, model latency and cost: NOT MEASURED. See report.json for raw runs and scope.</text></svg>`]
  }))
}

async function sourceFingerprint() {
  const folder = new URL('../../packages/kjdraw-sdk/src/', import.meta.url)
  const paths = (await readdir(folder, { recursive: true })).map(path => path.replaceAll('\\', '/')).filter(path => /\.(?:js|ts)$/.test(path)).sort()
  const hash = createHash('sha256')
  for (const path of paths) { hash.update(path); hash.update(await readFile(new URL(path, folder))) }
  let commit = null, dirty = null
  try {
    const args = ['-c', `safe.directory=${root.replaceAll('\\', '/')}`]
    commit = execFileSync('git', [...args, 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    dirty = Boolean(execFileSync('git', [...args, 'status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())
  } catch { /* The content hash remains available without Git. */ }
  return { commit, dirty, sdkSourceSha256: hash.digest('hex'), scriptSha256: sha256(await readFile(fileURLToPath(import.meta.url))) }
}

export async function runStrategyBenchmark({ output, repetitions = 5, tasks = strategyTasks }) {
  if (typeof output !== 'string' || !output.trim() || !Number.isSafeInteger(repetitions) || repetitions < 5 || repetitions > 30) throw new Error('Provide a new output directory and 5–30 repetitions')
  if (!Array.isArray(tasks) || !tasks.length || tasks.some(task => !strategyTasks.includes(task))) throw new Error('Only versioned original benchmark tasks are allowed')
  const target = resolve(output)
  await mkdir(dirname(target), { recursive: true }); await mkdir(target)
  const report = {
    schema: 'com.kanjie.kjdraw.benchmark.drawing-strategies@1', createdAt: new Date().toISOString(), repetitions,
    scope: 'Deterministic local SDK strategy comparison, not a model or competitor benchmark. Both arms use the same KJDraw CAD core and synthetic host approval. Per-entity edits have different undo granularity from batches. UTF-8 call-envelope bytes exclude schema, prompts, history and provider framing; they are not token counts. Build timing includes proposals and synthetic approval. Total timing adds document creation, checks, KJD/DXF serialization and in-memory reopening, undo and redo; artifact filesystem writes are excluded. KJD/DXF reopen uses KJDraw, not an independent CAD reader. No real-model quality, token savings, inference speed or cost advantage is established.',
    environment: { node: process.version, platform: process.platform, architecture: process.arch, cpu: cpus()[0]?.model ?? null, isolation: 'Not controlled; other workstation processes may run concurrently.' },
    source: await sourceFingerprint(), tasks: tasks.map(task => ({ id: task.id, prompt: task.prompt, expected: task.expected, fixtureSha256: sha256(JSON.stringify(task.expected)) })),
    provider: { measured: false, model: null, inputTokens: null, outputTokens: null, cachedInputTokens: null, modelLatencyMs: null, cost: null },
    fixtureGeneration: 'Versioned fixed coordinates; no random generator or selected random seed. Both arms receive exactly the same task and expected geometry.',
    artifactPolicy: 'Save representative KJD, DXF, call trace and actual-geometry SVG for repetition 1 of every task/arm. All repetitions retain timings, checks and call-trace hashes; no failed measured repetition is discarded.',
    warmup: 'Each selected task and arm executes once before measured repetitions; warmup is not included in timing statistics.', warmupResults: [], runs: [], summary: [],
  }
  for (const task of tasks) for (const strategy of strategies) {
    try { report.warmupResults.push({ taskId: task.id, strategy, passed: (await executeStrategy(task, strategy)).passed }) }
    catch (error) { report.warmupResults.push({ taskId: task.id, strategy, passed: false, failure: String(error.message).slice(0, 200) }) }
  }
  for (let repetition = 0; repetition < repetitions; repetition++) for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
    const task = tasks[taskIndex]
    const order = (repetition + taskIndex) % 2 ? [...strategies].reverse() : strategies
    for (const strategy of order) {
      let result
      try {
        const { artifacts, ...measured } = await executeStrategy(task, strategy)
        const prefix = `${task.id}-${strategy}-${repetition + 1}`
        const files = repetition === 0 ? { kjd: `${prefix}.kjd`, dxf: `${prefix}.dxf`, calls: `${prefix}-calls.json`, preview: `${prefix}.svg` } : {}
        const content = { kjd: artifacts.kjd, dxf: artifacts.dxf, calls: JSON.stringify(artifacts.calls, null, 2), preview: artifacts.preview }
        const checksums = {}
        for (const [kind, name] of Object.entries(files)) { await writeFile(resolve(target, name), content[kind], { flag: 'wx' }); checksums[kind] = sha256(content[kind]) }
        result = { ...measured, files, sha256: checksums, callTraceSha256: sha256(JSON.stringify(artifacts.calls)) }
      } catch (error) {
        result = { taskId: task.id, strategy, passed: false, buildMs: null, totalMs: null, failure: String(error.message).slice(0, 200) }
      }
      report.runs.push({ repetition: repetition + 1, order: order.indexOf(strategy), ...result })
    }
  }
  report.sourceAfter = await sourceFingerprint()
  report.stableSdkSource = report.source.sdkSourceSha256 === report.sourceAfter.sdkSourceSha256
  if (report.stableSdkSource && report.runs.every(run => Number.isFinite(run.buildMs) && Number.isFinite(run.totalMs))) report.summary = summarizeRuns(report.runs, tasks.map(task => task.id))
  await writeFile(resolve(target, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  if (report.summary.length) for (const [name, content] of Object.entries(comparisonCharts(report))) await writeFile(resolve(target, name), content, { flag: 'wx' })
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(argument => !/^--(?:output|repetitions)=.+$/.test(argument))) throw new Error('Use --output=NEW_DIRECTORY --repetitions=5')
  const output = args.find(argument => argument.startsWith('--output='))?.slice(9)
  const repetitions = Number(args.find(argument => argument.startsWith('--repetitions='))?.slice(14) ?? 5)
  const report = await runStrategyBenchmark({ output, repetitions })
  console.log(JSON.stringify({ output: resolve(output), runs: report.runs.length, passed: report.runs.filter(run => run.passed).length, providerMeasured: false, summary: report.summary }, null, 2))
  if (!report.stableSdkSource || report.runs.some(run => !run.passed)) process.exitCode = 1
}
