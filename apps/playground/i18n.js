const messages = {
  en: {
    output: 'OUTPUT', pageSetup: 'Page setup', printDrawing: 'Print / PDF',
    preview: '1.0 RELEASE CANDIDATE', docs: 'Documentation ↗', github: 'GitHub ↗', language: '中文',
    open: 'Open DXF / KJD / KJP', openShort: 'Open', snapshot: 'Snapshot', save: 'Download KJP', saveShort: 'Save KJP', saveLocalShort: 'Save local', export: 'Export DXF ↗', exportShort: 'DXF', memory: 'In memory', file: 'FILE', view: 'VIEW', construct: 'CONSTRUCT',
    home: 'HOME', draw: 'DRAW', modify: 'MODIFY', inspect: 'INSPECT', command: 'COMMAND', undo: 'Undo', redo: 'Redo',
    layout: 'Workbench layout', layout_classic: 'Classic', layout_compact: 'Compact', layout_focus: 'Focus',
    navigation: 'Canvas navigation', pan: 'Pan', zoomIn: 'Zoom in', zoomOut: 'Zoom out', panHint: 'Drag to pan · scroll to zoom · V to select',
    moveChoose: 'Select an object to move or copy', moveBase: 'Pick the base point', moveTarget: 'Pick the target point, or type MOVE dx dy', selectFirst: 'Select an object on the drawing first.', drawingChanged: 'The drawing changed. Start the move again.', translationNumbers: 'Enter both X and Y offsets, for example MOVE 10 0.',
    select: 'Select', line: 'Line', polyline: 'Polyline', circle: 'Circle', arc: 'Arc', text: 'Text', rectangle: 'Rectangle', ellipse: 'Ellipse', point: 'Point', xline: 'XLine',
    move: 'Move', copy: 'Copy', rotate: 'Rotate', offset: 'Offset', delete: 'Delete', distance: 'Distance', lengthArea: 'Length / area', fit: 'Fit view', run: 'Run',
    commandPlaceholder: 'Type a command: MOVE 5 0 · OFFSET 2 · LENGTH', project: 'PROJECT', layers: 'LAYERS', workspace: 'LOCAL WORKSPACE',
    sampleLibrary: 'SAMPLE DRAWINGS', chooseIndustry: 'Choose a discipline', sidePanel: 'Side panel', layerUnit: 'layers', closePanel: 'Close panel', showAllLayers: 'Show all layers', newLayer: 'Create layer',
    localHelp: 'Open or drop DXF / KJD / KJP. Files stay in this browser.', reload: 'Reload samples', inspector: 'PROPERTIES', agentPanel: 'Agent review',
    agent: 'AI CHAT', agentTitle: 'Review drawing changes', agentHelp: 'Preview an example change on the drawing, then apply it or keep the original.', ready: 'Ready',
    taskPreset: 'Example change', presetService: 'Re-plan east service yard', presetFire: 'Open an emergency corridor', presetInspect: 'Add an inspection buffer',
    naturalIntent: 'Change description', agentProtocolHelp: 'This example uses three predefined changes, not a connected AI model. Ctrl/⌘ + Enter previews the selected change.',
    openAgentSample: 'Open the energy campus example', agentSampleRequired: 'Open the energy campus drawing to review this example change.',
    searchLayers: 'Search layers', noLayersFound: 'No matching layers', showLayer: 'Show layer', hideLayer: 'Hide layer', editLayer: 'Layer settings', layerName: 'Layer name', layerColor: 'Color index (1–255)', layerColorRange: 'Enter a whole color index from 1 to 255.',
    inspectHint: 'Select an object to edit its properties. Hold Shift to add objects to the selection.', resizeLayers: 'Resize layers panel', resizeProperties: 'Resize properties panel',
    previewAction: 'Preview changes', previewHelp: 'Choose a scenario to see the proposed changes on the drawing.', clearPlan: 'Clear', confirm: 'Approve & apply changes',
    liveDiff: 'CHANGE PREVIEW', diffMove: 'Move', diffDelete: 'Remove', diffAdd: 'Add', protocolEnvelope: 'Technical details', receiptTitle: 'Change applied', undoResult: 'Undo change', saveProject: 'Save .KJP', verifyReopen: 'Check saved file',
    localDialog: 'LOCAL COMMAND', cancel: 'Cancel', continue: 'Continue',
    modelSpace: 'MODEL SPACE', top2d: 'TOP / 2D', canvasHint: 'Drag empty space to select · Shift adds · Ctrl/⌘ removes · drag a grip to reshape', drop: 'Drop DXF / KJD / KJP to open locally',
    visibleLayer: 'Visible', lockedLayer: 'Locked (protect from edits)', freezeLayer: 'Frozen (uncheck to thaw)', frozenLayer: 'Frozen', lockLayer: 'Lock layer', unlockLayer: 'Unlock layer', fence: 'Fence selection', fenceHint: 'Pick fence points · Enter selects crossed objects · Backspace undoes a point · Esc cancels',
    windowHint: 'Window: fully enclosed objects · Shift adds · Ctrl/⌘ removes', crossingHint: 'Crossing: enclosed or crossed objects · Shift adds · Ctrl/⌘ removes',
    gripHint: 'Drag the grip to reshape · object snap and Ortho apply · Esc cancels', gripApplied: 'Grip edit applied · Undo restores the original geometry', interactionChanged: 'Drawing or view changed. The unfinished selection or grip edit was cancelled.',
    selected: 'selected', entities: 'entities', gridOn: 'GRID ON', gridOff: 'GRID OFF', orthoOn: 'ORTHO ON', orthoOff: 'ORTHO OFF', polarOn: 'POLAR 45°', polarOff: 'POLAR OFF', polarBusy: 'Finish or cancel the current operation before changing Polar tracking', snapOn: 'SNAP ON', snapOff: 'SNAP OFF', snap_endpoint: 'Endpoint', snap_midpoint: 'Midpoint', snap_center: 'Center', snap_quadrant: 'Quadrant', snap_intersection: 'Intersection', snap_perpendicular: 'Perpendicular', snap_tangent: 'Tangent', snap_insertion: 'Insertion', snap_node: 'Node', snap_nearest: 'Nearest', loading: 'Loading local SDK…',
    drawingDocument: 'Drawing document', objectsSelected: 'objects selected', primary: 'Primary', groupHint: 'transforms and delete apply to all selected objects',
    handle: 'Handle', layer: 'Layer', radius: 'Radius', textField: 'Text', applyProperties: 'Apply properties', deleteSelected: 'Delete selected', blockEditScope: 'Edit scope', blockInstanceScope: 'This instance', blockDefinitionScope: 'Shared definition', blockMember: 'Definition member', blockScopeHint: 'Instance changes affect this occurrence. Definition changes affect every instance.', hatchEdit: 'Edit hatch', hatchEditHelp: 'Edit the selected hatch in one undoable transaction. Polygon islands close automatically; do not repeat the first vertex.', hatchOperation: 'Operation', hatchPatternOnly: 'Pattern only', hatchAddIsland: 'Add island', hatchReplaceIsland: 'Replace island', hatchRemoveIsland: 'Remove island', hatchIsland: 'Inner island', hatchVertices: 'Island vertices (x,y; x,y; …)', hatchScale: 'Pattern scale', hatchAngle: 'Pattern angle (degrees)', hatchApply: 'Apply hatch edit',
    revision: 'Revision', modelEntities: 'Model entities', kernel: 'Kernel', units: 'Units', jsReference: 'JS reference',
    githubTitle: 'Open source repository', docsTitle: 'Developer documentation', languageTitle: 'Switch language'
  },
  zh: {
    output: '出图', pageSetup: '页面设置', printDrawing: '打印 / PDF',
    preview: '1.0 候选版', docs: '开发文档 ↗', github: 'GitHub ↗', language: 'EN',
    open: '打开 DXF / KJD / KJP', openShort: '打开', snapshot: '快照', save: '下载 KJP', saveShort: '保存 KJP', saveLocalShort: '保存到本地', export: '导出 DXF ↗', exportShort: '导出 DXF', memory: '仅在内存中', file: '文件', view: '视图', construct: '构造',
    home: '常用', draw: '绘图', modify: '修改', inspect: '测量', command: '命令行', undo: '撤销', redo: '重做',
    layout: '工作台布局', layout_classic: '经典布局', layout_compact: '紧凑布局', layout_focus: '专注布局',
    navigation: '画布导航', pan: '平移', zoomIn: '放大', zoomOut: '缩小', panHint: '按住拖动画布 · 滚轮缩放 · V 返回选择',
    moveChoose: '选择要移动或复制的对象', moveBase: '指定基点', moveTarget: '指定目标点，或输入 MOVE dx dy', selectFirst: '请先在图纸上选择一个对象。', drawingChanged: '图纸已改变，请重新开始移动。', translationNumbers: '请输入 X 和 Y 两个位移值，例如 MOVE 10 0。',
    select: '选择', line: '直线', polyline: '多段线', circle: '圆', arc: '圆弧', text: '文字', rectangle: '矩形', ellipse: '椭圆', point: '点', xline: '构造线',
    move: '移动', copy: '复制', rotate: '旋转', offset: '偏移', delete: '删除', distance: '距离', lengthArea: '长度 / 面积', fit: '全图', run: '执行',
    commandPlaceholder: '输入命令：MOVE 5 0 · OFFSET 2 · LENGTH', project: '工程图纸', layers: '图层', workspace: '本地工作区',
    sampleLibrary: '行业样例', chooseIndustry: '选择专业图纸', sidePanel: '侧边栏', layerUnit: '个图层', closePanel: '关闭面板', showAllLayers: '显示全部图层', newLayer: '新建图层',
    localHelp: '打开或拖入 DXF / KJD / KJP，文件始终留在本浏览器。', reload: '重新加载样例库', inspector: '特性', agentPanel: 'Agent 审核',
    agent: 'AI 对话', agentTitle: '审核图纸修改', agentHelp: '先查看图纸上的修改预览，再决定应用修改，或保留原图。', ready: '就绪',
    taskPreset: '修改示例', presetService: '重排东侧服务场', presetFire: '打开消防应急通道', presetInspect: '增设设备巡检缓冲区',
    naturalIntent: '修改说明', agentProtocolHelp: '这里提供三个预设修改示例，未连接 AI 模型。按 Ctrl/⌘ + Enter 预览所选修改。',
    openAgentSample: '打开能源园区示例', agentSampleRequired: '打开能源园区图纸，即可审核这项示例修改。',
    searchLayers: '搜索图层', noLayersFound: '没有匹配的图层', showLayer: '显示图层', hideLayer: '隐藏图层', editLayer: '图层设置', layerName: '图层名称', layerColor: '颜色索引（1–255）', layerColorRange: '请输入 1 到 255 之间的整数颜色索引。',
    inspectHint: '选择图纸中的对象，即可编辑特性。按住 Shift 可追加选择多个对象。', resizeLayers: '调整图层面板宽度', resizeProperties: '调整特性面板宽度',
    previewAction: '预览修改', previewHelp: '选择一个场景，在真正修改前先查看图上差异。', clearPlan: '清除', confirm: '确认并应用修改',
    liveDiff: '修改预览', diffMove: '移动', diffDelete: '删除', diffAdd: '新增', protocolEnvelope: '技术详情', receiptTitle: '修改已应用', undoResult: '撤销修改', saveProject: '保存 .KJP', verifyReopen: '检查保存结果',
    localDialog: '本地命令', cancel: '取消', continue: '继续',
    modelSpace: '模型空间', top2d: '俯视 / 二维', canvasHint: '空白拖动框选 · Shift 增选 · Ctrl/⌘ 减选 · 拖动夹点修改形状', drop: '拖入 DXF / KJD / KJP，在本地打开',
    visibleLayer: '显示图层', lockedLayer: '锁定（保护对象不被编辑）', freezeLayer: '冻结（取消勾选以解冻）', frozenLayer: '已冻结', lockLayer: '锁定图层', unlockLayer: '解锁图层', fence: '围栏选择', fenceHint: '依次指定围栏点 · Enter 选择相交对象 · Backspace 撤回一点 · Esc 取消',
    windowHint: '窗口选择：完全包含的对象 · Shift 增选 · Ctrl/⌘ 减选', crossingHint: '交叉选择：包含或相交的对象 · Shift 增选 · Ctrl/⌘ 减选',
    gripHint: '拖动夹点修改形状 · 支持对象捕捉和正交 · Esc 取消', gripApplied: '夹点修改已应用 · 可一次撤销恢复原始几何', interactionChanged: '图纸或视图已改变，未完成的选择或夹点修改已取消。',
    selected: '个已选择', entities: '个对象', gridOn: '栅格 开', gridOff: '栅格 关', orthoOn: '正交 开', orthoOff: '正交 关', polarOn: '极轴 45°', polarOff: '极轴 关', polarBusy: '请先完成或取消当前操作，再切换极轴跟踪', snapOn: '捕捉 开', snapOff: '捕捉 关', snap_endpoint: '端点', snap_midpoint: '中点', snap_center: '圆心', snap_quadrant: '象限点', snap_intersection: '交点', snap_perpendicular: '垂足', snap_tangent: '切点', snap_insertion: '插入点', snap_node: '节点', snap_nearest: '最近点', loading: '正在加载本地 SDK…',
    drawingDocument: '图纸文档', objectsSelected: '个对象已选择', primary: '主对象', groupHint: '移动、复制、旋转和删除将应用到全部已选对象',
    handle: '句柄', layer: '图层', radius: '半径', textField: '文字', applyProperties: '应用特性', deleteSelected: '删除已选对象', blockEditScope: '修改范围', blockInstanceScope: '仅此实例', blockDefinitionScope: '共享块定义', blockMember: '定义成员', blockScopeHint: '实例修改仅影响当前对象；定义修改会影响全部实例。', hatchEdit: '编辑填充', hatchEditHelp: '在一个可撤销事务中修改选中填充。多边形内岛会自动闭合，请勿重复首点。', hatchOperation: '操作', hatchPatternOnly: '仅修改图案', hatchAddIsland: '新增内岛', hatchReplaceIsland: '替换内岛', hatchRemoveIsland: '删除内岛', hatchIsland: '内岛边界', hatchVertices: '内岛顶点（x,y; x,y; …）', hatchScale: '图案比例', hatchAngle: '图案角度（度）', hatchApply: '应用填充修改',
    revision: '版本', modelEntities: '模型对象', kernel: '几何内核', units: '单位', jsReference: 'JavaScript 参考实现',
    githubTitle: '打开源代码仓库', docsTitle: '打开开发文档', languageTitle: '切换语言'
  }
}

export function createI18n() {
  const stored = localStorage.getItem('kjdraw.language')
  let locale = stored === 'zh' || stored === 'en' ? stored : (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en')
  const t = key => messages[locale][key] ?? messages.en[key] ?? key
  const apply = () => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n)
    for (const element of document.querySelectorAll('[data-i18n-title]')) element.title = t(element.dataset.i18nTitle)
    for (const element of document.querySelectorAll('[data-i18n-label]')) element.setAttribute('aria-label', t(element.dataset.i18nLabel))
    for (const element of document.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = t(element.dataset.i18nPlaceholder)
    document.dispatchEvent(new CustomEvent('kjdraw:language', { detail: { locale } }))
  }
  const toggle = () => { locale = locale === 'zh' ? 'en' : 'zh'; localStorage.setItem('kjdraw.language', locale); apply() }
  return { t, apply, toggle, get locale() { return locale } }
}
