// Original public synthetic requirements. These are geometry tasks, not full drawing sheets.
// The fixture seeds below are test data only: never add them to model prompts or tool definitions.
import { strategyTasks } from './drawing-strategies.mjs'

export const parametricTaskScope = 'Three fully specified synthetic 2D geometry tasks with rectangular repetition. This does not measure complete engineering drawings, design judgment, multi-turn repair or all CAD capabilities.'
const xy = (x, y) => ({ x, y })
const empty = () => ({ expectedRevision: 0, units: 'millimeter', lines: [], circles: [], arcs: [], polylines: [] })
const rectangle = (x, y, width, height) => ({ vertices: [xy(x, y), xy(x + width, y), xy(x + width, y + height), xy(x, y + height)], closed: true })
const circle = (x, y, radius) => ({ center: xy(x, y), radius })
const line = (x1, y1, x2, y2) => ({ start: xy(x1, y1), end: xy(x2, y2) })
const arc = (x, y, radius, startDegrees, endDegrees) => ({ center: xy(x, y), radius, startDegrees, endDegrees })
const conditions = ' All coordinates and lengths are millimeters in model XY at z=0. Indices start at zero. All arcs are counterclockwise with angles in degrees from positive X. Draw only the specified geometry: no text, dimensions, hatches, construction lines or additional objects.'

const panel = strategyTasks.find(task => task.id === 'perforated-panel-209')
if (!panel) throw new Error('The original 209-entity panel fixture is required')
const finFrame = empty()
finFrame.polylines.push(rectangle(0, 0, 480, 200), rectangle(18, 25, 444, 150))
for (let index = 0; index < 24; index++) {
  finFrame.polylines.push(rectangle(25 + 18 * index, 40, 10, 120))
  finFrame.circles.push(circle(30 + 18 * index, 60, 2), circle(30 + 18 * index, 140, 2))
}
for (const [x, y] of [[10, 10], [470, 10], [470, 190], [10, 190]]) finFrame.circles.push(circle(x, y, 3))

const regions = empty()
regions.polylines.push({ vertices: [[0, 0], [700, 0], [700, 320], [400, 320], [400, 280], [0, 280]].map(([x, y]) => xy(x, y)), closed: true })
for (let row = 0; row < 8; row++) for (let column = 0; column < 10; column++) regions.circles.push(circle(30 + 35 * column, 30 + 30 * row, 3))
for (let row = 0; row < 6; row++) for (let column = 0; column < 9; column++) regions.circles.push(circle(430 + 25 * column, 45 + 40 * row, 4))
regions.lines.push(line(500, 277, 620, 277), line(620, 293, 500, 293))
regions.arcs.push(arc(620, 285, 8, 270, 90), arc(500, 285, 8, 90, 270), arc(370, 255, 10, 0, 90))

export const parametricDrawingTasks = [
  { id: 'perforated-panel-209', prompt: 'Draw one closed rectangular outline through (0,0), (1680,0), (1680,1280), (0,1280). Add 192 radius-8 holes: 12 rows and 16 columns, centers (40+100*column,50+100*row), row=0..11 and column=0..15. Add four rounded horizontal slots, index i=0..3. For each slot set x=160+400*i: draw lines (x,1210) to (x+100,1210) and (x+100,1230) to (x,1230); draw a radius-10 semicircle centered at (x+100,1220) from 270 to 90 degrees and a radius-10 semicircle centered at (x,1220) from 90 to 270 degrees.' + conditions, expected: structuredClone(panel.expected) },
  { id: 'fin-frame-78', prompt: 'Draw two closed rectangular frame outlines: outer corners (0,0),(480,0),(480,200),(0,200), and inner corners (18,25),(462,25),(462,175),(18,175). Draw 24 separate closed rectangular fin outlines. For each i=0..23, set x=25+18*i; its four vertices are (x,40),(x+10,40),(x+10,160),(x,160). Add two radius-2 holes per fin centered at (30+18*i,60) and (30+18*i,140), for 48 holes total. Add four radius-3 frame mounting holes at (10,10),(470,10),(470,190),(10,190).' + conditions, expected: finFrame },
  { id: 'dual-region-panel-140', prompt: 'Draw a single closed stepped outline through (0,0),(700,0),(700,320),(400,320),(400,280),(0,280), in that order. In the left region add 80 radius-3 holes: centers (30+35*column,30+30*row), row=0..7 and column=0..9. In the right region add 54 radius-4 holes: centers (430+25*column,45+40*row), row=0..5 and column=0..8. Add a rounded slot consisting of lines (500,277) to (620,277) and (620,293) to (500,293), a radius-8 semicircle centered at (620,285) from 270 to 90 degrees, and a radius-8 semicircle centered at (500,285) from 90 to 270 degrees. Also add one separate radius-10 quarter arc centered at (370,255) from 0 to 90 degrees.' + conditions, expected: regions },
]

const point = ({ x, y }) => [x, y, 0]
const nativeCircle = (x, y, radius) => ({ type: 'CIRCLE', payload: { center: [x, y, 0], radius } })
const nativeLine = (x1, y1, x2, y2) => ({ type: 'LINE', payload: { start: [x1, y1, 0], end: [x2, y2, 0] } })
const nativeArc = (x, y, radius, start, end) => ({ type: 'ARC', payload: { center: [x, y, 0], radius, startAngle: start * Math.PI / 180, endAngle: end * Math.PI / 180, clockwise: false } })
const nativeRectangle = (x, y, width, height) => ({ type: 'LWPOLYLINE', payload: { vertices: rectangle(x, y, width, height).vertices.map(point), closed: true } })
const grid = (entities, rows, columns, dx, dy) => ({ entities, pattern: { rows, columns, dx, dy } })

/** Deterministic conformance inputs only. Not a model answer or a built-in CAD template.
 * baseEntities are nonrepeated native specs; patterns use the generic pure expansion API.
 */
export const deterministicFixturePatternInputs = [
  { taskId: 'perforated-panel-209', baseEntities: [nativeRectangle(0, 0, 1680, 1280)], patterns: [grid([nativeCircle(40, 50, 8)], 12, 16, 100, 100), grid([nativeLine(160, 1210, 260, 1210), nativeLine(260, 1230, 160, 1230), nativeArc(260, 1220, 10, 270, 90), nativeArc(160, 1220, 10, 90, 270)], 1, 4, 400, 0)] },
  { taskId: 'fin-frame-78', baseEntities: [nativeRectangle(0, 0, 480, 200), nativeRectangle(18, 25, 444, 150), ...[[10, 10], [470, 10], [470, 190], [10, 190]].map(([x, y]) => nativeCircle(x, y, 3))], patterns: [grid([nativeRectangle(25, 40, 10, 120)], 1, 24, 18, 0), grid([nativeCircle(30, 60, 2)], 2, 24, 18, 80)] },
  { taskId: 'dual-region-panel-140', baseEntities: [{ type: 'LWPOLYLINE', payload: { vertices: [[0, 0, 0], [700, 0, 0], [700, 320, 0], [400, 320, 0], [400, 280, 0], [0, 280, 0]], closed: true } }, nativeLine(500, 277, 620, 277), nativeLine(620, 293, 500, 293), nativeArc(620, 285, 8, 270, 90), nativeArc(500, 285, 8, 90, 270), nativeArc(370, 255, 10, 0, 90)], patterns: [grid([nativeCircle(30, 30, 3)], 8, 10, 35, 30), grid([nativeCircle(430, 45, 4)], 6, 9, 25, 40)] },
]
