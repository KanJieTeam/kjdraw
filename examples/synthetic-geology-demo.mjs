import { createKJDrawSDK } from '../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../packages/kjdraw-sdk/src/agent-tools.js'
import { compileGeologySection } from '../packages/kjdraw-sdk/src/geology-engineering.js'
import { readGeologyDrawingRecipe, prepareGeologyDrawingRevision } from '../packages/kjdraw-sdk/src/geology-drawing-update.js'
import { KJDRAW_GEOLOGY_KNOWLEDGE_PACK } from '../packages/kjdraw-sdk/src/knowledge-packs/geology-core.js'

// Original public test facts. No file, historical report, MDB or model is read.
export const SYNTHETIC_GEOLOGY_PROVENANCE = Object.freeze({
  synthetic: true, measuredData: false, modelInvocations: 0,
  source: 'original-public-synthetic-facts', license: 'Apache-2.0',
  patterns: 'bundled-original-redistributable-geology-patterns',
  evidenceScope: 'deterministic-CAD-workflow-with-host-review',
})
const clone = value => structuredClone(value)
const check = (condition, message) => { if (!condition) throw new Error(message) }
const round = value => Math.round(value * 100) / 100

export function syntheticGeologySectionInput(locale = 'zh-CN') {
  const sectionStylePack = clone(KJDRAW_GEOLOGY_KNOWLEDGE_PACK)
  sectionStylePack.id = 'public-synthetic-section-legend'
  sectionStylePack.version = '1.0.0'
  sectionStylePack.title = 'Synthetic source-linked section legend / 示例源事实剖面图例'
  sectionStylePack.rules['geology-section-layout'].legendStyle = { left: 12, right: 408, bottom: 258, top: 264,
    columns: 6, swatchWidth: 8, swatchHeight: 4, textHeight: 2.2, textWidthFactor: 1, gap: 2 }
  const definitions = [
    ['fill', '示例填土', 'Synthetic fill'], ['clay', '示例黏土', 'Synthetic clay'],
    ['silty-clay', '示例粉质黏土', 'Synthetic silty clay'], ['sand', '示例砂土', 'Synthetic sand'],
    ['gravel', '示例砾石', 'Synthetic gravel'], ['weathered-rock', '示例风化岩', 'Synthetic weathered rock'],
  ]
  const stations = [0, 18, 39, 61, 83, 106, 130, 155]
  const collars = [109.4, 109.0, 108.3, 109.7, 108.8, 107.9, 108.5, 107.6]
  const depths = [30, 31, 29, 32, 31, 30, 32, 31]
  const holes = stations.map((station, index) => {
    const id = `SYN-${String(index + 1).padStart(2, '0')}`
    const boundaries = [0, round(1.8 + 0.2 * (index % 3)), round(6.3 + 0.25 * (index % 4)),
      round(12.1 + 0.3 * (index % 3)), round(18.3 + 0.25 * (index % 4)), round(24.2 + 0.2 * (index % 3)), depths[index]]
    return { id, station, collarElevation: collars[index], depth: depths[index],
      initialWaterDepth: round(6.1 + index * 0.1), stableWaterDepth: round(5.3 + index * 0.1),
      strata: definitions.map(([lithology, zh, en], layerIndex) => ({
        intervalId: `${id}-L${layerIndex + 1}`, code: String(layerIndex + 1), name: locale === 'en' ? en : zh,
        lithology, top: boundaries[layerIndex], bottom: boundaries[layerIndex + 1],
        description: locale === 'en' ? 'Synthetic supplied interval; not measured.' : '合成示例分层事实，非实测数据。',
        descriptionSource: 'interval', patternVisibility: 'filled',
      })),
      observations: [
        { kind: 'sample', id: `${id}-S1`, depth: 4.2, displayLabel: `S${index + 1}-1`, sampleMarker: 'filled-circle' },
        { kind: 'spt', id: `${id}-N1`, depth: 9.5, value: 12 + index },
        { kind: 'spt', id: `${id}-N2`, depth: 16.5, value: 21 + index },
        { kind: 'sample', id: `${id}-S2`, depth: 21.3, displayLabel: `S${index + 1}-2`, sampleMarker: 'open-circle' },
      ],
    }
  })
  return { locale, title: locale === 'en' ? 'SYNTHETIC GEOLOGICAL SECTION A-A' : '示例工程地质剖面 A-A / Synthetic',
    projectName: locale === 'en' ? 'Synthetic example' : '合成示例',
    expectedRevision: 0, holes, correlations: adjacentSyntheticLinks(holes), uncorrelatedOccurrences: [],
    sourceFactMode: 'complete-occurrence-map', horizontalScaleDenominator: 500, verticalScaleDenominator: 200,
    datumElevation: 70, surfaceRule: 'straight-between-supplied-collars', sectionStylePack,
  }
}

export function adjacentSyntheticLinks(holes) {
  return holes.slice(1).flatMap((right, index) => holes[index].strata.map((layer, layerIndex) => ({
    fromHoleId: holes[index].id, toHoleId: right.id,
    fromIntervalId: layer.intervalId, toIntervalId: right.strata[layerIndex].intervalId,
  })))
}

async function planNative(sdk, document, command, args) {
  const envelope = sdk.createCommandEnvelope(command, args, { document, mode: 'plan', origin: 'ai', expectedRevision: document.revision })
  const receipt = await sdk.executeCommandEnvelope(envelope, { document })
  check(receipt.status === 'planned', 'Synthetic host plan was not registered')
  return { envelope, receipt, async approve() {
    const approved = sdk.createCommandEnvelope(envelope.command, envelope.arguments, { document, origin: 'ai',
      expectedRevision: envelope.expectedRevision, confirmation: { status: 'confirmed', planId: envelope.id, confirmedBy: 'synthetic-demo-host' } })
    const result = await sdk.executeCommandEnvelope(approved, { document })
    check(result.status === 'committed', 'Synthetic host approval did not commit')
    return result
  } }
}

/** The initial eight-hole sheet is a trusted host compiler example. Its size
 * may exceed the agent's 512-entity creation bound; no agent admission is claimed. */
export async function createSyntheticGeologyDemo({ locale = 'zh-CN' } = {}) {
  const sdk = createKJDrawSDK(), document = sdk.createDocument({
    documentId: 'public-synthetic-geology-section', title: 'Synthetic geology example', units: 'millimeter',
    metadata: clone(SYNTHETIC_GEOLOGY_PROVENANCE), tags: ['synthetic', 'example'],
  })
  const source = { kind: 'section', input: syntheticGeologySectionInput(locale) }
  const compiled = compileGeologySection(source.input)
  const initial = await planNative(sdk, document, 'CREATEBATCH', { ...clone(compiled.commandArgs), geologySource: clone(source) })
  check(document.revision === 0 && document.listEntities().length === 0, 'Initial review mutated the document')
  const creationReceipt = await initial.approve()
  await sdk.executeCommand('CREATE', { type: 'CIRCLE', payload: { center: [402, 285, 0], radius: 1.5 },
    options: { id: 'synthetic-unrelated-reference' } }, { document, expectedRevision: document.revision })
  const session = new KJAgentToolSession(sdk, document)
  const drawingId = compiled.evidence.rootObjectId
  const recipe = readGeologyDrawingRecipe(document, drawingId)
  check(recipe.source.input.holes.length === 8, 'Synthetic source registration failed')
  return { sdk, document, session, drawingId, source: clone(recipe.source), compiled, creationReceipt,
    manual: clone(document.getObject('synthetic-unrelated-reference')),
    dispose() { for (const id of [...sdk.documents.keys()]) sdk.closeDocument(id) } }
}

const hole = (source, id) => source.input.holes.find(item => item.id === id)
const update = (source, id, fields) => ({ holeId: id, ...fields })
const exactLink = source => source.input.correlations.find(item => item.fromHoleId === 'SYN-03' && item.toHoleId === 'SYN-04' && item.fromIntervalId === 'SYN-03-L4')
const unlinkedEnds = link => [
  { holeId: link.fromHoleId, adjacentHoleId: link.toHoleId, intervalId: link.fromIntervalId },
  { holeId: link.toHoleId, adjacentHoleId: link.fromHoleId, intervalId: link.toIntervalId },
]

/** Explicit caller requests and exact parameter edits, not a mock model.
 * Only title/identity scenarios use the trusted host source-command path,
 * because those fields are not exposed by cad_propose_geology_revision. */
export const SYNTHETIC_GEOLOGY_SCENARIOS = Object.freeze([
  { id: 'collar', request: '将 SYN-03 孔口高程提高 0.65 m，重算分层和水位标注，其余孔保持。',
    build: source => ({ updates: [update(source, 'SYN-03', { collarElevation: round(hole(source, 'SYN-03').collarElevation + 0.65) })] }) },
  { id: 'depth', request: '将 SYN-08 延深 2 m，只延长底部风化岩层，保留全部观测和层间关系。', build: source => {
    const before = hole(source, 'SYN-08'), strata = clone(before.strata), depth = before.depth + 2
    strata.at(-1).bottom = depth
    return { updates: [update(source, before.id, { depth, strata })] }
  } },
  { id: 'stable-water', request: '将 SYN-02 稳定水位改为孔口以下 4.90 m，不改变初见水位或土层。',
    build: source => ({ updates: [update(source, 'SYN-02', { stableWaterDepth: 4.9 })] }) },
  { id: 'boundary', request: '将 SYN-04 黏土层底界下移 0.80 m，下一粉质黏土层顶界同步，保持连续分层。', build: source => {
    const strata = clone(hole(source, 'SYN-04').strata)
    strata[1].bottom = round(strata[1].bottom + 0.8); strata[2].top = strata[1].bottom
    return { updates: [update(source, 'SYN-04', { strata })] }
  } },
  { id: 'lithology-pattern', request: '将全部八孔表层改为示例耕植土，更新土类、原生填充和图例，保留深度与关联。', build: source => ({
    updates: source.input.holes.map(before => {
      const strata = clone(before.strata); strata[0].lithology = 'cultivated-soil'
      strata[0].name = source.input.locale === 'en' ? 'Synthetic topsoil' : '示例耕植土'
      return update(source, before.id, { strata })
    }),
  }) },
  { id: 'boundary-only', request: '仅移除八孔第一层的填充花纹，保留全部层界、层名和源事实。', build: source => ({
    updates: source.input.holes.map(before => {
      const strata = clone(before.strata); strata[0].patternVisibility = 'boundary-only'
      return update(source, before.id, { strata })
    }),
  }) },
  { id: 'sample-add', request: '在 SYN-05 孔 11.25 m 处新增独立取样 S5-NEW，不删除已有记录。', build: source => ({
    updates: [update(source, 'SYN-05', { observationChanges: { add: [
      { kind: 'sample', id: 'SYN-05-SNEW', depth: 11.25, displayLabel: 'S5-NEW', sampleMarker: 'filled-circle' } ] } })],
  }) },
  { id: 'spt-update', request: '将 SYN-03 的 N2 标贯记录值改为 32，深度保持 16.50 m，其他观测原样保留。', build: source => ({
    updates: [update(source, 'SYN-03', { observationChanges: { update: [{ target:
      { kind: 'spt', id: 'SYN-03-N2', expectedDepth: 16.5 }, set: { value: 32 } }] } })],
  }) },
  { id: 'sample-remove', request: '删除 SYN-06 的 21.30 m 取样 S2，仅删除这一条记录和对应标记。', build: source => ({
    updates: [update(source, 'SYN-06', { observationChanges: { remove: [
      { kind: 'sample', id: 'SYN-06-S2', expectedDepth: 21.3 } ] } })],
  }) },
  { id: 'unlink', request: '取消 SYN-03 与 SYN-04 砂层连接，显式保留两侧未关联状态，不推断其他连接。', build: source => {
    const link = clone(exactLink(source))
    return { updates: [], linkChanges: { correlations: { remove: [link] }, uncorrelatedOccurrences: { add: unlinkedEnds(link) } } }
  } },
  { id: 'split-layer', request: '按明确给定的新层号将八孔黏土各拆成上下两层，完整更新相邻孔关联；其他层不变。', build: source => {
    const holes = clone(source.input.holes)
    for (const before of holes) {
      const layer = before.strata[1], middle = round((layer.top + layer.bottom) / 2)
      before.strata.splice(1, 1, { ...layer, intervalId: `${before.id}-L2A`, code: '2a', bottom: middle },
        { ...layer, intervalId: `${before.id}-L2B`, code: '2b', top: middle })
    }
    return { updates: holes.map(before => update(source, before.id, { strata: before.strata })),
      correlations: adjacentSyntheticLinks(holes), uncorrelatedOccurrences: [] }
  } },
  { id: 'station', request: '将 SYN-05 里程调整为 85.50 m，保留孔高程、分层、观测以及原关联身份。',
    build: source => ({ updates: [update(source, 'SYN-05', { station: 85.5 })] }) },
  { id: 'water-unknown', request: '撤回 SYN-04 稳定水位事实，改为未知并移除该水位标记，其他水位保留。',
    build: source => ({ updates: [update(source, 'SYN-04', { clearFields: ['stableWaterDepth'] })] }) },
  { id: 'sheet-title', request: '将标题更新为新的 Synthetic 示例标题，保留同一源配方和全部孔事实。', hostSource: true, build: source => {
    const next = clone(source); next.input.title = 'Synthetic revised example / 示例修订剖面 A-A'; return next
  } },
  { id: 'hole-identity', request: '将 SYN-07 源孔编号改为 SYN-07A，同步两侧关联引用，保留区间和观测身份。', hostSource: true, build: source => {
    const next = clone(source); hole(next, 'SYN-07').id = 'SYN-07A'
    for (const link of next.input.correlations) {
      if (link.fromHoleId === 'SYN-07') link.fromHoleId = 'SYN-07A'
      if (link.toHoleId === 'SYN-07') link.toHoleId = 'SYN-07A'
    }
    for (const occurrence of next.input.uncorrelatedOccurrences) {
      if (occurrence.holeId === 'SYN-07') occurrence.holeId = 'SYN-07A'
      if (occurrence.adjacentHoleId === 'SYN-07') occurrence.adjacentHoleId = 'SYN-07A'
    }
    return next
  } },
])

/** Read current actual source, then prepare a reviewable unchanged-live-drawing
 * proposal. The caller decides when to approve; recording callers label that
 * scripted decision as an example host review, never human/model acceptance. */
export async function proposeSyntheticGeologyScenario(fixture, scenarioId) {
  const scenario = SYNTHETIC_GEOLOGY_SCENARIOS.find(item => item.id === scenarioId)
  check(scenario, 'Unknown synthetic scenario')
  const { sdk, document, drawingId, session } = fixture
  const read = await session.call('cad_read_geology_source', { expectedRevision: document.revision, drawingId, maxBytes: 262144 })
  check(read.ok && read.value.revision === document.revision, 'Synthetic source read failed')
  const previous = readGeologyDrawingRecipe(document, drawingId)
  if (scenario.hostSource) {
    const next = scenario.build(previous.source)
    const preview = prepareGeologyDrawingRevision(document, previous, next, { expectedRevision: document.revision })
    const plan = await planNative(sdk, document, 'GEOLOGY_DRAWING_UPDATE', { previous: clone(previous), next })
    return { scenario, route: 'trusted-host-source-command', beforeSource: clone(previous.source), afterSource: next,
      preview, unchangedIds: preview.unchangedIds, approve: plan.approve }
  }
  const args = { expectedRevision: document.revision, units: 'millimeter', drawingId, ...scenario.build(previous.source) }
  const result = await session.call('cad_propose_geology_revision', args)
  check(result.ok, `Synthetic ${scenarioId} proposal failed: ${result.error?.code}: ${result.error?.message}`)
  return { scenario, route: 'cad_propose_geology_revision', beforeSource: clone(previous.source),
    afterSource: { kind: result.value.engineeringEvidence.afterSource.kind, input: clone(result.value.engineeringEvidence.afterSource.facts) },
    preview: result.value.preview, unchangedIds: result.value.unchangedIds, proposal: result.value,
    async approve() {
      const approval = await session.approve(result.value.planId, 'synthetic-demo-host')
      check(approval.ok && approval.value.status === 'committed', `Synthetic ${scenarioId} approval failed`)
      return approval.value
    } }
}

export async function exportSyntheticGeologyDemo(outputDirectory) {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  const fixture = await createSyntheticGeologyDemo()
  try {
    const directory = resolve(outputDirectory)
    await mkdir(directory, { recursive: true })
    await writeFile(resolve(directory, 'synthetic-geology-section.dxf'), await fixture.sdk.writeDocument(fixture.document, { format: 'DXF' }))
    await writeFile(resolve(directory, 'synthetic-geology-section.kjd'), await fixture.sdk.writeDocument(fixture.document, { format: 'KJD' }))
    const manifest = { ...SYNTHETIC_GEOLOGY_PROVENANCE, holeCount: 8, stratumCount: 48,
      entityCount: fixture.document.listEntities().length, hatchCount: fixture.document.listEntities({ type: 'HATCH' }).length,
      correlationCount: fixture.source.input.correlations.length,
      scenarios: SYNTHETIC_GEOLOGY_SCENARIOS.map(({ id, request, hostSource }) => ({ id, request,
        route: hostSource ? 'trusted-host-source-command' : 'cad_propose_geology_revision' })) }
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    return { directory, manifest }
  } finally { fixture.dispose() }
}

if (typeof process !== 'undefined' && process.argv[1] && new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:') === process.argv[1].replaceAll('\\', '/')) {
  const outputIndex = process.argv.indexOf('--output')
  const output = outputIndex < 0 ? new URL('../.cache/synthetic-geology-demo/', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:') : process.argv[outputIndex + 1]
  if (!output) throw new Error('--output requires a directory')
  const result = await exportSyntheticGeologyDemo(output)
  console.log(JSON.stringify({ status: 'prepared', ...result.manifest }))
}
