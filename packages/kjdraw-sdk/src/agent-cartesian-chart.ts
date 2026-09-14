import { KJValidationError } from './errors.js'
import { stableHash } from './utils.js'

export const KJDRAW_CARTESIAN_CHART_VERSION = '1.0.0' as const

export interface KJAgentCartesianChartSeries {
  id: string
  name: string
  kind: 'line' | 'bar'
  values: number[]
  color?: number
}

export interface KJAgentCartesianChartInput {
  version: typeof KJDRAW_CARTESIAN_CHART_VERSION
  expectedRevision: number
  units: 'millimeter'
  drawingId: string
  title: string
  categories: string[]
  series: KJAgentCartesianChartSeries[]
  origin?: [number, number]
  width?: number
  height?: number
  textHeight?: number
  xLabel?: string
  yLabel?: string
  showValues?: boolean
  yAxis?: { minimum: number; maximum: number; tick: number }
}

interface ChartDocument {
  id: string
  revision: number
  snapshot(): { header?: { units?: string } }
  listEntities(): readonly unknown[]
}

type Point3 = [number, number, number]
type EntitySpec = { type: string; payload: Record<string, unknown>; options: { id: string } }
type NormalizedSeries = { id: string; name: string; kind: 'line' | 'bar'; values: number[]; color: number }

const INPUT_KEYS = ['version', 'expectedRevision', 'units', 'drawingId', 'title', 'categories', 'series', 'origin', 'width', 'height', 'textHeight', 'xLabel', 'yLabel', 'showValues', 'yAxis']
const SERIES_KEYS = ['id', 'name', 'kind', 'values', 'color']
const AXIS_KEYS = ['minimum', 'maximum', 'tick']
const DEFAULT_COLORS = [1, 5, 3, 6, 2, 4, 30, 8]
const MAX_ENTITY_COUNT = 512
const EPSILON = 1e-9

function plain(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KJValidationError(`${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new KJValidationError(`${label} must be a plain object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length) throw new KJValidationError(`${label} contains unsupported field: ${unknown[0]}`)
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new KJValidationError(`${label} must be a string`)
  const result = value.trim()
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new KJValidationError(`${label} must contain 1-${maximum} printable characters`)
  return result
}

function identifier(value: unknown, label: string): string {
  const result = boundedString(value, label, 64)
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(result)) throw new KJValidationError(`${label} must start with a letter and contain only letters, numbers, _ or -`)
  return result
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new KJValidationError(`${label} must be a finite number from ${minimum} to ${maximum}`)
  return value
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const result = boundedNumber(value, label, minimum, maximum)
  if (!Number.isInteger(result)) throw new KJValidationError(`${label} must be an integer`)
  return result
}

function point2(value: unknown, label: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new KJValidationError(`${label} must contain exactly two coordinates`)
  return [boundedNumber(value[0], `${label}[0]`, -1_000_000, 1_000_000), boundedNumber(value[1], `${label}[1]`, -1_000_000, 1_000_000)]
}

function niceStep(span: number): number {
  const rough = span / 7
  const power = 10 ** Math.floor(Math.log10(rough))
  const fraction = rough / power
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return nice * power
}

function decimalPlaces(value: number): number {
  if (value >= 1 || value === 0) return 0
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(value)) + 1))
}

function formatValue(value: number, step: number): string {
  const rounded = Math.abs(value) < Math.abs(step) * 1e-9 ? 0 : value
  return rounded.toFixed(decimalPlaces(Math.abs(step))).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function validateInput(document: ChartDocument, source: KJAgentCartesianChartInput) {
  if (!document || typeof document.id !== 'string' || !Number.isInteger(document.revision) || typeof document.snapshot !== 'function' || typeof document.listEntities !== 'function') {
    throw new KJValidationError('Cartesian chart compiler requires a KJDraw document')
  }
  if (document.listEntities().length !== 0) throw new KJValidationError('Cartesian chart compiler requires a blank document')
  const input = plain(source, 'input')
  exactKeys(input, INPUT_KEYS, 'input')
  if (input.version !== KJDRAW_CARTESIAN_CHART_VERSION) throw new KJValidationError(`input.version must be ${KJDRAW_CARTESIAN_CHART_VERSION}`)
  if (input.units !== 'millimeter') throw new KJValidationError('input.units must be millimeter')
  const expectedRevision = boundedInteger(input.expectedRevision, 'input.expectedRevision', 0, Number.MAX_SAFE_INTEGER)
  if (expectedRevision !== document.revision) throw new KJValidationError(`input.expectedRevision ${expectedRevision} does not match document revision ${document.revision}`)
  if (document.snapshot()?.header?.units !== 'millimeter') throw new KJValidationError('Cartesian chart compiler requires a millimeter document')

  if (!Array.isArray(input.categories) || input.categories.length < 2 || input.categories.length > 32) throw new KJValidationError('input.categories must contain 2-32 labels')
  const categories = input.categories.map((value, index) => boundedString(value, `input.categories[${index}]`, 32))
  if (!Array.isArray(input.series) || input.series.length < 1 || input.series.length > 8) throw new KJValidationError('input.series must contain 1-8 series')
  if (input.series.length * categories.length > 160) throw new KJValidationError('input.series contains more than 160 data values')
  const ids = new Set<string>()
  const series: NormalizedSeries[] = input.series.map((source, index) => {
    const item = plain(source, `input.series[${index}]`)
    exactKeys(item, SERIES_KEYS, `input.series[${index}]`)
    const id = identifier(item.id, `input.series[${index}].id`)
    if (ids.has(id.toUpperCase())) throw new KJValidationError(`input.series contains duplicate id: ${id}`)
    ids.add(id.toUpperCase())
    if (item.kind !== 'line' && item.kind !== 'bar') throw new KJValidationError(`input.series[${index}].kind must be line or bar`)
    if (!Array.isArray(item.values) || item.values.length !== categories.length) throw new KJValidationError(`input.series[${index}].values must match categories length`)
    const values = item.values.map((value, valueIndex) => boundedNumber(value, `input.series[${index}].values[${valueIndex}]`, -1e12, 1e12))
    return { id, name: boundedString(item.name, `input.series[${index}].name`, 64), kind: item.kind, values, color: item.color == null ? DEFAULT_COLORS[index]! : boundedInteger(item.color, `input.series[${index}].color`, 1, 255) }
  })

  const values = series.flatMap(item => item.values)
  const hasBars = series.some(item => item.kind === 'bar')
  let minimum: number, maximum: number, tick: number
  if (input.yAxis != null) {
    const axis = plain(input.yAxis, 'input.yAxis')
    exactKeys(axis, AXIS_KEYS, 'input.yAxis')
    minimum = boundedNumber(axis.minimum, 'input.yAxis.minimum', -1e12, 1e12)
    maximum = boundedNumber(axis.maximum, 'input.yAxis.maximum', -1e12, 1e12)
    tick = boundedNumber(axis.tick, 'input.yAxis.tick', Number.MIN_VALUE, 1e12)
    if (maximum <= minimum) throw new KJValidationError('input.yAxis.maximum must exceed minimum')
    if ((maximum - minimum) / tick > 12 + EPSILON) throw new KJValidationError('input.yAxis must contain at most 12 tick intervals')
    if (values.some(value => value < minimum - EPSILON || value > maximum + EPSILON)) throw new KJValidationError('input.yAxis must contain every data value')
    if (hasBars && (minimum > 0 || maximum < 0)) throw new KJValidationError('A bar chart yAxis must contain zero')
  } else {
    let low = Math.min(...values), high = Math.max(...values)
    if (hasBars) { low = Math.min(low, 0); high = Math.max(high, 0) }
    if (Math.abs(high - low) <= EPSILON) {
      const pad = Math.max(1, Math.abs(high) * 0.1)
      low -= pad; high += pad
    } else {
      const pad = (high - low) * 0.08
      low -= pad; high += pad
      if (hasBars) { low = Math.min(low, 0); high = Math.max(high, 0) }
    }
    tick = niceStep(high - low)
    minimum = Math.floor(low / tick) * tick
    maximum = Math.ceil(high / tick) * tick
    if (hasBars) { minimum = Math.min(minimum, 0); maximum = Math.max(maximum, 0) }
  }

  return {
    version: input.version,
    expectedRevision,
    units: input.units,
    drawingId: boundedString(input.drawingId, 'input.drawingId', 96),
    title: boundedString(input.title, 'input.title', 160),
    categories,
    series,
    origin: input.origin == null ? [0, 0] as [number, number] : point2(input.origin, 'input.origin'),
    width: input.width == null ? 420 : boundedNumber(input.width, 'input.width', 200, 2_000),
    height: input.height == null ? 260 : boundedNumber(input.height, 'input.height', 140, 1_200),
    textHeight: input.textHeight == null ? 5 : boundedNumber(input.textHeight, 'input.textHeight', 2, 20),
    xLabel: input.xLabel == null ? undefined : boundedString(input.xLabel, 'input.xLabel', 64),
    yLabel: input.yLabel == null ? undefined : boundedString(input.yLabel, 'input.yLabel', 64),
    showValues: input.showValues === true,
    yAxis: { minimum, maximum, tick },
  }
}

export function buildAgentCartesianChart(document: ChartDocument, source: KJAgentCartesianChartInput) {
  const input = validateInput(document, source)
  const [chartX, chartY] = input.origin
  const left = Math.max(38, input.textHeight * 9), right = Math.max(16, input.textHeight * 4)
  const bottom = Math.max(34, input.textHeight * 7), top = Math.max(42, input.textHeight * 9)
  const plotX = chartX + left, plotY = chartY + bottom
  const plotWidth = input.width - left - right, plotHeight = input.height - bottom - top
  if (plotWidth < input.textHeight * 20 || plotHeight < input.textHeight * 12) throw new KJValidationError('Chart size leaves insufficient room for axes and labels')
  const axis = input.yAxis
  const idPrefix = `chart-${stableHash({ drawingId: input.drawingId, version: input.version }).slice(0, 12)}`
  const entities: EntitySpec[] = []
  const continuousId = `${idPrefix}-lt-continuous`, gridId = `${idPrefix}-lt-grid`
  const layers = {
    axis: { id: `${idPrefix}-layer-axis`, name: 'CHART_AXIS', color: 7, linetypeId: continuousId, lineweight: 25 },
    grid: { id: `${idPrefix}-layer-grid`, name: 'CHART_GRID', color: 8, linetypeId: gridId, lineweight: 9 },
    text: { id: `${idPrefix}-layer-text`, name: 'CHART_TEXT', color: 7, linetypeId: continuousId, lineweight: 18 },
  }
  const seriesLayers = input.series.map((series, index) => ({ id: `${idPrefix}-layer-series-${index + 1}`, name: `CHART_${series.id.toUpperCase()}`, color: series.color, linetypeId: continuousId, lineweight: series.kind === 'line' ? 35 : 25 }))
  const add = (type: string, layerId: string, payload: Record<string, unknown>) => {
    const id = `${idPrefix}-${String(entities.length + 1).padStart(4, '0')}`
    entities.push({ type, payload: { ...payload, layerId }, options: { id } })
    return id
  }
  const p3 = (x: number, y: number): Point3 => [x, y, 0]
  const line = (x1: number, y1: number, x2: number, y2: number, layerId = layers.axis.id) => add('LINE', layerId, { start: p3(x1, y1), end: p3(x2, y2) })
  const text = (x: number, y: number, value: string, height = input.textHeight) => add('TEXT', layers.text.id, { position: p3(x, y), text: value, height })
  const rectangle = (x: number, y: number, width: number, height: number, layerId: string) => add('LWPOLYLINE', layerId, { vertices: [p3(x, y), p3(x + width, y), p3(x + width, y + height), p3(x, y + height)], closed: true })
  const mapY = (value: number) => plotY + (value - axis.minimum) / (axis.maximum - axis.minimum) * plotHeight
  const categoryX = (index: number) => plotX + plotWidth * (index + 0.5) / input.categories.length

  rectangle(chartX, chartY, input.width, input.height, layers.axis.id)
  const tickCount = Math.floor((axis.maximum - axis.minimum) / axis.tick + EPSILON)
  for (let index = 0; index <= tickCount; index += 1) {
    const value = axis.minimum + index * axis.tick
    const y = mapY(value)
    line(plotX, y, plotX + plotWidth, y, layers.grid.id)
    line(plotX - input.textHeight, y, plotX, y)
    text(plotX - input.textHeight * 7.5, y - input.textHeight * 0.35, formatValue(value, axis.tick), input.textHeight * 0.8)
  }
  const xAxisY = axis.minimum <= 0 && axis.maximum >= 0 ? mapY(0) : plotY
  line(plotX, plotY, plotX, plotY + plotHeight)
  line(plotX, xAxisY, plotX + plotWidth, xAxisY)
  input.categories.forEach((category, index) => {
    const x = categoryX(index)
    line(x, xAxisY, x, xAxisY - input.textHeight)
    const labelX = x - Math.min(category.length, 12) * input.textHeight * 0.22
    text(labelX, chartY + input.textHeight * 2.2, category, input.textHeight * 0.78)
  })

  const bars = input.series.filter(series => series.kind === 'bar')
  input.series.forEach((series, seriesIndex) => {
    const layerId = seriesLayers[seriesIndex]!.id
    if (series.kind === 'bar') {
      const barIndex = bars.findIndex(item => item.id === series.id)
      const slot = plotWidth / input.categories.length
      const groupWidth = slot * 0.72
      const barWidth = groupWidth / bars.length
      series.values.forEach((value, index) => {
        const x = categoryX(index) - groupWidth / 2 + barIndex * barWidth + barWidth * 0.08
        const y = mapY(value), base = mapY(0)
        if (Math.abs(y - base) <= EPSILON) line(x, base, x + barWidth * 0.84, base, layerId)
        else rectangle(x, Math.min(y, base), barWidth * 0.84, Math.abs(y - base), layerId)
        if (input.showValues) text(x, (value >= 0 ? y + input.textHeight * 0.5 : y - input.textHeight * 1.2), formatValue(value, axis.tick), input.textHeight * 0.72)
      })
    } else {
      const points = series.values.map((value, index) => p3(categoryX(index), mapY(value)))
      add('LWPOLYLINE', layerId, { vertices: points, closed: false })
      points.forEach((point, index) => {
        add('CIRCLE', layerId, { center: point, radius: input.textHeight * 0.42 })
        if (input.showValues) text(point[0] + input.textHeight * 0.6, point[1] + input.textHeight * 0.6, formatValue(series.values[index]!, axis.tick), input.textHeight * 0.72)
      })
    }
  })

  text(chartX + input.width * 0.35, chartY + input.height - input.textHeight * 2.2, input.title, input.textHeight * 1.25)
  if (input.xLabel) text(plotX + plotWidth * 0.45, chartY + input.textHeight * 0.35, input.xLabel, input.textHeight * 0.82)
  if (input.yLabel) text(chartX + input.textHeight * 0.8, chartY + input.height - top * 0.72, input.yLabel, input.textHeight * 0.82)
  const legendY = chartY + input.height - input.textHeight * 4.7
  const legendSlot = plotWidth / input.series.length
  input.series.forEach((series, index) => {
    const x = plotX + index * legendSlot
    if (series.kind === 'line') line(x, legendY, x + input.textHeight * 3, legendY, seriesLayers[index]!.id)
    else rectangle(x, legendY - input.textHeight * 0.55, input.textHeight * 2.2, input.textHeight * 1.1, seriesLayers[index]!.id)
    text(x + input.textHeight * 3.5, legendY - input.textHeight * 0.4, series.name, input.textHeight * 0.75)
  })

  if (entities.length > MAX_ENTITY_COUNT) throw new KJValidationError(`Cartesian chart expands to ${entities.length} entities; maximum is ${MAX_ENTITY_COUNT}`)
  return {
    commandArgs: {
      entities,
      resources: {
        linetypes: [
          { id: continuousId, name: `KJ_${idPrefix.slice(6, 18)}_CONT`, pattern: [] },
          { id: gridId, name: `KJ_${idPrefix.slice(6, 18)}_GRID`, pattern: [2, -2] },
        ],
        layers: [layers.axis, layers.grid, layers.text, ...seriesLayers],
      },
    },
    evidence: {
      drawingId: input.drawingId,
      skillId: 'cartesian-chart',
      skillVersion: KJDRAW_CARTESIAN_CHART_VERSION,
      units: input.units,
      expectedRevision: input.expectedRevision,
      entityCount: entities.length,
      bounds: { min: [chartX, chartY], max: [chartX + input.width, chartY + input.height], width: input.width, height: input.height },
      parameters: {
        title: input.title,
        categoryCount: input.categories.length,
        series: input.series.map(series => ({ id: series.id, name: series.name, kind: series.kind, color: series.color, valueCount: series.values.length })),
        yAxis: axis,
        showValues: input.showValues,
      },
      limitations: ['Cartesian category charts only', 'At most 8 series and 160 data values', 'Text labels are placed deterministically without font-metric collision solving'],
    },
  }
}
