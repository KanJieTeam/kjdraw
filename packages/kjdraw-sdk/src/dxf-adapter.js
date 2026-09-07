import { KJDocument } from './document.js'
import { KJValidationError } from './errors.js'
import { defineFileAdapter } from './file-adapters.js'
import { normalizeName } from './utils.js'

const PRODUCT_VERSIONS = Object.freeze(['R14', '2000', '2004', '2010', '2013', '2018', '2024'])
const VERSIONS = Object.freeze(['R12', ...PRODUCT_VERSIONS])
const ACADVER = Object.freeze({ R12: 'AC1009', R14: 'AC1014', 2000: 'AC1015', 2004: 'AC1018', 2010: 'AC1024', 2013: 'AC1027', 2018: 'AC1032', 2024: 'AC1032' })
const VERSION_BY_CODE = Object.freeze({ AC1009: 'R12', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1024: '2010', AC1027: '2013', AC1032: '2018' })
const READ_TYPES = Object.freeze(['LINE', 'POINT', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'ELLIPSE', 'SPLINE', 'TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB', 'INSERT', 'HATCH', 'LEADER', 'DIMENSION', 'SOLID', 'VIEWPORT', 'WIPEOUT', 'PROXY_ENTITY'])
const WRITE_TYPES = new Set(['LINE', 'POINT', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'ELLIPSE', 'SPLINE', 'TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB', 'INSERT', 'HATCH', 'LEADER', 'DIMENSION', 'SOLID', 'VIEWPORT', 'WIPEOUT', 'PROXY_ENTITY'])

const DIMENSION_TYPE_BY_CODE = Object.freeze({ 0: 'ROTATED', 1: 'ALIGNED', 2: 'ANGULAR', 3: 'DIAMETER', 4: 'RADIUS', 5: 'ANGULAR_3_POINT', 6: 'ORDINATE' })
const DIMENSION_CODE_BY_TYPE = Object.freeze(Object.fromEntries(Object.entries(DIMENSION_TYPE_BY_CODE).map(([code, type]) => [type, Number(code)])))
const VERSION_RANK = Object.freeze({ R12: 0, R14: 1, 2000: 2, 2004: 3, 2010: 4, 2013: 5, 2018: 6, 2024: 6 })
const MIN_ENTITY_VERSION = Object.freeze({
  ELLIPSE: 'R14', SPLINE: 'R14', MTEXT: 'R14', LEADER: 'R14', HATCH: 'R14',
  WIPEOUT: '2000',
})

const CODE_PAGE_LABELS = Object.freeze({
  'ANSI_936': 'gb18030',
  'ANSI_950': 'big5',
  'ANSI_932': 'shift_jis',
  'ANSI_949': 'euc-kr',
  'ANSI_1252': 'windows-1252',
  'UTF-8': 'utf-8',
  'UTF8': 'utf-8',
})

function decodeBytes(bytes) {
  const probe = new TextDecoder('windows-1252').decode(bytes.subarray(0, Math.min(bytes.length, 65536)))
  const match = probe.match(/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*([^\r\n]+)/i)
  const codePage = normalizeName(match?.[1] ?? 'UTF-8')
  const label = CODE_PAGE_LABELS[codePage] ?? 'utf-8'
  try { return new TextDecoder(label).decode(bytes) } catch { return new TextDecoder().decode(bytes) }
}

async function sourceText(source) {
  if (typeof source === 'string') return source
  if (source instanceof Uint8Array) return decodeBytes(source)
  if (source instanceof ArrayBuffer) return decodeBytes(new Uint8Array(source))
  if (typeof source?.arrayBuffer === 'function') return decodeBytes(new Uint8Array(await source.arrayBuffer()))
  if (typeof source?.text === 'function') return source.text()
  throw new KJValidationError('DXF source must be text, bytes, or Blob/File')
}

function tagsFromText(text) {
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')
  const tags = []
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index].trim())
    if (!Number.isInteger(code)) throw new KJValidationError(`Invalid DXF group code at line ${index + 1}`)
    tags.push({ code, value: lines[index + 1].trimEnd() })
  }
  return tags
}

function section(tags, name) {
  name = normalizeName(name)
  for (let index = 0; index < tags.length - 1; index += 1) {
    if (tags[index].code === 0 && normalizeName(tags[index].value) === 'SECTION' && tags[index + 1].code === 2 && normalizeName(tags[index + 1].value) === name) {
      const end = tags.findIndex((tag, position) => position > index + 1 && tag.code === 0 && normalizeName(tag.value) === 'ENDSEC')
      return tags.slice(index + 2, end < 0 ? tags.length : end)
    }
  }
  return []
}

function records(tags) {
  const output = []
  let current = null
  for (const tag of tags) {
    if (tag.code === 0) {
      if (current) output.push(current)
      current = { type: normalizeName(tag.value), tags: [] }
    } else if (current) current.tags.push(tag)
  }
  if (current) output.push(current)
  return output
}

function collapseLegacyPolylines(source) {
  const output = []
  for (let index = 0; index < source.length; index += 1) {
    const record = source[index]
    if (record.type !== 'POLYLINE') {
      output.push(record)
      continue
    }
    const vertices = []
    let cursor = index + 1
    while (cursor < source.length && source[cursor].type === 'VERTEX') {
      vertices.push(source[cursor])
      cursor += 1
    }
    const sequenceEnd = source[cursor]?.type === 'SEQEND' ? source[cursor] : null
    output.push({ ...record, vertices, sequenceEnd })
    index = sequenceEnd ? cursor : cursor - 1
  }
  return output
}

function entityRecords(tags) { return collapseLegacyPolylines(records(tags)) }

function blockDefinitions(tags) {
  const source = records(tags)
  const output = []
  for (let index = 0; index < source.length; index += 1) {
    if (source[index].type !== 'BLOCK') continue
    const header = source[index]
    const inner = []
    index += 1
    while (index < source.length && source[index].type !== 'ENDBLK') inner.push(source[index++])
    const name = String(first(header, 2, first(header, 3, ''))).trim()
    if (name) output.push({ name, header, basePoint: point(header), flags: number(header, 70, 0), records: collapseLegacyPolylines(inner) })
  }
  return output
}

function values(record, code) { return record.tags.filter(tag => tag.code === code).map(tag => tag.value) }
function first(record, code, fallback = null) { return values(record, code)[0] ?? fallback }
function number(record, code, fallback = 0) {
  const value = Number(first(record, code, fallback))
  if (!Number.isFinite(value)) throw new KJValidationError(`Invalid DXF numeric group ${code} in ${record.type}`)
  return value
}
function point(record, xCode = 10, yCode = 20, zCode = 30) { return [number(record, xCode), number(record, yCode), number(record, zCode)] }

function repeatedPoints(record, xCode = 10, yCode = 20, zCode = 30) {
  const result = []
  for (let index = 0; index < record.tags.length; index += 1) {
    if (record.tags[index].code !== xCode) continue
    const value = [Number(record.tags[index].value), 0, 0]
    for (let cursor = index + 1; cursor < record.tags.length && record.tags[cursor].code !== xCode; cursor += 1) {
      if (record.tags[cursor].code === yCode) value[1] = Number(record.tags[cursor].value)
      else if (record.tags[cursor].code === zCode) value[2] = Number(record.tags[cursor].value)
    }
    if (!value.every(Number.isFinite)) throw new KJValidationError(`Invalid repeated point ${xCode}/${yCode}/${zCode} in ${record.type}`)
    result.push(value)
  }
  return result
}

function optionalPoint(record, xCode, yCode, zCode) {
  return values(record, xCode).length ? point(record, xCode, yCode, zCode) : null
}

function polylineVertices(record) {
  const vertices = []
  for (let index = 0; index < record.tags.length; index += 1) {
    if (record.tags[index].code !== 10) continue
    const vertex = { point: [Number(record.tags[index].value), 0, 0], bulge: 0, startWidth: 0, endWidth: 0 }
    for (let cursor = index + 1; cursor < record.tags.length && record.tags[cursor].code !== 10; cursor += 1) {
      const tag = record.tags[cursor]
      if (tag.code === 20) vertex.point[1] = Number(tag.value)
      else if (tag.code === 30) vertex.point[2] = Number(tag.value)
      else if (tag.code === 42) vertex.bulge = Number(tag.value)
      else if (tag.code === 40) vertex.startWidth = Number(tag.value)
      else if (tag.code === 41) vertex.endWidth = Number(tag.value)
    }
    if (!vertex.point.every(Number.isFinite) || ![vertex.bulge, vertex.startWidth, vertex.endWidth].every(Number.isFinite)) throw new KJValidationError('Invalid LWPOLYLINE vertex')
    vertices.push(vertex)
  }
  return vertices
}

function legacyPolylineVertices(record) {
  const defaultStartWidth = number(record, 40, 0)
  const defaultEndWidth = number(record, 41, 0)
  return (record.vertices ?? []).map((vertex, index) => {
    const value = {
      point: point(vertex),
      bulge: number(vertex, 42, 0),
      startWidth: number(vertex, 40, defaultStartWidth),
      endWidth: number(vertex, 41, defaultEndWidth),
      dxfFlags: number(vertex, 70, 0),
    }
    if (!value.point.every(Number.isFinite)) throw new KJValidationError(`Invalid POLYLINE vertex ${index}`)
    return value
  })
}

function hatchBoundaryLoops(record) {
  const tags = record.tags
  const loops = []
  let cursor = tags.findIndex(tag => tag.code === 91)
  const loopCount = cursor < 0 ? 0 : Number(tags[cursor].value)
  cursor += 1
  for (let loopIndex = 0; loopIndex < loopCount; loopIndex += 1) {
    while (cursor < tags.length && tags[cursor].code !== 92) cursor += 1
    if (cursor >= tags.length) break
    const flags = Number(tags[cursor++].value)
    const external = Boolean(flags & 1 || flags & 16)
    if (flags & 2) {
      let closed = true, vertexCount = 0
      while (cursor < tags.length && tags[cursor].code !== 93) {
        if (tags[cursor].code === 73) closed = Number(tags[cursor].value) !== 0
        cursor += 1
      }
      if (tags[cursor]?.code === 93) vertexCount = Number(tags[cursor++].value)
      const vertices = []
      while (cursor < tags.length && vertices.length < vertexCount) {
        if (tags[cursor].code !== 10) { cursor += 1; continue }
        const vertex = { point: [Number(tags[cursor++].value), 0, 0], bulge: 0, startWidth: 0, endWidth: 0 }
        while (cursor < tags.length && tags[cursor].code !== 10 && tags[cursor].code !== 97 && tags[cursor].code !== 92) {
          if (tags[cursor].code === 20) vertex.point[1] = Number(tags[cursor].value)
          else if (tags[cursor].code === 42) vertex.bulge = Number(tags[cursor].value)
          cursor += 1
        }
        vertices.push(vertex)
      }
      loops.push({ external, flags, closed, vertices })
    } else {
      while (cursor < tags.length && tags[cursor].code !== 93) cursor += 1
      const edgeCount = tags[cursor]?.code === 93 ? Number(tags[cursor++].value) : 0
      const edges = []
      for (let edgeIndex = 0; edgeIndex < edgeCount && cursor < tags.length; edgeIndex += 1) {
        while (cursor < tags.length && tags[cursor].code !== 72) cursor += 1
        if (cursor >= tags.length) break
        const edgeType = Number(tags[cursor++].value)
        if (edgeType === 1) {
          const edge = { type: 'LINE', start: [0, 0, 0], end: [0, 0, 0] }
          while (cursor < tags.length && ![72, 92, 97].includes(tags[cursor].code)) {
            const tag = tags[cursor++]; if (tag.code === 10) edge.start[0] = Number(tag.value); else if (tag.code === 20) edge.start[1] = Number(tag.value); else if (tag.code === 11) edge.end[0] = Number(tag.value); else if (tag.code === 21) edge.end[1] = Number(tag.value)
          }
          edges.push(edge)
        } else if (edgeType === 2) {
          const edge = { type: 'ARC', center: [0, 0, 0], radius: 0, startAngle: 0, endAngle: 0, counterClockwise: true }
          while (cursor < tags.length && ![72, 92, 97].includes(tags[cursor].code)) {
            const tag = tags[cursor++]; if (tag.code === 10) edge.center[0] = Number(tag.value); else if (tag.code === 20) edge.center[1] = Number(tag.value); else if (tag.code === 40) edge.radius = Number(tag.value); else if (tag.code === 50) edge.startAngle = Number(tag.value) * Math.PI / 180; else if (tag.code === 51) edge.endAngle = Number(tag.value) * Math.PI / 180; else if (tag.code === 73) edge.counterClockwise = Number(tag.value) !== 0
          }
          edges.push(edge)
        } else {
          const rawTags = []
          while (cursor < tags.length && ![72, 92, 97].includes(tags[cursor].code)) rawTags.push(tags[cursor++])
          edges.push({ type: edgeType === 3 ? 'ELLIPSE' : edgeType === 4 ? 'SPLINE' : 'UNKNOWN', dxfEdgeType: edgeType, rawTags })
        }
      }
      loops.push({ external, flags, edges })
    }
    if (tags[cursor]?.code === 97) {
      const sourceCount = Number(tags[cursor++].value)
      cursor += Math.min(sourceCount, tags.slice(cursor).filter(tag => tag.code === 330).length)
    }
  }
  if (!loops.length) throw new KJValidationError('DXF HATCH contains no boundary loops')
  return loops
}

function entityPayload(record, blockIds, resources = {}) {
  switch (record.type) {
    case 'LINE': return { type: 'LINE', payload: { start: point(record), end: point(record, 11, 21, 31) } }
    case 'POINT': return { type: 'POINT', payload: { position: point(record) } }
    case 'CIRCLE': return { type: 'CIRCLE', payload: { center: point(record), radius: number(record, 40) } }
    case 'ARC': return { type: 'ARC', payload: { center: point(record), radius: number(record, 40), startAngle: number(record, 50) * Math.PI / 180, endAngle: number(record, 51) * Math.PI / 180 } }
    case 'LWPOLYLINE': return { type: 'LWPOLYLINE', payload: { vertices: polylineVertices(record), closed: (number(record, 70, 0) & 1) === 1, elevation: number(record, 38, 0) } }
    case 'POLYLINE': return { type: 'POLYLINE', payload: { vertices: legacyPolylineVertices(record), closed: (number(record, 70, 0) & 1) === 1, elevation: number(record, 30, 0), dxfFlags: number(record, 70, 0) } }
    case 'ELLIPSE': return { type: 'ELLIPSE', payload: { center: point(record), majorAxis: point(record, 11, 21, 31), ratio: number(record, 40), startParameter: number(record, 41, 0), endParameter: number(record, 42, Math.PI * 2) } }
    case 'SPLINE': {
      const weights = values(record, 41).map(Number)
      return { type: 'SPLINE', payload: { degree: number(record, 71), knots: values(record, 40).map(Number), weights: weights.length ? weights : undefined, controlPoints: repeatedPoints(record), fitPoints: repeatedPoints(record, 11, 21, 31), closed: (number(record, 70, 0) & 1) === 1, periodic: (number(record, 70, 0) & 2) === 2 } }
    }
    case 'TEXT': return { type: 'TEXT', payload: { position: point(record), text: first(record, 1, ''), height: number(record, 40, 2.5), rotation: number(record, 50, 0) * Math.PI / 180, styleId: resources.textStyleIds?.get(normalizeName(first(record, 7, 'STANDARD'))) ?? null } }
    case 'MTEXT': return { type: 'MTEXT', payload: { position: point(record), text: values(record, 3).join('') + first(record, 1, ''), height: number(record, 40, 2.5), rotation: number(record, 50, 0) * Math.PI / 180, styleId: resources.textStyleIds?.get(normalizeName(first(record, 7, 'STANDARD'))) ?? null } }
    case 'ATTDEF':
    case 'ATTRIB': return { type: record.type, payload: { position: point(record), alignmentPoint: values(record, 11).length ? point(record, 11, 21, 31) : undefined, text: first(record, 1, ''), tag: first(record, 2, ''), prompt: first(record, 3, ''), flags: number(record, 70, 0), height: number(record, 40, 2.5), rotation: number(record, 50, 0) * Math.PI / 180, styleId: resources.textStyleIds?.get(normalizeName(first(record, 7, 'STANDARD'))) ?? null, lockPosition: number(record, 280, 0) === 1 } }
    case 'INSERT': return { type: 'INSERT', payload: { blockRecordId: blockIds.get(normalizeName(first(record, 2))), position: point(record), scale: [number(record, 41, 1), number(record, 42, 1), number(record, 43, 1)], rotation: number(record, 50, 0) * Math.PI / 180 } }
    case 'HATCH': return { type: 'HATCH', payload: { boundaryLoops: hatchBoundaryLoops(record), patternName: first(record, 2, 'SOLID'), solid: number(record, 70, 0) === 1, associative: number(record, 71, 0) === 1, patternAngle: number(record, 52, 0) * Math.PI / 180, patternScale: number(record, 41, 1), rawTags: record.tags } }
    case 'LEADER': return { type: 'LEADER', payload: { vertices: repeatedPoints(record), annotationHandle: first(record, 340), textPosition: point(record, 11, 21, 31) } }
    case 'DIMENSION': {
      const dxfDimensionType = number(record, 70, 0)
      const definitionPoints = [optionalPoint(record, 10, 20, 30), optionalPoint(record, 13, 23, 33), optionalPoint(record, 14, 24, 34), optionalPoint(record, 15, 25, 35), optionalPoint(record, 16, 26, 36)].filter(Boolean)
      const styleName = first(record, 3, 'STANDARD')
      return { type: 'DIMENSION', payload: { dimensionType: DIMENSION_TYPE_BY_CODE[dxfDimensionType & 7] ?? 'ROTATED', dxfDimensionType, definitionPoints, textPosition: optionalPoint(record, 11, 21, 31), textOverride: first(record, 1), styleName, styleId: resources.dimensionStyleIds?.get(normalizeName(styleName)) ?? null, blockName: first(record, 2), measurement: values(record, 42).length ? number(record, 42) : null, rotation: number(record, 50, 0) * Math.PI / 180, rawTags: record.tags } }
    }
    case 'SOLID': return { type: 'SOLID', payload: { vertices: [point(record), point(record, 11, 21, 31), point(record, 12, 22, 32), point(record, 13, 23, 33)] } }
    case 'VIEWPORT': return { type: 'VIEWPORT', payload: { center: point(record), width: number(record, 40), height: number(record, 41), viewCenter: point(record, 12, 22, 32), viewHeight: number(record, 45), twistAngle: number(record, 51, 0) * Math.PI / 180 } }
    case 'WIPEOUT': {
      const position = point(record), u = point(record, 11, 21, 31), v = point(record, 12, 22, 32)
      const vertices = repeatedPoints(record, 14, 24, 34).map(([x, y]) => [position[0] + u[0] * x + v[0] * y, position[1] + u[1] * x + v[1] * y, position[2] + u[2] * x + v[2] * y])
      return { type: 'WIPEOUT', payload: { vertices, closed: true, position, uVector: u, vVector: v, rawTags: record.tags } }
    }
    default: return { type: 'PROXY_ENTITY', payload: { originalType: record.type, rawTags: record.tags } }
  }
}

function dxfVersion(tags) {
  const index = tags.findIndex(tag => tag.code === 9 && normalizeName(tag.value) === '$ACADVER')
  const code = index >= 0 ? tags.slice(index + 1).find(tag => tag.code === 1)?.value : null
  return VERSION_BY_CODE[normalizeName(code)] ?? 'UNKNOWN'
}

function dxfCodePage(tags) {
  const index = tags.findIndex(tag => tag.code === 9 && normalizeName(tag.value) === '$DWGCODEPAGE')
  return index >= 0 ? String(tags.slice(index + 1).find(tag => tag.code === 3)?.value ?? 'UTF-8').trim() : 'UTF-8'
}

function importResourceTables(transaction, tableRecords, document) {
  const linetypeIds = new Map(document.getTable('linetypes').records.map(record => [normalizeName(record.name), record.id]))
  const textStyleIds = new Map(document.getTable('textStyles').records.map(record => [normalizeName(record.name), record.id]))
  const dimensionStyleIds = new Map(document.getTable('dimensionStyles').records.map(record => [normalizeName(record.name), record.id]))
  for (const record of tableRecords.filter(value => value.type === 'LTYPE')) {
    const name = String(first(record, 2, 'CONTINUOUS')).trim() || 'CONTINUOUS'
    const imported = transaction.upsertTableRecord('linetypes', { name, type: 'LINETYPE', payload: { description: first(record, 3, ''), pattern: values(record, 49).map(Number), totalPatternLength: number(record, 40, 0), dxfFlags: number(record, 70, 0) } })
    linetypeIds.set(normalizeName(name), imported.id)
  }
  for (const record of tableRecords.filter(value => value.type === 'STYLE')) {
    const name = String(first(record, 2, 'STANDARD')).trim() || 'STANDARD'
    const imported = transaction.upsertTableRecord('textStyles', { name, type: 'TEXT_STYLE', payload: { fontFamily: first(record, 3, 'sans-serif'), fontFile: first(record, 3, null), bigFontFile: first(record, 4, null), fixedHeight: number(record, 40, 0), widthFactor: number(record, 41, 1), obliqueAngle: number(record, 50, 0) * Math.PI / 180, dxfFlags: number(record, 70, 0), generationFlags: number(record, 71, 0) } })
    textStyleIds.set(normalizeName(name), imported.id)
  }
  for (const record of tableRecords.filter(value => value.type === 'DIMSTYLE')) {
    const name = String(first(record, 2, 'STANDARD')).trim() || 'STANDARD'
    const imported = transaction.upsertTableRecord('dimensionStyles', { name, type: 'DIM_STYLE', payload: { overallScale: number(record, 40, 1), arrowSize: number(record, 41, 2.5), extensionOffset: number(record, 42, 0.625), baselineSpacing: number(record, 43, 3.75), extensionBeyond: number(record, 44, 1.25), rounding: number(record, 45, 0), textHeight: number(record, 140, 2.5), centerMarkSize: number(record, 141, 2.5), textGap: number(record, 147, 0.625), dxfFlags: number(record, 70, 0) } })
    dimensionStyleIds.set(normalizeName(name), imported.id)
  }
  for (const record of tableRecords.filter(value => value.type === 'UCS')) {
    const name = String(first(record, 2, '')).trim()
    if (name) transaction.upsertTableRecord('ucs', { name, type: 'UCS', payload: { origin: point(record), xAxis: point(record, 11, 21, 31), yAxis: point(record, 12, 22, 32), dxfFlags: number(record, 70, 0) } })
  }
  for (const record of tableRecords.filter(value => value.type === 'VIEW')) {
    const name = String(first(record, 2, '')).trim()
    if (name) transaction.upsertTableRecord('views', { name, type: 'VIEW', payload: { center: point(record), height: number(record, 40, 1), width: number(record, 41, 1), direction: point(record, 11, 21, 31), target: point(record, 12, 22, 32), twistAngle: number(record, 50, 0) * Math.PI / 180, dxfFlags: number(record, 70, 0) } })
  }
  return { linetypeIds, textStyleIds, dimensionStyleIds }
}

async function readDXF(source) {
  const tags = tagsFromText(await sourceText(source))
  if (!section(tags, 'ENTITIES').length && !tags.some(tag => tag.code === 0 && normalizeName(tag.value) === 'SECTION')) throw new KJValidationError('DXF has no valid SECTION structure')
  const version = dxfVersion(tags)
  const document = KJDocument.create({ sourceFormat: 'DXF', sourceVersion: version, codePage: dxfCodePage(tags), title: 'Imported DXF' })
  await document.transact('Import ASCII DXF', transaction => {
    const tableRecords = records(section(tags, 'TABLES'))
    const resources = importResourceTables(transaction, tableRecords, document)
    const layerIds = new Map([['0', document.snapshot().tables.layers.currentId]])
    for (const record of tableRecords.filter(record => record.type === 'LAYER')) {
      const name = String(first(record, 2, '0')).trim() || '0'
      const color = number(record, 62, 7)
      const linetypeName = first(record, 6, 'CONTINUOUS')
      const layer = transaction.upsertTableRecord('layers', { name, type: 'LAYER', payload: { color: Math.abs(color), linetypeName, linetypeId: resources.linetypeIds.get(normalizeName(linetypeName)) ?? null, lineweight: number(record, 370, -1), visible: color >= 0, frozen: (number(record, 70, 0) & 1) === 1, locked: (number(record, 70, 0) & 4) === 4, plottable: number(record, 290, 1) !== 0 } })
      layerIds.set(normalizeName(name), layer.id)
    }
    const definitions = blockDefinitions(section(tags, 'BLOCKS'))
    const sourceEntityRecords = entityRecords(section(tags, 'ENTITIES'))
    const allSourceRecords = [...sourceEntityRecords, ...definitions.flatMap(definition => definition.records)]
    const blockNames = new Set([
      ...definitions.map(definition => normalizeName(definition.name)),
      ...allSourceRecords.filter(record => record.type === 'INSERT').map(record => normalizeName(first(record, 2))).filter(Boolean),
    ])
    const blockIds = new Map()
    for (const block of document.getTable('blockRecords').records) blockIds.set(normalizeName(block.name), block.id)
    for (const name of blockNames) {
      const definition = definitions.find(value => normalizeName(value.name) === name)
      const block = transaction.upsertTableRecord('blockRecords', { name: definition?.name ?? name, type: 'BLOCK_RECORD', payload: { entityIds: [], isSpace: name.startsWith('*MODEL_SPACE') || name.startsWith('*PAPER_SPACE'), basePoint: definition?.basePoint ?? [0, 0, 0], dxfFlags: definition?.flags ?? 0, importedPlaceholder: !definition } })
      blockIds.set(name, block.id)
    }

    const paperSpaceIds = new Map()
    const defaultPaperLayoutId = document.snapshot().spaces.layoutIds.find(id => document.getObject(id)?.name !== 'Model')
    const defaultPaperLayout = defaultPaperLayoutId ? document.getObject(defaultPaperLayoutId) : null
    if (defaultPaperLayout) paperSpaceIds.set(normalizeName(defaultPaperLayout.name), defaultPaperLayout.payload.blockRecordId)
    const sourcePaperLayouts = [...new Set(sourceEntityRecords
      .filter(record => number(record, 67, 0) === 1 || (first(record, 410) && normalizeName(first(record, 410)) !== 'MODEL'))
      .map(record => String(first(record, 410, 'Layout1')).trim() || 'Layout1'))]
    for (const [index, layoutName] of sourcePaperLayouts.entries()) {
      const key = normalizeName(layoutName)
      if (paperSpaceIds.has(key)) continue
      if (index === 0 && defaultPaperLayout) {
        transaction.updateObject(defaultPaperLayout.id, { name: layoutName })
        paperSpaceIds.clear()
        paperSpaceIds.set(key, defaultPaperLayout.payload.blockRecordId)
      } else {
        const layout = transaction.createLayout({ name: layoutName })
        paperSpaceIds.set(key, layout.payload.blockRecordId)
      }
    }

    const importRecord = (record, index, ownerId, scope) => {
      const layerName = normalizeName(first(record, 8, '0'))
      const layerId = layerIds.get(layerName) ?? layerIds.get('0')
      const converted = entityPayload(record, blockIds, resources)
      const sourceHandle = String(first(record, 5, '')).toUpperCase()
      const handleAvailable = /^[0-9A-F]+$/.test(sourceHandle) && !Object.values(transaction._draft().objects).some(object => object.handle === sourceHandle)
      try {
        transaction.createEntity(converted.type, { ...converted.payload, layerId }, { ownerId, handle: handleAvailable ? sourceHandle : undefined, source: { format: 'DXF', scope, entityIndex: index, originalHandle: sourceHandle || null } })
      } catch (error) {
        transaction.createEntity('PROXY_ENTITY', { originalType: record.type, rawTags: record.tags, importError: error.message, layerId }, { ownerId, source: { format: 'DXF', scope, entityIndex: index, originalHandle: sourceHandle || null } })
      }
    }
    for (const definition of definitions) {
      const ownerId = blockIds.get(normalizeName(definition.name))
      definition.records.forEach((record, index) => importRecord(record, index, ownerId, `block:${definition.name}`))
    }
    const modelSpaceId = document.snapshot().spaces.modelSpaceId
    sourceEntityRecords.forEach((record, index) => {
      const layoutName = String(first(record, 410, 'Layout1')).trim() || 'Layout1'
      const paperSpace = number(record, 67, 0) === 1 || (first(record, 410) && normalizeName(first(record, 410)) !== 'MODEL')
      const ownerId = paperSpace ? (paperSpaceIds.get(normalizeName(layoutName)) ?? defaultPaperLayout?.payload.blockRecordId ?? modelSpaceId) : modelSpaceId
      importRecord(record, index, ownerId, paperSpace ? `paper-space:${layoutName}` : 'model-space')
    })
  }, { source: 'adapter:dxf-ascii' })
  return document
}

function emit(output, code, value) { output.push(String(code), String(value)) }
function emitPoint(output, pointValue, base = 10) { emit(output, base, pointValue[0]); emit(output, base + 10, pointValue[1]); emit(output, base + 20, pointValue[2] ?? 0) }

function emitLegacyPolyline(output, entity, layerName) {
  const p = entity.payload ?? {}
  emit(output, 0, 'POLYLINE'); emit(output, 5, entity.handle); emit(output, 8, layerName)
  emitPoint(output, [0, 0, p.elevation ?? 0]); emit(output, 70, (Number(p.dxfFlags ?? 0) & ~1) | (p.closed ? 1 : 0))
  for (const vertex of p.vertices ?? []) {
    const pointValue = vertex.point ?? vertex
    emit(output, 0, 'VERTEX'); emit(output, 8, layerName); emitPoint(output, pointValue)
    if (vertex.startWidth) emit(output, 40, vertex.startWidth)
    if (vertex.endWidth) emit(output, 41, vertex.endWidth)
    if (vertex.bulge) emit(output, 42, vertex.bulge)
    if (vertex.dxfFlags) emit(output, 70, vertex.dxfFlags)
  }
  emit(output, 0, 'SEQEND'); emit(output, 8, layerName)
}

function emitSpaceOwnership(output, space, version) {
  if (!space?.paper) return
  emit(output, 67, 1)
  if (VERSION_RANK[version] >= VERSION_RANK['2000']) emit(output, 410, space.layoutName ?? 'Layout1')
}

function emitHatch(output, entity, layerName, space, version) {
  const p = entity.payload ?? {}
  if (Array.isArray(p.rawTags) && p.rawTags.length) {
    emit(output, 0, 'HATCH')
    let wroteHandle = false, wroteLayer = false
    for (const tag of p.rawTags) {
      if (tag.code === 5 && !wroteHandle) { emit(output, 5, entity.handle); wroteHandle = true }
      else if (tag.code === 8 && !wroteLayer) { emit(output, 8, layerName); wroteLayer = true }
      else if (tag.code === 67 || tag.code === 410) continue
      else emit(output, tag.code, tag.value)
    }
    emitSpaceOwnership(output, space, version)
    return
  }
  emit(output, 0, 'HATCH'); emit(output, 5, entity.handle); emit(output, 8, layerName)
  emitSpaceOwnership(output, space, version)
  emitPoint(output, [0, 0, 0]); emit(output, 2, p.patternName ?? 'SOLID'); emit(output, 70, p.solid ? 1 : 0); emit(output, 71, p.associative ? 1 : 0)
  emit(output, 91, p.boundaryLoops?.length ?? 0)
  for (const loop of p.boundaryLoops ?? []) {
    if (loop.vertices?.length) {
      emit(output, 92, (Number(loop.flags ?? 1) | 2)); emit(output, 72, loop.vertices.some(vertex => Number(vertex.bulge)) ? 1 : 0); emit(output, 73, loop.closed === false ? 0 : 1); emit(output, 93, loop.vertices.length)
      for (const vertex of loop.vertices) { const value = vertex.point ?? vertex; emit(output, 10, value[0]); emit(output, 20, value[1]); if (vertex.bulge) emit(output, 42, vertex.bulge) }
    } else {
      emit(output, 92, Number(loop.flags ?? 1) & ~2); emit(output, 93, loop.edges?.length ?? 0)
      for (const edge of loop.edges ?? []) {
        if (edge.type === 'LINE') { emit(output, 72, 1); emit(output, 10, edge.start[0]); emit(output, 20, edge.start[1]); emit(output, 11, edge.end[0]); emit(output, 21, edge.end[1]) }
        else if (edge.type === 'ARC') { emit(output, 72, 2); emit(output, 10, edge.center[0]); emit(output, 20, edge.center[1]); emit(output, 40, edge.radius); emit(output, 50, edge.startAngle * 180 / Math.PI); emit(output, 51, edge.endAngle * 180 / Math.PI); emit(output, 73, edge.counterClockwise === false ? 0 : 1) }
        else throw new KJValidationError(`DXF HATCH writer does not support ${edge.type} boundary edges`)
      }
    }
    emit(output, 97, 0)
  }
  emit(output, 75, 0); emit(output, 76, 1)
  if (!p.solid) { emit(output, 52, (p.patternAngle ?? 0) * 180 / Math.PI); emit(output, 41, p.patternScale ?? 1); emit(output, 77, 0); emit(output, 78, 0) }
}

function emitRawEntity(output, entity, layerName, space, version) {
  emit(output, 0, entity.type)
  let wroteHandle = false, wroteLayer = false
  for (const tag of entity.payload?.rawTags ?? []) {
    if (tag.code === 5 && !wroteHandle) { emit(output, 5, entity.handle); wroteHandle = true }
    else if (tag.code === 8 && !wroteLayer) { emit(output, 8, layerName); wroteLayer = true }
    else if (tag.code === 67 || tag.code === 410) continue
    else emit(output, tag.code, tag.value)
  }
  emitSpaceOwnership(output, space, version)
}

function emitTable(output, name, records, emitRecord) {
  emit(output, 0, 'TABLE'); emit(output, 2, name); emit(output, 70, records.length)
  for (const record of records) emitRecord(record)
  emit(output, 0, 'ENDTAB')
}

function emitLinetypeTable(output, records) {
  emitTable(output, 'LTYPE', records, record => {
    const pattern = record.payload?.pattern ?? []
    emit(output, 0, 'LTYPE'); emit(output, 5, record.handle); emit(output, 2, record.name); emit(output, 70, record.payload?.dxfFlags ?? 0); emit(output, 3, record.payload?.description ?? ''); emit(output, 72, 65); emit(output, 73, pattern.length); emit(output, 40, record.payload?.totalPatternLength ?? pattern.reduce((sum, value) => sum + Math.abs(Number(value)), 0))
    for (const value of pattern) { emit(output, 49, value); emit(output, 74, 0) }
  })
}

function emitTextStyleTable(output, records) {
  emitTable(output, 'STYLE', records, record => {
    const payload = record.payload ?? {}
    emit(output, 0, 'STYLE'); emit(output, 5, record.handle); emit(output, 2, record.name); emit(output, 70, payload.dxfFlags ?? 0); emit(output, 40, payload.fixedHeight ?? 0); emit(output, 41, payload.widthFactor ?? 1); emit(output, 50, (payload.obliqueAngle ?? 0) * 180 / Math.PI); emit(output, 71, payload.generationFlags ?? 0); emit(output, 42, payload.lastHeight ?? 2.5); emit(output, 3, payload.fontFile ?? payload.fontFamily ?? 'txt'); emit(output, 4, payload.bigFontFile ?? '')
  })
}

function emitDimensionStyleTable(output, records) {
  emitTable(output, 'DIMSTYLE', records, record => {
    const payload = record.payload ?? {}
    emit(output, 0, 'DIMSTYLE'); emit(output, 5, record.handle); emit(output, 2, record.name); emit(output, 70, payload.dxfFlags ?? 0); emit(output, 40, payload.overallScale ?? 1); emit(output, 41, payload.arrowSize ?? 2.5); emit(output, 42, payload.extensionOffset ?? 0.625); emit(output, 43, payload.baselineSpacing ?? 3.75); emit(output, 44, payload.extensionBeyond ?? 1.25); emit(output, 45, payload.rounding ?? 0); emit(output, 140, payload.textHeight ?? 2.5); emit(output, 141, payload.centerMarkSize ?? 2.5); emit(output, 147, payload.textGap ?? 0.625)
  })
}

function emitUcsTable(output, records) {
  emitTable(output, 'UCS', records, record => {
    const payload = record.payload ?? {}
    emit(output, 0, 'UCS'); emit(output, 5, record.handle); emit(output, 2, record.name); emit(output, 70, payload.dxfFlags ?? 0); emitPoint(output, payload.origin ?? [0, 0, 0]); emitPoint(output, payload.xAxis ?? [1, 0, 0], 11); emitPoint(output, payload.yAxis ?? [0, 1, 0], 12)
  })
}

function emitViewTable(output, records) {
  emitTable(output, 'VIEW', records, record => {
    const payload = record.payload ?? {}
    emit(output, 0, 'VIEW'); emit(output, 5, record.handle); emit(output, 2, record.name); emit(output, 70, payload.dxfFlags ?? 0); emitPoint(output, payload.center ?? [0, 0, 0]); emit(output, 40, payload.height ?? 1); emit(output, 41, payload.width ?? 1); emitPoint(output, payload.direction ?? [0, 0, 1], 11); emitPoint(output, payload.target ?? [0, 0, 0], 12); emit(output, 50, (payload.twistAngle ?? 0) * 180 / Math.PI)
  })
}

function emitEntity(output, entity, layerName, version, blockNames = new Map(), space = null, resources = {}) {
  const p = entity.payload ?? {}
  if (!WRITE_TYPES.has(entity.type)) throw new KJValidationError(`ASCII DXF writer does not support ${entity.type}; export stopped to prevent data loss`)
  if (entity.type === 'POLYLINE' || (version === 'R12' && entity.type === 'LWPOLYLINE')) {
    emitLegacyPolyline(output, entity, layerName)
    return
  }
  if (entity.type === 'HATCH') { emitHatch(output, entity, layerName, space, version); return }
  if (['WIPEOUT', 'DIMENSION'].includes(entity.type) && p.rawTags?.length) { emitRawEntity(output, entity, layerName, space, version); return }
  if (entity.type === 'PROXY_ENTITY') {
    emit(output, 0, p.originalType ?? 'PROXY_ENTITY')
    for (const tag of p.rawTags ?? []) emit(output, tag.code, tag.value)
    return
  }
  emit(output, 0, entity.type)
  emit(output, 5, entity.handle)
  emit(output, 8, layerName)
  emitSpaceOwnership(output, space, version)
  if (entity.type === 'LINE') { emitPoint(output, p.start); emitPoint(output, p.end, 11) }
  else if (entity.type === 'POINT') emitPoint(output, p.position)
  else if (entity.type === 'CIRCLE') { emitPoint(output, p.center); emit(output, 40, p.radius) }
  else if (entity.type === 'ARC') { emitPoint(output, p.center); emit(output, 40, p.radius); emit(output, 50, p.startAngle * 180 / Math.PI); emit(output, 51, p.endAngle * 180 / Math.PI) }
  else if (entity.type === 'ELLIPSE') { emitPoint(output, p.center); emitPoint(output, p.majorAxis, 11); emit(output, 40, p.ratio); emit(output, 41, p.startParameter); emit(output, 42, p.endParameter) }
  else if (entity.type === 'SPLINE') {
    const flags = (p.closed ? 1 : 0) | (p.periodic ? 2 : 0) | (p.weights?.length ? 4 : 0)
    emit(output, 70, flags); emit(output, 71, p.degree); emit(output, 72, p.knots?.length ?? 0); emit(output, 73, p.controlPoints?.length ?? 0); emit(output, 74, p.fitPoints?.length ?? 0)
    for (const knot of p.knots ?? []) emit(output, 40, knot)
    for (const weight of p.weights ?? []) emit(output, 41, weight)
    for (const value of p.controlPoints ?? []) emitPoint(output, value)
    for (const value of p.fitPoints ?? []) emitPoint(output, value, 11)
  }
  else if (['LWPOLYLINE', 'POLYLINE'].includes(entity.type)) {
    emit(output, 90, p.vertices.length); emit(output, 70, p.closed ? 1 : 0); emit(output, 38, p.elevation ?? 0)
    for (const vertex of p.vertices) { const pointValue = vertex.point ?? vertex; emit(output, 10, pointValue[0]); emit(output, 20, pointValue[1]); if (pointValue[2]) emit(output, 30, pointValue[2]); if (vertex.bulge) emit(output, 42, vertex.bulge); if (vertex.startWidth) emit(output, 40, vertex.startWidth); if (vertex.endWidth) emit(output, 41, vertex.endWidth) }
  } else if (['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB'].includes(entity.type)) { emitPoint(output, p.position); emit(output, 40, p.height); emit(output, 1, p.text); if (p.styleId) emit(output, 7, resources.textStyleNames?.get(p.styleId) ?? 'STANDARD'); if (p.rotation) emit(output, 50, p.rotation * 180 / Math.PI); if (p.alignmentPoint) emitPoint(output, p.alignmentPoint, 11); if (['ATTDEF', 'ATTRIB'].includes(entity.type)) { emit(output, 2, p.tag); if (entity.type === 'ATTDEF') emit(output, 3, p.prompt); emit(output, 70, p.flags ?? 0); if (p.lockPosition) emit(output, 280, 1) } }
  else if (entity.type === 'INSERT') {
    const blockName = blockNames.get(p.blockRecordId)
    if (!blockName) throw new KJValidationError(`DXF INSERT references an unavailable block record: ${p.blockRecordId}`)
    emit(output, 2, blockName); emitPoint(output, p.position); emit(output, 41, p.scale?.[0] ?? 1); emit(output, 42, p.scale?.[1] ?? 1); emit(output, 43, p.scale?.[2] ?? 1); if (p.rotation) emit(output, 50, p.rotation * 180 / Math.PI)
  }
  else if (entity.type === 'SOLID') { p.vertices.forEach((value, index) => emitPoint(output, value, 10 + index)) }
  else if (entity.type === 'LEADER') { emit(output, 3, 'STANDARD'); emit(output, 71, 1); emit(output, 72, 0); emit(output, 73, 3); emit(output, 74, 0); emit(output, 75, 0); emit(output, 76, p.vertices.length); for (const value of p.vertices) emitPoint(output, value) }
  else if (entity.type === 'DIMENSION') {
    const codes = [10, 13, 14, 15, 16]
    if (!p.definitionPoints?.length) throw new KJValidationError('DXF DIMENSION requires at least one definition point')
    p.definitionPoints.slice(0, codes.length).forEach((value, index) => emitPoint(output, value, codes[index]))
    if (p.textPosition) emitPoint(output, p.textPosition, 11)
    if (p.blockName) emit(output, 2, p.blockName)
    emit(output, 3, resources.dimensionStyleNames?.get(p.styleId) ?? p.styleName ?? 'STANDARD')
    emit(output, 70, p.dxfDimensionType ?? DIMENSION_CODE_BY_TYPE[normalizeName(p.dimensionType)] ?? 0)
    if (p.textOverride != null) emit(output, 1, p.textOverride)
    if (p.measurement != null) emit(output, 42, p.measurement)
    if (p.rotation) emit(output, 50, p.rotation * 180 / Math.PI)
  }
  else if (entity.type === 'VIEWPORT') { emitPoint(output, p.center); emit(output, 40, p.width); emit(output, 41, p.height); emitPoint(output, p.viewCenter, 12); emit(output, 45, p.viewHeight); if (p.twistAngle) emit(output, 51, p.twistAngle * 180 / Math.PI) }
}

function writeDXF(document, options = {}) {
  if (!(document instanceof KJDocument)) throw new KJValidationError('DXF writer requires a KJDocument')
  const version = String(options.version ?? '2018').toUpperCase()
  if (!VERSIONS.includes(version)) throw new KJValidationError(`Unsupported ASCII DXF version: ${version}`)
  const output = [], layers = document.getTable('layers').records, layerNames = new Map(layers.map(layer => [layer.id, layer.name]))
  const state = document.toJSON({ includeRevisions: false })
  const blocks = document.getTable('blockRecords').records
  const blockNames = new Map(blocks.map(block => [block.id, block.name]))
  const linetypes = document.getTable('linetypes').records
  const textStyles = document.getTable('textStyles').records
  const dimensionStyles = document.getTable('dimensionStyles').records
  const ucsRecords = document.getTable('ucs').records
  const views = document.getTable('views').records
  const resources = {
    textStyleNames: new Map(textStyles.map(record => [record.id, record.name])),
    dimensionStyleNames: new Map(dimensionStyles.map(record => [record.id, record.name])),
  }
  const linetypeNames = new Map(linetypes.map(record => [record.id, record.name]))
  const allEntities = document.listEntities()
  for (const entity of allEntities) {
    const minimum = MIN_ENTITY_VERSION[entity.type]
    if (minimum && VERSION_RANK[version] < VERSION_RANK[minimum]) throw new KJValidationError(`DXF ${version} cannot represent ${entity.type} without data loss; minimum target is ${minimum}`)
    if (entity.type === 'PROXY_ENTITY' && state.header.sourceVersion !== 'UNKNOWN' && ACADVER[state.header.sourceVersion] !== ACADVER[version]) throw new KJValidationError(`Opaque ${entity.payload?.originalType ?? 'DXF'} data can only be preserved at its source format code ${ACADVER[state.header.sourceVersion] ?? state.header.sourceVersion}`)
  }
  const populatedPaperSpaces = state.spaces.paperSpaceIds.filter(id => document.listEntities({ ownerId: id }).length)
  if (VERSION_RANK[version] < VERSION_RANK['2000'] && populatedPaperSpaces.length > 1) throw new KJValidationError(`DXF ${version} cannot preserve multiple named paper spaces without layout metadata`)
  emit(output, 0, 'SECTION'); emit(output, 2, 'HEADER'); emit(output, 9, '$ACADVER'); emit(output, 1, ACADVER[version]); emit(output, 0, 'ENDSEC')
  emit(output, 0, 'SECTION'); emit(output, 2, 'TABLES')
  emitLinetypeTable(output, linetypes)
  emitTextStyleTable(output, textStyles)
  emitDimensionStyleTable(output, dimensionStyles)
  emitUcsTable(output, ucsRecords)
  emitViewTable(output, views)
  emitTable(output, 'LAYER', layers, layer => {
    const payload = layer.payload ?? {}
    const flags = (payload.frozen ? 1 : 0) | (payload.locked ? 4 : 0)
    const color = Math.abs(Number(payload.color ?? 7))
    emit(output, 0, 'LAYER'); emit(output, 5, layer.handle); emit(output, 2, layer.name)
    emit(output, 70, flags); emit(output, 62, payload.visible === false ? -color : color)
    emit(output, 6, linetypeNames.get(payload.linetypeId) ?? payload.linetypeName ?? 'CONTINUOUS')
    if (version !== 'R12') { emit(output, 290, payload.plottable === false ? 0 : 1); emit(output, 370, payload.lineweight ?? -1) }
  })
  emit(output, 0, 'ENDSEC')
  emit(output, 0, 'SECTION'); emit(output, 2, 'BLOCKS')
  for (const block of blocks) {
    emit(output, 0, 'BLOCK'); emit(output, 5, block.handle); emit(output, 8, '0'); emit(output, 2, block.name); emit(output, 70, block.payload?.dxfFlags ?? 0); emitPoint(output, block.payload?.basePoint ?? [0, 0, 0]); emit(output, 3, block.name); emit(output, 1, '')
    if (!block.payload?.isSpace) {
      for (const entity of document.listEntities({ ownerId: block.id })) emitEntity(output, entity, layerNames.get(entity.payload?.layerId) ?? '0', version, blockNames, null, resources)
    }
    emit(output, 0, 'ENDBLK'); emit(output, 8, '0')
  }
  emit(output, 0, 'ENDSEC')
  emit(output, 0, 'SECTION'); emit(output, 2, 'ENTITIES')
  for (const entity of document.listEntities({ ownerId: state.spaces.modelSpaceId })) emitEntity(output, entity, layerNames.get(entity.payload?.layerId) ?? '0', version, blockNames, null, resources)
  const layoutsByBlock = new Map(state.spaces.layoutIds.map(id => state.objects[id]).filter(Boolean).map(layout => [layout.payload?.blockRecordId, layout.name]))
  for (const paperSpaceId of state.spaces.paperSpaceIds) {
    const space = { paper: true, layoutName: layoutsByBlock.get(paperSpaceId) ?? 'Layout1' }
    for (const entity of document.listEntities({ ownerId: paperSpaceId })) emitEntity(output, entity, layerNames.get(entity.payload?.layerId) ?? '0', version, blockNames, space, resources)
  }
  emit(output, 0, 'ENDSEC'); emit(output, 0, 'EOF')
  return `${output.join('\r\n')}\r\n`
}

export function createDXFFileAdapter(options = {}) {
  return defineFileAdapter({
    id: options.id ?? 'kanjie.dxf.ascii', vendor: 'Kanjie', priority: Number(options.priority ?? 500),
    formats: { DXF: { read: PRODUCT_VERSIONS, write: PRODUCT_VERSIONS, notes: ['ASCII DXF core-entity baseline; not yet golden-corpus certified', 'R12 is accepted only through the explicit legacy adapter path and is not in the KJDraw 1.0 support matrix'] } },
    capabilities: { certification: 'development', encoding: 'ascii', legacyMigrationVersions: ['R12'], entityRead: READ_TYPES, entityWrite: [...WRITE_TYPES], unknownEntities: 'proxy-raw-tags', blocks: 'definitions-and-nested-inserts', spaces: 'model-and-paper-ownership', tables: ['LAYER', 'LTYPE', 'STYLE', 'DIMSTYLE', 'UCS', 'VIEW'], limitations: ['binary DXF', 'layout object metadata'] },
    preservation: { handles: 'best-effort', ownership: 'model-and-paper-space', opaqueObjects: 'raw-entity-tags', resources: 'standard-table-records' },
    sniff: async source => { try { const text = await sourceText(source); return /\bSECTION\b/.test(text.slice(0, 4096)) && /\bHEADER\b|\bENTITIES\b/.test(text.slice(0, 16384)) } catch { return false } },
    read: readDXF,
    write: writeDXF,
  })
}
