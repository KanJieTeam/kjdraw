import { KJCanvasRenderer } from './canvas-renderer.js'
import { createKJDrawSDK } from './sdk.js'
import type { KJDrawSDK, KJSDKCommandEnvelopeReceipt } from './sdk.js'
import { KJDocument } from './document.js'
import type { KJCommandArguments } from './commands.js'
import { editEntityGrip, type KJEntityGrip } from './grips.js'
import type { KJReadonlyObjectRecord } from './schema.js'
import { getDocumentSnapSettings, type KJSnapMode } from './snapping.js'
import type { KJDxfPlotSettings } from './plot-settings.js'
import type { KJFileAdapterOptions, KJFileReadProgress } from './file-adapters.js'
import { openDrawingPrintWindow, type KJDrawingPrintHtml, type KJDrawingPrintOptions } from './print-export.js'
import { createIndustrySample } from './samples.js'
import { KJDRAW_THEME_CSS, kjdrawIcon } from './theme.js'
import { KJDRAW_LAYOUTS, normalizeWorkbenchLayout, type KJWorkbenchLayout } from './layout.js'
import { createBoundaryEditSession, type KJBoundaryEditSession } from './boundary-edit.js'
import {
  KJ_MODIFICATION_DEFINITIONS,
  buildKJModificationCommand,
  getKJModificationDefinition,
  getKJModificationSelectionCenter,
  validateKJModificationSelection,
  type KJLocalizedControlText,
  type KJModificationDefinition,
  type KJModificationId,
} from './modification-controls.js'
import {
  constrainOrthogonalDraftPoint,
  createDraftingSession,
  parseDraftCoordinate,
  type KJDraftEntitySpec,
  type KJDraftingOptions,
  type KJDraftingSession,
  type KJDraftPointRole,
  type KJDraftTool,
} from './drafting.js'

export type { KJWorkbenchLayout } from './layout.js'

export type KJWorkbenchLocale = 'en' | 'zh-CN'
export type KJWorkbenchTheme = 'dark' | 'light'
export type KJWorkbenchTool = 'select' | 'fence' | 'pan' | KJDraftTool | 'text' | 'measure' | 'move' | 'copy'

export interface KJDrawWorkbenchOptions {
  sdk?: KJDrawSDK
  document?: KJDocument | 'blank' | 'sample' | null
  locale?: KJWorkbenchLocale
  theme?: KJWorkbenchTheme
  readonly?: boolean
  grid?: boolean
  showLayers?: boolean
  showInspector?: boolean
  toolbar?: boolean
  layout?: KJWorkbenchLayout
  title?: string
  /** Browser-side ceiling checked before a selected file is read into memory. */
  maxFileBytes?: number
  onChange?: (event: KJDrawWorkbenchChange) => void
  onError?: (error: unknown) => void
}

export interface KJDrawWorkbenchChange {
  document: KJDocument
  revision: number
  entityCount: number
}

export interface KJWorkbenchOpenOptions extends KJFileAdapterOptions {
  fileName?: string
}

export interface KJWorkbenchSaveOptions extends KJFileAdapterOptions {
  fileName?: string
  download?: boolean
}

export type KJWorkbenchPrintOptions = Omit<KJDrawingPrintOptions, 'layoutId' | 'locale'> & { layoutId?: string }

export interface KJWorkbenchSnapshot {
  locale: KJWorkbenchLocale
  theme: KJWorkbenchTheme
  layout: KJWorkbenchLayout
  drawingLayoutId: string | null
  spaceId: string | null
  paperPreview: boolean
  tool: KJWorkbenchTool
  documentId: string | null
  revision: number
  entityCount: number
  selectedIds: readonly string[]
  render: ReturnType<KJCanvasRenderer['render']>
}

type Point2 = readonly [number, number]

interface KJModificationGesture {
  document: KJDocument
  revision: number
  ids: readonly string[]
  definition: KJModificationDefinition
  values: Readonly<Record<string, unknown>>
  selectionCenter: Point2
  points: Point2[]
}

interface KJWorkbenchDraftGesture {
  document: KJDocument
  revision: number
  session: KJDraftingSession
}

interface KJWorkbenchPointerBinding {
  pointerId: number
  document: KJDocument
  revision: number
  view: string
  baseScreen: Point2
}

interface KJWorkbenchBoxSelection extends KJWorkbenchPointerBinding {
  currentScreen: Point2
  operation: 'replace' | 'add' | 'remove'
}

interface KJWorkbenchBoundaryPointer extends KJWorkbenchPointerBinding {
  currentScreen: Point2
  phase: 'boundaries' | 'targets'
  operation: 'add' | 'remove'
}

interface KJWorkbenchGripGesture extends KJWorkbenchPointerBinding {
  grip: KJEntityGrip
  entity: KJReadonlyObjectRecord
  currentWorld: Point2
}

interface KJWorkbenchFenceSelection {
  document: KJDocument
  revision: number
  points: Point2[]
  operation: 'replace' | 'add' | 'remove'
}

const copy = {
  en: {
    drawingSpace: 'Drawing space', modelSpace: 'Model', paperPreview: 'Paper preview · return to Model to edit',
    pageSetup: 'Page setup', pageDescription: 'Configure the selected sheet for DXF export. Blank fields keep existing values. This does not print the drawing.', pageSheet: 'Sheet', pageStale: 'The drawing changed. Close and reopen page setup before applying.', pageWidth: 'Paper width (mm)', pageHeight: 'Paper height (mm)', pageLeft: 'Left margin (mm)', pageRight: 'Right margin (mm)', pageTop: 'Top margin (mm)', pageBottom: 'Bottom margin (mm)', pageUnits: 'Plot units', pageRotation: 'Rotation (counterclockwise)', pageNumerator: 'Custom scale: paper units', pageDenominator: 'Custom scale: drawing units', pageScaleNote: 'Choose Fit to paper or edit the custom ratio. Window coordinates use drawing units; physical offsets use millimeters.', pageUnchanged: 'Keep existing', pageInches: 'Inches', pageMm: 'Millimeters', pagePixels: 'Pixels', pageArea: 'Plot area', pageDisplay: 'Last display', pageExtents: 'Drawing extents', pageLimits: 'Drawing limits', pageView: 'Named view', pageWindow: 'Window', pageLayout: 'Layout', pageViewName: 'View name', pageMinX: 'Window minimum X', pageMinY: 'Window minimum Y', pageMaxX: 'Window maximum X', pageMaxY: 'Window maximum Y', pageOriginX: 'Origin X (mm)', pageOriginY: 'Origin Y (mm)', pageScaleMode: 'Scale mode', pageFit: 'Fit to paper', pageCustom: 'Custom ratio',
    open: 'Open', openSource: 'Reading file', openParse: 'Parsing DXF', openImport: 'Building drawing', openCancelHint: 'Esc cancels', openCancelled: 'Open cancelled', saveKjd: 'Save KJD', exportDxf: 'Export DXF', exportSvg: 'Export SVG', print: 'Print / PDF', printOpened: 'Print dialog opened · choose Save as PDF for vector output', draw: 'Draw', modify: 'Modify', view: 'View',
    select: 'Select', pan: 'Pan', line: 'Line', polyline: 'Polyline', circle: 'Circle', arc: 'Arc', rectangle: 'Rectangle', text: 'Text', measure: 'Measure',
    undo: 'Undo', redo: 'Redo', erase: 'Delete', move: 'Move', copy: 'Copy', rotate: 'Rotate', offset: 'Offset', fit: 'Fit', grid: 'Grid', ortho: 'Ortho', orthoOn: 'Orthogonal drafting on', orthoOff: 'Orthogonal drafting off', orthoBusy: 'Finish or cancel the current operation before changing Ortho', layers: 'Layers', properties: 'Properties',
    noSelection: 'Select an object to inspect its properties.', drawing: 'Drawing', entities: 'entities', selected: 'selected',
    layer: 'Layer', radius: 'Radius', apply: 'Apply', ready: 'Ready', readonly: 'Read only',
    firstPoint: 'Specify the first point', nextPoint: 'Specify the next point', finishPolyline: 'Click vertices · Enter or double-click to finish', arcStart: 'Specify arc start', arcEnd: 'Specify arc endpoint', textPrompt: 'Type TEXT followed by content, then click an insertion point', measured: 'Measured distance',
    unsupported: 'projection limits', theme: 'Theme', language: '中文', sample: 'Starter drawing', openFailed: 'Could not open drawing', command: 'Command', run: 'Run', commandHint: 'MOVE 10 0 · COPY 10 0 · ROTATE 15 · OFFSET 2 · SCALE 1.2', fileTooLarge: 'File exceeds the workbench limit',
    layout: 'Layout', layoutClassic: 'Classic', layoutCompact: 'Compact', layoutFocus: 'Focus', selectObjects: 'Select an object', basePoint: 'Specify the base point', destinationPoint: 'Specify the destination point', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
    modifyTools: 'Edit tools', modifyTitle: 'Modify selection', modifyDescription: 'Choose an exact operation and enter its parameters.', cancel: 'Cancel', continueOnCanvas: 'Continue on canvas', selectionOrder: 'Selection order is significant for paired and boundary operations.',
    moreDraw: 'More', drawTitle: 'Drawing tools', drawDescription: 'Choose a primitive and configure its construction method.', startDrawing: 'Start drawing', drawingTool: 'Primitive', undoPoint: 'Undo point', finish: 'Finish', closeShape: 'Close', coordinateHint: 'x,y · @dx,dy · @distance<angle',
    selectionHint: 'Drag blank space: left → right encloses, right → left crosses · Shift adds · Ctrl/⌘ removes · Ctrl/⌘+A selects all',
    windowSelection: 'Window: fully enclosed objects', crossingSelection: 'Crossing: enclosed or intersecting objects', gripHint: 'Drag a square grip to edit geometry · Esc cancels', gripEditing: 'Specify the new grip position · Esc cancels', gestureCancelled: 'Drawing or view changed — gesture cancelled', snapEndpoint: 'Endpoint', snapMidpoint: 'Midpoint', snapCenter: 'Center', snapQuadrant: 'Quadrant', snapIntersection: 'Intersection', snapInsertion: 'Insertion', snapNode: 'Node', snapNearest: 'Nearest',
    fenceHint: 'Fence: click an open polyline · Enter selects · Backspace removes a point · Esc cancels · Shift/Ctrl/⌘ on first point adds/removes', fenceNeedsPoints: 'Fence selection needs at least two distinct points',
    showLayer: 'Show layer', hideLayer: 'Hide layer', lockLayer: 'Lock layer', unlockLayer: 'Unlock layer', freezeLayer: 'Freeze layer', thawLayer: 'Thaw layer',
    editWorkflow: 'Workflow', boundaryWorkflow: 'Continuous · boundaries first', singleWorkflow: 'Single edit · target then boundaries',
    confirmBoundaries: 'Confirm boundaries', boundarySelectionHint: 'Click or drag to add boundaries · Ctrl/⌘ removes · Enter confirms', boundaryTargetHint: 'Click target portions repeatedly · Enter or Esc finishes', boundaryEmpty: 'No editable target here — pick another portion', boundaryBusy: 'Applying the edit…',
  },
  'zh-CN': {
    drawingSpace: '图纸空间', modelSpace: '模型', paperPreview: '纸空间只读预览 · 返回模型后编辑',
    pageSetup: '页面设置', pageDescription: '配置选定图纸的 DXF 导出参数。空字段保留已有值；本操作不执行打印。', pageSheet: '图纸布局', pageStale: '图档已变更，请关闭并重新打开页面设置后再应用。', pageWidth: '纸张宽度（毫米）', pageHeight: '纸张高度（毫米）', pageLeft: '左边距（毫米）', pageRight: '右边距（毫米）', pageTop: '上边距（毫米）', pageBottom: '下边距（毫米）', pageUnits: '打印单位', pageRotation: '旋转（逆时针）', pageNumerator: '自定义比例：纸张单位', pageDenominator: '自定义比例：图形单位', pageScaleNote: '可选适合纸张或编辑自定义比例。窗口坐标使用绘图单位，物理偏移使用毫米。', pageUnchanged: '保留已有值', pageInches: '英寸', pageMm: '毫米', pagePixels: '像素', pageArea: '打印范围', pageDisplay: '上次显示范围', pageExtents: '图形范围', pageLimits: '图形界限', pageView: '命名视图', pageWindow: '窗口', pageLayout: '布局', pageViewName: '视图名称', pageMinX: '窗口最小 X', pageMinY: '窗口最小 Y', pageMaxX: '窗口最大 X', pageMaxY: '窗口最大 Y', pageOriginX: '原点 X（毫米）', pageOriginY: '原点 Y（毫米）', pageScaleMode: '比例模式', pageFit: '适合纸张', pageCustom: '自定义比例',
    open: '打开', openSource: '正在读取文件', openParse: '正在解析 DXF', openImport: '正在构建图纸', openCancelHint: 'Esc 取消', openCancelled: '已取消打开', saveKjd: '保存 KJD', exportDxf: '导出 DXF', exportSvg: '导出 SVG', print: '打印 / PDF', printOpened: '已打开打印对话框 · 选择另存为 PDF 可保留矢量', draw: '绘图', modify: '修改', view: '视图',
    select: '选择', pan: '平移', line: '直线', polyline: '多段线', circle: '圆', arc: '圆弧', rectangle: '矩形', text: '文字', measure: '测距',
    undo: '撤销', redo: '重做', erase: '删除', move: '移动', copy: '复制', rotate: '旋转', offset: '偏移', fit: '全图', grid: '栅格', ortho: '正交', orthoOn: '正交绘图已开启', orthoOff: '正交绘图已关闭', orthoBusy: '请先完成或取消当前操作，再切换正交模式', layers: '图层', properties: '特性',
    noSelection: '选择图元后可查看和修改属性。', drawing: '图纸', entities: '图元', selected: '已选择',
    layer: '图层', radius: '半径', apply: '应用', ready: '就绪', readonly: '只读',
    firstPoint: '指定第一个点', nextPoint: '指定下一个点', finishPolyline: '连续指定顶点 · Enter 或双击完成', arcStart: '指定圆弧起点', arcEnd: '指定圆弧端点', textPrompt: '输入 TEXT 和文字内容，再指定插入点', measured: '测量距离',
    unsupported: '投影限制', theme: '主题', language: 'EN', sample: '入门图纸', openFailed: '无法打开图纸', command: '命令', run: '执行', commandHint: 'MOVE 10 0 · COPY 10 0 · ROTATE 15 · OFFSET 2 · SCALE 1.2', fileTooLarge: '文件超过工作台限制',
    layout: '布局', layoutClassic: '经典', layoutCompact: '紧凑', layoutFocus: '专注', selectObjects: '选择对象', basePoint: '指定基点', destinationPoint: '指定目标点', zoomIn: '放大', zoomOut: '缩小',
    modifyTools: '编辑工具', modifyTitle: '修改选中对象', modifyDescription: '选择精确操作并输入参数。', cancel: '取消', continueOnCanvas: '到画布继续', selectionOrder: '成对操作和边界操作会按选择顺序执行。',
    moreDraw: '更多', drawTitle: '绘图工具', drawDescription: '选择基础图元并配置构造方式。', startDrawing: '开始绘图', drawingTool: '基础图元', undoPoint: '撤回点', finish: '完成', closeShape: '闭合', coordinateHint: 'x,y · @dx,dy · @距离<角度',
    selectionHint: '空白处拖动：左→右框选，右→左交叉选 · Shift 增选 · Ctrl/⌘ 减选 · Ctrl/⌘+A 全选',
    windowSelection: '框选：完全位于框内的对象', crossingSelection: '交叉选择：框内或与边界相交的对象', gripHint: '拖动方形夹点修改几何 · Esc 取消', gripEditing: '指定夹点的新位置 · Esc 取消', gestureCancelled: '图纸或视图已变化，操作已取消', snapEndpoint: '端点', snapMidpoint: '中点', snapCenter: '圆心', snapQuadrant: '象限点', snapIntersection: '交点', snapInsertion: '插入点', snapNode: '节点', snapNearest: '最近点',
    fenceHint: '围栏：连续点击折线点 · Enter 选择 · Backspace 撤回点 · Esc 取消 · 首点按 Shift 增选、Ctrl/⌘ 减选', fenceNeedsPoints: '围栏至少需要两个不同的点',
    showLayer: '显示图层', hideLayer: '隐藏图层', lockLayer: '锁定图层', unlockLayer: '解锁图层', freezeLayer: '冻结图层', thawLayer: '解冻图层',
    editWorkflow: '工作模式', boundaryWorkflow: '连续编辑 · 先选边界', singleWorkflow: '单次编辑 · 先目标后边界',
    confirmBoundaries: '确认边界', boundarySelectionHint: '点击或框选添加边界 · Ctrl/⌘ 减选 · Enter 确认', boundaryTargetHint: '连续点选目标区段 · Enter 或 Esc 结束', boundaryEmpty: '这里没有可编辑目标，请重新点选区段', boundaryBusy: '正在应用修改…',
  },
} as const

const DRAFT_TOOLS = Object.freeze(['line', 'polyline', 'circle', 'arc', 'ellipse', 'rectangle', 'polygon', 'point', 'ray', 'xline', 'spline', 'hatch', 'dimension'] as const satisfies readonly KJDraftTool[])

const DRAFT_COMMAND_TO_TOOL = new Map<string, KJDraftTool>([
  ['P', 'point'], ['POINT', 'point'], ['RAY', 'ray'], ['XL', 'xline'], ['XLINE', 'xline'],
  ['EL', 'ellipse'], ['ELLIPSE', 'ellipse'], ['POL', 'polygon'], ['POLYGON', 'polygon'],
  ['SPL', 'spline'], ['SPLINE', 'spline'], ['H', 'hatch'], ['HATCH', 'hatch'],
  ['DIM', 'dimension'], ['DIMENSION', 'dimension'],
])

const DIMENSION_COMMAND_TO_TYPE = new Map<string, NonNullable<KJDraftingOptions['dimensionType']>>([
  ['DIMALIGNED', 'ALIGNED'], ['DIMLINEAR', 'ROTATED'], ['DIMRADIUS', 'RADIUS'], ['DIMDIAMETER', 'DIAMETER'], ['DIMANGULAR', 'ANGULAR_3_POINT'], ['DIMANGULAR3P', 'ANGULAR_3_POINT'],
])

const draftToolText: Readonly<Record<KJDraftTool, KJLocalizedControlText>> = Object.freeze({
  line: { en: 'Line', zh: '直线' }, polyline: { en: 'Polyline', zh: '多段线' }, circle: { en: 'Circle', zh: '圆' }, arc: { en: 'Arc', zh: '圆弧' },
  ellipse: { en: 'Ellipse', zh: '椭圆' }, rectangle: { en: 'Rectangle', zh: '矩形' }, polygon: { en: 'Polygon', zh: '正多边形' }, point: { en: 'Point', zh: '点' },
  ray: { en: 'Ray', zh: '射线' }, xline: { en: 'Construction line', zh: '构造线' }, spline: { en: 'Spline', zh: '样条曲线' }, hatch: { en: 'Hatch', zh: '填充' }, dimension: { en: 'Dimension', zh: '标注' },
})

const draftPointText: Readonly<Record<KJDraftPointRole, KJLocalizedControlText>> = Object.freeze({
  start: { en: 'Specify the start point', zh: '指定起点' }, end: { en: 'Specify the end point', zh: '指定终点' }, vertex: { en: 'Specify the next vertex', zh: '指定下一顶点' }, position: { en: 'Specify the position', zh: '指定位置' },
  origin: { en: 'Specify the origin', zh: '指定原点' }, directionPoint: { en: 'Specify a point on the direction', zh: '指定方向上的一点' }, center: { en: 'Specify the center', zh: '指定中心' }, radiusPoint: { en: 'Specify a point on the radius', zh: '指定半径点' },
  diameterPoint1: { en: 'Specify the first diameter point', zh: '指定直径第一点' }, diameterPoint2: { en: 'Specify the second diameter point', zh: '指定直径第二点' }, throughPoint: { en: 'Specify a point on the arc', zh: '指定圆弧经过点' }, majorAxisPoint: { en: 'Specify the major-axis endpoint', zh: '指定长轴端点' },
  minorAxisPoint: { en: 'Specify the minor-axis endpoint', zh: '指定短轴端点' }, firstCorner: { en: 'Specify the first corner', zh: '指定第一个角点' }, oppositeCorner: { en: 'Specify the opposite corner', zh: '指定对角点' }, controlPoint: { en: 'Specify the next control point', zh: '指定下一控制点' },
  ellipseArcStart: { en: 'Specify the elliptical-arc start direction', zh: '指定椭圆弧起点方向' }, ellipseArcEnd: { en: 'Specify the elliptical-arc end direction (counter-clockwise)', zh: '指定椭圆弧终点方向（逆时针）' },
  boundaryPoint: { en: 'Specify the next boundary point', zh: '指定下一边界点' }, extensionOrigin1: { en: 'Specify the first extension origin', zh: '指定第一尺寸界线原点' }, extensionOrigin2: { en: 'Specify the second extension origin', zh: '指定第二尺寸界线原点' }, placement: { en: 'Specify the dimension-line position', zh: '指定尺寸线位置' },
  angleVertex: { en: 'Three-point angle 1/4: vertex → first ray → second ray → arc position', zh: '三点角度 1/4：顶点 → 第一射线点 → 第二射线点 → 弧位置' }, firstRayPoint: { en: '2/4: specify a point on the first ray', zh: '2/4：指定第一条射线上的点' }, secondRayPoint: { en: '3/4: specify a point on the second ray', zh: '3/4：指定第二条射线上的点' }, angularPlacement: { en: '4/4: place the angle arc; choose the opposite sector for a reflex angle', zh: '4/4：指定角度弧位置；在另一角域放置可标注反角' },
  oppositePoint: { en: 'Specify the opposite point', zh: '指定对侧点' }, pointOnCircle: { en: 'Specify a point on the circle', zh: '指定圆上一点' },
})

const WORKBENCH_STYLE = `
:host{display:block;min-height:480px;color-scheme:light}
.kjwb{--surface:var(--kj-surface,#fff);--surface-subtle:var(--kj-surface-subtle,#eef1f5);--chrome:var(--kj-chrome,#f6f7f9);--border:var(--kj-border,#d9dee6);--text:var(--kj-text,#202936);--muted:var(--kj-muted,#637083);--action:var(--kj-action,#2863df);--action-soft:var(--kj-action-soft,#eaf1ff);--brand:var(--kj-brand,#bdf878);--radius:var(--kj-radius,6px);height:100%;min-height:480px;display:grid;grid-template-rows:44px 92px minmax(300px,1fr) 32px;background:var(--chrome);color:var(--text);font:13px/1.4 var(--kj-font,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif);border:1px solid var(--border);overflow:hidden;isolation:isolate}
/* Long status messages must never resize the canvas by expanding an implicit auto grid column. */
.kjwb{grid-template-columns:minmax(0,1fr);min-width:0}.kjwb :is(.appbar,.ribbon,.workspace,.statusbar){min-width:0}
.kjwb .appbar button,.kjwb .appbar .layout-select,.kjwb .appbar .brand{flex-shrink:0;white-space:nowrap}
.kjwb *{box-sizing:border-box}.kjwb :where(:not(svg):not(svg *)){all:revert;box-sizing:border-box}.kjwb button,.kjwb select,.kjwb input{font:inherit}.kjwb .appbar{display:flex;align-items:center;gap:6px;padding:0 10px;background:var(--chrome);border-bottom:1px solid var(--border)}
.kjwb .mark{display:grid;place-items:center;width:28px;height:28px;border-radius:var(--radius);background:var(--brand);color:#16220f;flex:0 0 auto}.kjwb .mark .icon{width:19px;height:19px}.kjwb .brand{font-size:14px;font-weight:700;letter-spacing:-.015em}.kjwb .docname{min-width:0;margin-left:8px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kjwb .spacer{flex:1}
.kjwb button{min-height:32px;border:1px solid transparent;color:var(--text);background:transparent;border-radius:var(--radius);cursor:pointer}.kjwb button:hover:not(:disabled){background:var(--surface-subtle);border-color:var(--border)}.kjwb button:focus-visible{outline:2px solid var(--action);outline-offset:1px}.kjwb button:disabled{opacity:.38;cursor:default}.kjwb .icon{display:inline-grid;place-items:center;width:18px;height:18px;color:#526075;flex:0 0 auto}.kjwb .icon svg{display:block;width:100%;height:100%}
.kjwb .appbar button{height:32px;padding:0 9px;display:inline-flex;align-items:center;justify-content:center;gap:6px}.kjwb .layout-select{height:32px;max-width:112px;padding:0 26px 0 9px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text)}.kjwb .primary{background:var(--action)!important;border-color:var(--action)!important;color:#fff!important}.kjwb .primary .icon{color:#fff}.kjwb .panel-toggle.active{background:var(--action-soft);border-color:#c8d8fa;color:var(--action)}.kjwb .panel-toggle.active .icon{color:var(--action)}
.kjwb .ribbon{display:flex;gap:0;background:var(--surface);border-bottom:1px solid var(--border);overflow-x:auto;overflow-y:hidden}.kjwb .group{display:flex;flex:0 0 auto;align-items:stretch;gap:2px;padding:8px 8px 22px;border-right:1px solid var(--border);position:relative}.kjwb .group>span{position:absolute;bottom:4px;left:0;right:0;text-align:center;font-size:12px;line-height:16px;letter-spacing:.02em;color:var(--muted)}
.kjwb .tool{flex:0 0 auto;min-width:54px;padding:5px 7px;display:grid;grid-template-rows:24px auto;place-items:center;align-content:center;gap:2px}.kjwb .tool .icon{width:21px;height:21px}.kjwb .tool small{font-size:12px;line-height:16px;white-space:nowrap;color:var(--text)}.kjwb .tool.active{background:var(--action-soft);border-color:#c8d8fa;color:var(--action)}.kjwb .tool.active .icon,.kjwb .tool.active small{color:var(--action)}
/* WebKit grid buttons need explicit intrinsic widths to keep groups from overlapping. */
.kjwb .group,.kjwb .tool{width:max-content}
.kjwb .workspace{min-height:0;display:grid;grid-template-columns:232px minmax(0,1fr) 260px}.kjwb .workspace.no-layers{grid-template-columns:minmax(0,1fr) 260px}.kjwb .workspace.no-inspector{grid-template-columns:232px minmax(0,1fr)}.kjwb .workspace.no-layers.no-inspector{grid-template-columns:minmax(0,1fr)}
.kjwb .side{min-width:0;background:var(--surface);border-right:1px solid var(--border);overflow:auto}.kjwb .side.right{border-right:0;border-left:1px solid var(--border)}.kjwb .side h2{height:40px;margin:0;padding:11px 12px;border-bottom:1px solid var(--border);font-size:12px;line-height:17px;font-weight:700;letter-spacing:.035em;color:var(--muted)}
.kjwb .layer{width:100%;min-height:38px;display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:7px;padding:6px 12px;border-bottom:1px solid var(--surface-subtle);text-align:left}.kjwb .layer:hover{background:var(--surface-subtle)}.kjwb .layer input{width:16px;height:16px;accent-color:var(--action)}.kjwb .layer span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kjwb .layer small{min-width:24px;padding:1px 5px;border-radius:10px;background:var(--surface-subtle);color:var(--muted);font-size:12px;text-align:center}
.kjwb .layer{grid-template-columns:minmax(0,1fr) 28px 28px auto;gap:4px;padding-inline:8px}.kjwb .layer-name{display:flex;align-items:center;gap:7px;min-width:0;cursor:pointer}.kjwb .layer-name input{flex:0 0 16px;margin:0}.kjwb .layer-name span{min-width:0}.kjwb .layer-state{display:grid;place-items:center;width:28px;height:28px;min-height:28px;padding:4px;color:var(--muted)}.kjwb .layer-state[aria-pressed="true"]{color:var(--action);background:var(--action-soft)}.kjwb .layer-state .kj-icon{width:17px;height:17px}
.kjwb .canvas-wrap{position:relative;min-width:0;min-height:0;background:#081016;overflow:hidden}.kjwb.light .canvas-wrap{background:#f8fafc}.kjwb .canvas-wrap canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none}.kjwb .canvas-wrap .overlay{pointer-events:none}.kjwb .crosshair{cursor:crosshair!important}.kjwb .pan{cursor:grab!important}.kjwb .pan.dragging{cursor:grabbing!important}
.kjwb .navigator{position:absolute;z-index:4;right:12px;top:50%;transform:translateY(-50%);display:grid;gap:2px;padding:3px;border:1px solid var(--border);border-radius:var(--radius);background:#fffffff2;box-shadow:0 7px 22px #17233a24}.kjwb .navigator button{width:32px;height:32px;min-height:32px;padding:6px;display:grid;place-items:center}.kjwb .navigator button.active{background:var(--action-soft);border-color:#c8d8fa}.kjwb .navigator button.active .icon{color:var(--action)}
.kjwb .draft-actions{position:absolute;z-index:4;left:12px;top:12px;display:flex;gap:4px;padding:3px;border:1px solid var(--border);border-radius:var(--radius);background:#fffffff2;box-shadow:0 6px 18px #17233a1f}.kjwb .draft-actions button{height:32px;padding:0 10px}.kjwb .draft-actions button:disabled{display:none}
.kjwb .boundary-actions{flex-wrap:wrap;max-width:calc(100% - 24px);align-items:center}.kjwb .boundary-summary{min-width:0;padding:0 7px;font-size:12px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}
.kjwb .hint{position:absolute;left:12px;bottom:12px;max-width:min(540px,calc(100% - 24px));padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius);background:#fffffff2;color:var(--muted);box-shadow:0 4px 16px #17233a14;pointer-events:none}.kjwb .snap{position:absolute;z-index:3;width:9px;height:9px;border:2px solid var(--brand);box-shadow:0 0 0 2px #20293680;transform:translate(-50%,-50%);pointer-events:none;display:none}.kjwb .snap::after{content:attr(data-label);position:absolute;left:12px;top:8px;padding:2px 5px;border-radius:3px;background:#202936e8;color:#fff;font:11px/15px var(--kj-sans,system-ui,sans-serif);white-space:nowrap}
.kjwb .command{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);width:min(700px,calc(100% - 28px));min-height:40px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;padding:3px 4px 3px 11px;border:1px solid var(--border);border-radius:var(--radius);background:#fffffff5;box-shadow:0 8px 26px #17233a24}.kjwb .command span{font:12px/16px var(--kj-mono,ui-monospace,SFMono-Regular,Consolas,monospace);font-weight:700;color:var(--muted);letter-spacing:.025em}.kjwb .command input{min-width:0;height:32px;border:0;outline:0;background:transparent;color:var(--text)}.kjwb .command input::placeholder{color:#8b96a6}.kjwb .command button{height:32px;padding:0 14px;background:var(--action);border-color:var(--action);color:#fff}.kjwb .command+.hint{bottom:60px}
.kjwb .inspector{padding:12px}.kjwb .empty{margin:2px 0;color:var(--muted);line-height:1.65}.kjwb .entity-title{padding-bottom:10px;border-bottom:1px solid var(--border);font-size:16px;font-weight:700;margin-bottom:8px}.kjwb .kv{display:grid;grid-template-columns:82px minmax(0,1fr);gap:9px;padding:8px 0;border-bottom:1px solid var(--surface-subtle)}.kjwb .kv span{color:var(--muted)}.kjwb .kv b{font-weight:600;overflow:hidden;text-overflow:ellipsis}.kjwb .field{display:grid;gap:6px;margin:12px 0}.kjwb .field span{font-size:12px;font-weight:600;color:var(--muted);letter-spacing:.025em}.kjwb .field input,.kjwb .field select{min-width:0;width:100%;height:32px;padding:0 9px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);outline:0}.kjwb .field input:focus,.kjwb .field select:focus{border-color:var(--action);box-shadow:0 0 0 2px var(--action-soft)}.kjwb .apply{width:100%;height:32px;background:var(--action);border-color:var(--action);color:#fff}.kjwb .warning{margin-top:12px;padding:9px;border:1px solid #e4b95f;border-radius:var(--radius);background:#fff8e8;color:#76530c;font-size:12px}
.kjwb .modify-dialog{width:min(480px,calc(100vw - 28px));max-height:min(680px,calc(100vh - 28px));padding:0;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);box-shadow:0 22px 70px #17233a42;overflow:hidden}.kjwb .modify-dialog::backdrop{background:#17233a66;backdrop-filter:blur(2px)}.kjwb .modify-form{display:grid;grid-template-rows:auto minmax(0,1fr) auto;max-height:inherit}.kjwb .modify-head{padding:18px 20px 12px;border-bottom:1px solid var(--border)}.kjwb .modify-head h2{margin:0 0 5px;font-size:18px;line-height:1.25}.kjwb .modify-head p,.kjwb .modify-description,.kjwb .modify-order{margin:0;color:var(--muted);line-height:1.55}.kjwb .modify-body{padding:15px 20px;overflow:auto}.kjwb .modify-body>.field{margin-top:0}.kjwb .modify-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px}.kjwb .modify-fields .field{margin:10px 0}.kjwb .modify-fields .check{display:flex;align-items:center;gap:9px;align-self:end;min-height:44px}.kjwb .modify-fields .check input{width:17px;height:17px;accent-color:var(--action)}.kjwb .modify-order{margin-top:10px;padding:9px 10px;border-radius:var(--radius);background:var(--surface-subtle);font-size:12px}.kjwb .modify-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--border);background:var(--chrome)}.kjwb .modify-actions button{padding:0 14px}.kjwb .modify-actions .confirm{background:var(--action);border-color:var(--action);color:#fff}@media(max-width:520px){.kjwb .modify-fields{grid-template-columns:1fr}}
.kjwb .draft-options:empty::after{content:'—';display:block;padding:8px 0;color:var(--muted)}
.kjwb .statusbar{display:flex;align-items:center;gap:14px;padding:0 10px;background:var(--chrome);border-top:1px solid var(--border);color:var(--muted);font:12px/1.3 var(--kj-mono,ui-monospace,SFMono-Regular,Consolas,monospace)}.kjwb .statusbar .message{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kjwb .statusbar b{color:var(--text);font-weight:600}.kjwb .statusbar .draft-toggle{height:24px;min-height:24px;padding:0 7px;border-color:var(--border);font:inherit}.kjwb .statusbar .draft-toggle[aria-pressed="true"]{color:var(--action);background:var(--action-soft);border-color:#c8d8fa}.kjwb .file-input{display:none}
.kjwb.layout-compact{grid-template-rows:44px 44px minmax(300px,1fr) 32px}.kjwb.layout-compact .group{align-items:center;padding:5px 6px}.kjwb.layout-compact .group>span{display:none}.kjwb.layout-compact .tool{min-width:auto;height:32px;display:inline-flex;grid-template-rows:none;gap:5px;padding:4px 8px}.kjwb.layout-compact .tool .icon{width:18px;height:18px}.kjwb.layout-focus{grid-template-rows:44px 0 minmax(300px,1fr) 32px}.kjwb.layout-focus .ribbon{visibility:hidden;overflow:hidden;pointer-events:none}.kjwb.layout-focus .workspace{grid-template-columns:minmax(0,1fr)!important}.kjwb.layout-focus .side,.kjwb.layout-focus .panel-toggle{display:none!important}
@media(max-width:980px){.kjwb .workspace,.kjwb .workspace.no-layers{grid-template-columns:minmax(0,1fr) 230px}.kjwb .workspace.no-inspector,.kjwb .workspace.no-layers.no-inspector{grid-template-columns:minmax(0,1fr)}.kjwb .side.layers{display:none}.kjwb .panel-toggle[data-action="toggle-layers"]{display:none}.kjwb .tool{min-width:50px;padding-inline:5px}}
@media(max-width:680px){.kjwb .workspace,.kjwb .workspace.no-layers,.kjwb .workspace.no-inspector,.kjwb .workspace.no-layers.no-inspector{grid-template-columns:minmax(0,1fr)}.kjwb .side.right{display:none}.kjwb .panel-toggle{display:none!important}.kjwb .hide-small{display:none!important}.kjwb .brand{font-size:13px}.kjwb .docname{display:none}.kjwb .group{padding-inline:4px}.kjwb .appbar{gap:3px;padding-inline:6px}.kjwb .layout-select{max-width:92px}}
@media(max-width:680px){.kjwb .appbar .file-action{width:32px;padding:0}.kjwb .appbar .file-action>[data-copy]{display:none}}
/* Preserve all file actions at phone widths; the mark still identifies the app. */
@media(max-width:460px){.kjwb .appbar .brand{display:none}.kjwb .layout-select{max-width:82px}}
.kjwb .drawing-space{position:absolute;top:10px;left:10px;z-index:4;display:flex;align-items:center;flex-wrap:wrap;gap:8px;max-width:calc(100% - 70px);font-size:12px}.kjwb .drawing-space select{max-width:210px;min-height:30px;padding:4px 8px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)}.kjwb .drawing-space span{padding:5px 8px;background:var(--surface);color:var(--muted);border:1px solid var(--border);border-radius:var(--radius)}
`

function assertBrowser(): void {
  if (typeof document === 'undefined') throw new Error('KJDraw workbench requires a browser DOM')
}

function query<ElementType extends Element>(root: ParentNode, selector: string): ElementType {
  const element = root.querySelector<ElementType>(selector)
  if (!element) throw new Error(`KJDraw workbench element is missing: ${selector}`)
  return element
}

function point(event: PointerEvent | WheelEvent, canvas: HTMLCanvasElement): Point2 {
  const rect = canvas.getBoundingClientRect()
  return [event.clientX - rect.left, event.clientY - rect.top]
}

function formatFromName(fileName: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(fileName)
  const extension = match?.[1]?.toUpperCase()
  return extension === 'KJD' || extension === 'DXF' ? extension : undefined
}

function sourceByteLength(source: unknown): number | null {
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return source.byteLength
  if (typeof Blob !== 'undefined' && source instanceof Blob) return source.size
  return null
}

function entityIdsFromCommandResult(value: unknown): string[] {
  const ids = new Set<string>()
  const seen = new WeakSet<object>()
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object') return
    if (seen.has(candidate)) return
    seen.add(candidate)
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
      return
    }
    const record = candidate as Record<string, unknown>
    if (record.kind === 'entity' && typeof record.id === 'string') {
      ids.add(record.id)
      return
    }
    for (const item of Object.values(record)) visit(item)
  }
  visit(value)
  return [...ids]
}

function downloadBytes(content: unknown, name: string, type: string): void {
  let part: BlobPart
  if (content instanceof Uint8Array) part = content as BlobPart
  else if (content instanceof ArrayBuffer) part = content
  else part = String(content ?? '')
  const url = URL.createObjectURL(new Blob([part], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

async function starterDocument(sdk: KJDrawSDK): Promise<KJDocument> {
  return createIndustrySample(sdk, 'sample-site-plan')
}

function availableDocumentId(sdk: KJDrawSDK, prefix: string): string {
  const base = `${prefix}-${Date.now()}`
  let documentId = base
  let copy = 2
  while (sdk.documents.has(documentId)) documentId = `${base}-${copy++}`
  return documentId
}

interface KJWorkbenchDocumentLease {
  document: KJDocument
  viewers: Set<KJDrawWorkbench>
  generated: boolean
}

const workbenchDocumentLeases = new WeakMap<KJDrawSDK, Map<KJDocument, KJWorkbenchDocumentLease>>()

function acquireDocumentLease(sdk: KJDrawSDK, workbench: KJDrawWorkbench, document: KJDocument, generated: boolean): void {
  let leases = workbenchDocumentLeases.get(sdk)
  if (!leases) {
    leases = new Map()
    workbenchDocumentLeases.set(sdk, leases)
  }
  const current = leases.get(document)
  const lease = current ?? { document, viewers: new Set<KJDrawWorkbench>(), generated: false }
  lease.generated ||= generated
  lease.viewers.add(workbench)
  leases.set(document, lease)
}

function releaseDocumentLease(sdk: KJDrawSDK, workbench: KJDrawWorkbench, document: KJDocument): void {
  const leases = workbenchDocumentLeases.get(sdk)
  const lease = leases?.get(document)
  if (!leases || !lease) return
  lease.viewers.delete(workbench)
  if (lease.viewers.size) return
  leases.delete(document)
  if (!leases.size) workbenchDocumentLeases.delete(sdk)
  if (lease.generated && sdk.documents.get(document.id) === document) sdk.closeDocument(document.id)
}

function hasOtherDocumentViewer(sdk: KJDrawSDK, workbench: KJDrawWorkbench, document: KJDocument): boolean {
  const lease = workbenchDocumentLeases.get(sdk)?.get(document)
  if (!lease) return false
  for (const viewer of lease.viewers) if (viewer !== workbench) return true
  return false
}

/** A framework-neutral reference CAD workbench that can be embedded with one call. */
export class KJDrawWorkbench {
  readonly container: HTMLElement | ShadowRoot
  readonly root: HTMLElement
  readonly sdk: KJDrawSDK
  readonly renderer: KJCanvasRenderer
  readonly ready: Promise<this>
  #options: KJDrawWorkbenchOptions
  #locale: KJWorkbenchLocale
  #theme: KJWorkbenchTheme
  #layout: KJWorkbenchLayout
  #drawingLayoutId: string | null = null
  #tool: KJWorkbenchTool = 'select'
  #canvas: HTMLCanvasElement
  #overlay: HTMLCanvasElement
  #overlayContext: CanvasRenderingContext2D
  #overlayObserver: ResizeObserver | null = null
  #abort = new AbortController()
  #disposeDocument: (() => void) | null = null
  #disposeSelection: (() => void) | null = null
  #draftStart: Point2 | null = null
  #draftPoints: Point2[] = []
  #cursorWorld: Point2 | null = null
  #snapWorld: Point2 | null = null
  #snapMode: KJSnapMode | null = null
  #pendingText = 'KJDraw'
  #snappableEntityIds: string[] = []
  #panStart: Point2 | null = null
  #activePointer: number | null = null
  #selectionDrag: (KJWorkbenchPointerBinding & { ids: readonly string[]; baseWorld: Point2; currentWorld: Point2 }) | null = null
  #boxSelection: KJWorkbenchBoxSelection | null = null
  #gripGesture: KJWorkbenchGripGesture | null = null
  #fenceSelection: KJWorkbenchFenceSelection | null = null
  #fencePointer: number | null = null
  #hoverGrip: KJEntityGrip | null = null
  #cancelledPointers = new Set<number>()
  #ignoredPointers = new Set<number>()
  #transformGesture: { document: KJDocument; revision: number; ids: readonly string[]; operation: 'MOVE' | 'COPY'; base: Point2 | null } | null = null
  #modificationGesture: KJModificationGesture | null = null
  #pageBinding: { document: KJDocument; revision: number; layoutId: string; settings: KJDxfPlotSettings } | null = null
  #boundarySession: KJBoundaryEditSession | null = null
  #boundaryPointer: KJWorkbenchBoundaryPointer | null = null
  #boundaryPreview: ReturnType<KJBoundaryEditSession['preview']> | null = null
  #gestureEpoch = 0
  #draftGesture: KJWorkbenchDraftGesture | null = null
  #draftOptions = new Map<KJDraftTool, KJDraftingOptions>()
  #message = ''
  #fileName = 'drawing.kjd'
  #maxFileBytes: number
  #fileReadAbort: AbortController | null = null
  #leasedDocument: KJDocument | null = null

  constructor(container: HTMLElement | ShadowRoot, options: KJDrawWorkbenchOptions = {}) {
    assertBrowser()
    if (!(container instanceof HTMLElement) && !(container instanceof ShadowRoot)) throw new TypeError('KJDrawWorkbench requires an HTMLElement or ShadowRoot')
    this.container = container
    this.#locale = options.locale ?? 'en'
    this.#theme = options.theme ?? 'dark'
    this.#layout = normalizeWorkbenchLayout(options.layout)
    this.#options = { ...options, layout: this.#layout }
    this.#maxFileBytes = Number(options.maxFileBytes ?? 64 * 1024 * 1024)
    if (!Number.isSafeInteger(this.#maxFileBytes) || this.#maxFileBytes <= 0) throw new RangeError('maxFileBytes must be a positive safe integer')
    this.sdk = options.sdk ?? createKJDrawSDK()
    this.root = document.createElement('section')
    this.root.className = `kjwb ${this.#theme} layout-${this.#layout}${options.toolbar === false ? ' no-toolbar' : ''}`
    this.root.tabIndex = 0
    this.root.innerHTML = this.#markup()
    const boundaryActions = document.createElement('div')
    boundaryActions.className = 'draft-actions boundary-actions'
    boundaryActions.dataset.boundaryActions = ''
    boundaryActions.hidden = true
    boundaryActions.innerHTML = `<span class="boundary-summary" data-boundary-summary></span><button type="button" data-action="boundary-confirm" data-copy="confirmBoundaries">${this.#t('confirmBoundaries')}</button><button type="button" data-action="boundary-finish" data-copy="finish">${this.#t('finish')}</button><button type="button" data-action="boundary-cancel" data-copy="cancel">${this.#t('cancel')}</button>`
    query<HTMLElement>(this.root, '.canvas-wrap').append(boundaryActions)
    container.append(this.root)
    this.#canvas = query<HTMLCanvasElement>(this.root, 'canvas[data-canvas]')
    this.#overlay = query<HTMLCanvasElement>(this.root, 'canvas[data-overlay]')
    const overlayContext = this.#overlay.getContext('2d')
    if (!overlayContext) throw new Error('Canvas 2D overlay is unavailable')
    this.#overlayContext = overlayContext
    this.renderer = new KJCanvasRenderer(this.#canvas, { theme: this.#theme, grid: options.grid ?? true, padding: 82 })
    if (typeof ResizeObserver !== 'undefined') {
      this.#overlayObserver = new ResizeObserver(() => this.#drawOverlay())
      this.#overlayObserver.observe(this.#canvas)
    }
    this.#bind()
    const initialDocument = options.document === undefined ? 'sample' : options.document
    this.ready = this.#initialize(initialDocument)
  }

  get document(): KJDocument | null { return this.renderer.document }
  get #selection() { return this.document ? this.sdk.getSelectionManager(this.document.id)?.active ?? null : null }
  get locale(): KJWorkbenchLocale { return this.#locale }
  get theme(): KJWorkbenchTheme { return this.#theme }
  get layout(): KJWorkbenchLayout { return this.#layout }
  /** Null means model space; independent of the classic/compact/focus interface layout. */
  get drawingLayoutId(): string | null { return this.#drawingLayoutId }
  get spaceId(): string | null { return this.renderer.spaceId ?? this.document?.spaces.modelSpaceId ?? null }
  get paperPreview(): boolean { return this.#drawingLayoutId !== null }
  get #readOnly(): boolean { return this.#options.readonly === true || this.paperPreview }
  get tool(): KJWorkbenchTool { return this.#tool }

  /** Switch the displayed model/paper space without changing document state or undo history.
   * Existing paper layouts are read-only previews; return to null (Model) to edit.
   */
  setDrawingLayout(layoutId: string | null): this {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    const drawing = this.document
    if (!drawing) throw new Error('No active KJDraw document')
    const layout = layoutId === null ? null : this.#paperLayouts().find(item => item.id === layoutId)
    if (layoutId !== null && !layout) throw new RangeError('Drawing layout must be an existing paper-space layout')
    if (this.#drawingLayoutId === layoutId) return this
    this.#cancelGesture()
    this.#drawingLayoutId = layoutId
    this.renderer.setSpace(layout ? String(layout.payload.blockRecordId) : null)
    this.#selection?.clear()
    this.renderer.setSelection([])
    this.setTool('select')
    this.#refreshDocumentPanels()
    this.renderer.fit(); this.#refreshViewport()
    this.#setMessage(this.#t(this.paperPreview ? 'paperPreview' : 'ready'))
    this.root.dispatchEvent(new CustomEvent('kjdraw:space', { detail: { document: drawing, layoutId, spaceId: this.spaceId, readonly: this.#readOnly }, bubbles: true, composed: true }))
    return this
  }

  #paperLayouts(): KJReadonlyObjectRecord[] {
    const drawing = this.document
    if (!drawing) return []
    const spaces = drawing.spaces, result: KJReadonlyObjectRecord[] = []
    for (const id of spaces.layoutIds) {
      const layout = drawing.getObject(id), ownerId = String(layout?.payload.blockRecordId ?? ''), owner = drawing.getObject(ownerId)
      if (layout?.kind === 'layout' && !layout.erased && owner?.kind === 'block-record' && !owner.erased && owner.payload.isSpace === true && spaces.paperSpaceIds.includes(ownerId)) result.push(layout)
    }
    return result.sort((a, b) => Number(a.payload.tabOrder ?? 0) - Number(b.payload.tabOrder ?? 0))
  }

  #syncDrawingLayouts(): void {
    const layouts = this.#paperLayouts()
    if (this.#drawingLayoutId !== null && !layouts.some(layout => layout.id === this.#drawingLayoutId)) {
      this.#cancelGesture(); this.#drawingLayoutId = null; this.renderer.setSpace(null)
      this.#selection?.clear(); this.renderer.setSelection([]); this.setTool('select'); this.renderer.fit()
    }
    const select = this.root.querySelector<HTMLSelectElement>('[data-drawing-layout]')
    if (select) {
      const rows = [{ id: '', name: this.#t('modelSpace') }, ...layouts.map(layout => ({ id: layout.id, name: String(layout.name ?? layout.id) }))]
      select.replaceChildren(...rows.map(row => { const option = document.createElement('option'); option.value = row.id; option.textContent = row.name; return option }))
      select.value = this.#drawingLayoutId ?? ''; select.setAttribute('aria-label', this.#t('drawingSpace')); select.title = this.#t('drawingSpace')
    }
    this.root.dataset.drawingSpace = this.paperPreview ? 'paper' : 'model'
    const notice = this.root.querySelector<HTMLElement>('[data-paper-preview]')
    if (notice) { notice.hidden = !this.paperPreview; notice.textContent = this.#t('paperPreview') }
  }

  #syncEditability(): void {
    const allowed = this.paperPreview ? ['select', 'fence', 'pan'] : ['select', 'fence', 'pan', 'measure']
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-command-template],[data-action="erase"],[data-action="modify"],[data-action="draft"],[data-action="page-setup"],[data-tool]')) button.disabled = this.#readOnly && !allowed.includes(button.dataset.tool ?? '')
    const command = this.root.querySelector<HTMLInputElement>('[data-command]'), run = this.root.querySelector<HTMLButtonElement>('[data-action="run-command"]')
    if (command) command.disabled = this.paperPreview
    if (run) run.disabled = this.paperPreview
  }

  /** Change presentation without replacing the drawing or its undo history. */
  setOptions(options: Pick<KJDrawWorkbenchOptions, 'readonly' | 'grid' | 'toolbar' | 'showLayers' | 'showInspector' | 'title' | 'maxFileBytes' | 'layout'>): this {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    if (options.maxFileBytes !== undefined) {
      const nextLimit = Number(options.maxFileBytes)
      if (!Number.isSafeInteger(nextLimit) || nextLimit <= 0) throw new RangeError('maxFileBytes must be a positive safe integer')
      this.#maxFileBytes = nextLimit
    }
    this.#options = { ...this.#options, ...options }
    if (options.layout !== undefined) this.setLayout(options.layout)
    if (options.readonly === true) this.#cancelGesture()
    if (options.grid !== undefined) this.renderer.setGrid(options.grid)
    const workspace = query<HTMLElement>(this.root, '.workspace')
    workspace.classList.toggle('no-layers', this.#options.showLayers === false)
    workspace.classList.toggle('no-inspector', this.#options.showInspector === false)
    this.root.classList.toggle('no-toolbar', this.#options.toolbar === false)
    query<HTMLElement>(this.root, '.side.layers').hidden = this.#options.showLayers === false
    query<HTMLElement>(this.root, '.side.right').hidden = this.#options.showInspector === false
    const layersToggle = this.root.querySelector<HTMLButtonElement>('[data-action="toggle-layers"]')
    const inspectorToggle = this.root.querySelector<HTMLButtonElement>('[data-action="toggle-inspector"]')
    const syncPanelToggle = (button: HTMLButtonElement | null, visible: boolean): void => {
      if (!button) return
      button.classList.toggle('active', visible)
      button.setAttribute('aria-pressed', String(visible))
    }
    syncPanelToggle(layersToggle, this.#options.showLayers !== false)
    syncPanelToggle(inspectorToggle, this.#options.showInspector !== false)
    this.#syncEditability()
    if (this.#readOnly && !['select', 'fence', 'pan', 'measure'].includes(this.#tool)) this.setTool('select')
    this.#refreshDocumentPanels()
    this.renderer.resize()
    this.#drawOverlay()
    return this
  }

  setLocale(locale: KJWorkbenchLocale): this {
    if (locale !== 'en' && locale !== 'zh-CN') throw new RangeError(`Unsupported KJDraw workbench locale: ${String(locale)}`)
    this.#locale = locale
    this.#boundarySession?.setLocale(locale === 'zh-CN' ? 'zh' : 'en')
    this.#updateCopy()
    this.#refreshDocumentPanels()
    this.#syncBoundaryActions()
    const modificationPoint = this.#modificationGesture?.definition.pointKeys[this.#modificationGesture.points.length]
    this.#setMessage(this.#draftGesture
      ? this.#draftPrompt(this.#draftGesture.session.state.nextPoint)
      : this.#boundarySession
        ? this.#boundaryPrompt()
      : modificationPoint
        ? this.#localizedControlText(modificationPoint.label)
        : this.#fenceSelection ? this.#t('fenceHint') : this.#tool === 'select' ? this.#t('selectionHint') : this.#t('ready'))
    return this
  }

  snapshot(): Readonly<KJWorkbenchSnapshot> {
    const drawing = this.document
    return Object.freeze({
      locale: this.#locale,
      theme: this.#theme,
      layout: this.#layout,
      drawingLayoutId: this.drawingLayoutId,
      spaceId: this.spaceId,
      paperPreview: this.paperPreview,
      tool: this.#tool,
      documentId: drawing?.id ?? null,
      revision: drawing?.revision ?? 0,
      entityCount: drawing?.listEntities().length ?? 0,
      selectedIds: Object.freeze([...(this.#selection?.ids ?? [])]),
      render: this.renderer.report,
    })
  }

  setTheme(theme: KJWorkbenchTheme): this {
    if (theme !== 'dark' && theme !== 'light') throw new RangeError(`Unsupported KJDraw workbench theme: ${String(theme)}`)
    this.#theme = theme
    this.root.classList.toggle('dark', theme === 'dark')
    this.root.classList.toggle('light', theme === 'light')
    this.renderer.setTheme(theme)
    const toggle = this.root.querySelector<HTMLButtonElement>('[data-action="theme"]')
    const toggleIcon = toggle?.querySelector<HTMLElement>('[data-theme-icon]')
    if (toggleIcon) toggleIcon.innerHTML = kjdrawIcon(theme === 'dark' ? 'sun' : 'moon')
    this.#refreshViewport()
    return this
  }

  setLayout(value: KJWorkbenchLayout): this {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    const layout = normalizeWorkbenchLayout(value)
    if (layout !== this.#layout) {
      if (this.#boundarySession) this.#cancelGesture()
      else this.#cancelPointer()
    }
    this.#layout = layout
    this.#options = { ...this.#options, layout }
    for (const candidate of KJDRAW_LAYOUTS) this.root.classList.toggle(`layout-${candidate}`, candidate === layout)
    const select = this.root.querySelector<HTMLSelectElement>('[data-layout]')
    if (select) select.value = layout
    this.renderer.resize()
    this.#drawOverlay()
    return this
  }

  setTool(tool: KJWorkbenchTool): this {
    const tools: readonly KJWorkbenchTool[] = ['select', 'fence', 'pan', ...DRAFT_TOOLS, 'text', 'measure', 'move', 'copy']
    if (!tools.includes(tool)) throw new RangeError(`Unsupported KJDraw workbench tool: ${String(tool)}`)
    if (this.#readOnly && !(this.paperPreview ? ['select', 'fence', 'pan'] : ['select', 'fence', 'pan', 'measure']).includes(tool)) {
      this.#setMessage(this.#t(this.paperPreview ? 'paperPreview' : 'readonly'))
      return this
    }
    this.#cancelGesture()
    this.#tool = tool
    if (tool === 'fence' && this.document) this.#fenceSelection = { document: this.document, revision: this.document.revision, points: [], operation: 'replace' }
    if (tool === 'move' || tool === 'copy') this.#beginTransformGesture(tool)
    if (DRAFT_TOOLS.includes(tool as KJDraftTool)) this.#beginDraftGesture(tool as KJDraftTool)
    this.#canvas.classList.toggle('crosshair', DRAFT_TOOLS.includes(tool as KJDraftTool) || ['fence', 'text', 'measure', 'move', 'copy'].includes(tool))
    this.#canvas.classList.toggle('pan', tool === 'pan')
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.classList.toggle('active', button.dataset.tool === tool)
    this.#hideSnap()
    this.#drawOverlay()
    this.#setMessage(this.#draftGesture
      ? this.#draftPrompt(this.#draftGesture.session.state.nextPoint)
      : tool === 'fence' ? this.#t('fenceHint') : tool === 'select'
      ? this.#t('selectionHint')
      : tool === 'text'
        ? this.#t('textPrompt')
        : tool === 'move' || tool === 'copy'
          ? this.#selection?.size ? this.#t('basePoint') : this.#t('selectObjects')
          : this.#t('firstPoint'))
    this.#syncDraftActions()
    return this
  }

  async setDocument(document: KJDocument): Promise<this> {
    return this.#setDocument(document, false)
  }

  async #setDocument(document: KJDocument, generated: boolean): Promise<this> {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    const registered = this.sdk.documents.get(document.id)
    if (registered && registered !== document) throw new Error(`A different KJDraw document is already attached with id: ${document.id}`)
    if (this.document !== document) this.#cancelGesture()
    if (!registered) this.sdk.attachDocument(document)
    this.sdk.setActiveDocument(document.id)
    const previousLease = this.#leasedDocument
    const acquire = previousLease !== document
    if (acquire) acquireDocumentLease(this.sdk, this, document, generated)
    try {
      this.#drawingLayoutId = null
      this.renderer.setSpace(null)
      this.renderer.setDocument(document)
      this.#subscribeDocument(document)
      const selection = this.sdk.getSelectionManager(document.id)?.active
      const modelIds = selection?.ids.filter(id => document.getObject(id)?.ownerId === document.spaces.modelSpaceId) ?? []
      if (selection && modelIds.length !== selection.ids.length) selection.replace(modelIds)
      this.renderer.setSelection(modelIds)
      if (DRAFT_TOOLS.includes(this.#tool as KJDraftTool)) this.#beginDraftGesture(this.#tool as KJDraftTool)
      if (this.#tool === 'fence') this.#fenceSelection = { document, revision: document.revision, points: [], operation: 'replace' }
      this.#leasedDocument = document
      if (previousLease && previousLease !== document) releaseDocumentLease(this.sdk, this, previousLease)
      this.#fileName = `${document.id}.kjd`
      this.#refreshDocumentPanels()
      this.renderer.fit()
      this.#refreshViewport()
      this.root.dispatchEvent(new CustomEvent('kjdraw:document', { detail: { document }, bubbles: true, composed: true }))
      return this
    } catch (error) {
      if (acquire) releaseDocumentLease(this.sdk, this, document)
      throw error
    }
  }

  async open(source: unknown, options: KJWorkbenchOpenOptions = {}): Promise<KJDocument> {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    const byteLength = sourceByteLength(source)
    if (byteLength != null && byteLength > this.#maxFileBytes) throw new RangeError(`${this.#t('fileTooLarge')}: ${byteLength.toLocaleString()} > ${this.#maxFileBytes.toLocaleString()} bytes`)
    const format = options.format ?? formatFromName(options.fileName ?? '')
    const result = await this.sdk.fileAdapters.read(source, { ...options, ...(format === undefined ? {} : { format }) })
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    if (!(result instanceof KJDocument) && (!result || typeof result !== 'object' || Array.isArray(result))) throw new Error('File adapter did not return a drawing')
    const drawing = result instanceof KJDocument ? result : KJDocument.open(result as Record<string, unknown>)
    const previous = this.sdk.documents.get(drawing.id)
    if (previous && previous !== drawing) {
      if (previous !== this.document) throw new Error(`Another drawing is already open with id: ${drawing.id}`)
      if (hasOtherDocumentViewer(this.sdk, this, previous)) {
        throw new Error(`Drawing ${drawing.id} is shared by another KJDraw workbench; load it as a separate document before reopening`)
      }
      // Reopening this editor's own file also refreshes the selection manager.
      this.#releaseCurrentDocumentLease()
      this.sdk.closeDocument(drawing.id)
    }
    await this.setDocument(drawing)
    this.#fileName = options.fileName ?? `${drawing.id}.${String(format ?? 'kjd').toLowerCase()}`
    this.#setMessage(`${this.#t('open')} · ${this.#fileName}`)
    return drawing
  }

  async execute<TResult = unknown>(command: string, args: KJCommandArguments = {}, options: { expectedRevision?: number } = {}): Promise<KJSDKCommandEnvelopeReceipt<TResult>> {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    if (this.paperPreview && command.toUpperCase() !== 'SELECT') throw new Error(this.#t('paperPreview'))
    if (this.paperPreview && (!Array.isArray(args.ids) || args.ids.some(id => this.document?.getObject(String(id))?.ownerId !== this.spaceId))) throw new Error('Selection must belong to the displayed paper space')
    if (this.#readOnly && !['SELECT', 'SELECTBYPROPERTY', 'QSELECT', 'SEARCH', 'FIND', 'LENGTH', 'AREA', 'DISTANCE', 'NEAREST', 'INTERSECT', 'ANGLE'].includes(command.toUpperCase())) throw new Error('This editor is read only')
    const drawing = this.document
    if (!drawing) throw new Error('No active KJDraw document')
    if (this.sdk.documents.get(drawing.id) !== drawing) throw new Error('This drawing was closed or replaced by the host; setDocument before editing')
    this.#activateDocument()
    const receipt = await this.sdk.executeCommand<TResult>(this.sdk.createCommandEnvelope(command, args, {
      document: drawing,
      expectedRevision: options.expectedRevision ?? drawing.revision,
      origin: 'ui',
    }))
    this.#setMessage(`${command} · REV ${drawing.revision}`)
    this.#refreshViewport()
    return receipt
  }

  async save(format: 'KJD' | 'DXF' | 'SVG' = 'KJD', options: KJWorkbenchSaveOptions = {}): Promise<unknown> {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    const drawing = this.document
    if (!drawing) throw new Error('No active KJDraw document')
    const output = await this.sdk.writeDocument(drawing, { ...options, format, ...(format === 'SVG' ? { layoutId: options.layoutId ?? this.#drawingLayoutId ?? drawing.spaces.activeLayoutId } : {}), ...(format === 'DXF' && options.version == null ? { version: '2018' } : {}) })
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    if (options.download !== false) {
      const extension = format.toLowerCase()
      const base = (options.fileName ?? this.#fileName).replace(/\.[^.]+$/, '') || drawing.id
      downloadBytes(output, `${base}.${extension}`, format === 'DXF' ? 'application/dxf' : format === 'SVG' ? 'image/svg+xml' : 'application/vnd.kanjie.kjdraw+json')
    }
    this.#setMessage(`${format} · ${drawing.fingerprint()}`)
    return output
  }

  async print(options: KJWorkbenchPrintOptions = {}): Promise<KJDrawingPrintHtml> {
    if (this.#abort.signal.aborted) throw new Error('KJDraw workbench has been disposed')
    const drawing = this.document
    if (!drawing) throw new Error('No active KJDraw document')
    const layout = this.#drawingLayoutId
    const output = await openDrawingPrintWindow(drawing, {
      ...options,
      layoutId: options.layoutId ?? layout ?? drawing.spaces.activeLayoutId,
      locale: this.#locale,
      title: options.title ?? this.#fileName,
      ...(this.root.ownerDocument.defaultView ? { ownerWindow: this.root.ownerDocument.defaultView } : {}),
      isCurrent: () => !this.#abort.signal.aborted && this.document === drawing && this.#drawingLayoutId === layout,
    })
    if (!this.#abort.signal.aborted && this.document === drawing) this.#setMessage(this.#t('printOpened'))
    return output
  }

  dispose(): void {
    if (this.#abort.signal.aborted) return
    this.#fileReadAbort?.abort(); this.#fileReadAbort = null
    this.#cancelGesture()
    this.#abort.abort()
    this.#disposeDocument?.(); this.#disposeDocument = null
    this.#disposeSelection?.(); this.#disposeSelection = null
    this.#overlayObserver?.disconnect(); this.#overlayObserver = null
    this.renderer.dispose()
    this.root.remove()
    this.#releaseCurrentDocumentLease()
  }

  async #initialize(input: KJDocument | 'blank' | 'sample' | null): Promise<this> {
    try {
      const drawing = input && typeof input === 'object'
        ? input
        : input === 'blank' || input === null
          ? this.sdk.createDocument({ documentId: availableDocumentId(this.sdk, 'drawing'), units: 'millimeter' })
          : await starterDocument(this.sdk)
      const generated = input === null || typeof input === 'string'
      if (this.#abort.signal.aborted) {
        if (generated) {
          if (this.sdk.documents.get(drawing.id) === drawing) this.sdk.closeDocument(drawing.id)
        }
        return this
      }
      await this.#setDocument(drawing, generated)
      this.#setMessage(this.#t('selectionHint'))
      return this
    } catch (error) {
      this.#handleError(error)
      throw error
    }
  }

  #markup(): string {
    const t = (key: keyof typeof copy.en) => this.#t(key)
    const icon = (name: string, attributes = '') => `<span class="icon" aria-hidden="true" ${attributes}>${kjdrawIcon(name)}</span>`
    const readonly = this.#readOnly === true
    const showLayers = this.#options.showLayers !== false
    const showInspector = this.#options.showInspector !== false
    const layoutCopy: Record<KJWorkbenchLayout, keyof typeof copy.en> = { classic: 'layoutClassic', compact: 'layoutCompact', focus: 'layoutFocus' }
    return `<style>${KJDRAW_THEME_CSS}\n${WORKBENCH_STYLE}\n.kjwb [hidden]{display:none!important}.kjwb.no-toolbar{grid-template-rows:44px 0 minmax(300px,1fr) 32px}.kjwb.no-toolbar .ribbon{visibility:hidden;overflow:hidden;pointer-events:none}</style>
      <header class="appbar"><span class="mark" aria-hidden="true">${icon('logo')}</span><span class="brand">KJDraw</span><span class="docname" data-document-name>${t('sample')}</span><span class="spacer"></span>
        <input class="file-input" type="file" accept=".dxf,.kjd" aria-label="${t('open')}" data-file>
        <select class="layout-select" data-layout aria-label="${t('layout')}" title="${t('layout')}">${KJDRAW_LAYOUTS.map(layout => `<option value="${layout}" data-copy="${layoutCopy[layout]}"${layout === this.#layout ? ' selected' : ''}>${t(layoutCopy[layout])}</option>`).join('')}</select>
        <button type="button" class="panel-toggle hide-small ${showLayers ? 'active' : ''}" data-action="toggle-layers" aria-pressed="${showLayers}">${icon('layers')}<span data-copy="layers">${t('layers')}</span></button>
        <button type="button" class="panel-toggle hide-small ${showInspector ? 'active' : ''}" data-action="toggle-inspector" aria-pressed="${showInspector}">${icon('panel')}<span data-copy="properties">${t('properties')}</span></button>
        <button type="button" class="file-action" data-action="open" data-copy-title="open" aria-label="${t('open')}" title="${t('open')}">${icon('open')}<span data-copy="open">${t('open')}</span></button><button type="button" class="file-action hide-small" data-action="save-kjd" data-copy-title="saveKjd" aria-label="${t('saveKjd')}" title="${t('saveKjd')}">${icon('save')}<span data-copy="saveKjd">${t('saveKjd')}</span></button><button type="button" class="file-action primary" data-action="save-dxf" data-copy-title="exportDxf" aria-label="${t('exportDxf')}" title="${t('exportDxf')}">${icon('export')}<span data-copy="exportDxf">${t('exportDxf')}</span></button><button type="button" data-action="theme" data-copy-title="theme" title="${t('theme')}">${icon(this.#theme === 'dark' ? 'sun' : 'moon', 'data-theme-icon')}</button><button type="button" data-action="language"><span data-copy="language">${t('language')}</span></button>
        <button type="button" class="file-action" data-action="save-svg" data-copy-title="exportSvg" title="${t('exportSvg')}" aria-label="${t('exportSvg')}">${icon('export')}<span data-copy="exportSvg">${t('exportSvg')}</span></button>
        <button type="button" class="file-action" data-action="print" data-copy-title="print" title="${t('print')}" aria-label="${t('print')}">${icon('export')}<span data-copy="print">${t('print')}</span></button>
        <button type="button" class="file-action" data-action="page-setup" data-copy-title="pageSetup" title="${t('pageSetup')}" aria-label="${t('pageSetup')}" ${readonly ? 'disabled' : ''}>${icon('panel')}<span data-copy="pageSetup">${t('pageSetup')}</span></button>
      </header>
      <nav class="ribbon" aria-label="CAD tools">
        <div class="group"><button type="button" class="tool active" data-tool="select">${icon('select')}<small data-copy="select">${t('select')}</small></button><button type="button" class="tool" data-tool="pan">${icon('pan')}<small data-copy="pan">${t('pan')}</small></button><span data-copy="view">${t('view')}</span></div>
        <div class="group"><button type="button" class="tool" data-tool="point" ${readonly ? 'disabled' : ''}>${icon('point')}<small data-draft-label="point">${this.#localizedControlText(draftToolText.point)}</small></button><button type="button" class="tool" data-tool="line" ${readonly ? 'disabled' : ''}>${icon('line')}<small data-copy="line">${t('line')}</small></button><button type="button" class="tool" data-tool="polyline" ${readonly ? 'disabled' : ''}>${icon('polyline')}<small data-copy="polyline">${t('polyline')}</small></button><button type="button" class="tool" data-tool="circle" ${readonly ? 'disabled' : ''}>${icon('circle')}<small data-copy="circle">${t('circle')}</small></button><button type="button" class="tool" data-tool="arc" ${readonly ? 'disabled' : ''}>${icon('arc')}<small data-copy="arc">${t('arc')}</small></button><button type="button" class="tool" data-tool="ellipse" ${readonly ? 'disabled' : ''}>${icon('ellipse')}<small data-draft-label="ellipse">${this.#localizedControlText(draftToolText.ellipse)}</small></button><button type="button" class="tool" data-tool="rectangle" ${readonly ? 'disabled' : ''}>${icon('rectangle')}<small data-copy="rectangle">${t('rectangle')}</small></button><button type="button" class="tool" data-tool="polygon" ${readonly ? 'disabled' : ''}>${icon('rectangle')}<small data-draft-label="polygon">${this.#localizedControlText(draftToolText.polygon)}</small></button><button type="button" class="tool" data-tool="dimension" ${readonly ? 'disabled' : ''}>${icon('measure')}<small data-draft-label="dimension">${this.#localizedControlText(draftToolText.dimension)}</small></button><button type="button" class="tool" data-tool="text" ${readonly ? 'disabled' : ''}>${icon('text')}<small data-copy="text">${t('text')}</small></button><button type="button" class="tool" data-action="draft" ${readonly ? 'disabled' : ''}>${icon('plus')}<small data-copy="moreDraw">${t('moreDraw')}</small></button><span data-copy="draw">${t('draw')}</span></div>
        <div class="group"><button type="button" class="tool" data-tool="move" ${readonly ? 'disabled' : ''}>${icon('move')}<small data-copy="move">${t('move')}</small></button><button type="button" class="tool" data-tool="copy" ${readonly ? 'disabled' : ''}>${icon('copy')}<small data-copy="copy">${t('copy')}</small></button><button type="button" class="tool" data-action="modify" ${readonly ? 'disabled' : ''}>${icon('rotate')}<small data-copy="modifyTools">${t('modifyTools')}</small></button><button type="button" class="tool" data-action="undo" ${readonly ? 'disabled' : ''}>${icon('undo')}<small data-copy="undo">${t('undo')}</small></button><button type="button" class="tool" data-action="redo" ${readonly ? 'disabled' : ''}>${icon('redo')}<small data-copy="redo">${t('redo')}</small></button><button type="button" class="tool" data-action="erase" ${readonly ? 'disabled' : ''}>${icon('delete')}<small data-copy="erase">${t('erase')}</small></button><span data-copy="modify">${t('modify')}</span></div>
        <div class="group"><button type="button" class="tool" data-action="fit">${icon('fit')}<small data-copy="fit">${t('fit')}</small></button><button type="button" class="tool" data-action="grid">${icon('grid')}<small data-copy="grid">${t('grid')}</small></button><button type="button" class="tool" data-tool="measure">${icon('measure')}<small data-copy="measure">${t('measure')}</small></button><span data-copy="view">${t('view')}</span></div>
      </nav>
      <div class="workspace ${this.#options.showLayers === false ? 'no-layers' : ''} ${this.#options.showInspector === false ? 'no-inspector' : ''}">
        <aside class="side layers" ${this.#options.showLayers === false ? 'hidden' : ''}><h2 data-copy="layers">${t('layers')}</h2><div data-layers></div></aside>
        <main class="canvas-wrap"><div class="drawing-space"><select data-drawing-layout></select><span data-paper-preview role="status" hidden></span></div><canvas class="cad-canvas" data-canvas aria-label="KJDraw CAD canvas"></canvas><canvas class="overlay" data-overlay aria-hidden="true"></canvas><span class="snap" data-snap></span><nav class="navigator" aria-label="${t('view')}"><button type="button" class="active" data-tool="select" data-copy-title="select" title="${t('select')}">${icon('select')}</button><button type="button" data-tool="pan" data-copy-title="pan" title="${t('pan')}">${icon('pan')}</button><button type="button" data-action="nav-fit" data-copy-title="fit" title="${t('fit')}">${icon('fit')}</button><button type="button" data-action="zoom-in" data-copy-title="zoomIn" title="${t('zoomIn')}">${icon('zoom-in')}</button><button type="button" data-action="zoom-out" data-copy-title="zoomOut" title="${t('zoomOut')}">${icon('zoom-out')}</button></nav><div class="draft-actions" data-draft-actions hidden><button type="button" data-action="draft-undo" data-copy="undoPoint">${t('undoPoint')}</button><button type="button" data-action="draft-finish" data-copy="finish">${t('finish')}</button><button type="button" data-action="draft-close" data-copy="closeShape">${t('closeShape')}</button></div><div class="command"><span data-copy="command">${t('command')}</span><input data-command aria-label="${t('command')}" placeholder="${t('commandHint')}" autocomplete="off"><button type="button" data-action="run-command" data-copy="run">${t('run')}</button></div><div class="hint" data-hint>${t('ready')}</div></main>
        <aside class="side right" ${this.#options.showInspector === false ? 'hidden' : ''}><h2 data-copy="properties">${t('properties')}</h2><div class="inspector" data-inspector><p class="empty">${t('noSelection')}</p></div></aside>
      </div>
      <footer class="statusbar"><span class="message" data-message>${readonly ? t('readonly') : t('ready')}</span><span data-coordinate>X 0.000 · Y 0.000</span><span data-selection>0 ${t('selected')}</span><b data-count>0 ${t('entities')}</b><span data-revision>REV 0</span><button type="button" class="draft-toggle" data-action="ortho" aria-pressed="false"><span data-copy="ortho">${t('ortho')}</span></button><span data-zoom>100%</span></footer>
      <dialog class="modify-dialog" data-modification-dialog aria-label="${t('modifyTitle')}">
        <div class="modify-form" data-modification-form>
          <header class="modify-head"><h2 data-copy="modifyTitle">${t('modifyTitle')}</h2><p data-copy="modifyDescription">${t('modifyDescription')}</p></header>
          <div class="modify-body"><label class="field"><span data-copy="modifyTools">${t('modifyTools')}</span><select data-modification>${KJ_MODIFICATION_DEFINITIONS.map(definition => `<option value="${definition.id}">${this.#localizedControlText(definition.label)}</option>`).join('')}</select></label><p class="modify-description" data-modification-description></p><div class="modify-fields" data-modification-fields></div><p class="modify-order" data-copy="selectionOrder">${t('selectionOrder')}</p></div>
          <footer class="modify-actions"><button type="button" data-action="cancel-modification" data-copy="cancel">${t('cancel')}</button><button type="button" class="confirm" data-action="start-modification" data-copy="continueOnCanvas">${t('continueOnCanvas')}</button></footer>
        </div>
      </dialog>
      <dialog class="modify-dialog" data-draft-dialog aria-label="${t('drawTitle')}">
        <div class="modify-form" data-draft-form>
          <header class="modify-head"><h2 data-copy="drawTitle">${t('drawTitle')}</h2><p data-copy="drawDescription">${t('drawDescription')}</p></header>
          <div class="modify-body"><label class="field"><span data-copy="drawingTool">${t('drawingTool')}</span><select data-draft-tool>${DRAFT_TOOLS.map(tool => `<option value="${tool}">${this.#localizedControlText(draftToolText[tool])}</option>`).join('')}</select></label><div class="modify-fields draft-options" data-draft-options></div></div>
          <footer class="modify-actions"><button type="button" data-action="cancel-draft" data-copy="cancel">${t('cancel')}</button><button type="button" class="confirm" data-action="start-draft" data-copy="startDrawing">${t('startDrawing')}</button></footer>
        </div>
      </dialog>
      <dialog class="modify-dialog" data-page-dialog aria-label="${t('pageSetup')}">
        <div class="modify-form" data-page-form>
          <header class="modify-head"><h2 data-copy="pageSetup">${t('pageSetup')}</h2><p data-copy="pageDescription">${t('pageDescription')}</p></header>
          <div class="modify-body"><label class="field"><span data-copy="pageSheet">${t('pageSheet')}</span><select data-page-sheet></select></label><div class="modify-fields" data-page-fields></div><p class="modify-order" data-copy="pageScaleNote">${t('pageScaleNote')}</p><p role="alert" data-page-error></p></div>
          <footer class="modify-actions"><button type="button" data-action="cancel-page" data-copy="cancel">${t('cancel')}</button><button type="button" data-action="apply-page" class="confirm" data-copy="apply">${t('apply')}</button></footer>
        </div>
      </dialog>`
  }

  #bind(): void {
    const signal = this.#abort.signal
    query<HTMLSelectElement>(this.root, '[data-drawing-layout]').addEventListener('change', event => {
      void this.#run(() => this.setDrawingLayout((event.currentTarget as HTMLSelectElement).value || null))
    }, { signal })
    const pageDialog = query<HTMLDialogElement>(this.root, '[data-page-dialog]')
    query<HTMLButtonElement>(this.root, '[data-action="page-setup"]').addEventListener('click', () => this.#openPageSetup(), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="cancel-page"]').addEventListener('click', () => pageDialog.close(), { signal })
    pageDialog.addEventListener('close', () => { this.#pageBinding = null }, { signal })
    query<HTMLSelectElement>(this.root, '[data-page-sheet]').addEventListener('change', () => this.#loadPageSheet(), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="apply-page"]').addEventListener('click', () => void this.#applyPageSetup(), { signal })
    pageDialog.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); if (!event.repeat && !event.isComposing) void this.#applyPageSetup() }
    }, { signal })
    this.root.addEventListener('focusin', () => this.#activateDocument(), { signal })
    this.root.addEventListener('pointerdown', () => this.#activateDocument(), { signal })
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.addEventListener('click', () => this.setTool(button.dataset.tool as KJWorkbenchTool), { signal })
    query<HTMLSelectElement>(this.root, '[data-layout]').addEventListener('change', event => this.setLayout((event.currentTarget as HTMLSelectElement).value as KJWorkbenchLayout), { signal })
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-command-template]')) button.addEventListener('click', () => {
      const input = query<HTMLInputElement>(this.root, '[data-command]')
      input.value = button.dataset.commandTemplate ?? ''
      input.focus(); input.select()
    }, { signal })
    query<HTMLButtonElement>(this.root, '[data-action="open"]').addEventListener('click', () => query<HTMLInputElement>(this.root, '[data-file]').click(), { signal })
    query<HTMLInputElement>(this.root, '[data-file]').addEventListener('change', event => {
      const input = event.currentTarget as HTMLInputElement
      const file = input.files?.[0]
      if (!file) return
      void this.#run(async () => {
        const controller = new AbortController()
        this.#fileReadAbort?.abort(); this.#fileReadAbort = controller
        const dispose = () => controller.abort()
        this.#abort.signal.addEventListener('abort', dispose, { once: true })
        try {
          if (file.size > this.#maxFileBytes) throw new RangeError(`${this.#t('fileTooLarge')}: ${file.size.toLocaleString()} > ${this.#maxFileBytes.toLocaleString()} bytes`)
          await this.open(file, { fileName: file.name, signal: controller.signal, onProgress: progress => this.#showFileProgress(progress) })
        } catch (error) {
          if (controller.signal.aborted) { this.#setMessage(this.#t('openCancelled')); return }
          throw error
        } finally {
          this.#abort.signal.removeEventListener('abort', dispose)
          if (this.#fileReadAbort === controller) this.#fileReadAbort = null
          input.value = ''
        }
      })
    }, { signal })
    query<HTMLButtonElement>(this.root, '[data-action="save-kjd"]').addEventListener('click', () => void this.#run(() => this.save('KJD')), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="save-dxf"]').addEventListener('click', () => void this.#run(() => this.save('DXF')), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="save-svg"]').addEventListener('click', () => void this.#run(() => this.save('SVG')), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="print"]').addEventListener('click', () => void this.#run(() => this.print()), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="undo"]').addEventListener('click', () => void this.#run(() => this.execute('UNDO')), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="redo"]').addEventListener('click', () => void this.#run(() => this.execute('REDO')), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="erase"]').addEventListener('click', () => void this.#eraseSelection(), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="modify"]').addEventListener('click', () => this.#openModificationDialog(), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="boundary-confirm"]').addEventListener('click', () => void this.#run(() => this.#confirmBoundaryEdit()), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="boundary-finish"]').addEventListener('click', () => this.#finishBoundaryEdit(), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="boundary-cancel"]').addEventListener('click', () => this.setTool('select'), { signal })
    const modificationDialog = query<HTMLDialogElement>(this.root, '[data-modification-dialog]')
    query<HTMLSelectElement>(this.root, '[data-modification]').addEventListener('change', () => this.#renderModificationForm(), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="cancel-modification"]').addEventListener('click', () => modificationDialog.close(), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="start-modification"]').addEventListener('click', () => void this.#run(() => this.#startModification()), { signal })
    modificationDialog.addEventListener('cancel', () => { this.#modificationGesture = null; this.#drawOverlay() }, { signal })
    query<HTMLButtonElement>(this.root, '[data-action="draft"]').addEventListener('click', () => this.#openDraftDialog(), { signal })
    const draftDialog = query<HTMLDialogElement>(this.root, '[data-draft-dialog]')
    query<HTMLSelectElement>(this.root, '[data-draft-tool]').addEventListener('change', () => this.#renderDraftForm(), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="cancel-draft"]').addEventListener('click', () => draftDialog.close(), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="start-draft"]').addEventListener('click', () => void this.#run(() => this.#startDraftFromDialog()), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="draft-undo"]').addEventListener('click', () => this.#undoDraftPoint(), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="draft-finish"]').addEventListener('click', () => void this.#finishDraft(false), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="draft-close"]').addEventListener('click', () => void this.#finishDraft(true), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="toggle-layers"]').addEventListener('click', () => this.setOptions({ showLayers: this.#options.showLayers === false }), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="toggle-inspector"]').addEventListener('click', () => this.setOptions({ showInspector: this.#options.showInspector === false }), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="fit"]').addEventListener('click', () => { this.renderer.fit(); this.#refreshViewport() }, { signal })
    query<HTMLButtonElement>(this.root, '[data-action="nav-fit"]').addEventListener('click', () => { this.renderer.fit(); this.#refreshViewport() }, { signal })
    query<HTMLButtonElement>(this.root, '[data-action="zoom-in"]').addEventListener('click', () => { this.renderer.zoomAt(1.25, [this.#canvas.clientWidth / 2, this.#canvas.clientHeight / 2]); this.#refreshViewport() }, { signal })
    query<HTMLButtonElement>(this.root, '[data-action="zoom-out"]').addEventListener('click', () => { this.renderer.zoomAt(0.8, [this.#canvas.clientWidth / 2, this.#canvas.clientHeight / 2]); this.#refreshViewport() }, { signal })
    query<HTMLButtonElement>(this.root, '[data-action="grid"]').addEventListener('click', () => { this.renderer.setGrid(!this.renderer.grid); this.#refreshViewport() }, { signal })
    query<HTMLButtonElement>(this.root, '[data-action="ortho"]').addEventListener('click', () => void this.#toggleOrtho(), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="theme"]').addEventListener('click', () => this.setTheme(this.#theme === 'dark' ? 'light' : 'dark'), { signal })
    query<HTMLButtonElement>(this.root, '[data-action="language"]').addEventListener('click', () => this.setLocale(this.#locale === 'en' ? 'zh-CN' : 'en'), { signal })
    const commandInput = query<HTMLInputElement>(this.root, '[data-command]')
    query<HTMLButtonElement>(this.root, '[data-action="run-command"]').addEventListener('click', () => void this.#runCommand(), { signal })
    commandInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void this.#runCommand() } }, { signal })
    this.#canvas.addEventListener('wheel', event => {
      event.preventDefault()
      if (this.#selectionDrag || this.#boxSelection || this.#gripGesture || event.buttons !== 0) return
      this.renderer.zoomAt(Math.exp(-event.deltaY * 0.0015), point(event, this.#canvas)); this.#refreshViewport()
    }, { signal, passive: false })
    this.#canvas.addEventListener('pointerdown', event => this.#pointerDown(event), { signal })
    this.#canvas.addEventListener('pointermove', event => this.#pointerMove(event), { signal })
    this.#canvas.addEventListener('pointerup', event => void this.#pointerUp(event), { signal })
    this.#canvas.addEventListener('pointercancel', event => {
      if (this.#ignoredPointers.delete(event.pointerId) || this.#isForeignPointer(event)) return
      this.#cancelledPointers.add(event.pointerId)
      if (this.#fenceSelection) this.setTool('select')
      else this.#cancelPointer()
      this.#hideSnap(); this.#drawOverlay()
    }, { signal })
    this.#canvas.addEventListener('lostpointercapture', event => {
      if ([this.#boundaryPointer?.pointerId, this.#selectionDrag?.pointerId, this.#boxSelection?.pointerId, this.#gripGesture?.pointerId, this.#fencePointer, this.#activePointer].includes(event.pointerId)) {
        this.#cancelPointer(); this.#hideSnap(); this.#drawOverlay()
      }
    }, { signal })
    this.#canvas.addEventListener('pointerleave', event => {
      if (this.#ignoredPointers.has(event.pointerId) || this.#isForeignPointer(event)) return
      if (this.#gripGesture || this.#boxSelection || this.#selectionDrag) return
      this.#cursorWorld = null; this.#hoverGrip = null; this.#clearBoundaryPreview(); this.#hideSnap(); this.#drawOverlay()
    }, { signal })
    this.#canvas.addEventListener('dblclick', event => {
      if (this.#draftGesture?.session.state.canFinish) { event.preventDefault(); void this.#finishDraft(false) }
    }, { signal })
    this.root.addEventListener('keydown', event => {
      if (event.key === 'F8') { event.preventDefault(); void this.#toggleOrtho(); return }
      if (event.key === 'Escape' && this.#fileReadAbort) { event.preventDefault(); this.#fileReadAbort.abort(); return }
      if (event.key === 'Escape') { this.setTool('select'); return }
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return
      if (this.#boundarySession && event.key === 'Enter') {
        event.preventDefault()
        if (this.#boundarySession.state.phase === 'boundaries') void this.#run(() => this.#confirmBoundaryEdit())
        else if (this.#boundarySession.state.phase === 'targets') this.#finishBoundaryEdit()
        return
      }
      if (this.#boundarySession && ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' || event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault()
        return
      }
      if (this.#fenceSelection && event.key === 'Enter') { event.preventDefault(); void this.#finishFence(); return }
      if (this.#fenceSelection && event.key === 'Backspace') { event.preventDefault(); this.#fenceSelection.points.pop(); this.#drawOverlay(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        this.setTool('select')
        void this.#run(() => this.execute('SELECT', { ids: [...this.renderer.selectAll()], operation: 'replace' }))
        return
      }
      if (event.key === 'Enter' && this.#draftGesture?.session.state.canFinish) { event.preventDefault(); void this.#finishDraft(false); return }
      if (event.key.toLowerCase() === 'c' && this.#draftGesture?.session.state.canClose && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); void this.#finishDraft(true); return }
      if (event.key === 'Backspace' && this.#draftGesture?.session.points.length) { event.preventDefault(); this.#undoDraftPoint(); return }
      if (!this.#readOnly && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); void this.#eraseSelection() }
      if (!this.#readOnly && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); void this.#run(() => this.execute(event.shiftKey ? 'REDO' : 'UNDO')) }
      if (!this.#readOnly && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); void this.#run(() => this.execute('REDO')) }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key.toLowerCase() === 'f') { this.renderer.fit(); this.#refreshViewport() }
    }, { signal })
  }

  #subscribeDocument(drawing: KJDocument): void {
    this.#disposeDocument?.(); this.#disposeSelection?.()
    this.#disposeDocument = drawing.on('document:change', () => {
      const boundary = this.#boundarySession
      if (boundary && boundary.state.phase !== 'applying' && !boundary.isCurrent()) {
        this.setTool('select'); this.#setMessage(this.#t('gestureCancelled'))
      }
      const gesture = this.#gripGesture ?? this.#boxSelection ?? this.#selectionDrag
      if (gesture && !this.#pointerBindingIsCurrent(gesture)) {
        this.#cancelPointer()
        this.#setMessage(this.#t('gestureCancelled'))
      }
      if (this.#fenceSelection && this.#fenceSelection.revision !== drawing.revision) {
        this.setTool('select'); this.#setMessage(this.#t('gestureCancelled'))
      }
      this.#refreshDocumentPanels()
      const change = { document: drawing, revision: drawing.revision, entityCount: drawing.listEntities().length }
      this.#options.onChange?.(change)
      this.root.dispatchEvent(new CustomEvent('kjdraw:change', { detail: change, bubbles: true, composed: true }))
    })
    const selection = this.sdk.getSelectionManager(drawing.id)?.active
    this.#disposeSelection = selection?.onChange(() => {
      if (this.#boxSelection) this.#cancelPointer()
      this.#hoverGrip = null
      this.renderer.setSelection(selection.ids)
      this.#refreshSelectionPanels()
      this.#refreshDraftPreview()
      this.#refreshGripPreview()
      this.#drawOverlay()
      this.root.dispatchEvent(new CustomEvent('kjdraw:selection', { detail: { document: drawing, ids: selection.ids }, bubbles: true, composed: true }))
    }) ?? null
  }

  #activateDocument(): void {
    const drawing = this.document
    if (!drawing || this.sdk.documents.get(drawing.id) !== drawing || this.sdk.activeDocumentId === drawing.id) return
    this.sdk.setActiveDocument(drawing.id)
  }

  #releaseCurrentDocumentLease(): void {
    const drawing = this.#leasedDocument
    if (!drawing) return
    this.#leasedDocument = null
    releaseDocumentLease(this.sdk, this, drawing)
  }

  async #runCommand(): Promise<void> {
    if (this.paperPreview) { this.#setMessage(this.#t('paperPreview')); return }
    const input = query<HTMLInputElement>(this.root, '[data-command]')
    const raw = input.value.trim()
    if (!raw) {
      if (this.#boundarySession) {
        if (this.#boundarySession.state.phase === 'boundaries') await this.#run(() => this.#confirmBoundaryEdit())
        else if (this.#boundarySession.state.phase === 'targets') this.#finishBoundaryEdit()
        return
      }
      if (this.#fenceSelection) { await this.#finishFence(); return }
      if (this.#draftGesture?.session.state.canFinish) await this.#finishDraft(false)
      return
    }
    if (this.#draftGesture?.session.state.canClose && ['C', 'CLOSE'].includes(raw.toUpperCase())) {
      await this.#finishDraft(true)
      input.value = ''
      return
    }
    if (this.#modificationGesture && (/^@?[^,]+,[^,]+$/.test(raw) || /^@[^<]+<[^<]+$/.test(raw))) {
      const result = await this.#run(() => this.#addModificationCoordinate(raw))
      if (result !== null) input.value = ''
      return
    }
    if (this.#draftGesture && (/^@?[^,]+,[^,]+$/.test(raw) || /^@[^<]+<[^<]+$/.test(raw))) {
      const result = await this.#run(() => this.#addDraftCoordinate(raw))
      if (result !== null) input.value = ''
      return
    }
    const separator = raw.search(/\s/)
    const command = (separator < 0 ? raw : raw.slice(0, separator)).toUpperCase()
    const remainder = separator < 0 ? '' : raw.slice(separator).trim()
    const tokens = remainder ? remainder.split(/\s+/) : []
    const values = tokens.map(Number)
    const finiteValues = (count: number): number[] => {
      if (values.length !== count || values.some(value => !Number.isFinite(value))) throw new Error(`${command} expects ${count} numeric values`)
      return values
    }
    const selectedIds = (): string[] => {
      const ids = [...(this.#selection?.ids ?? [])]
      if (!ids.length) throw new Error(`${command} requires a selection`)
      return ids
    }
    const result = await this.#run(async () => {
      if (command === 'FIT' || command === 'EXTENTS') {
        this.renderer.fit(); this.#refreshViewport(); return
      }
      if (remainder.startsWith('{')) {
        if (this.#readOnly && !['SELECT', 'SELECTBYPROPERTY', 'QSELECT'].includes(command)) throw new Error(this.#t('readonly'))
        const parsed = JSON.parse(remainder) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Command JSON arguments must be an object')
        await this.execute(command, parsed as KJCommandArguments)
        return
      }
      if (this.#readOnly && !['PAN', 'SELECT', 'SELECTBYPROPERTY', 'QSELECT', 'FENCE', 'MEASURE'].includes(command)) throw new Error(this.#t('readonly'))
      if ((command === 'TRIM' || command === 'EXTEND') && !tokens.length) {
        this.#beginBoundaryEdit(command === 'TRIM' ? 'trim' : 'extend')
        return
      }
      if (command === 'PAN' || command === 'SELECT' || command === 'FENCE' || command === 'MEASURE') {
        this.setTool(command.toLowerCase() as KJWorkbenchTool)
        return
      }
      if (command === 'PL' || command === 'PLINE' || command === 'POLYLINE') {
        if (!tokens.length) { this.setTool('polyline'); return }
        if (values.length < 4 || values.length % 2 !== 0 || values.some(value => !Number.isFinite(value))) throw new Error('POLYLINE expects at least two x y pairs')
        const vertices = Array.from({ length: values.length / 2 }, (_, index) => ({ point: [values[index * 2]!, values[index * 2 + 1]!, 0] }))
        await this.execute('CREATE', { type: 'LWPOLYLINE', payload: { vertices, closed: false, ...this.#activeLayerPayload() } })
        return
      }
      const draftCommand = DRAFT_COMMAND_TO_TOOL.get(command)
      if (draftCommand) {
        if (draftCommand === 'polygon' && tokens.length) {
          const [sides] = finiteValues(1)
          if (!Number.isInteger(sides) || sides! < 3 || sides! > 1024) throw new RangeError('POLYGON sides must be an integer from 3 to 1024')
          this.#draftOptions.set('polygon', { sides: sides! })
        } else if (tokens.length) throw new Error(`${command} uses the drawing options panel or canvas coordinates`)
        this.setTool(draftCommand)
        return
      }
      if (command === 'L' || command === 'LINE') {
        if (!tokens.length) { this.setTool('line'); return }
        const [x1, y1, x2, y2] = finiteValues(4)
        await this.execute('CREATE', { type: 'LINE', payload: { start: [x1, y1, 0], end: [x2, y2, 0], ...this.#activeLayerPayload() } })
        return
      }
      if (command === 'CIRCLE2P' || command === 'CIRCLE3P') {
        if (tokens.length) throw new Error(`${command} accepts canvas or command-line coordinates after activation`)
        this.#draftOptions.set('circle', { circleMode: command === 'CIRCLE2P' ? '2-point' : '3-point' })
        this.setTool('circle')
        return
      }
      if (command === 'ARC3P') {
        if (tokens.length) throw new Error('ARC3P accepts canvas or command-line coordinates after activation')
        this.#draftOptions.set('arc', { arcMode: '3-point' })
        this.setTool('arc')
        return
      }
      if (command === 'ELLIPSEARC') {
        if (tokens.length) throw new Error('ELLIPSEARC accepts canvas or command-line coordinates after activation')
        this.#draftOptions.set('ellipse', { ellipseMode: 'arc' })
        this.setTool('ellipse')
        return
      }
      const dimensionPreset = DIMENSION_COMMAND_TO_TYPE.get(command)
      if (dimensionPreset) {
        if (tokens.length) throw new Error(`${command} accepts canvas or command-line coordinates after activation`)
        this.#draftOptions.set('dimension', { dimensionType: dimensionPreset })
        this.setTool('dimension')
        return
      }
      if (command === 'C' || command === 'CIRCLE') {
        if (!tokens.length) { this.setTool('circle'); return }
        const [x, y, radius] = finiteValues(3)
        if (radius! <= 0) throw new Error('CIRCLE radius must be positive')
        await this.execute('CREATE', { type: 'CIRCLE', payload: { center: [x, y, 0], radius, ...this.#activeLayerPayload() } })
        return
      }
      if (command === 'REC' || command === 'RECTANG' || command === 'RECTANGLE') {
        if (!tokens.length) { this.setTool('rectangle'); return }
        const [x1, y1, x2, y2] = finiteValues(4)
        const vertices = [[x1, y1, 0], [x2, y1, 0], [x2, y2, 0], [x1, y2, 0]].map(value => ({ point: value }))
        await this.execute('CREATE', { type: 'LWPOLYLINE', payload: { vertices, closed: true, ...this.#activeLayerPayload() } })
        return
      }
      if (command === 'A' || command === 'ARC') {
        if (!tokens.length) { this.setTool('arc'); return }
        const [cx, cy, sx, sy, ex, ey] = finiteValues(6)
        const radius = Math.hypot(sx! - cx!, sy! - cy!)
        if (radius <= 1e-12) throw new Error('ARC start point must differ from its center')
        await this.execute('CREATE', { type: 'ARC', payload: { center: [cx, cy, 0], radius, startAngle: Math.atan2(sy! - cy!, sx! - cx!), endAngle: Math.atan2(ey! - cy!, ex! - cx!), clockwise: false, ...this.#activeLayerPayload() } })
        return
      }
      if (command === 'T' || command === 'TEXT') {
        const x = Number(tokens[0]), y = Number(tokens[1])
        if (tokens.length >= 3 && Number.isFinite(x) && Number.isFinite(y)) {
          const text = tokens.slice(2).join(' ')
          await this.execute('CREATE', { type: 'TEXT', payload: { position: [x, y, 0], text, height: Math.max(1, 16 / this.renderer.camera.scale), rotation: 0, ...this.#activeLayerPayload() } })
        } else {
          this.#pendingText = remainder || 'KJDraw'
          this.setTool('text')
        }
        return
      }
      if (command === 'E' || command === 'ERASE' || command === 'DELETE') {
        await this.#eraseSelection(); return
      }
      if (command === 'M' || command === 'MOVE' || command === 'CO' || command === 'CP' || command === 'COPY') {
        if (!tokens.length) {
          this.setTool(command === 'M' || command === 'MOVE' ? 'move' : 'copy')
          return
        }
        const [dx, dy] = finiteValues(2)
        await this.execute(command === 'M' || command === 'MOVE' ? 'MOVE' : 'COPY', { ids: selectedIds(), dx, dy })
        return
      }
      if (command === 'RO' || command === 'ROTATE') {
        const [angleDegrees] = finiteValues(1)
        const ids = selectedIds()
        await this.execute('ROTATE', { ids, angleDegrees, center: this.#selectionCenter(ids) })
        return
      }
      if (command === 'SC' || command === 'SCALE') {
        const [factor] = finiteValues(1)
        const ids = selectedIds()
        await this.execute('SCALE', { ids, factor, center: this.#selectionCenter(ids) })
        return
      }
      if (command === 'O' || command === 'OFFSET') {
        const [distance] = finiteValues(1)
        const ids = selectedIds()
        if (ids.length !== 1) throw new Error('OFFSET requires exactly one selected entity')
        await this.execute('OFFSET', { id: ids[0]!, distance })
        return
      }
      if (!remainder) { await this.execute(command); return }
      throw new Error(`${command} arguments must use JSON, for example: ${command} {"id":"..."}`)
    })
    if (result !== null) input.value = ''
  }

  #draftPrompt(role: KJDraftPointRole | null): string {
    return role ? this.#localizedControlText(draftPointText[role]) : this.#t('ready')
  }

  #beginDraftGesture(tool: KJDraftTool): void {
    const drawing = this.document
    if (!drawing) { this.#draftGesture = null; return }
    const configured = this.#draftOptions.get(tool) ?? {}
    const session = createDraftingSession(tool, {
      ...configured,
      payload: { ...this.#activeLayerPayload(), ...(configured.payload ?? {}) },
    })
    this.#draftGesture = { document: drawing, revision: drawing.revision, session }
    this.#syncDraftActions()
  }

  #syncDraftActions(): void {
    const host = this.root.querySelector<HTMLElement>('[data-draft-actions]')
    if (!host) return
    const state = this.#draftGesture?.session.state
    host.hidden = !state || state.maximumPoints !== null
    const undo = host.querySelector<HTMLButtonElement>('[data-action="draft-undo"]')
    const finish = host.querySelector<HTMLButtonElement>('[data-action="draft-finish"]')
    const close = host.querySelector<HTMLButtonElement>('[data-action="draft-close"]')
    if (undo) undo.disabled = !(state?.points.length)
    if (finish) finish.disabled = !(state?.canFinish)
    if (close) close.disabled = !(state?.canClose)
    const command = this.root.querySelector<HTMLInputElement>('[data-command]')
    if (command) command.placeholder = state ? this.#t('coordinateHint') : this.#t('commandHint')
  }

  #refreshDraftPreview(): void {
    const gesture = this.#draftGesture
    if (!gesture || gesture.document !== this.document) return
    this.renderer.render()
    const preview = gesture.session.preview(this.#cursorWorld ?? undefined)
    if (preview) this.renderer.drawPreview([preview], this.#theme === 'dark' ? '#8fc4ff' : '#2863df')
  }

  async #commitDraft(gesture: KJWorkbenchDraftGesture, spec: KJDraftEntitySpec): Promise<void> {
    if (this.document !== gesture.document) { this.#cancelGesture(); return }
    const points = gesture.session.points
    const variableLength = gesture.session.state.maximumPoints === null
    const receipt = await this.#run(() => this.execute('CREATE', {
      type: spec.type,
      payload: spec.payload,
      ...(spec.options ? { options: spec.options } : {}),
    }, { expectedRevision: gesture.revision }))
    if (this.document !== gesture.document) return
    if (!receipt) {
      this.#beginDraftGesture(gesture.session.tool)
      const retryPoints = variableLength ? points : points.slice(0, -1)
      for (const point of retryPoints) this.#draftGesture?.session.addPoint(point)
      this.renderer.render()
      this.#syncDraftActions()
      this.#refreshDraftPreview()
      this.#drawOverlay()
      return
    }
    this.#beginDraftGesture(gesture.session.tool)
    this.#cursorWorld = null
    this.#setMessage(this.#draftPrompt(this.#draftGesture?.session.state.nextPoint ?? null))
    this.#refreshDraftPreview()
    this.#drawOverlay()
  }

  async #addDraftPoint(world: Point2): Promise<void> {
    const gesture = this.#draftGesture
    if (!gesture || gesture.document !== this.document) { this.#cancelGesture(); return }
    const result = await this.#run(() => ({ spec: gesture.session.addPoint(world) }))
    if (!result) return // Keep the validation error visible; no point was accepted.
    const { spec } = result
    if (spec) { await this.#commitDraft(gesture, spec); return }
    if (spec === null && gesture.session.state.status !== 'collecting') return
    this.#setMessage(this.#draftPrompt(gesture.session.state.nextPoint))
    this.#syncDraftActions()
    this.#refreshDraftPreview()
    this.#drawOverlay()
  }

  async #addDraftCoordinate(value: string): Promise<void> {
    const gesture = this.#draftGesture
    if (!gesture || gesture.document !== this.document) { this.#cancelGesture(); return }
    const result = await this.#run(() => ({ spec: gesture.session.addCoordinate(value) }))
    if (!result) return // Keep the validation error visible; no point was accepted.
    const { spec } = result
    if (spec) { await this.#commitDraft(gesture, spec); return }
    if (spec === null && gesture.session.state.status !== 'collecting') return
    this.#setMessage(this.#draftPrompt(gesture.session.state.nextPoint))
    this.#syncDraftActions()
    this.#refreshDraftPreview()
    this.#drawOverlay()
  }

  async #finishDraft(close: boolean): Promise<void> {
    const gesture = this.#draftGesture
    if (!gesture || gesture.document !== this.document) return
    const spec = await this.#run(() => close ? gesture.session.close() : gesture.session.finish())
    if (spec) await this.#commitDraft(gesture, spec)
  }

  #undoDraftPoint(): void {
    const gesture = this.#draftGesture
    if (!gesture?.session.points.length) return
    gesture.session.undoPoint()
    this.#setMessage(this.#draftPrompt(gesture.session.state.nextPoint))
    this.#syncDraftActions()
    this.#refreshDraftPreview()
    this.#drawOverlay()
  }

  #draftField(host: HTMLElement, key: string, labelText: KJLocalizedControlText, options: { type?: 'number' | 'text'; value: string; min?: number; max?: number; step?: number }): void {
    const label = document.createElement('label')
    label.className = 'field'
    const text = document.createElement('span')
    text.textContent = this.#localizedControlText(labelText)
    const input = document.createElement('input')
    input.type = options.type ?? 'number'
    input.value = options.value
    input.required = true
    input.dataset.draftOption = key
    if (options.min !== undefined) input.min = String(options.min)
    if (options.max !== undefined) input.max = String(options.max)
    if (options.step !== undefined) input.step = String(options.step)
    label.append(text, input)
    host.append(label)
  }

  #draftSelect(host: HTMLElement, key: string, labelText: KJLocalizedControlText, values: readonly { value: string; label: KJLocalizedControlText }[], selected: string): void {
    const label = document.createElement('label')
    label.className = 'field'
    const text = document.createElement('span')
    text.textContent = this.#localizedControlText(labelText)
    const select = document.createElement('select')
    select.dataset.draftOption = key
    for (const value of values) {
      const option = document.createElement('option')
      option.value = value.value
      option.textContent = this.#localizedControlText(value.label)
      option.selected = option.value === selected
      select.append(option)
    }
    label.append(text, select)
    host.append(label)
  }

  #draftCheck(host: HTMLElement, key: string, labelText: KJLocalizedControlText, checked: boolean): void {
    const label = document.createElement('label')
    label.className = 'check'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = checked
    input.dataset.draftOption = key
    const text = document.createElement('span')
    text.textContent = this.#localizedControlText(labelText)
    label.append(input, text)
    host.append(label)
  }

  #renderDraftForm(): void {
    const select = query<HTMLSelectElement>(this.root, '[data-draft-tool]')
    for (const option of select.options) option.textContent = this.#localizedControlText(draftToolText[option.value as KJDraftTool])
    const tool = select.value as KJDraftTool
    const configured = this.#draftOptions.get(tool) ?? {}
    const host = query<HTMLElement>(this.root, '[data-draft-options]')
    host.replaceChildren()
    if (tool === 'circle') this.#draftSelect(host, 'circleMode', { en: 'Construction', zh: '构造方式' }, [
      { value: 'center-radius', label: { en: 'Center + radius', zh: '圆心 + 半径点' } },
      { value: '2-point', label: { en: 'Two-point diameter', zh: '两点直径' } },
      { value: '3-point', label: { en: 'Three points', zh: '三点圆' } },
    ], configured.circleMode ?? 'center-radius')
    if (tool === 'arc') this.#draftSelect(host, 'arcMode', { en: 'Construction', zh: '构造方式' }, [
      { value: 'center-start-end', label: { en: 'Center, start, end', zh: '圆心、起点、终点' } },
      { value: '3-point', label: { en: 'Start, through, end', zh: '起点、经过点、终点' } },
    ], configured.arcMode ?? 'center-start-end')
    if (tool === 'ellipse') this.#draftSelect(host, 'ellipseMode', { en: 'Construction', zh: '构造方式' }, [
      { value: 'full', label: { en: 'Full ellipse', zh: '完整椭圆' } },
      { value: 'arc', label: { en: 'Elliptical arc (5 points)', zh: '椭圆弧（五点）' } },
    ], configured.ellipseMode ?? 'full')
    if (tool === 'polygon') this.#draftField(host, 'sides', { en: 'Sides', zh: '边数' }, { value: String(configured.sides ?? 6), min: 3, max: 1024, step: 1 })
    if (tool === 'spline') this.#draftField(host, 'splineDegree', { en: 'Degree', zh: '次数' }, { value: String(configured.splineDegree ?? 3), min: 1, max: 10, step: 1 })
    if (tool === 'hatch') {
      this.#draftField(host, 'patternName', { en: 'Pattern', zh: '图案' }, { type: 'text', value: String(configured.patternName ?? 'SOLID') })
      this.#draftField(host, 'patternScale', { en: 'Pattern scale', zh: '图案比例' }, { value: String(configured.patternScale ?? 1), min: Number.EPSILON, step: 0.1 })
      this.#draftField(host, 'patternAngleDegrees', { en: 'Pattern angle (°)', zh: '图案角度（°）' }, { value: String(Number(configured.patternAngle ?? 0) * 180 / Math.PI), step: 1 })
      this.#draftCheck(host, 'solid', { en: 'Solid fill', zh: '实体填充' }, configured.solid ?? true)
    }
    if (tool === 'dimension') {
      this.#draftSelect(host, 'dimensionType', { en: 'Dimension type', zh: '标注类型' }, [
        { value: 'ALIGNED', label: { en: 'Aligned', zh: '对齐' } }, { value: 'ROTATED', label: { en: 'Rotated', zh: '线性' } },
        { value: 'RADIUS', label: { en: 'Radius', zh: '半径' } }, { value: 'DIAMETER', label: { en: 'Diameter', zh: '直径' } },
        { value: 'ANGULAR_3_POINT', label: { en: 'Three-point angle (including reflex)', zh: '三点角度（含反角）' } },
      ], configured.dimensionType ?? 'ALIGNED')
      this.#draftField(host, 'rotationDegrees', { en: 'Rotation (°)', zh: '旋转角度（°）' }, { value: String(Number(configured.rotation ?? 0) * 180 / Math.PI), step: 1 })
    }
  }

  #openDraftDialog(tool?: KJDraftTool): void {
    if (this.#readOnly) { this.#setMessage(this.#t('readonly')); return }
    if (this.#draftGesture?.session.points.length) {
      this.#setMessage(this.#locale === 'zh-CN' ? '请先完成或按 Esc 取消当前绘图' : 'Finish the current drawing or press Esc to cancel it first')
      return
    }
    this.setTool('select')
    const select = query<HTMLSelectElement>(this.root, '[data-draft-tool]')
    if (tool) select.value = tool
    this.#renderDraftForm()
    const dialog = query<HTMLDialogElement>(this.root, '[data-draft-dialog]')
    if (!dialog.open) dialog.showModal()
  }

  #startDraftFromDialog(): void {
    const form = query<HTMLElement>(this.root, '[data-draft-form]')
    const invalid = form.querySelector<HTMLInputElement | HTMLSelectElement>('input:invalid,select:invalid')
    if (invalid) { invalid.reportValidity(); return }
    const tool = query<HTMLSelectElement>(form, '[data-draft-tool]').value as KJDraftTool
    const value = (key: string): string => query<HTMLInputElement | HTMLSelectElement>(form, `[data-draft-option="${key}"]`).value
    const checked = (key: string): boolean => query<HTMLInputElement>(form, `[data-draft-option="${key}"]`).checked
    let options: KJDraftingOptions = {}
    if (tool === 'circle') options = { circleMode: value('circleMode') as NonNullable<KJDraftingOptions['circleMode']> }
    if (tool === 'arc') options = { arcMode: value('arcMode') as NonNullable<KJDraftingOptions['arcMode']> }
    if (tool === 'ellipse') options = { ellipseMode: value('ellipseMode') as NonNullable<KJDraftingOptions['ellipseMode']> }
    if (tool === 'polygon') options = { sides: Number(value('sides')) }
    if (tool === 'spline') options = { splineDegree: Number(value('splineDegree')) }
    if (tool === 'hatch') options = { patternName: value('patternName'), patternScale: Number(value('patternScale')), patternAngle: Number(value('patternAngleDegrees')) * Math.PI / 180, solid: checked('solid') }
    if (tool === 'dimension') options = { dimensionType: value('dimensionType') as NonNullable<KJDraftingOptions['dimensionType']>, rotation: Number(value('rotationDegrees')) * Math.PI / 180 }
    this.#draftOptions.set(tool, options)
    query<HTMLDialogElement>(this.root, '[data-draft-dialog]').close()
    this.setTool(tool)
  }

  #localizedControlText(value: KJLocalizedControlText): string {
    return this.#locale === 'zh-CN' ? value.zh : value.en
  }

  #openPageSetup(): void {
    const drawing = this.document
    if (!drawing || this.#readOnly || this.#abort.signal.aborted) return
    this.#cancelGesture()
    this.#pageBinding = { document: drawing, revision: drawing.revision, layoutId: '', settings: {} }
    const select = query<HTMLSelectElement>(this.root, '[data-page-sheet]')
    select.replaceChildren(...drawing.spaces.layoutIds.map(id => new Option(drawing.getObject(id)?.name ?? id, id)))
    select.value = drawing.spaces.activeLayoutId
    this.#loadPageSheet()
    query<HTMLDialogElement>(this.root, '[data-page-dialog]').showModal()
  }

  #loadPageSheet(): void {
    const binding = this.#pageBinding
    if (!binding) return
    const id = query<HTMLSelectElement>(this.root, '[data-page-sheet]').value
    const layout = binding.document.getObject(id)
    if (!layout || layout.kind !== 'layout') return
    binding.layoutId = id
    binding.settings = { ...layout.payload.dxfPlotSettings }
    const fields = query<HTMLElement>(this.root, '[data-page-fields]')
    fields.replaceChildren()
    const numbers = [
      ['paperWidth', 'pageWidth', 0], ['paperHeight', 'pageHeight', 0],
      ['marginLeft', 'pageLeft', 0], ['marginRight', 'pageRight', 0], ['marginTop', 'pageTop', 0], ['marginBottom', 'pageBottom', 0],
      ['scaleNumerator', 'pageNumerator', .000000001], ['scaleDenominator', 'pageDenominator', .000000001],
      ['windowMinX', 'pageMinX', null], ['windowMinY', 'pageMinY', null], ['windowMaxX', 'pageMaxX', null], ['windowMaxY', 'pageMaxY', null],
      ['originX', 'pageOriginX', null], ['originY', 'pageOriginY', null],
    ] as const
    const labelFor = (key: keyof KJDxfPlotSettings | 'scaleMode', text: keyof typeof copy.en): HTMLLabelElement => {
      const label = document.createElement('label'); label.className = 'field'
      const span = document.createElement('span'); span.dataset.copy = text; span.textContent = this.#t(text); label.append(span)
      fields.append(label); return label
    }
    for (const [key, text, minimum] of numbers) {
      const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; if (minimum !== null) input.min = String(minimum); input.dataset.pageField = key
      input.value = binding.settings[key] === undefined ? '' : String(binding.settings[key]); input.placeholder = this.#t('pageUnchanged')
      labelFor(key, text).append(input)
    }
    for (const [key, text, values] of [
      ['paperUnits', 'pageUnits', [this.#t('pageInches'), this.#t('pageMm'), this.#t('pagePixels')]],
      ['rotation', 'pageRotation', ['0°', '90°', '180°', '270°']],
      ['plotType', 'pageArea', [this.#t('pageDisplay'), this.#t('pageExtents'), this.#t('pageLimits'), this.#t('pageView'), this.#t('pageWindow'), this.#t('pageLayout')]],
    ] as const) {
      const select = document.createElement('select'); select.dataset.pageField = key
      select.add(new Option(this.#t('pageUnchanged'), ''))
      values.forEach((value, index) => select.add(new Option(value, String(index))))
      select.value = binding.settings[key] === undefined ? '' : String(binding.settings[key]); labelFor(key, text).append(select)
    }
    const view = document.createElement('input'); view.type = 'text'; view.dataset.pageField = 'viewName'; view.value = binding.settings.viewName ?? ''
    labelFor('viewName', 'pageViewName').append(view)
    const scale = document.createElement('select'); scale.dataset.pageScaleMode = ''
    for (const [value, text] of [['', 'pageUnchanged'], ['fit', 'pageFit'], ['custom', 'pageCustom']] as const) scale.add(new Option(this.#t(text), value))
    scale.value = binding.settings.flags === undefined ? '' : !(binding.settings.flags & 16) ? 'custom' : binding.settings.standardScaleType === 0 ? 'fit' : ''
    scale.dataset.initial = scale.value; labelFor('scaleMode', 'pageScaleMode').append(scale)
    const update = () => {
      const area = query<HTMLSelectElement>(fields, '[data-page-field="plotType"]').value
      for (const input of fields.querySelectorAll<HTMLInputElement>('[data-page-field^="window"]')) { input.disabled = area !== '4'; input.required = area === '4' }
      view.disabled = area !== '3'; view.required = area === '3'
      for (const input of fields.querySelectorAll<HTMLInputElement>('[data-page-field^="scale"]')) input.disabled = scale.value === 'fit'
    }
    query<HTMLSelectElement>(fields, '[data-page-field="plotType"]').addEventListener('change', update)
    scale.addEventListener('change', update)
    for (const input of fields.querySelectorAll<HTMLInputElement>('[data-page-field^="scale"]')) input.addEventListener('input', () => { scale.value = 'custom'; update() })
    update()
    query<HTMLElement>(this.root, '[data-page-error]').textContent = ''
  }

  async #applyPageSetup(): Promise<void> {
    const binding = this.#pageBinding, dialog = query<HTMLDialogElement>(this.root, '[data-page-dialog]')
    if (!binding || !dialog.open) return
    const button = query<HTMLButtonElement>(dialog, '[data-action="apply-page"]')
    if (button.disabled) return
    const invalid = dialog.querySelector<HTMLInputElement | HTMLSelectElement>('input:invalid,select:invalid')
    if (invalid) { invalid.reportValidity(); return }
    button.disabled = true
    try {
      if (this.#readOnly) throw new Error(this.#t('readonly'))
      if (this.document !== binding.document || binding.document.revision !== binding.revision) throw new Error(this.#t('pageStale'))
      const patch: Record<string, number | string> = {}
      for (const input of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-page-field]')) {
        if (input.disabled || !input.value.trim()) continue
        const key = input.dataset.pageField as keyof KJDxfPlotSettings, value = key === 'viewName' ? input.value : Number(input.value)
        if (value !== binding.settings[key]) patch[key] = value
      }
      const scale = query<HTMLSelectElement>(dialog, '[data-page-scale-mode]')
      if (scale.value === 'fit' && scale.value !== scale.dataset.initial) { patch.flags = (binding.settings.flags ?? 688) | 16; patch.standardScaleType = 0 }
      else if ((scale.value === 'custom' && scale.value !== scale.dataset.initial) || patch.scaleNumerator !== undefined || patch.scaleDenominator !== undefined) patch.flags = (binding.settings.flags ?? 688) & ~16
      if (Object.keys(patch).length) await this.execute('PAGESETUP', { layoutId: binding.layoutId, dxf: patch }, { expectedRevision: binding.revision })
      dialog.close()
    } catch (error) {
      query<HTMLElement>(dialog, '[data-page-error]').textContent = error instanceof Error ? error.message : String(error)
    } finally { button.disabled = false }
  }

  #renderModificationForm(): void {
    const select = query<HTMLSelectElement>(this.root, '[data-modification]')
    const id = select.value as KJModificationId
    const definition = getKJModificationDefinition(id)
    for (const option of select.options) {
      const candidate = KJ_MODIFICATION_DEFINITIONS.find(value => value.id === option.value)
      if (candidate) option.textContent = this.#localizedControlText(candidate.label)
    }
    const description = query<HTMLElement>(this.root, '[data-modification-description]')
    description.textContent = this.#localizedControlText(definition.description)
    const fields = query<HTMLElement>(this.root, '[data-modification-fields]')
    const previousWorkflow = fields.querySelector<HTMLSelectElement>('[data-boundary-workflow]')?.value
    fields.replaceChildren()
    if (id === 'trim' || id === 'extend') {
      const label = document.createElement('label')
      label.className = 'field'
      label.style.gridColumn = '1 / -1'
      const text = document.createElement('span')
      text.textContent = this.#t('editWorkflow')
      const workflow = document.createElement('select')
      workflow.dataset.boundaryWorkflow = ''
      workflow.setAttribute('aria-label', this.#t('editWorkflow'))
      for (const [value, key] of [['boundaries', 'boundaryWorkflow'], ['single', 'singleWorkflow']] as const) {
        const option = document.createElement('option')
        option.value = value; option.textContent = this.#t(key); workflow.append(option)
      }
      workflow.value = previousWorkflow ?? ((this.#selection?.size ?? 0) >= 2 ? 'single' : 'boundaries')
      const updateDescription = (): void => { description.textContent = workflow.value === 'boundaries' ? `${this.#t('boundarySelectionHint')} · ${this.#t('boundaryTargetHint')}` : this.#localizedControlText(definition.description) }
      workflow.addEventListener('change', updateDescription, { signal: this.#abort.signal })
      updateDescription()
      label.append(text, workflow); fields.append(label)
    }
    for (const field of definition.fields) {
      const label = document.createElement('label')
      if (field.type === 'boolean') {
        label.className = 'check'
        const input = document.createElement('input')
        input.type = 'checkbox'
        input.checked = Boolean(field.default)
        input.dataset.modificationField = field.key
        const text = document.createElement('span')
        text.textContent = this.#localizedControlText(field.label)
        label.append(input, text)
      } else {
        label.className = 'field'
        const text = document.createElement('span')
        text.textContent = this.#localizedControlText(field.label)
        const input = document.createElement('input')
        input.type = 'number'
        input.required = true
        input.value = String(field.default)
        input.step = String(field.step ?? (field.type === 'integer' ? 1 : 'any'))
        if (field.min !== undefined) input.min = String(field.min)
        if (field.max !== undefined) input.max = String(field.max)
        input.dataset.modificationField = field.key
        label.append(text, input)
      }
      fields.append(label)
    }
    const submit = query<HTMLButtonElement>(this.root, '[data-action="start-modification"]')
    const copyKey = definition.pointKeys.length ? 'continueOnCanvas' : 'apply'
    submit.dataset.copy = copyKey
    submit.textContent = this.#t(copyKey)
  }

  #openModificationDialog(id?: KJModificationId): void {
    if (this.#readOnly) { this.#setMessage(this.#t('readonly')); return }
    this.setTool('select')
    const select = query<HTMLSelectElement>(this.root, '[data-modification]')
    if (id) select.value = id
    query<HTMLElement>(this.root, '[data-modification-fields]').replaceChildren()
    this.#renderModificationForm()
    const dialog = query<HTMLDialogElement>(this.root, '[data-modification-dialog]')
    if (!dialog.open) dialog.showModal()
  }

  #validateModificationSelection(definition: KJModificationDefinition, ids: readonly string[], drawing: KJDocument): void {
    validateKJModificationSelection(definition, ids.map(id => drawing.getObject(id)), this.#locale === 'zh-CN' ? 'zh' : 'en')
  }

  async #startModification(): Promise<void> {
    const form = query<HTMLElement>(this.root, '[data-modification-form]')
    const invalid = form.querySelector<HTMLInputElement | HTMLSelectElement>('input:invalid,select:invalid')
    if (invalid) { invalid.reportValidity(); return }
    const drawing = this.document
    if (!drawing) throw new Error('No active KJDraw document')
    const definition = getKJModificationDefinition(query<HTMLSelectElement>(this.root, '[data-modification]').value as KJModificationId)
    if ((definition.id === 'trim' || definition.id === 'extend') && form.querySelector<HTMLSelectElement>('[data-boundary-workflow]')?.value === 'boundaries') {
      this.#beginBoundaryEdit(definition.id)
      return
    }
    const ids = Object.freeze([...(this.#selection?.ids ?? [])])
    this.#validateModificationSelection(definition, ids, drawing)
    const values: Record<string, unknown> = {}
    for (const field of definition.fields) {
      const input = query<HTMLInputElement>(form, `[data-modification-field="${field.key}"]`)
      values[field.key] = field.type === 'boolean' ? input.checked : Number(input.value)
    }
    const gesture = {
      document: drawing,
      revision: drawing.revision,
      ids,
      definition,
      values: Object.freeze(values),
      selectionCenter: this.#selectionCenter(ids),
      points: [] as Point2[],
    }
    this.#modificationGesture = gesture
    query<HTMLDialogElement>(this.root, '[data-modification-dialog]').close()
    if (!definition.pointKeys.length) {
      await this.#commitModification(gesture)
      return
    }
    this.#setMessage(this.#localizedControlText(definition.pointKeys[0]!.label))
    this.#drawOverlay()
  }

  async #commitModification(gesture: KJModificationGesture): Promise<void> {
    const epoch = this.#gestureEpoch
    if (this.#modificationGesture === gesture) this.#modificationGesture = null
    if (this.document !== gesture.document) return
    const built = await this.#run(() => buildKJModificationCommand(gesture.definition.id, {
      ids: gesture.ids,
      values: gesture.values,
      points: gesture.points,
      selectionCenter: gesture.selectionCenter,
    }))
    if (epoch !== this.#gestureEpoch || this.document !== gesture.document || gesture.document.revision !== gesture.revision) return
    if (!built) {
      if (gesture.definition.pointKeys.length) {
        if (gesture.points.length) gesture.points.pop()
        gesture.revision = gesture.document.revision
        this.#modificationGesture = gesture
      }
      this.#drawOverlay()
      return
    }
    const request = built
    const receipt = await this.#run(() => this.execute(request.command, request.arguments, { expectedRevision: gesture.revision }))
    if (epoch !== this.#gestureEpoch || this.document !== gesture.document) return
    if (!receipt) {
      if (gesture.document.revision !== gesture.revision) { this.setTool('select'); return }
      if (gesture.definition.pointKeys.length) {
        if (gesture.points.length) gesture.points.pop()
        gesture.revision = gesture.document.revision
        this.#modificationGesture = gesture
      }
      this.#drawOverlay()
      return
    }
    const ids = entityIdsFromCommandResult(receipt.result)
    if (ids.length) await this.sdk.executeCommand('SELECT', { ids, operation: 'replace' }, { document: gesture.document })
    this.setTool('select')
    this.#setMessage(`${request.command} · REV ${gesture.document.revision}`)
  }

  async #addModificationPoint(world: Point2): Promise<void> {
    const gesture = this.#modificationGesture
    if (!gesture || this.document !== gesture.document) { this.#cancelGesture(); return }
    gesture.points.push(world)
    const next = gesture.definition.pointKeys[gesture.points.length]
    if (next) {
      this.#setMessage(this.#localizedControlText(next.label))
      this.#drawOverlay()
      return
    }
    await this.#commitModification(gesture)
  }

  async #addModificationCoordinate(value: string): Promise<void> {
    const gesture = this.#modificationGesture
    if (!gesture || gesture.document !== this.document) { this.#cancelGesture(); return }
    await this.#addModificationPoint(parseDraftCoordinate(value, gesture.points.at(-1)))
  }

  #beginBoundaryEdit(operation: 'trim' | 'extend'): void {
    if (this.#readOnly) throw new Error(this.#t('readonly'))
    const drawing = this.document
    if (!drawing) throw new Error('No active KJDraw document')
    const ids = [...(this.#selection?.ids ?? [])]
    this.setTool('select')
    this.#boundarySession = createBoundaryEditSession(operation, {
      document: drawing, boundaryIds: ids, locale: this.#locale === 'zh-CN' ? 'zh' : 'en',
      isDocumentCurrent: () => this.document === drawing && this.sdk.documents.get(drawing.id) === drawing
        && !this.#readOnly && !this.#abort.signal.aborted,
    })
    this.#canvas.classList.add('crosshair')
    this.#syncBoundaryActions()
    this.#setMessage(this.#boundaryPrompt())
    this.#drawOverlay()
  }

  #boundaryPrompt(): string {
    const session = this.#boundarySession
    if (!session) return this.#t('ready')
    return session.state.phase === 'boundaries' ? `${session.prompt} · ${this.#t('boundarySelectionHint')}` : session.prompt
  }

  #syncBoundaryActions(): void {
    const host = this.root.querySelector<HTMLElement>('[data-boundary-actions]')
    if (!host) return
    const state = this.#boundarySession?.state
    const phase = state?.phase
    host.hidden = !phase || phase === 'finished' || phase === 'cancelled'
    host.dataset.boundaryStage = phase ?? 'idle'
    query<HTMLElement>(host, '[data-boundary-summary]').textContent = !state ? '' : this.#locale === 'zh-CN'
      ? `${state.operation === 'trim' ? '修剪' : '延伸'} · ${state.boundaryIds.length} 条边界 · ${state.committedCount} 次`
      : `${state.operation.toUpperCase()} · ${state.boundaryIds.length} ${state.boundaryIds.length === 1 ? 'boundary' : 'boundaries'} · ${state.committedCount} ${state.committedCount === 1 ? 'edit' : 'edits'}`
    const confirm = query<HTMLButtonElement>(host, '[data-action="boundary-confirm"]')
    const finish = query<HTMLButtonElement>(host, '[data-action="boundary-finish"]')
    confirm.hidden = phase !== 'boundaries'
    finish.hidden = phase === 'boundaries'
    finish.disabled = phase === 'applying'
    this.#refreshSelectionPanels()
  }

  #confirmBoundaryEdit(): void {
    const session = this.#boundarySession
    if (!session || session.state.phase !== 'boundaries') return
    session.confirmBoundaries()
    this.#cancelPointer()
    this.#syncBoundaryActions()
    this.#setMessage(this.#boundaryPrompt())
    this.#drawOverlay()
    this.root.focus({ preventScroll: true })
  }

  #finishBoundaryEdit(): void {
    const session = this.#boundarySession
    if (!session || session.state.phase === 'applying') return
    session.finish()
    const message = session.prompt
    this.setTool('select')
    this.#setMessage(message)
  }

  #clearBoundaryPreview(): void {
    const hadPreview = this.#boundaryPreview !== null
    this.#boundaryPreview = null
    if (hadPreview) this.renderer.render()
  }

  #previewBoundaryTarget(location: Point2): void {
    this.#clearBoundaryPreview()
    const session = this.#boundarySession
    if (!session || session.state.phase !== 'targets') return
    if (!session.isCurrent()) { this.setTool('select'); this.#setMessage(this.#t('gestureCancelled')); return }
    const hit = this.renderer.hitTest(location, 9)
    if (!hit || session.state.boundaryIds.includes(hit.entity.id)) { this.#setMessage(session.prompt); return }
    try {
      const preview = session.preview(hit.entity.id, this.renderer.screenToWorld(location))
      this.#boundaryPreview = preview
      this.renderer.drawPreview(preview.pieces, this.#theme === 'dark' ? '#8fc0ff' : '#175fc8')
      this.#setMessage(session.prompt)
    } catch (error) {
      // Hover errors are retryable hints, not failed transactions or onError events.
      this.#setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async #boundaryPointerUp(gesture: KJWorkbenchBoundaryPointer, location: Point2): Promise<void> {
    const session = this.#boundarySession
    if (!session || session.state.phase !== gesture.phase) return
    if (!session.isCurrent() || !this.#pointerBindingIsCurrent(gesture)) {
      this.setTool('select'); this.#setMessage(this.#t('gestureCancelled')); return
    }
    try {
      if (gesture.phase === 'boundaries') {
        const dragged = Math.hypot(location[0] - gesture.baseScreen[0], location[1] - gesture.baseScreen[1]) >= 3
        const hit = dragged ? null : this.renderer.hitTest(location, 9, { includeLocked: true })
        const found = dragged ? this.renderer.selectBox(gesture.baseScreen, location, { includeLocked: true }) : hit ? [hit.entity.id] : []
        const ids = gesture.operation === 'remove'
          ? session.state.boundaryIds.filter(id => !found.includes(id))
          : [...new Set([...session.state.boundaryIds, ...found])]
        session.setBoundaries(ids)
        await this.execute('SELECT', { ids, operation: 'replace' }, { expectedRevision: gesture.revision })
      } else {
        // A trim pick is the raw clicked portion, not an object-snap endpoint:
        // snapping can turn a valid interior pick into an ambiguous exact cut.
        const hit = this.renderer.hitTest(location, 9)
        if (!hit) { this.#setMessage(this.#t('boundaryEmpty')); return }
        const preview = session.preview(hit.entity.id, this.renderer.screenToWorld(location))
        this.#clearBoundaryPreview()
        const applying = session.apply(preview, request => this.execute(request.command, request.arguments, { expectedRevision: request.expectedRevision }))
        this.#syncBoundaryActions()
        this.#setMessage(session.prompt)
        await applying
      }
      if (this.#boundarySession !== session) return
      if (!session.isCurrent()) { this.setTool('select'); this.#setMessage(this.#t('gestureCancelled')); return }
      this.#syncBoundaryActions()
      this.#setMessage(this.#boundaryPrompt())
    } catch (error) {
      if (this.#boundarySession !== session) return
      if (!session.isCurrent()) this.setTool('select')
      this.#handleError(error)
      this.#syncBoundaryActions()
    } finally {
      if (this.#boundarySession === session) this.#drawOverlay()
    }
  }

  #activeLayerPayload(): Record<string, unknown> {
    const layerId = this.document?.getTable('layers')?.currentId
    return layerId ? { layerId } : {}
  }

  #selectionCenter(ids: readonly string[]): Point2 {
    const drawing = this.document
    if (!drawing) return [0, 0]
    const entities = ids.flatMap(id => {
      const entity = drawing.getObject(id)
      return entity?.kind === 'entity' ? [entity] : []
    })
    return getKJModificationSelectionCenter(entities)
  }

  #selectionBounds(ids: readonly string[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const drawing = this.document
    if (!drawing) return null
    const values: Point2[] = []
    const add = (value: unknown): void => {
      if (!Array.isArray(value)) return
      const x = Number(value[0]), y = Number(value[1])
      if (Number.isFinite(x) && Number.isFinite(y)) values.push([x, y])
    }
    for (const id of ids) {
      const entity = drawing.getObject(id)
      if (!entity || entity.kind !== 'entity') continue
      const payload = entity.payload
      for (const key of ['start', 'end', 'center', 'position', 'insertionPoint', 'origin', 'textPosition'] as const) add(payload[key])
      for (const key of ['vertices', 'controlPoints', 'fitPoints', 'definitionPoints'] as const) {
        if (Array.isArray(payload[key])) for (const vertex of payload[key]) add(vertex && typeof vertex === 'object' && 'point' in vertex ? vertex.point : vertex)
      }
      if ((entity.type === 'CIRCLE' || entity.type === 'ARC') && Array.isArray(payload.center)) {
        const x = Number(payload.center[0]), y = Number(payload.center[1]), radius = Math.abs(Number(payload.radius))
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(radius)) {
          values.push([x - radius, y - radius], [x + radius, y + radius])
        }
      }
    }
    if (!values.length) return null
    const xs = values.map(value => value[0]), ys = values.map(value => value[1])
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
  }

  #visibleModelEntityIds(): string[] {
    const drawing = this.document
    if (!drawing) return []
    const modelSpaceId = this.spaceId ?? drawing.spaces.modelSpaceId
    const layers = new Map(drawing.getTable('layers')?.records.map(layer => [layer.id, layer.payload]) ?? [])
    return drawing.listEntities({ ownerId: modelSpaceId }).filter(entity => {
      const layer = layers.get(String(entity.payload.layerId ?? ''))
      return layer?.visible !== false && layer?.frozen !== true
    }).map(entity => entity.id)
  }

  #orthoEnabled(): boolean {
    return Number(this.document?.snapshot().header.systemVariables.ORTHOMODE ?? 0) !== 0
  }

  #orthoBase(): Point2 | null {
    if (this.#gripGesture) return [this.#gripGesture.grip.point[0], this.#gripGesture.grip.point[1]]
    if (this.#selectionDrag) return this.#selectionDrag.baseWorld
    if (this.#transformGesture?.base) return this.#transformGesture.base
    const modificationPoint = this.#modificationGesture?.points.at(-1)
    if (modificationPoint) return modificationPoint
    const draftPoint = this.#draftGesture?.session.points.at(-1)
    if (draftPoint) return [draftPoint[0], draftPoint[1]]
    return this.#draftPoints.at(-1) ?? this.#draftStart
  }

  #constrainPointer(world: Point2, snapped: Point2 | null): Point2 {
    if (snapped || !this.#orthoEnabled()) return snapped ?? world
    const base = this.#orthoBase()
    return base ? constrainOrthogonalDraftPoint(world, base) as Point2 : world
  }

  #syncOrtho(): void {
    const button = this.root.querySelector<HTMLButtonElement>('[data-action="ortho"]')
    if (!button) return
    const enabled = this.#orthoEnabled()
    button.disabled = this.#readOnly
    button.setAttribute('aria-pressed', String(enabled))
    button.title = this.#t(enabled ? 'orthoOn' : 'orthoOff')
    button.setAttribute('aria-label', button.title)
  }

  async #toggleOrtho(): Promise<void> {
    if (this.#readOnly || !this.document) return
    if (this.#draftGesture || this.#transformGesture || this.#modificationGesture || this.#gripGesture || this.#selectionDrag || this.#boundarySession || this.#fenceSelection) {
      this.#setMessage(this.#t('orthoBusy'))
      return
    }
    await this.#run(() => this.execute('ORTHO', { enabled: !this.#orthoEnabled() }))
  }

  #snapAt(world: Point2, excludeIds: readonly string[] = []): Point2 | null {
    if (this.paperPreview) { this.#snapMode = null; return null }
    const drawing = this.document
    if (!drawing || !this.#snappableEntityIds.length) { this.#snapMode = null; return null }
    let settings
    try { settings = getDocumentSnapSettings(drawing) } catch { this.#snapMode = null; return null }
    if (!settings.modes.length) { this.#snapMode = null; return null }
    const candidate = this.sdk.snap(world, {
      document: drawing,
      entityIds: excludeIds.length ? this.#snappableEntityIds.filter(id => !excludeIds.includes(id)) : this.#snappableEntityIds,
      radius: settings.aperture / this.renderer.camera.scale,
      modes: settings.modes,
    })[0]
    this.#snapMode = candidate?.mode ?? null
    return candidate ? [candidate.point[0], candidate.point[1]] : null
  }

  #showSnap(world: Point2 | null): void {
    const marker = this.root.querySelector<HTMLElement>('[data-snap]')
    if (!marker || !world) { this.#hideSnap(); return }
    this.#snapWorld = world
    const labels: Partial<Record<KJSnapMode, keyof typeof copy.en>> = { endpoint: 'snapEndpoint', midpoint: 'snapMidpoint', center: 'snapCenter', quadrant: 'snapQuadrant', intersection: 'snapIntersection', insertion: 'snapInsertion', node: 'snapNode', nearest: 'snapNearest' }
    const label = this.#snapMode && labels[this.#snapMode] ? this.#t(labels[this.#snapMode]!) : ''
    marker.dataset.mode = this.#snapMode ?? ''
    marker.dataset.label = label
    if (label) marker.setAttribute('aria-label', label); else marker.removeAttribute('aria-label')
    const screen = this.renderer.worldToScreen(world)
    marker.style.display = 'block'
    marker.style.left = `${screen[0]}px`
    marker.style.top = `${screen[1]}px`
  }

  #hideSnap(): void {
    this.#snapWorld = null
    this.#snapMode = null
    const marker = this.root.querySelector<HTMLElement>('[data-snap]')
    if (marker) { marker.style.display = 'none'; delete marker.dataset.mode; delete marker.dataset.label; marker.removeAttribute('aria-label') }
  }

  #pointerDown(event: PointerEvent): void {
    const owner = this.#pointerOwnerId()
    if (owner !== null) {
      if (owner !== event.pointerId) this.#ignoredPointers.add(event.pointerId)
      return
    }
    if (event.pointerType === 'touch' && !event.isPrimary) { this.#ignoredPointers.add(event.pointerId); return }
    this.#ignoredPointers.delete(event.pointerId)
    this.root.focus({ preventScroll: true })
    this.#cancelledPointers.delete(event.pointerId)
    const location = point(event, this.#canvas)
    if (this.#gripGesture || this.#boxSelection || this.#selectionDrag || this.#activePointer !== null || this.#fencePointer !== null) return
    if (event.button === 1 || this.#tool === 'pan') {
      event.preventDefault(); this.#panStart = location; this.#activePointer = event.pointerId; this.#canvas.setPointerCapture(event.pointerId); this.#canvas.classList.add('dragging')
      return
    }
    if (event.button === 0 && this.#boundarySession) {
      const phase = this.#boundarySession.state.phase, drawing = this.document
      if (!drawing || (phase !== 'boundaries' && phase !== 'targets')) return
      this.#boundaryPointer = { pointerId: event.pointerId, document: drawing, revision: drawing.revision,
        view: this.#viewIdentity(), baseScreen: location, currentScreen: location, phase,
        operation: event.ctrlKey || event.metaKey ? 'remove' : 'add' }
      this.#canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
      return
    }
    if (event.button === 0 && this.#fenceSelection) {
      this.#fencePointer = event.pointerId
      this.#canvas.setPointerCapture(event.pointerId)
      return
    }
    if (event.button === 0 && this.#tool === 'select' && !this.#modificationGesture) {
      const drawing = this.document
      if (!drawing) return
      const selection = this.#selection
      const operation = event.ctrlKey || event.metaKey ? 'remove' : event.shiftKey ? 'add' : 'replace'
      const binding: KJWorkbenchPointerBinding = {
        pointerId: event.pointerId, document: drawing, revision: drawing.revision, view: this.#viewIdentity(), baseScreen: location,
      }
      const grip = operation === 'replace' && !this.#readOnly && selection?.size === 1 ? this.renderer.hitGrip(location, 7) : null
      const entity = grip ? drawing.getObject(grip.entityId) : null
      if (grip && entity?.kind === 'entity') {
        this.#gripGesture = { ...binding, grip, entity, currentWorld: [grip.point[0], grip.point[1]] }
        this.#canvas.setPointerCapture(event.pointerId)
        this.#canvas.classList.add('dragging')
        this.#setMessage(this.#t('gripEditing'))
        event.preventDefault()
        return
      }
      const hit = this.renderer.hitTest(location, 9)
      if (!hit) {
        this.#boxSelection = { ...binding, currentScreen: location, operation }
        this.#canvas.setPointerCapture(event.pointerId)
        this.#hoverGrip = null
        this.#hideSnap()
        event.preventDefault()
        return
      }
      if (operation === 'replace' && !this.#readOnly && selection?.has(hit.entity.id)) {
        const baseWorld = this.renderer.screenToWorld(location)
        const editable = new Set(this.renderer.selectAll())
        this.#selectionDrag = {
          ...binding,
          ids: Object.freeze(selection.ids.filter(id => editable.has(id))),
          baseWorld,
          currentWorld: baseWorld,
        }
        this.#canvas.setPointerCapture(event.pointerId)
        this.#canvas.classList.add('dragging')
        event.preventDefault()
      }
    }
  }

  #pointerMove(event: PointerEvent): void {
    if (this.#ignoredPointers.has(event.pointerId) || this.#isForeignPointer(event)) return
    const location = point(event, this.#canvas), rawWorld = this.renderer.screenToWorld(location)
    const coordinate = this.root.querySelector<HTMLElement>('[data-coordinate]')
    if (coordinate) coordinate.textContent = `X ${rawWorld[0].toFixed(3)} · Y ${rawWorld[1].toFixed(3)}`
    if (this.#boundarySession && !this.#panStart) {
      if (this.#boundaryPointer) this.#boundaryPointer.currentScreen = location
      this.#cursorWorld = rawWorld
      this.#hoverGrip = null
      this.#previewBoundaryTarget(location)
      this.#hideSnap(); this.#drawOverlay(); return
    }
    const pointerGesture = this.#gripGesture ?? this.#boxSelection ?? this.#selectionDrag
    if (pointerGesture && !this.#pointerBindingIsCurrent(pointerGesture)) {
      this.#cancelPointer(); this.#setMessage(this.#t('gestureCancelled')); this.#drawOverlay(); return
    }
    if (this.#boxSelection?.pointerId === event.pointerId) {
      this.#boxSelection.currentScreen = location
      this.#setMessage(this.#t(location[0] >= this.#boxSelection.baseScreen[0] ? 'windowSelection' : 'crossingSelection'))
      this.#drawOverlay()
      return
    }
    if (this.#gripGesture?.pointerId === event.pointerId) {
      const snapped = this.#snapAt(rawWorld, [this.#gripGesture.grip.entityId])
      this.#gripGesture.currentWorld = this.#constrainPointer(rawWorld, snapped)
      this.#cursorWorld = this.#gripGesture.currentWorld
      this.#showSnap(snapped)
      this.#refreshGripPreview()
      this.#drawOverlay()
      return
    }
    if (this.#selectionDrag?.pointerId === event.pointerId) {
      this.#selectionDrag.currentWorld = this.#constrainPointer(rawWorld, null)
      this.#cursorWorld = this.#selectionDrag.currentWorld
      this.#hideSnap()
      this.#drawOverlay()
      return
    }
    if (this.#panStart && this.#activePointer === event.pointerId) {
      this.renderer.panBy(location[0] - this.#panStart[0], location[1] - this.#panStart[1])
      this.#panStart = location
      this.#cursorWorld = null
      this.#hideSnap()
      this.#refreshViewport()
      return
    }
    const drawingTool = this.#draftGesture !== null || this.#modificationGesture !== null || ['text', 'measure', 'move', 'copy'].includes(this.#tool)
    this.#hoverGrip = this.#tool === 'select' && !this.#readOnly && this.#selection?.size === 1 ? this.renderer.hitGrip(location, 7) : null
    this.#canvas.style.cursor = this.#hoverGrip ? 'crosshair' : ''
    const snapped = drawingTool ? this.#snapAt(rawWorld) : null
    this.#cursorWorld = this.#constrainPointer(rawWorld, snapped)
    if (coordinate) coordinate.textContent = `X ${this.#cursorWorld[0].toFixed(3)} · Y ${this.#cursorWorld[1].toFixed(3)}`
    this.#showSnap(snapped)
    this.#refreshDraftPreview()
    this.#drawOverlay()
  }

  async #pointerUp(event: PointerEvent): Promise<void> {
    if (this.#ignoredPointers.delete(event.pointerId) || this.#isForeignPointer(event)) return
    if (this.#cancelledPointers.delete(event.pointerId)) return
    if (this.#boundaryPointer?.pointerId === event.pointerId) {
      const gesture = this.#boundaryPointer
      this.#boundaryPointer = null
      if (this.#canvas.hasPointerCapture(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId)
      await this.#boundaryPointerUp(gesture, point(event, this.#canvas))
      return
    }
    if (this.#fencePointer === event.pointerId) {
      this.#fencePointer = null
      if (this.#canvas.hasPointerCapture(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId)
    }
    if (this.#boxSelection?.pointerId === event.pointerId) {
      const box = this.#boxSelection, location = point(event, this.#canvas)
      this.#boxSelection = null
      if (this.#canvas.hasPointerCapture(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId)
      if (this.#pointerBindingIsCurrent(box)) {
        const dragged = Math.hypot(location[0] - box.baseScreen[0], location[1] - box.baseScreen[1]) >= 3
        if (dragged || box.operation === 'replace') {
          const ids = dragged ? this.renderer.selectBox(box.baseScreen, location) : []
          await this.#run(() => this.execute('SELECT', { ids: [...ids], operation: box.operation }, { expectedRevision: box.revision }))
        }
        this.#setMessage(this.#selection?.size === 1 ? this.#t('gripHint') : this.#t('selectionHint'))
      } else this.#setMessage(this.#t('gestureCancelled'))
      this.#drawOverlay()
      return
    }
    if (this.#gripGesture?.pointerId === event.pointerId) {
      const gesture = this.#gripGesture, location = point(event, this.#canvas)
      const rawWorld = this.renderer.screenToWorld(location)
      const destination = this.#constrainPointer(rawWorld, this.#snapAt(rawWorld, [gesture.grip.entityId]))
      this.#gripGesture = null
      if (this.#canvas.hasPointerCapture(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId)
      this.#canvas.classList.remove('dragging')
      this.#hoverGrip = null
      this.#hideSnap()
      this.renderer.render()
      if (this.#pointerBindingIsCurrent(gesture) && !this.#readOnly) {
        if (Math.hypot(location[0] - gesture.baseScreen[0], location[1] - gesture.baseScreen[1]) >= 3) {
          await this.#run(() => this.execute('GRIPEDIT', {
            id: gesture.entity.id, gripId: gesture.grip.id, point: [destination[0], destination[1], gesture.grip.point[2]],
          }, { expectedRevision: gesture.revision }))
        }
      } else this.#setMessage(this.#t('gestureCancelled'))
      this.#drawOverlay()
      return
    }
    if (this.#selectionDrag?.pointerId === event.pointerId) {
      const drag = this.#selectionDrag
      const location = point(event, this.#canvas)
      const destination = this.#constrainPointer(this.renderer.screenToWorld(location), null)
      this.#selectionDrag = null
      if (this.#canvas.hasPointerCapture(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId)
      this.#canvas.classList.remove('dragging')
      const screenDistance = Math.hypot(location[0] - drag.baseScreen[0], location[1] - drag.baseScreen[1])
      if (screenDistance >= 3 && this.#pointerBindingIsCurrent(drag) && drag.ids.length) {
        await this.#run(() => this.execute('MOVE', {
          ids: [...drag.ids],
          dx: destination[0] - drag.baseWorld[0],
          dy: destination[1] - drag.baseWorld[1],
        }, { expectedRevision: drag.revision }))
      }
      this.#cursorWorld = destination
      this.#drawOverlay()
      return
    }
    if (this.#activePointer === event.pointerId) { this.#cancelPointer(); return }
    if (this.#boundarySession) return
    if (event.button !== 0 || !this.document) return
    const location = point(event, this.#canvas)
    const rawWorld = this.renderer.screenToWorld(location)
    const snapped = (this.#draftGesture !== null || this.#modificationGesture !== null || ['text', 'measure', 'move', 'copy'].includes(this.#tool)) ? this.#snapAt(rawWorld) : null
    const world = this.#constrainPointer(rawWorld, snapped)
    this.#cursorWorld = world
    if (this.#fenceSelection) {
      const fence = this.#fenceSelection
      if (fence.document !== this.document || fence.document.revision !== fence.revision) { this.setTool('select'); return }
      if (!fence.points.length) fence.operation = event.ctrlKey || event.metaKey ? 'remove' : event.shiftKey ? 'add' : 'replace'
      const previous = fence.points.at(-1)
      if (!previous || Math.hypot(previous[0] - rawWorld[0], previous[1] - rawWorld[1]) > 1e-12) fence.points.push(rawWorld)
      this.#setMessage(this.#t('fenceHint')); this.#drawOverlay(); return
    }
    if (this.#draftGesture) { await this.#addDraftPoint(world); return }
    if (this.#modificationGesture) { await this.#addModificationPoint(world); return }
    if (this.#tool === 'select') {
      const hit = this.renderer.hitTest(location, 9)
      if ((event.shiftKey || event.ctrlKey || event.metaKey) && !hit) return
      const operation = event.ctrlKey || event.metaKey ? 'remove' : event.shiftKey ? 'add' : 'replace'
      await this.#run(() => this.execute('SELECT', { ids: hit ? [hit.entity.id] : [], operation }))
      this.#setMessage(this.#selection?.size === 1 && !this.#readOnly ? this.#t('gripHint') : this.#t('selectionHint'))
      return
    }
    if (this.#tool === 'pan') return
    if (this.#tool === 'move' || this.#tool === 'copy') {
      const operationTool = this.#tool
      let gesture = this.#transformGesture
      if (!gesture) {
        const drawing = this.document
        const ids = [...(this.#selection?.ids ?? [])]
        if (ids.length) {
          this.#beginTransformGesture(operationTool, ids)
          gesture = this.#transformGesture
        } else {
          const hit = this.renderer.hitTest(location, 9)
          if (!hit) { this.#setMessage(this.#t('selectObjects')); return }
          await this.sdk.executeCommand('SELECT', { ids: [hit.entity.id], operation: 'replace' }, { document: drawing })
          if (this.document !== drawing) return
          this.#beginTransformGesture(operationTool, [hit.entity.id])
          this.#setMessage(this.#t('basePoint'))
          this.#drawOverlay()
          return
        }
      }
      if (!gesture || gesture.document !== this.document) {
        this.#cancelGesture()
        this.#setMessage(this.#t('selectObjects'))
        return
      }
      if (!gesture.base) {
        gesture.base = world
        this.#setMessage(this.#t('destinationPoint'))
        this.#drawOverlay()
        return
      }
      const base = gesture.base
      this.#transformGesture = null
      const result = await this.#run(() => this.execute(gesture.operation, {
        ids: [...gesture.ids],
        dx: world[0] - base[0],
        dy: world[1] - base[1],
      }, { expectedRevision: gesture.revision }))
      if (result) {
        const operation = gesture.operation
        this.setTool('select')
        this.#setMessage(`${operation} · REV ${this.document?.revision ?? 0}`)
      }
      this.#drawOverlay()
      return
    }
    if (this.#tool === 'text') {
      if (this.#readOnly) return
      await this.#run(() => this.execute('CREATE', { type: 'TEXT', payload: { position: [...world, 0], text: this.#pendingText, height: Math.max(1, 16 / this.renderer.camera.scale), rotation: 0, ...this.#activeLayerPayload() } }))
      this.#setMessage(this.#t('textPrompt'))
      this.#drawOverlay()
      return
    }
    if (this.#tool === 'polyline') {
      const previous = this.#draftPoints.at(-1)
      if (!previous || Math.hypot(previous[0] - world[0], previous[1] - world[1]) > 1e-12) this.#draftPoints.push(world)
      this.#setMessage(this.#draftPoints.length < 2 ? this.#t('nextPoint') : this.#t('finishPolyline'))
      this.#drawOverlay()
      return
    }
    if (this.#tool === 'arc') {
      this.#draftPoints.push(world)
      if (this.#draftPoints.length === 1) this.#setMessage(this.#t('arcStart'))
      else if (this.#draftPoints.length === 2) this.#setMessage(this.#t('arcEnd'))
      else {
        const [center, start, end] = this.#draftPoints
        this.#draftPoints = []
        const radius = Math.hypot(start![0] - center![0], start![1] - center![1])
        if (radius <= 1e-12) { this.#handleError(new Error('ARC start point must differ from its center')); this.#drawOverlay(); return }
        await this.#run(() => this.execute('CREATE', { type: 'ARC', payload: { center: [...center!, 0], radius, startAngle: Math.atan2(start![1] - center![1], start![0] - center![0]), endAngle: Math.atan2(end![1] - center![1], end![0] - center![0]), clockwise: false, ...this.#activeLayerPayload() } }))
        this.#setMessage(this.#t('firstPoint'))
      }
      this.#drawOverlay()
      return
    }
    if (!this.#draftStart) { this.#draftStart = world; this.#setMessage(this.#t('nextPoint')); this.#drawOverlay(); return }
    const start = this.#draftStart
    this.#draftStart = null
    if (this.#tool === 'measure') {
      const distance = Math.hypot(world[0] - start[0], world[1] - start[1])
      this.#setMessage(`${this.#t('measured')}: ${distance.toFixed(3)}`)
      this.#drawOverlay()
      return
    }
    if (this.#readOnly) return
    let type = 'LINE', payload: Record<string, unknown> = { start: [...start, 0], end: [...world, 0], ...this.#activeLayerPayload() }
    if (this.#tool === 'circle') {
      type = 'CIRCLE'; payload = { center: [...start, 0], radius: Math.hypot(world[0] - start[0], world[1] - start[1]), ...this.#activeLayerPayload() }
    } else if (this.#tool === 'rectangle') {
      type = 'LWPOLYLINE'; payload = { vertices: [[start[0], start[1], 0], [world[0], start[1], 0], [world[0], world[1], 0], [start[0], world[1], 0]].map(value => ({ point: value })), closed: true, ...this.#activeLayerPayload() }
    }
    await this.#run(() => this.execute('CREATE', { type, payload }))
    this.#setMessage(this.#t('firstPoint'))
    this.#drawOverlay()
  }

  async #finishPolyline(): Promise<void> {
    if (this.#readOnly) return
    if (this.#draftPoints.length < 2) { this.#setMessage(this.#t('nextPoint')); return }
    const vertices = this.#draftPoints.map(value => ({ point: [value[0], value[1], 0] }))
    this.#draftPoints = []
    await this.#run(() => this.execute('CREATE', { type: 'LWPOLYLINE', payload: { vertices, closed: false, ...this.#activeLayerPayload() } }))
    this.#setMessage(this.#t('firstPoint'))
    this.#drawOverlay()
  }

  #cancelPointer(): void {
    const ids = [this.#activePointer, this.#selectionDrag?.pointerId, this.#boxSelection?.pointerId, this.#gripGesture?.pointerId, this.#fencePointer, this.#boundaryPointer?.pointerId]
    const hadGripPreview = this.#gripGesture !== null
    this.#activePointer = null; this.#panStart = null; this.#selectionDrag = null; this.#boxSelection = null; this.#gripGesture = null; this.#hoverGrip = null; this.#fencePointer = null
    this.#boundaryPointer = null
    this.#clearBoundaryPreview()
    for (const id of ids) if (id != null) {
      this.#cancelledPointers.add(id)
      if (this.#canvas.hasPointerCapture(id)) this.#canvas.releasePointerCapture(id)
    }
    this.#canvas.classList.remove('dragging')
    this.#canvas.style.cursor = ''
    if (hadGripPreview) this.renderer.render()
  }

  #pointerOwnerId(): number | null {
    return this.#boundaryPointer?.pointerId ?? this.#gripGesture?.pointerId ?? this.#boxSelection?.pointerId ?? this.#selectionDrag?.pointerId ?? this.#fencePointer ?? this.#activePointer
  }

  #isForeignPointer(event: PointerEvent): boolean {
    const owner = this.#pointerOwnerId()
    return (event.pointerType === 'touch' && !event.isPrimary) || (owner !== null && owner !== event.pointerId)
  }

  #viewIdentity(): string {
    const rect = this.#canvas.getBoundingClientRect(), camera = this.renderer.camera
    return [camera.centerX, camera.centerY, camera.scale, rect.left, rect.top, rect.width, rect.height].join(':')
  }

  #pointerBindingIsCurrent(binding: KJWorkbenchPointerBinding): boolean {
    return this.document === binding.document && this.sdk.documents.get(binding.document.id) === binding.document
      && binding.document.revision === binding.revision && binding.view === this.#viewIdentity()
  }

  #refreshGripPreview(): void {
    const gesture = this.#gripGesture
    if (!gesture) return
    this.renderer.render()
    try {
      const payload = editEntityGrip(gesture.entity, gesture.grip.id, [...gesture.currentWorld, gesture.grip.point[2]])
      this.renderer.drawPreview([{ type: gesture.entity.type, payload }], this.#theme === 'dark' ? '#8fc0ff' : '#175fc8')
    } catch {
      // A transient degenerate position is not a committed edit. GRIPEDIT validates the final position.
    }
  }

  async #finishFence(): Promise<void> {
    const fence = this.#fenceSelection
    if (!fence) return
    if (fence.points.length < 2) { this.#setMessage(this.#t('fenceNeedsPoints')); return }
    if (fence.document !== this.document || fence.document.revision !== fence.revision || this.sdk.documents.get(fence.document.id) !== fence.document) {
      this.setTool('select'); this.#setMessage(this.#t('gestureCancelled')); return
    }
    const ids = this.renderer.selectFence(fence.points.map(value => this.renderer.worldToScreen(value)))
    this.#fenceSelection = null
    await this.#run(() => this.execute('SELECT', { ids: [...ids], operation: fence.operation }, { expectedRevision: fence.revision }))
    if (this.document === fence.document) this.setTool('select')
  }

  #beginTransformGesture(tool: 'move' | 'copy', ids: readonly string[] = this.#selection?.ids ?? []): void {
    const drawing = this.document
    this.#transformGesture = drawing && ids.length
      ? { document: drawing, revision: drawing.revision, ids: Object.freeze([...ids]), operation: tool === 'move' ? 'MOVE' : 'COPY', base: null }
      : null
  }

  #cancelGesture(): void {
    this.#gestureEpoch += 1
    const hadBoundarySession = this.#boundarySession !== null
    this.#boundarySession?.cancel()
    this.#boundarySession = null
    if (hadBoundarySession) this.#canvas.classList.remove('crosshair')
    const hadDraft = this.#draftGesture !== null
    this.#draftGesture?.session.cancel()
    this.#draftGesture = null
    this.#draftStart = null
    this.#draftPoints = []
    this.#transformGesture = null
    this.#modificationGesture = null
    this.#fenceSelection = null
    const dialog = this.root.querySelector<HTMLDialogElement>('[data-modification-dialog]')
    if (dialog?.open) dialog.close()
    const draftDialog = this.root.querySelector<HTMLDialogElement>('[data-draft-dialog]')
    if (draftDialog?.open) draftDialog.close()
    const pageDialog = this.root.querySelector<HTMLDialogElement>('[data-page-dialog]')
    if (pageDialog?.open) pageDialog.close()
    this.#pageBinding = null
    this.#cancelPointer()
    this.#hideSnap()
    if (hadDraft) this.renderer.render()
    this.#syncDraftActions()
    this.#syncBoundaryActions()
    this.#drawOverlay()
  }

  async #eraseSelection(): Promise<void> {
    if (this.#boundarySession) return
    const ids = this.#selection?.ids ?? []
    const drawing = this.document
    if (!ids.length || this.#readOnly || !drawing) return
    const receipt = await this.#run(() => this.execute('ERASE', { ids }))
    if (!receipt) return
    await this.sdk.executeCommand('SELECT', { ids: [], operation: 'clear' }, { document: drawing })
  }

  #drawOverlay(): void {
    const rect = this.#canvas.getBoundingClientRect()
    const width = Math.max(1, this.#canvas.width), height = Math.max(1, this.#canvas.height)
    if (this.#overlay.width !== width) this.#overlay.width = width
    if (this.#overlay.height !== height) this.#overlay.height = height
    const context = this.#overlayContext
    const cssWidth = Math.max(1, rect.width || this.#canvas.clientWidth || width)
    const cssHeight = Math.max(1, rect.height || this.#canvas.clientHeight || height)
    context.setTransform(width / cssWidth, 0, 0, height / cssHeight, 0, 0)
    context.clearRect(0, 0, cssWidth, cssHeight)
    const cursor = this.#cursorWorld
    const screen = (value: Point2): Point2 => this.renderer.worldToScreen(value)
    context.save()
    context.strokeStyle = this.#theme === 'dark' ? '#a4ef55' : '#1769e0'
    context.fillStyle = context.strokeStyle
    context.lineWidth = 1.5
    context.setLineDash([6, 4])
    const grips = this.#tool === 'select' && !this.#readOnly && !this.#modificationGesture && !this.#boundarySession && (this.#selection?.size === 1 || this.#gripGesture) && !this.#boxSelection && !this.#selectionDrag
      ? this.renderer.getGrips(this.#gripGesture ? [this.#gripGesture.entity.id] : undefined) : []
    this.#overlay.dataset.gripCount = String(grips.length)
    this.#overlay.dataset.boundaryPreviewCount = String(this.#boundaryPreview?.pieces.length ?? 0)
    context.setLineDash([])
    for (const grip of grips) {
      const active = this.#gripGesture?.grip.id === grip.id && this.#gripGesture.grip.entityId === grip.entityId
      const hover = this.#hoverGrip?.id === grip.id && this.#hoverGrip.entityId === grip.entityId
      const position = screen(active ? this.#gripGesture!.currentWorld : [grip.point[0], grip.point[1]])
      context.fillStyle = active || hover ? '#ffb547' : '#3985ed'
      context.strokeStyle = this.#theme === 'dark' ? '#c6ddff' : '#123b76'
      context.lineWidth = 1
      context.fillRect(position[0] - 4, position[1] - 4, 8, 8)
      context.strokeRect(position[0] - 4, position[1] - 4, 8, 8)
    }
    const selectionBox = this.#boxSelection ?? (this.#boundaryPointer?.phase === 'boundaries' ? this.#boundaryPointer : null)
    if (selectionBox) {
      const { baseScreen: first, currentScreen: last } = selectionBox
      const crossing = last[0] < first[0]
      this.#overlay.dataset.selectionMode = crossing ? 'crossing' : 'window'
      context.strokeStyle = crossing ? '#43c58b' : '#559bff'
      context.fillStyle = crossing ? 'rgba(67,197,139,0.14)' : 'rgba(85,155,255,0.14)'
      context.lineWidth = 1
      context.setLineDash(crossing ? [6, 4] : [])
      const x = Math.min(first[0], last[0]), y = Math.min(first[1], last[1]), width = Math.abs(last[0] - first[0]), height = Math.abs(last[1] - first[1])
      context.fillRect(x, y, width, height)
      context.strokeRect(x, y, width, height)
      context.restore()
      return
    }
    delete this.#overlay.dataset.selectionMode
    context.strokeStyle = this.#theme === 'dark' ? '#a4ef55' : '#1769e0'
    context.fillStyle = context.strokeStyle
    context.lineWidth = 1.5
    context.setLineDash([6, 4])
    if (this.#gripGesture) {
      const start = screen([this.#gripGesture.grip.point[0], this.#gripGesture.grip.point[1]]), end = screen(this.#gripGesture.currentWorld)
      context.beginPath(); context.moveTo(start[0], start[1]); context.lineTo(end[0], end[1]); context.stroke()
      context.restore()
      return
    }
    const transformBase = this.#selectionDrag?.baseWorld ?? this.#transformGesture?.base ?? null
    const transformCursor = this.#selectionDrag?.currentWorld ?? cursor
    if (this.#fenceSelection) {
      const points = cursor ? [...this.#fenceSelection.points, cursor] : this.#fenceSelection.points
      context.strokeStyle = '#43c58b'
      context.beginPath()
      points.forEach((value, index) => { const p = screen(value); if (index === 0) context.moveTo(p[0], p[1]); else context.lineTo(p[0], p[1]) })
      context.stroke()
      context.setLineDash([])
      for (const value of this.#fenceSelection.points) { const p = screen(value); context.strokeRect(p[0] - 3, p[1] - 3, 6, 6) }
    } else if (transformBase && transformCursor) {
      const start = screen(transformBase), end = screen(transformCursor)
      const dx = transformCursor[0] - transformBase[0], dy = transformCursor[1] - transformBase[1]
      context.beginPath(); context.moveTo(start[0], start[1]); context.lineTo(end[0], end[1]); context.stroke()
      context.setLineDash([])
      context.beginPath(); context.arc(end[0], end[1], 3, 0, Math.PI * 2); context.fill()
      const bounds = this.#selectionBounds(this.#selectionDrag?.ids ?? this.#transformGesture?.ids ?? [])
      if (bounds) {
        const first = screen([bounds.minX + dx, bounds.maxY + dy]), second = screen([bounds.maxX + dx, bounds.minY + dy])
        const x = Math.min(first[0], second[0]), y = Math.min(first[1], second[1])
        const width = Math.abs(second[0] - first[0]), height = Math.abs(second[1] - first[1])
        context.globalAlpha = 0.82
        context.strokeRect(x - 3, y - 3, Math.max(6, width + 6), Math.max(6, height + 6))
        context.globalAlpha = 1
      }
      context.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace'
      context.fillText(`Δ ${dx.toFixed(3)}, ${dy.toFixed(3)}`, end[0] + 8, end[1] - 8)
      context.setLineDash([6, 4])
    } else if (this.#draftGesture?.session.points.length) {
      const points = cursor ? [...this.#draftGesture.session.points, cursor] : this.#draftGesture.session.points
      context.beginPath()
      points.forEach((value, index) => { const projected = screen(value); if (index === 0) context.moveTo(projected[0], projected[1]); else context.lineTo(projected[0], projected[1]) })
      context.stroke()
      for (const value of this.#draftGesture.session.points) { const projected = screen(value); context.strokeRect(projected[0] - 3, projected[1] - 3, 6, 6) }
    } else if (this.#modificationGesture?.points.length) {
      const points = cursor ? [...this.#modificationGesture.points, cursor] : this.#modificationGesture.points
      context.beginPath()
      points.forEach((value, index) => { const projected = screen(value); if (index === 0) context.moveTo(projected[0], projected[1]); else context.lineTo(projected[0], projected[1]) })
      context.stroke()
      for (const value of this.#modificationGesture.points) { const projected = screen(value); context.strokeRect(projected[0] - 3, projected[1] - 3, 6, 6) }
    } else if (this.#tool === 'polyline' && this.#draftPoints.length) {
      const points = cursor ? [...this.#draftPoints, cursor] : this.#draftPoints
      context.beginPath()
      points.forEach((value, index) => { const projected = screen(value); if (index === 0) context.moveTo(projected[0], projected[1]); else context.lineTo(projected[0], projected[1]) })
      context.stroke()
    } else if (this.#tool === 'arc' && this.#draftPoints.length && cursor) {
      const center = this.#draftPoints[0]!, centerScreen = screen(center)
      if (this.#draftPoints.length === 1) {
        const end = screen(cursor); context.beginPath(); context.moveTo(centerScreen[0], centerScreen[1]); context.lineTo(end[0], end[1]); context.stroke()
      } else {
        const start = this.#draftPoints[1]!
        const radius = Math.hypot(start[0] - center[0], start[1] - center[1])
        const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
        const endAngle = Math.atan2(cursor[1] - center[1], cursor[0] - center[0])
        context.beginPath(); context.arc(centerScreen[0], centerScreen[1], radius * this.renderer.camera.scale, -startAngle, -endAngle, true); context.stroke()
      }
    } else if (this.#draftStart && cursor) {
      const start = screen(this.#draftStart), end = screen(cursor)
      if (this.#tool === 'circle') {
        context.beginPath(); context.arc(start[0], start[1], Math.hypot(end[0] - start[0], end[1] - start[1]), 0, Math.PI * 2); context.stroke()
      } else if (this.#tool === 'rectangle') {
        context.strokeRect(start[0], start[1], end[0] - start[0], end[1] - start[1])
      } else {
        context.beginPath(); context.moveTo(start[0], start[1]); context.lineTo(end[0], end[1]); context.stroke()
      }
    } else if (this.#tool === 'text' && cursor) {
      const insertion = screen(cursor)
      context.setLineDash([])
      context.font = '13px ui-monospace, SFMono-Regular, Consolas, monospace'
      context.fillText(this.#pendingText, insertion[0] + 5, insertion[1] - 5)
      context.beginPath(); context.moveTo(insertion[0] - 4, insertion[1]); context.lineTo(insertion[0] + 4, insertion[1]); context.moveTo(insertion[0], insertion[1] - 4); context.lineTo(insertion[0], insertion[1] + 4); context.stroke()
    }
    context.setLineDash([])
    for (const value of this.#draftPoints) { const projected = screen(value); context.strokeRect(projected[0] - 3, projected[1] - 3, 6, 6) }
    context.restore()
  }

  #refreshViewport(): void {
    this.#refreshHatchWarning()
    const zoom = this.root.querySelector<HTMLElement>('[data-zoom]')
    if (zoom) zoom.textContent = `${Math.round(this.renderer.camera.scale * 100)}%`
    if (this.#snapWorld) this.#showSnap(this.#snapWorld)
    this.#refreshDraftPreview()
    this.#drawOverlay()
  }

  #refreshSelectionPanels(): void {
    const selection = this.#selection
    const output = this.root.querySelector<HTMLElement>('[data-selection]')
    if (output) output.textContent = `${selection?.size ?? 0} ${this.#t('selected')}`
    const erase = this.root.querySelector<HTMLButtonElement>('[data-action="erase"]')
    if (erase) erase.disabled = this.#readOnly === true || this.#boundarySession !== null || !(selection?.size)
    this.#refreshInspector()
  }

  #refreshDocumentPanels(): void {
    const drawing = this.document
    if (!drawing) return
    this.#syncDrawingLayouts()
    this.#syncEditability()
    this.#snappableEntityIds = this.#visibleModelEntityIds()
    const name = this.root.querySelector<HTMLElement>('[data-document-name]')
    if (name) name.textContent = this.#options.title ?? String(drawing.metadata.title ?? drawing.id)
    const count = drawing.listEntities().length
    const set = (selector: string, value: string) => { const element = this.root.querySelector<HTMLElement>(selector); if (element) element.textContent = value }
    set('[data-count]', `${count.toLocaleString()} ${this.#t('entities')}`)
    set('[data-revision]', `REV ${drawing.revision}`)
    const undo = this.root.querySelector<HTMLButtonElement>('[data-action="undo"]'), redo = this.root.querySelector<HTMLButtonElement>('[data-action="redo"]')
    if (undo) undo.disabled = this.#readOnly === true || !drawing.history.canUndo
    if (redo) redo.disabled = this.#readOnly === true || !drawing.history.canRedo
    this.#syncOrtho()
    this.#refreshLayers()
    this.#refreshSelectionPanels()
    this.#refreshViewport()
  }

  #refreshLayers(): void {
    const host = this.root.querySelector<HTMLElement>('[data-layers]'), drawing = this.document
    if (!host || !drawing) return
    host.replaceChildren()
    const counts = new Map<string, number>()
    for (const entity of drawing.listEntities()) counts.set(String(entity.payload.layerId ?? ''), (counts.get(String(entity.payload.layerId ?? '')) ?? 0) + 1)
    for (const layer of drawing.getTable('layers')?.records ?? []) {
      const row = document.createElement('div'); row.className = 'layer'; row.dataset.layerId = layer.id
      const label = document.createElement('label'); label.className = 'layer-name'
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = layer.payload.visible !== false; input.disabled = this.#readOnly === true
      input.title = `${this.#t(input.checked ? 'hideLayer' : 'showLayer')}: ${layer.name ?? '0'}`
      input.setAttribute('aria-label', input.title)
      input.addEventListener('change', () => void this.#run(() => this.execute('LAYERUPDATE', { id: layer.id, patch: { visible: input.checked } })), { signal: this.#abort.signal })
      const name = document.createElement('span'); name.textContent = layer.name ?? '0'
      name.title = name.textContent
      const count = document.createElement('small'); count.textContent = String(counts.get(layer.id) ?? 0)
      label.append(input, name)
      const controls = (['locked', 'frozen'] as const).map(property => {
        const active = layer.payload[property] === true
        const button = document.createElement('button'); button.type = 'button'; button.className = 'layer-state'; button.dataset.layerProperty = property
        button.disabled = this.#readOnly === true
        button.title = `${this.#t(property === 'locked' ? active ? 'unlockLayer' : 'lockLayer' : active ? 'thawLayer' : 'freezeLayer')}: ${layer.name ?? '0'}`
        button.setAttribute('aria-label', button.title); button.setAttribute('aria-pressed', String(active))
        button.innerHTML = property === 'locked' ? kjdrawIcon(active ? 'lock' : 'unlock') : active
          ? '<svg class="kj-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M3.34 7l17.32 10M3.34 17 20.66 7M9 4l3 3 3-3M9 20l3-3 3 3M3.5 10.5l4-1-1-4M17.5 18.5l-1-4 4-1M6.5 18.5l1-4-4-1M20.5 10.5l-4-1 1-4"/></svg>'
          : kjdrawIcon('sun')
        button.addEventListener('click', () => void this.#run(() => this.execute('LAYERUPDATE', { id: layer.id, patch: { [property]: !active } })), { signal: this.#abort.signal })
        return button
      })
      row.append(label, ...controls, count); host.append(row)
    }
  }

  #refreshInspector(): void {
    const host = this.root.querySelector<HTMLElement>('[data-inspector]'), drawing = this.document
    if (!host || !drawing) return
    host.replaceChildren()
    const selectedEntities = (this.#selection?.ids ?? []).map(id => drawing.getObject(id)).filter((item): item is KJReadonlyObjectRecord => item?.kind === 'entity')
    const entity = selectedEntities.at(-1) ?? null
    if (!entity || entity.kind !== 'entity') { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = this.#t('noSelection'); host.append(empty); return }
    const multiple = selectedEntities.length > 1
    const title = document.createElement('div'); title.className = 'entity-title'; title.textContent = multiple ? `${selectedEntities.length} ${this.#t('selected')}` : entity.type
    host.append(title, this.#kv('Handle', entity.handle), this.#kv(this.#t('layer'), drawing.getObject(String(entity.payload.layerId ?? ''))?.name ?? '0'))
    const layerField = document.createElement('label'); layerField.className = 'field'; layerField.innerHTML = `<span>${this.#t('layer')}</span>`
    const layerSelect = document.createElement('select'); layerSelect.disabled = this.#readOnly === true
    const layerIds = new Set(selectedEntities.map(item => String(item.payload.layerId ?? '')))
    const commonLayerId = layerIds.size === 1 ? [...layerIds][0]! : ''
    if (!commonLayerId) {
      const option = document.createElement('option'); option.value = ''; option.textContent = '—'; option.selected = true; option.disabled = true; layerSelect.append(option)
    }
    for (const layer of drawing.getTable('layers')?.records ?? []) {
      const option = document.createElement('option'); option.value = layer.id; option.textContent = layer.name ?? '0'; option.selected = commonLayerId === layer.id; layerSelect.append(option)
    }
    layerField.append(layerSelect); host.append(layerField)
    let valueInput: HTMLInputElement | null = null
    if (!multiple && (entity.type === 'CIRCLE' || entity.type === 'ARC')) {
      const field = document.createElement('label'); field.className = 'field'; field.innerHTML = `<span>${this.#t('radius')}</span>`
      valueInput = document.createElement('input'); valueInput.type = 'number'; valueInput.min = '0.000001'; valueInput.step = '0.1'; valueInput.value = String(entity.payload.radius ?? ''); valueInput.disabled = this.#readOnly === true; field.append(valueInput); host.append(field)
    } else if (!multiple && ['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB'].includes(entity.type)) {
      const field = document.createElement('label'); field.className = 'field'; field.innerHTML = `<span>${this.#t('text')}</span>`
      valueInput = document.createElement('input'); valueInput.value = String(entity.payload.text ?? ''); valueInput.disabled = this.#readOnly === true; field.append(valueInput); host.append(field)
    }
    if (!this.#readOnly) {
      const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'apply'; apply.textContent = this.#t('apply')
      apply.addEventListener('click', () => void this.#run(async () => {
        if (multiple) {
          if (!layerSelect.value || layerSelect.value === commonLayerId) return
          await this.execute('PROPERTIES', { ids: selectedEntities.map(item => item.id), patch: { payload: { layerId: layerSelect.value } } })
          return
        }
        const payload: Record<string, unknown> = { ...structuredClone(entity.payload), layerId: layerSelect.value }
        if (valueInput && (entity.type === 'CIRCLE' || entity.type === 'ARC')) payload.radius = Number(valueInput.value)
        if (valueInput && ['TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB'].includes(entity.type)) payload.text = valueInput.value
        await this.execute('PROPERTIES', { id: entity.id, patch: { payload } })
      }), { signal: this.#abort.signal })
      host.append(apply)
    }
    if (this.renderer.report.unsupported) { const warning = document.createElement('div'); warning.className = 'warning'; warning.textContent = `${this.renderer.report.unsupportedTypes.join(', ')} · ${this.#t('unsupported')}`; host.append(warning) }
    const warning = document.createElement('div'); warning.className = 'warning'; warning.dataset.hatchWarning = ''; warning.setAttribute('role', 'status'); host.append(warning)
    this.#refreshHatchWarning()
  }

  #refreshHatchWarning(): void {
    const warning = this.root.querySelector<HTMLElement>('[data-hatch-warning]')
    if (!warning) return
    const denseHatches = this.renderer.report.hatchDiagnostics?.filter(item => item.reason === 'budget').length ?? 0
    warning.hidden = denseHatches === 0
    if (denseHatches) {
      warning.textContent = this.#locale === 'zh-CN' ? `${denseHatches} 个填充过密，当前仅显示部分图案。请放大查看。` : `${denseHatches} dense hatches are partially displayed. Zoom in to inspect their patterns.`
    }
  }

  #kv(label: string, value: unknown): HTMLElement {
    const row = document.createElement('div'); row.className = 'kv'
    const key = document.createElement('span'); key.textContent = label
    const output = document.createElement('b'); output.textContent = String(value ?? '—')
    row.append(key, output); return row
  }

  #updateCopy(): void {
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-copy]')) {
      const key = element.dataset.copy as keyof typeof copy.en
      if (Object.prototype.hasOwnProperty.call(copy.en, key)) element.textContent = this.#t(key)
    }
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-copy-title]')) {
      const key = element.dataset.copyTitle as keyof typeof copy.en
      if (!Object.prototype.hasOwnProperty.call(copy.en, key)) continue
      element.title = this.#t(key)
      element.setAttribute('aria-label', this.#t(key))
    }
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-draft-label]')) {
      const tool = element.dataset.draftLabel as KJDraftTool
      if (draftToolText[tool]) element.textContent = this.#localizedControlText(draftToolText[tool])
    }
    const file = this.root.querySelector<HTMLInputElement>('[data-file]')
    if (file) file.setAttribute('aria-label', this.#t('open'))
    const layout = this.root.querySelector<HTMLSelectElement>('[data-layout]')
    if (layout) { layout.setAttribute('aria-label', this.#t('layout')); layout.title = this.#t('layout') }
    const command = this.root.querySelector<HTMLInputElement>('[data-command]')
    if (command) {
      command.setAttribute('aria-label', this.#t('command'))
      command.placeholder = this.#t('commandHint')
    }
    this.#renderModificationForm()
    this.#renderDraftForm()
    const modificationDialog = this.root.querySelector<HTMLDialogElement>('[data-modification-dialog]')
    if (modificationDialog) modificationDialog.setAttribute('aria-label', this.#t('modifyTitle'))
    const draftDialog = this.root.querySelector<HTMLDialogElement>('[data-draft-dialog]')
    if (draftDialog) draftDialog.setAttribute('aria-label', this.#t('drawTitle'))
    const pageDialog = this.root.querySelector<HTMLDialogElement>('[data-page-dialog]')
    if (pageDialog) pageDialog.setAttribute('aria-label', this.#t('pageSetup'))
    this.#syncDraftActions()
    this.#canvas.setAttribute('aria-label', `${this.#t('drawing')} · KJDraw CAD`)
  }

  #t(key: keyof typeof copy.en): string { return String(copy[this.#locale][key]) }
  #showFileProgress(progress: Readonly<KJFileReadProgress>): void {
    const label = this.#t(progress.phase === 'source' ? 'openSource' : progress.phase === 'parse' ? 'openParse' : 'openImport')
    const amount = progress.total && progress.total > 0 ? `${Math.min(100, Math.floor(progress.completed / progress.total * 100))}%` : progress.completed.toLocaleString()
    this.#setMessage(`${label} · ${amount} · ${this.#t('openCancelHint')}`)
  }
  #setMessage(value: string): void { this.#message = value; const message = this.root.querySelector<HTMLElement>('[data-message]'); if (message) message.textContent = value; const hint = this.root.querySelector<HTMLElement>('[data-hint]'); if (hint) hint.textContent = value }
  #handleError(error: unknown): void { this.#setMessage(error instanceof Error ? error.message : String(error)); this.#options.onError?.(error); this.root.dispatchEvent(new CustomEvent('kjdraw:error', { detail: error, bubbles: true, composed: true })) }
  async #run<Result>(operation: () => Result | Promise<Result>): Promise<Result | null> { try { return await operation() } catch (error) { this.#handleError(error); return null } }
}

export function mountKJDrawWorkbench(container: HTMLElement | ShadowRoot, options: KJDrawWorkbenchOptions = {}): KJDrawWorkbench {
  return new KJDrawWorkbench(container, options)
}

export function defineKJDrawWorkbenchElement(tagName = 'kjdraw-workbench'): CustomElementConstructor {
  assertBrowser()
  const normalized = String(tagName).trim().toLowerCase()
  const existing = customElements.get(normalized)
  if (existing) return existing
  class KJDrawWorkbenchElement extends HTMLElement {
    instance: KJDrawWorkbench | null = null
    connectedCallback(): void {
      if (this.instance) return
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
      const locale = this.getAttribute('locale') === 'zh-CN' ? 'zh-CN' : 'en'
      const theme = this.getAttribute('theme') === 'light' ? 'light' : 'dark'
      this.instance = mountKJDrawWorkbench(root, { locale, theme, readonly: this.hasAttribute('readonly') })
    }
    disconnectedCallback(): void { this.instance?.dispose(); this.instance = null }
  }
  customElements.define(normalized, KJDrawWorkbenchElement)
  return KJDrawWorkbenchElement
}
