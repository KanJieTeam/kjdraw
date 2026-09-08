const messages = {
  en: {
    preview: '1.0 RELEASE CANDIDATE', docs: 'Documentation ↗', github: 'GitHub ↗', language: '中文',
    open: 'Open DXF / KJD / KJP', openShort: 'Open', snapshot: 'Snapshot', save: 'Download KJP', saveShort: 'Save KJP', export: 'Export DXF ↗', exportShort: 'DXF', memory: 'In memory', file: 'FILE', view: 'VIEW', construct: 'CONSTRUCT',
    home: 'HOME', draw: 'DRAW', modify: 'MODIFY', inspect: 'INSPECT', command: 'COMMAND',
    select: 'Select', line: 'Line', polyline: 'Polyline', circle: 'Circle', arc: 'Arc', text: 'Text', rectangle: 'Rectangle', ellipse: 'Ellipse', point: 'Point', xline: 'XLine',
    move: 'Move', copy: 'Copy', rotate: 'Rotate', offset: 'Offset', delete: 'Delete', distance: 'Distance', lengthArea: 'Length / area', fit: 'Fit view', run: 'Run',
    commandPlaceholder: 'Type a command: MOVE 5 0 · OFFSET 2 · LENGTH', project: 'PROJECT', layers: 'LAYERS', workspace: 'LOCAL WORKSPACE',
    localHelp: 'Open or drop DXF / KJD / KJP. Files stay in this browser.', reload: 'Reload sample', inspector: 'PROPERTIES', agentPanel: 'Agent review',
    agent: 'AGENT REVIEW', agentTitle: 'Describe → diff → approve → receipt.', agentHelp: 'Deterministic protocol demo. No model, API key, or hidden service.',
    taskPreset: '90-second scenario', presetService: 'Re-plan east service yard', presetFire: 'Open an emergency corridor', presetInspect: 'Add an inspection buffer',
    naturalIntent: 'Natural-language intent', agentProtocolHelp: 'A local preset compiler turns this sentence into exact public-SDK arguments. Ctrl/⌘ + Enter previews.',
    previewAction: 'Build exact plan', previewHelp: 'Choose a scenario, then review the exact diff before anything changes.', clearPlan: 'Clear', confirm: 'Approve & commit atomically',
    liveDiff: 'LIVE DIFF', diffMove: 'Move', diffDelete: 'Delete', diffAdd: 'Add', protocolEnvelope: 'Protocol envelope', receiptTitle: 'Verified receipt', undoResult: 'Undo result', saveProject: 'Save .KJP', verifyReopen: 'Verify reopen',
    localDialog: 'LOCAL COMMAND', cancel: 'Cancel', continue: 'Continue',
    modelSpace: 'MODEL SPACE', top2d: 'TOP / 2D', canvasHint: 'Scroll to zoom · middle-drag to pan · click to inspect', drop: 'Drop DXF / KJD / KJP to open locally',
    selected: 'selected', entities: 'entities', gridOn: 'GRID ON', gridOff: 'GRID OFF', orthoOn: 'ORTHO ON', orthoOff: 'ORTHO OFF', snapOn: 'SNAP ON', snapOff: 'SNAP OFF', loading: 'Loading local SDK…',
    drawingDocument: 'Drawing document', objectsSelected: 'objects selected', primary: 'Primary', groupHint: 'transforms and delete apply to all selected objects',
    handle: 'Handle', layer: 'Layer', radius: 'Radius', textField: 'Text', applyProperties: 'Apply properties', deleteSelected: 'Delete selected',
    revision: 'Revision', modelEntities: 'Model entities', kernel: 'Kernel', units: 'Units', jsReference: 'JS reference',
    githubTitle: 'Open source repository', docsTitle: 'Developer documentation', languageTitle: 'Switch language'
  },
  zh: {
    preview: '1.0 候选版', docs: '开发文档 ↗', github: 'GitHub ↗', language: 'EN',
    open: '打开 DXF / KJD / KJP', openShort: '打开', snapshot: '快照', save: '下载 KJP', saveShort: '保存 KJP', export: '导出 DXF ↗', exportShort: '导出 DXF', memory: '仅在内存中', file: '文件', view: '视图', construct: '构造',
    home: '常用', draw: '绘图', modify: '修改', inspect: '测量', command: '命令行',
    select: '选择', line: '直线', polyline: '多段线', circle: '圆', arc: '圆弧', text: '文字', rectangle: '矩形', ellipse: '椭圆', point: '点', xline: '构造线',
    move: '移动', copy: '复制', rotate: '旋转', offset: '偏移', delete: '删除', distance: '距离', lengthArea: '长度 / 面积', fit: '全图', run: '执行',
    commandPlaceholder: '输入命令：MOVE 5 0 · OFFSET 2 · LENGTH', project: '工程图纸', layers: '图层', workspace: '本地工作区',
    localHelp: '打开或拖入 DXF / KJD / KJP，文件始终留在本浏览器。', reload: '重新加载示例', inspector: '特性', agentPanel: 'Agent 审核',
    agent: 'AGENT 审核', agentTitle: '描述 → 差异 → 批准 → 回执', agentHelp: '确定性协议演示，不连接模型、API Key 或隐藏服务。',
    taskPreset: '90 秒场景', presetService: '重排东侧服务场', presetFire: '打开消防应急通道', presetInspect: '增设设备巡检缓冲区',
    naturalIntent: '自然语言意图', agentProtocolHelp: '本地预设编译器把这句话转换成精确的公开 SDK 参数。Ctrl/⌘ + Enter 预览。',
    previewAction: '生成精确计划', previewHelp: '选择场景，先审核精确差异；此时图纸不会改变。', clearPlan: '清除', confirm: '批准并原子提交',
    liveDiff: '实时差异', diffMove: '移动', diffDelete: '删除', diffAdd: '新增', protocolEnvelope: '协议载荷', receiptTitle: '可验证回执', undoResult: '撤销结果', saveProject: '保存 .KJP', verifyReopen: '验证重开',
    localDialog: '本地命令', cancel: '取消', continue: '继续',
    modelSpace: '模型空间', top2d: '俯视 / 二维', canvasHint: '滚轮缩放 · 中键拖动画布 · 单击检查对象', drop: '拖入 DXF / KJD / KJP，在本地打开',
    selected: '个已选择', entities: '个对象', gridOn: '栅格 开', gridOff: '栅格 关', orthoOn: '正交 开', orthoOff: '正交 关', snapOn: '捕捉 开', snapOff: '捕捉 关', loading: '正在加载本地 SDK…',
    drawingDocument: '图纸文档', objectsSelected: '个对象已选择', primary: '主对象', groupHint: '移动、复制、旋转和删除将应用到全部已选对象',
    handle: '句柄', layer: '图层', radius: '半径', textField: '文字', applyProperties: '应用特性', deleteSelected: '删除已选对象',
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
    for (const element of document.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = t(element.dataset.i18nPlaceholder)
    document.dispatchEvent(new CustomEvent('kjdraw:language', { detail: { locale } }))
  }
  const toggle = () => { locale = locale === 'zh' ? 'en' : 'zh'; localStorage.setItem('kjdraw.language', locale); apply() }
  return { t, apply, toggle, get locale() { return locale } }
}
