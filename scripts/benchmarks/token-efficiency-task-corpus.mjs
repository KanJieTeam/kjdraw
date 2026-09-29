// Frozen specifications for a paired CAD-library benchmark. The model must receive
// prompts and the seed drawing only; expectedRounds are scorer-only data.
import { createHash } from 'node:crypto'
import { manufacturingTaskSuite } from './manufacturing-task-suite.mjs'

export const tokenEfficiencyCorpusVersion = '1.0.0'
export const tokenEfficiencyCorpusSeed = 20260929
export const tokenEfficiencyCorpusSchema = 'com.kanjie.kjdraw.benchmark.token-efficiency-corpus@1'
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const xy = (x, y) => ({ x, y })
const empty = () => ({ expectedRevision: 0, units: 'millimeter', lines: [], circles: [], arcs: [], polylines: [] })
const line = (x1, y1, x2, y2) => ({ start: xy(x1, y1), end: xy(x2, y2) })
const circle = (x, y, r) => ({ center: xy(x, y), radius: r })
const arc = (x, y, r, startDegrees, endDegrees) => ({ center: xy(x, y), radius: r, startDegrees, endDegrees })
const poly = (vertices, closed = true) => ({ vertices: vertices.map(([x, y]) => xy(x, y)), closed })
const rect = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
const specs = ' All lengths and coordinates are millimeters on model XY at z=0. Use editable LINE, CIRCLE, ARC, or straight LWPOLYLINE entities only; no extra geometry, text, dimensions, hatches, or construction objects.'

function frozen(task) {
  const { acceptanceSha256, ...unhashed } = task
  return Object.freeze({ ...unhashed, acceptanceSha256: sha256(unhashed.expectedRounds) })
}

function simpleTask(family, index, prompt, expected) {
  const id = `simple-${family}-${index + 1}`
  return frozen({ id, version: tokenEfficiencyCorpusVersion, category: 'simple-one-shot', family, units: 'millimeter', seed: null,
    rounds: [{ id: 'create', prompt: prompt + specs }],
    expectedRounds: [{ id: 'create', validatorKind: 'generic', expected, requiredFeatureIds: [] }],
    provenance: { generator: family, index, corpusSeed: tokenEfficiencyCorpusSeed },
  })
}

const simple = []
for (let i = 0; i < 5; i++) {
  const w = 100 + i * 12, h = 60 + i * 7, inset = 9 + i, r = 3 + i * 0.5
  const plate = empty(); plate.polylines.push(rect(0, 0, w, h)); plate.circles.push(...[[inset, inset], [w - inset, inset], [w - inset, h - inset], [inset, h - inset]].map(([x, y]) => circle(x, y, r)))
  simple.push(simpleTask('corner-hole-plate', i, `Draw a closed ${w} by ${h} rectangular plate from origin (0,0). Add four radius-${r} holes at (${inset},${inset}), (${w - inset},${inset}), (${w - inset},${h - inset}), (${inset},${h - inset}).`, plate))

  const flange = empty(), pitch = 30 + i * 4, count = 4 + i
  flange.circles.push(circle(0, 0, 44 + i * 5), circle(0, 0, 10 + i), ...Array.from({ length: count }, (_, j) => circle(Number((pitch * Math.cos(j * 2 * Math.PI / count)).toFixed(9)), Number((pitch * Math.sin(j * 2 * Math.PI / count)).toFixed(9)), 2.5 + i * 0.25)))
  simple.push(simpleTask('radial-flange', i, `Draw concentric circles at (0,0) with outer radius ${44 + i * 5} and bore radius ${10 + i}. Add ${count} radius-${2.5 + i * 0.25} holes on radius-${pitch} pitch circle, starting at zero degrees and spaced counterclockwise equally. Do not draw the pitch circle.`, flange))

  const step = empty(), a = 80 + i * 10, b = 32 + i * 3, c = 55 + i * 4
  step.polylines.push(poly([[0, 0], [a, 0], [a, b], [c, b], [c, b + 30], [0, b + 30]]))
  step.circles.push(circle(12, 12, 3), circle(a - 12, 12, 3), circle(15, b + 18, 3))
  simple.push(simpleTask('stepped-bracket', i, `Draw one closed six-vertex bracket outline in order (0,0), (${a},0), (${a},${b}), (${c},${b}), (${c},${b + 30}), (0,${b + 30}). Add radius-3 holes at (12,12), (${a - 12},12), (15,${b + 18}).`, step))

  const rails = empty(), length = 100 + i * 20, gap = 18 + i * 3
  rails.lines.push(line(0, 0, length, 0), line(0, gap, length, gap), line(0, 0, 0, gap), line(length, 0, length, gap))
  rails.circles.push(circle(15, gap / 2, 2), circle(length - 15, gap / 2, 2))
  simple.push(simpleTask('guide-rails', i, `Draw separate LINE entities joining (0,0) to (${length},0), (0,${gap}) to (${length},${gap}), (0,0) to (0,${gap}), and (${length},0) to (${length},${gap}). Add radius-2 holes at (15,${gap / 2}) and (${length - 15},${gap / 2}).`, rails))

  const slot = empty(), left = 20 + i * 5, right = 70 + i * 10, y = 30 + i * 2, sr = 5 + i
  slot.lines.push(line(left, y - sr, right, y - sr), line(right, y + sr, left, y + sr))
  slot.arcs.push(arc(right, y, sr, 270, 90), arc(left, y, sr, 90, 270))
  simple.push(simpleTask('rounded-slot', i, `Draw one horizontal rounded slot: lower line (${left},${y - sr}) to (${right},${y - sr}), upper line (${right},${y + sr}) to (${left},${y + sr}), right radius-${sr} arc centered (${right},${y}) counterclockwise 270 to 90 degrees, and left radius-${sr} arc centered (${left},${y}) counterclockwise 90 to 270 degrees.`, slot))

  const cam = empty(), outer = 35 + i * 4, inner = 18 + i * 2
  cam.arcs.push(arc(0, 0, outer, 0, 180), arc(0, 0, inner, 0, 180))
  cam.lines.push(line(-outer, 0, -inner, 0), line(inner, 0, outer, 0))
  simple.push(simpleTask('semicircular-track', i, `Draw two upper semicircular arcs centered (0,0): radii ${outer} and ${inner}, each counterclockwise 0 to 180 degrees. Connect their negative-X endpoints and positive-X endpoints with separate straight LINE entities.`, cam))
}

function fullRound(id, prompt, features, preservedFeatureIds) {
  return { round: { id, prompt: prompt + specs }, acceptance: { id, validatorKind: 'generic', expected: geometry(features), expectedFeatures: structuredClone(features), requiredFeatureIds: features.map(feature => feature.id), preservedFeatureIds } }
}
function editTask(family, index, seed, turns) {
  const id = `edit-${family}-${index + 1}`
  return frozen({ id, version: tokenEfficiencyCorpusVersion, category: 'multi-round-edit', family, units: 'millimeter', seed,
    seedSha256: sha256(seed), rounds: turns.map(turn => turn.round), expectedRounds: turns.map(turn => turn.acceptance),
    provenance: { generator: family, index, corpusSeed: tokenEfficiencyCorpusSeed },
  })
}
function seedOf(features) { return { units: 'millimeter', features } }
function geometry(features) {
  const result = empty()
  for (const feature of features) result[feature.kind].push(structuredClone(feature.shape))
  return result
}
function feature(id, kind, shape) { return { id, kind, shape } }
function circleEditFamily(family, i, variant) {
  const w = 120 + i * 13, h = 70 + i * 6, r = 4 + i * 0.5
  const fixed = [feature('outline', 'polylines', rect(0, 0, w, h)), feature('fixed-hole', 'circles', circle(w - 18, h - 18, r))]
  let moving = feature('target-hole', 'circles', circle(20, 20, r))
  const seed = seedOf([...fixed, moving]), turns = []
  for (let j = 0; j < (family === 'hole-move-x' ? 10 : 2); j++) {
    const old = moving.shape
    const updated = variant(j, old, r, i)
    moving = feature('target-hole', 'circles', updated.shape)
    turns.push(fullRound(`revision-${j + 1}`, `${updated.prompt} Edit only target-hole in the supplied drawing; retain outline and fixed-hole exactly, including their feature identities.`, [...fixed, moving], ['outline', 'fixed-hole']))
  }
  return editTask(family, i, seed, turns)
}
const edits = []
for (let i = 0; i < 5; i++) {
  edits.push(circleEditFamily('hole-move-x', i, (j, old) => { const dx = j % 2 === 0 ? 4 + i : -(2 + i); return { shape: circle(old.center.x + dx, old.center.y, old.radius), prompt: `Move target-hole by dx=${dx}, dy=0.` } }))
  edits.push(circleEditFamily('hole-move-y', i, (j, old) => { const dy = 4 + i + j * 3; return { shape: circle(old.center.x, old.center.y + dy, old.radius), prompt: `Move target-hole by dx=0, dy=${dy}.` } }))
  edits.push(circleEditFamily('hole-diameter', i, (j, old) => { const radius = old.radius + 1 + i * 0.25; return { shape: circle(old.center.x, old.center.y, radius), prompt: `Change only target-hole to diameter ${radius * 2} while keeping its center fixed.` } }))
  edits.push(circleEditFamily('hole-correction', i, (j, old, r) => { const radius = j === 0 ? r + 2 : r; return { shape: circle(old.center.x, old.center.y, radius), prompt: `Engineering correction: set target-hole radius to ${radius}, keeping its center fixed.` } }))

  const width = 110 + i * 15, height = 65 + i * 7
  let boundary = feature('boundary', 'polylines', rect(0, 0, width, height))
  const datum = feature('datum', 'lines', line(0, -10, width, -10))
  let seed = seedOf([boundary, datum]), turns = []
  for (let j = 0; j < 2; j++) {
    const nextWidth = width + (j + 1) * (8 + i)
    boundary = feature('boundary', 'polylines', rect(0, 0, nextWidth, height))
    turns.push(fullRound(`revision-${j + 1}`, `Set the boundary right edge to x=${nextWidth}, retaining its left edge at x=0 and y extents 0..${height}. Preserve datum exactly as drawn.`, [boundary, datum], ['datum']))
  }
  edits.push(editTask('boundary-width', i, seed, turns))

  boundary = feature('boundary', 'polylines', rect(0, 0, width, height))
  seed = seedOf([boundary, datum]); turns = []
  for (let j = 0; j < 2; j++) {
    const nextHeight = height + (j + 1) * (6 + i)
    boundary = feature('boundary', 'polylines', rect(0, 0, width, nextHeight))
    turns.push(fullRound(`revision-${j + 1}`, `Set the boundary top edge to y=${nextHeight}, retaining its bottom edge at y=0 and x extents 0..${width}. Preserve datum exactly as drawn.`, [boundary, datum], ['datum']))
  }
  edits.push(editTask('boundary-height', i, seed, turns))

  let left = 20, right = 70 + i * 4, y = 25, radius = 4 + i
  const slotFeatures = () => [feature('slot-lower', 'lines', line(left, y - radius, right, y - radius)), feature('slot-upper', 'lines', line(right, y + radius, left, y + radius)), feature('slot-right', 'arcs', arc(right, y, radius, 270, 90)), feature('slot-left', 'arcs', arc(left, y, radius, 90, 270)), feature('reference-hole', 'circles', circle(100 + i * 5, 25, 2))]
  seed = seedOf(slotFeatures()); turns = []
  for (let j = 0; j < 2; j++) {
    right += 5 + i + j
    turns.push(fullRound(`revision-${j + 1}`, `Extend only the rounded slot right end to x=${right}; retain left center x=${left}, centerline y=${y}, radius ${radius}, and all four editable slot components. Preserve reference-hole exactly.`, slotFeatures(), ['reference-hole']))
  }
  edits.push(editTask('slot-length', i, seed, turns))

  let a = circle(20, 20, 3), b = circle(90 + i * 6, 20, 3)
  const outline = feature('outline', 'polylines', rect(0, 0, 130 + i * 8, 60))
  const pair = () => [outline, feature('hole-a', 'circles', a), feature('hole-b', 'circles', b)]
  seed = seedOf(pair()); turns = []
  for (let j = 0; j < 2; j++) {
    const dx = 3 + i + j
    a = circle(a.center.x + dx, a.center.y, a.radius)
    b = circle(b.center.x - dx, b.center.y, b.radius)
    turns.push(fullRound(`revision-${j + 1}`, `Move hole-a right ${dx} and hole-b left ${dx}; keep radii and y coordinates. Preserve outline exactly.`, pair(), ['outline']))
  }
  edits.push(editTask('paired-hole-spacing', i, seed, turns))
}

const manufacturing = manufacturingTaskSuite.map((source, index) => frozen({
  id: `sheet-${source.id}`, version: tokenEfficiencyCorpusVersion, category: 'complex-one-shot', family: 'manufacturing-sheet', units: 'millimeter', seed: null,
  rounds: [{ id: 'create', prompt: source.prompt }],
  expectedRounds: [{ id: 'create', validatorKind: 'manufacturing', expected: source.expected, requiredFeatureIds: [] }],
  sourceInputSha256: source.inputSha256,
  provenance: { generator: 'manufacturing-task-suite@1.0.1', index, corpusSeed: tokenEfficiencyCorpusSeed },
}))

export const tokenEfficiencyTaskCorpus = Object.freeze([...simple, ...manufacturing, ...edits])
export const tokenEfficiencyCorpusCounts = Object.freeze({ total: tokenEfficiencyTaskCorpus.length, simpleOneShot: simple.length, complexOneShot: manufacturing.length, multiRoundEdit: edits.length })
export const tokenEfficiencyCorpusSha256 = sha256(tokenEfficiencyTaskCorpus)

// Historical public pilots are outside the 100 scored tasks. They are regression
// cases, not an unseen holdout; a separate holdout must be frozen before scoring.
export const tokenEfficiencyHoldoutIds = Object.freeze(['mounting-plate', 'bolt-flange', 'stepped-profile', 'perforated-panel-209', 'fin-frame-78'])
