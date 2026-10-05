// Offline KJDraw arm for a paired CAD benchmark. No model transport or scorer data.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../../packages/kjdraw-sdk/src/agent-tools.js'

const xy = point => [point.x, point.y, 0]
const finite = value => typeof value === 'number' && Number.isFinite(value)
function entityOf(feature) {
  const shape = feature.shape
  if (feature.kind === 'lines' && shape?.start && shape?.end) return ['LINE', { start: xy(shape.start), end: xy(shape.end) }]
  if (feature.kind === 'circles' && shape?.center && finite(shape.radius) && shape.radius > 0) return ['CIRCLE', { center: xy(shape.center), radius: shape.radius }]
  if (feature.kind === 'arcs' && shape?.center && finite(shape.radius) && shape.radius > 0 && finite(shape.startDegrees) && finite(shape.endDegrees))
    return ['ARC', { center: xy(shape.center), radius: shape.radius, startAngle: shape.startDegrees * Math.PI / 180, endAngle: shape.endDegrees * Math.PI / 180 }]
  if (feature.kind === 'polylines' && Array.isArray(shape?.vertices) && shape.vertices.length >= 2 && typeof shape.closed === 'boolean')
    return ['LWPOLYLINE', { vertices: shape.vertices.map(vertex => ({ point: xy(vertex) })), closed: shape.closed }]
  throw new Error(`Unsupported seed feature kind: ${feature.kind}`)
}

function knownPoint(point) { return point && finite(point.x) && finite(point.y) }
function validFeature(feature) {
  if (!feature || typeof feature.id !== 'string' || !feature.id || typeof feature.kind !== 'string') return false
  const shape = feature.shape
  if (feature.kind === 'lines') return knownPoint(shape?.start) && knownPoint(shape?.end)
  if (feature.kind === 'circles' || feature.kind === 'arcs') return knownPoint(shape?.center)
  if (feature.kind === 'polylines') return Array.isArray(shape?.vertices) && shape.vertices.every(knownPoint)
  return false
}

async function writeDrawing(state, prefix) {
  const kjd = await state.sdk.writeDocument(state.document, { format: 'KJD' })
  const dxf = await state.sdk.writeDocument(state.document, { format: 'DXF', version: '2018' })
  if (state.outputDirectory) {
    await mkdir(state.outputDirectory, { recursive: true })
    await writeFile(join(state.outputDirectory, `${prefix}.kjd`), kjd, { flag: 'wx' })
    await writeFile(join(state.outputDirectory, `${prefix}.dxf`), dxf, { flag: 'wx' })
  }
  return { kjd, dxf }
}

export async function createTokenKjdrawArm({ seed = null, outputDirectory = null, mode = 'live' } = {}) {
  if (!['live', 'fixture'].includes(mode)) throw new Error('Invalid benchmark mode')
  if (seed !== null && (seed?.units !== 'millimeter' || !Array.isArray(seed.features) ||
    seed.features.some(feature => !validFeature(feature)) || new Set(seed.features.map(feature => feature.id)).size !== seed.features.length)) throw new Error('Invalid seed features')
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: seed?.units ?? 'millimeter' })
  const featureIds = {}
  if (seed?.features.length) await document.transact('Benchmark seed', transaction => {
    for (const feature of seed.features) {
      const [type, payload] = entityOf(feature)
      featureIds[feature.id] = transaction.createEntity(type, payload).id
    }
  })
  const state = { sdk, document, session: new KJAgentToolSession(sdk, document), featureIds: Object.freeze(featureIds), outputDirectory, mode }
  const artifacts = await writeDrawing(state, 'seed')
  return { ...state, seedArtifacts: artifacts }
}

function resolveIds(state, parameters) {
  const args = structuredClone(parameters)
  if (Array.isArray(args.ids)) args.ids = args.ids.map(id => state.featureIds[id] ?? id)
  if (typeof args.id === 'string') args.id = state.featureIds[args.id] ?? args.id
  // Revision and units are host-owned. A single model response may contain
  // several proposals, each of which observes the preceding approved edit.
  args.expectedRevision = state.document.revision
  args.units = 'millimeter'
  return args
}

// Only synthetic fixtures may be auto-approved. A live caller gets an uncommitted
// proposal and must provide its own explicit reviewer action outside this helper.
export async function executeTokenKjdrawRound({ state, roundIndex, toolName, parameters, syntheticFixture = false } = {}) {
  if (!state?.sdk || !state?.document || !state?.session || !Number.isSafeInteger(roundIndex) || roundIndex < 1 ||
    typeof toolName !== 'string' || !toolName || !parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('Invalid KJDraw round')
  if (syntheticFixture && state.mode !== 'fixture') throw new Error('Synthetic auto approval requires fixture mode')
  const args = resolveIds(state, parameters), startedAt = performance.now()
  let proposal, approval = null, status = 'failed', failure = null
  try {
    proposal = await state.session.call(toolName, args)
    if (!proposal.ok || !proposal.value?.planId) { failure = proposal.error ?? 'PROPOSAL_REJECTED' }
    else if (!syntheticFixture) status = 'awaiting-review'
    else {
      approval = await state.session.approve(proposal.value.planId, 'synthetic-benchmark-fixture')
      if (approval.ok) status = 'applied'
      else failure = approval.error ?? 'APPROVAL_REJECTED'
    }
  } catch (error) { failure = error instanceof Error ? error.message : 'ROUND_ERROR' }
  const artifacts = await writeDrawing(state, `round-${roundIndex}`)
  return { status, failure, roundIndex, toolName, toolCallCount: 1, arguments: args,
    proposalPlanId: proposal?.value?.planId ?? null, proposalAccepted: proposal?.ok === true,
    approval: { kind: syntheticFixture ? 'synthetic-fixture' : 'required', approved: approval?.ok === true,
      reviewer: approval?.ok ? 'synthetic-benchmark-fixture' : null },
    totalMs: performance.now() - startedAt, timingScope: 'local-proposal-approval-export-only',
    documentRevision: state.document.revision, artifacts }
}
