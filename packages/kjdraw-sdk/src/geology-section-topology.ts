import { KJValidationError } from './errors.js'

export interface KJSectionTopologyStratum {
  intervalId?: string
  groupId?: string
  groupRole?: 'principal' | 'lens'
  code: string
  top: number
  bottom: number
}

export interface KJSectionTopologyHole {
  id: string
  station: number
  collarElevation: number
  depth: number
  strata: readonly KJSectionTopologyStratum[]
}

export interface KJSectionTopologyPoint { station: number; elevation: number }

export interface KJSectionTopologyCell {
  kind: 'main' | 'lens'
  identity: string
  occurrence: number
  leftHoleId: string
  rightHoleId: string
  points: KJSectionTopologyPoint[]
  source: KJSectionTopologyStratum
  pinchout: boolean
}

export interface KJSectionTopologyBoundary {
  identity: string
  leftHoleId: string
  rightHoleId: string
  mode: 'known-known' | 'known-missing-midpoint' | 'missing-known-midpoint'
  points: [KJSectionTopologyPoint, KJSectionTopologyPoint]
}

export interface KJSectionTopologyResult {
  mainCells: KJSectionTopologyCell[]
  lensCells: KJSectionTopologyCell[]
  mainBoundaries: KJSectionTopologyBoundary[]
  mainIdentityCount: number
  lensIdentityCount: number
}

interface NormalizedInterval {
  source: KJSectionTopologyStratum
  identity: string
  topElevation: number
  bottomElevation: number
  boundaryBottomElevation?: number
  terminalAtHoleBottom: boolean
}

interface NormalizedHole {
  source: KJSectionTopologyHole
  main: Map<string, NormalizedInterval>
  lenses: Map<string, NormalizedInterval[]>
  mainSequence: string[]
  lensSequence: NormalizedInterval[]
}

const EPSILON = 1e-6
const TOPOLOGY_ENTITY_BUDGET = 2048
const finite = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new KJValidationError(`Geology section topology: ${label} must be finite`)
  return value
}
const boundedText = (value: unknown, label: string, maximum = 64): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new KJValidationError(`Geology section topology: ${label} is invalid`)
  return value
}

/**
 * Compile source-declared major groups and exact lens occurrences into section
 * cells. A final interval ending at exploration depth proves presence only; it
 * does not prove a geological bottom. No correlation is invented from names,
 * lithology or visual proximity.
 */
export function compileGeologySectionTopology(rawHoles: readonly KJSectionTopologyHole[]): KJSectionTopologyResult {
  if (!Array.isArray(rawHoles) || rawHoles.length < 2 || rawHoles.length > 24)
    throw new KJValidationError('Geology section topology: 2-24 holes are required')
  const holes = [...rawHoles].sort((a, b) => finite(a.station, 'station') - finite(b.station, 'station'))
  const ids = new Set<string>()
  const mainOrder: string[] = [], lensOrder: string[] = []
  const seenMain = new Set<string>(), seenLens = new Set<string>()
  const normalized: NormalizedHole[] = holes.map((hole, holeIndex) => {
    const id = boundedText(hole.id, `hole ${holeIndex + 1} id`, 40)
    if (ids.has(id)) throw new KJValidationError(`Geology section topology: duplicate hole ${id}`)
    ids.add(id)
    const station = finite(hole.station, `${id} station`), collar = finite(hole.collarElevation, `${id} collar elevation`)
    const depth = finite(hole.depth, `${id} depth`)
    if (depth <= 0) throw new KJValidationError(`Geology section topology: ${id} depth must be positive`)
    if (!Array.isArray(hole.strata) || !hole.strata.length || hole.strata.length > 80)
      throw new KJValidationError(`Geology section topology: ${id} needs 1-80 intervals`)
    const main = new Map<string, NormalizedInterval>(), lenses = new Map<string, NormalizedInterval[]>()
    const groupedRows = new Map<string, NormalizedInterval[]>(), principalRows = new Map<string, NormalizedInterval[]>()
    const mainSequence: string[] = [], lensSequence: NormalizedInterval[] = []
    const closedGroups = new Set<string>(), intervalIds = new Set<string>()
    let currentGroup: string | undefined, previousBottom = 0
    const strata = [...hole.strata].sort((a, b) => finite(a.top, 'interval top') - finite(b.top, 'interval top'))
    for (const [intervalIndex, stratum] of strata.entries()) {
      const groupId = boundedText(stratum.groupId, `${id} interval ${intervalIndex + 1} group id`, 24)
      const code = boundedText(stratum.code, `${id} interval ${intervalIndex + 1} code`, 24)
      if (stratum.groupRole !== 'principal' && stratum.groupRole !== 'lens')
        throw new KJValidationError(`Geology section topology: ${id} interval ${intervalIndex + 1} needs a principal/lens role`)
      const top = finite(stratum.top, `${id} interval top`), bottom = finite(stratum.bottom, `${id} interval bottom`)
      if (top < -EPSILON || Math.abs(top - previousBottom) > EPSILON || bottom <= top + EPSILON || bottom > depth + EPSILON)
        throw new KJValidationError(`Geology section topology: ${id} interval depths are invalid`)
      previousBottom = bottom
      if (stratum.intervalId != null) {
        const intervalId = boundedText(stratum.intervalId, `${id} interval identity`)
        if (intervalIds.has(intervalId)) throw new KJValidationError(`Geology section topology: ${id} has a repeated interval identity`)
        intervalIds.add(intervalId)
      }
      if (groupId !== currentGroup) {
        if (currentGroup != null) closedGroups.add(currentGroup)
        if (closedGroups.has(groupId)) throw new KJValidationError(`Geology section topology: ${id} has a discontinuous major group`)
        currentGroup = groupId; mainSequence.push(groupId)
      }
      const terminalAtHoleBottom = Math.abs(bottom - depth) <= EPSILON
      const row: NormalizedInterval = { source: stratum, identity: stratum.groupRole === 'principal' ? groupId : `${groupId}\u0000${code}`,
        topElevation: collar - top, bottomElevation: collar - bottom, terminalAtHoleBottom,
        ...(terminalAtHoleBottom ? {} : { boundaryBottomElevation: collar - bottom }) }
      const group = groupedRows.get(groupId) ?? []
      group.push(row); groupedRows.set(groupId, group)
      if (stratum.groupRole === 'principal') {
        const principals = principalRows.get(groupId) ?? []
        if (principals.some(prior => prior.source.code !== code))
          throw new KJValidationError(`Geology section topology: ${id} principal intervals disagree on their major group identity`)
        principals.push(row); principalRows.set(groupId, principals)
      } else {
        if (!seenLens.has(row.identity)) { seenLens.add(row.identity); lensOrder.push(row.identity) }
        const rows = lenses.get(row.identity) ?? []
        lensSequence.push(row)
        rows.push(row); lenses.set(row.identity, rows)
      }
    }
    if (Math.abs(previousBottom - depth) > EPSILON)
      throw new KJValidationError(`Geology section topology: ${id} intervals must continuously reach the supplied exploration depth`)
    for (const [groupId, rows] of groupedRows) {
      const principals = principalRows.get(groupId)
      if (!principals?.length) throw new KJValidationError(`Geology section topology: ${id} major group lacks a principal interval`)
      if (!seenMain.has(groupId)) { seenMain.add(groupId); mainOrder.push(groupId) }
      const shallowest = rows.reduce((best, row) => row.topElevation > best.topElevation ? row : best)
      const deepest = rows.reduce((best, row) => row.bottomElevation < best.bottomElevation ? row : best)
      main.set(groupId, { source: principals[0]!.source, identity: groupId,
        topElevation: shallowest.topElevation, bottomElevation: deepest.bottomElevation,
        terminalAtHoleBottom: deepest.terminalAtHoleBottom,
        ...(deepest.boundaryBottomElevation == null ? {} : { boundaryBottomElevation: deepest.boundaryBottomElevation }) })
    }
    for (const rows of lenses.values()) rows.sort((a, b) => b.topElevation - a.topElevation || b.bottomElevation - a.bottomElevation)
    return { source: { ...hole, id, station, collarElevation: collar, depth }, main, lenses, mainSequence, lensSequence }
  })
  for (let index = 1; index < normalized.length; index++) if (normalized[index]!.source.station <= normalized[index - 1]!.source.station)
    throw new KJValidationError('Geology section topology: stations must be strictly increasing')
  const precedes = new Map<string, Set<string>>()
  for (const hole of normalized) for (let left = 0; left < hole.mainSequence.length; left++) for (let right = left + 1; right < hole.mainSequence.length; right++) {
    const before = hole.mainSequence[left]!, after = hole.mainSequence[right]!
    const targets = precedes.get(before) ?? new Set<string>(); targets.add(after); precedes.set(before, targets)
  }
  const visiting = new Set<string>(), visited = new Set<string>()
  const visit = (identity: string): void => {
    if (visiting.has(identity)) throw new KJValidationError('Geology section topology: major groups cross or reverse stratigraphic order')
    if (visited.has(identity)) return
    visiting.add(identity)
    for (const target of precedes.get(identity) ?? []) visit(target)
    visiting.delete(identity); visited.add(identity)
  }
  for (const identity of mainOrder) visit(identity)
  const maximumLensOccurrences = new Map(lensOrder.map(identity => [identity,
    Math.max(...normalized.map(hole => hole.lenses.get(identity)?.length ?? 0))]))
  const lensOccurrenceKey = (row: NormalizedInterval): string => {
    if ((maximumLensOccurrences.get(row.identity) ?? 0) <= 1) return row.identity
    const occurrenceIdentity = boundedText(row.source.intervalId, 'repeated lens occurrence identity')
    return `${row.identity}\u0000${occurrenceIdentity}`
  }
  const lensPrecedes = new Map<string, Set<string>>()
  for (const hole of normalized) for (let left = 0; left < hole.lensSequence.length; left++) for (let right = left + 1; right < hole.lensSequence.length; right++) {
    const before = lensOccurrenceKey(hole.lensSequence[left]!), after = lensOccurrenceKey(hole.lensSequence[right]!)
    const targets = lensPrecedes.get(before) ?? new Set<string>(); targets.add(after); lensPrecedes.set(before, targets)
  }
  const visitingLens = new Set<string>(), visitedLens = new Set<string>()
  const visitLens = (identity: string): void => {
    if (visitingLens.has(identity)) throw new KJValidationError('Geology section topology: lens occurrences cross or reverse stratigraphic order')
    if (visitedLens.has(identity)) return
    visitingLens.add(identity)
    for (const target of lensPrecedes.get(identity) ?? []) visitLens(target)
    visitingLens.delete(identity); visitedLens.add(identity)
  }
  for (const hole of normalized) for (const row of hole.lensSequence) visitLens(lensOccurrenceKey(row))

  const provesAbsence = (hole: NormalizedHole, present: NormalizedInterval): boolean =>
    hole.source.collarElevation >= present.topElevation - EPSILON &&
    hole.source.collarElevation - hole.source.depth <= present.bottomElevation + EPSILON

  const cell = (kind: 'main' | 'lens', identity: string, occurrence: number, leftHole: NormalizedHole, rightHole: NormalizedHole,
    left: NormalizedInterval | undefined, right: NormalizedInterval | undefined): KJSectionTopologyCell | undefined => {
    if (!left && !right || left?.terminalAtHoleBottom || right?.terminalAtHoleBottom ||
      left && !right && !provesAbsence(rightHole, left) || right && !left && !provesAbsence(leftHole, right)) return undefined
    const x0 = leftHole.source.station, x1 = rightHole.source.station, midpoint = (x0 + x1) / 2
    if (left && right) return { kind, identity, occurrence, leftHoleId: leftHole.source.id, rightHoleId: rightHole.source.id,
      points: [{ station: x0, elevation: left.bottomElevation }, { station: x1, elevation: right.bottomElevation },
        { station: x1, elevation: right.topElevation }, { station: x0, elevation: left.topElevation }], source: left.source, pinchout: false }
    const present = left ?? right!, sharp = (present.topElevation + present.bottomElevation) / 2
    return left
      ? { kind, identity, occurrence, leftHoleId: leftHole.source.id, rightHoleId: rightHole.source.id,
          points: [{ station: x0, elevation: left.bottomElevation }, { station: midpoint, elevation: sharp }, { station: x0, elevation: left.topElevation }], source: left.source, pinchout: true }
      : { kind, identity, occurrence, leftHoleId: leftHole.source.id, rightHoleId: rightHole.source.id,
          points: [{ station: midpoint, elevation: sharp }, { station: x1, elevation: present.bottomElevation }, { station: x1, elevation: present.topElevation }], source: present.source, pinchout: true }
  }

  const mainCells: KJSectionTopologyCell[] = [], lensCells: KJSectionTopologyCell[] = [], mainBoundaries: KJSectionTopologyBoundary[] = []
  const pushBudgeted = <T>(target: T[], value: T): void => {
    if (mainCells.length + lensCells.length + mainBoundaries.length >= TOPOLOGY_ENTITY_BUDGET)
      throw new KJValidationError('Geology section topology: generated topology exceeds its entity budget')
    target.push(value)
  }
  for (const identity of mainOrder) for (let index = 0; index < normalized.length - 1; index++) {
    const leftHole = normalized[index]!, rightHole = normalized[index + 1]!, left = leftHole.main.get(identity), right = rightHole.main.get(identity)
    const region = cell('main', identity, 0, leftHole, rightHole, left, right)
    if (region) pushBudgeted(mainCells, region)
    if (left?.terminalAtHoleBottom || right?.terminalAtHoleBottom) continue
    const leftElevation = left?.boundaryBottomElevation, rightElevation = right?.boundaryBottomElevation
    if (leftElevation == null && rightElevation == null) continue
    const x0 = leftHole.source.station, x1 = rightHole.source.station, midpoint = (x0 + x1) / 2
    if (leftElevation != null && rightElevation != null) pushBudgeted(mainBoundaries, { identity, leftHoleId: leftHole.source.id, rightHoleId: rightHole.source.id,
      mode: 'known-known', points: [{ station: x0, elevation: leftElevation }, { station: x1, elevation: rightElevation }] })
    else if (leftElevation != null && !right && provesAbsence(rightHole, left!)) pushBudgeted(mainBoundaries, { identity, leftHoleId: leftHole.source.id, rightHoleId: rightHole.source.id,
      mode: 'known-missing-midpoint', points: [{ station: x0, elevation: leftElevation }, { station: midpoint, elevation: (left!.topElevation + left!.bottomElevation) / 2 }] })
    else if (rightElevation != null && !left && provesAbsence(leftHole, right!)) pushBudgeted(mainBoundaries, { identity, leftHoleId: leftHole.source.id, rightHoleId: rightHole.source.id,
      mode: 'missing-known-midpoint', points: [{ station: midpoint, elevation: (right!.topElevation + right!.bottomElevation) / 2 }, { station: x1, elevation: rightElevation }] })
  }
  const verticalEnvelopeAt = (host: KJSectionTopologyCell, station: number): [number, number] | undefined => {
    const elevations: number[] = []
    for (let index = 0; index < host.points.length; index++) {
      const start = host.points[index]!, end = host.points[(index + 1) % host.points.length]!
      if (Math.abs(start.station - station) <= EPSILON) elevations.push(start.elevation)
      const minimum = Math.min(start.station, end.station), maximum = Math.max(start.station, end.station)
      if (Math.abs(end.station - start.station) > EPSILON && station > minimum + EPSILON && station < maximum - EPSILON) {
        const fraction = (station - start.station) / (end.station - start.station)
        elevations.push(start.elevation + fraction * (end.elevation - start.elevation))
      }
    }
    if (!elevations.length) return undefined
    return [Math.min(...elevations), Math.max(...elevations)]
  }
  const assertLensInsideHost = (region: KJSectionTopologyCell): void => {
    const separator = region.identity.indexOf('\u0000')
    const hostIdentity = separator < 0 ? region.identity : region.identity.slice(0, separator)
    const host = mainCells.find(candidate => candidate.identity === hostIdentity &&
      candidate.leftHoleId === region.leftHoleId && candidate.rightHoleId === region.rightHoleId)
    if (!host) throw new KJValidationError('Geology section topology: lens occurrence lacks a proved host major-group cell')
    for (const point of region.points) {
      const envelope = verticalEnvelopeAt(host, point.station)
      if (!envelope || point.elevation < envelope[0] - EPSILON || point.elevation > envelope[1] + EPSILON)
        throw new KJValidationError('Geology section topology: lens occurrence crosses its host major-group boundary')
    }
  }
  for (const identity of lensOrder) {
    const maximumOccurrence = maximumLensOccurrences.get(identity) ?? 0
    const occurrenceIdentities: (string | undefined)[] = maximumOccurrence <= 1 ? [undefined]
      : [...new Set(normalized.flatMap(hole => (hole.lenses.get(identity) ?? []).map(row => boundedText(row.source.intervalId, 'repeated lens occurrence identity'))))]
    if (maximumOccurrence > 1) for (let index = 0; index < normalized.length - 1; index++) {
      const left = normalized[index]!.lenses.get(identity) ?? [], right = normalized[index + 1]!.lenses.get(identity) ?? []
      if (left.length && right.length && !left.some(row => right.some(candidate => candidate.source.intervalId === row.source.intervalId)))
        throw new KJValidationError('Geology section topology: repeated lenses need a shared explicit occurrence identity')
    }
    for (let occurrence = 0; occurrence < occurrenceIdentities.length; occurrence++) for (let index = 0; index < normalized.length - 1; index++) {
      const leftHole = normalized[index]!, rightHole = normalized[index + 1]!
      const occurrenceIdentity = occurrenceIdentities[occurrence]
      const select = (hole: NormalizedHole): NormalizedInterval | undefined => occurrenceIdentity == null
        ? hole.lenses.get(identity)?.[0]
        : hole.lenses.get(identity)?.find(row => row.source.intervalId === occurrenceIdentity)
      const region = cell('lens', identity, occurrence, leftHole, rightHole, select(leftHole), select(rightHole))
      if (region) { assertLensInsideHost(region); pushBudgeted(lensCells, region) }
    }
  }
  return { mainCells, lensCells, mainBoundaries, mainIdentityCount: mainOrder.length, lensIdentityCount: lensOrder.length }
}
