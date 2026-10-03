import { createAiChatRuntime } from './runtime.js'
import { loadLocalHistory, saveLocalHistory } from './local-history.js'
import { geologySourceChanges } from './geology-source-changes.js'
import { createDrawingViewer } from './drawing-viewer.js'
import { renderMessageMarkdown } from './message-markdown.js'
import { CHAT_MODEL_PROVIDER_PRESETS, getChatModelProviderPreset, formatChatModelUpstreamEndpoint } from '../chat-model-presets.js'

const copy = {
  zh: {
    newChat:'新建对话',recent:'最近对话',editor:'打开 CAD 编辑器',docs:'使用文档 ↗',beta:'预览版',
    searchHistory:'搜索对话',today:'今天',yesterday:'昨天',lastWeek:'近 7 天',older:'更早',
    rename:'重命名',deleteChat:'删除',conversationName:'对话名称',deleteTitle:'删除这段对话？',
    deleteDescription:'消息与本地图纸将从此浏览器永久删除，此操作无法撤销。',renameTitle:'重命名对话',emptyTitle:'请输入对话名称。',
    notConnected:'未连接模型',connected:'模型已连接',connect:'连接模型',manage:'连接设置',
    heroTitle:'今天想画什么图？',heroDescription:'描述需求，检查提案，然后再应用到可编辑图纸。',
    suggestLine:'画一条 100 mm 水平线',suggestCircle:'画一个半径 25 mm 的圆',suggestOutline:'画一个 120 × 80 mm 矩形',
    promptLabel:'描述你想绘制或修改的图纸',promptPlaceholder:'描述你想绘制或修改的图纸…',
    composerHint:'Enter 发送 · Shift + Enter 换行',send:'发送',stop:'停止生成',stopped:'已停止，图纸未修改。',working:'正在处理图纸需求…',
    disclaimer:'对话、图纸及模型密钥保存在此浏览器；请求会发送给所选模型服务商。共用电脑可清除本站数据，工程图须由你审核。',
    connectionSettings:'模型连接',connectModel:'连接你的模型',settingsIntro:'选择常用模型或自定义接口。请求直接发给所选服务商；连接配置和密钥保存在此浏览器，清除本站数据即可移除。',
    provider:'服务商',commonModel:'常用模型',customModel:'自定义模型…',connectionDetails:'连接详情与自定义',protocol:'接口协议',
    endpoint:'API 地址',model:'模型名称',apiKey:'API 密钥',cancel:'取消',saveConnection:'连接并继续',
    invalidSettings:'请填写完整的 API 地址和模型名称。',invalidEndpoint:'请输入完整的 http(s) API 地址。',keyRequired:'请填写该服务商的 API 密钥。',you:'你',assistant:'KJDraw AI',
    proposal:'CAD 修改提案',proposalPending:'待审核',proposalApproved:'已应用',proposalRejected:'已放弃',proposalExpired:'已失效',
    noProposal:'尚未生成可确认的修改，图纸未改变。',
    previewMissing:'暂时无法绘制预览，请检查提案详情。',reviewDetails:'查看提案详情',approve:'审核并应用',reject:'放弃提案',
    download:'下载 DXF 图纸',openEditor:'打开编辑器',applied:'修改已应用。可在线查看，或下载 DXF 图纸继续编辑。',
    currentDrawing:'当前图纸',viewDrawing:'放大查看',zoomIn:'放大',zoomOut:'缩小',fitDrawing:'全图',closeViewer:'关闭查看',viewerHint:'滚轮缩放 · 拖动平移',
    emptyResponse:'模型没有返回可显示的内容。',retry:'请重试或检查模型设置。',newConversation:'新对话',
    failedDownload:'导出图纸失败。',editorHint:'编辑器会在新标签页打开。请使用“打开文件”导入刚下载的 DXF 图纸。',
    unsafeDxfWarning:'图纸已打开，但部分视口关联数据暂不能安全保留。可在当前会话查看和编辑，暂不能导出 DXF。原始文件未改动；请先在 CAD 软件中检查相关数据，再重新打开。',
    unsafeDxfExport:'为避免丢失视口关联数据，本次 DXF 导出已阻止。当前图纸仍保留在会话中，原始文件未改动。请先在 CAD 软件中检查相关数据，再重新打开。',
    openDrawing:'打开图纸',dropDrawing:'松开以打开图纸',importFailed:'图纸未导入，请检查文件格式。',
    importBusy:'请等待当前请求结束后再打开图纸。',importingDrawing:'正在打开图纸，请稍候…',drawingLoaded:'已打开图纸',entities:'个对象',
    storageFailed:'本地会话保存失败。请先下载 DXF 图纸，并检查浏览器存储空间。',proposalUnsaved:'未保存',
    historyEmpty:'没有找到对话',busyHistory:'请先停止当前请求，再管理这段对话。',
    undoDrawing:'撤销',redoDrawing:'重做',historyRestored:'图纸历史',
    historyUnavailable:'当前图纸已恢复，但旧会话或超出保存容量的撤销历史不可用。新的修改仍可撤销。',
    historyLimited:'刷新后可恢复的修改：撤销 {undo} 步、重做 {redo} 步。当前页面内仍可使用全部现有历史。',
  },
  en: {
    newChat:'New chat',recent:'Recent chats',editor:'Open CAD editor',docs:'Documentation ↗',beta:'PREVIEW',
    searchHistory:'Search conversations',today:'Today',yesterday:'Yesterday',lastWeek:'Past 7 days',older:'Older',
    rename:'Rename',deleteChat:'Delete',conversationName:'Conversation name',deleteTitle:'Delete this conversation?',
    deleteDescription:'Messages and the local drawing will be permanently removed from this browser. This cannot be undone.',renameTitle:'Rename conversation',emptyTitle:'Enter a conversation name.',
    notConnected:'Model not connected',connected:'Model connected',connect:'Connect model',manage:'Connection settings',
    heroTitle:'What would you like to draw?',heroDescription:'Describe the drawing, review the proposal, then apply it to an editable file.',
    suggestLine:'Draw a 100 mm horizontal line',suggestCircle:'Draw a circle with a 25 mm radius',suggestOutline:'Draw a 120 × 80 mm rectangle',
    promptLabel:'Describe the drawing you want to create or change',promptPlaceholder:'Describe the drawing you want to create or change…',
    composerHint:'Enter to send · Shift + Enter for a new line',send:'Send',stop:'Stop',stopped:'Stopped. The drawing was not changed.',working:'Working on your drawing…',
    disclaimer:'Chats, drawings, and your model key stay in this browser. Requests go to your chosen model provider. Clear this site’s data on shared devices; review drawings before use.',
    connectionSettings:'Model connection',connectModel:'Connect your model',settingsIntro:'Choose a common model or custom endpoint. Requests go directly to that provider. Your connection and key are saved in this browser; clearing this site’s data removes them.',
    provider:'Provider',commonModel:'Common model',customModel:'Custom model…',connectionDetails:'Connection details & custom setup',protocol:'API protocol',
    endpoint:'API endpoint',model:'Model name',apiKey:'API key',cancel:'Cancel',saveConnection:'Connect and continue',
    invalidSettings:'Enter an API endpoint and model name.',invalidEndpoint:'Enter a complete http(s) API endpoint.',keyRequired:'Enter an API key for this provider.',you:'You',assistant:'KJDraw AI',
    proposal:'CAD change proposal',proposalPending:'Awaiting review',proposalApproved:'Applied',proposalRejected:'Discarded',proposalExpired:'Expired',
    noProposal:'No reviewable change was created. The drawing is unchanged.',
    previewMissing:'Preview could not be rendered. Review the proposal details.',reviewDetails:'View proposal details',approve:'Review and apply',reject:'Discard proposal',
    download:'Download DXF drawing',openEditor:'Open editor',applied:'Change applied. View it here, or download the DXF drawing to continue editing.',
    currentDrawing:'Current drawing',viewDrawing:'Expand drawing',zoomIn:'Zoom in',zoomOut:'Zoom out',fitDrawing:'Fit drawing',closeViewer:'Close viewer',viewerHint:'Scroll to zoom · Drag to pan',
    emptyResponse:'The model returned no displayable content.',retry:'Try again or check your model settings.',newConversation:'New chat',
    failedDownload:'Could not export drawing.',editorHint:'The editor opens in a new tab. Use Open file to import the downloaded DXF drawing.',
    unsafeDxfWarning:'Drawing opened, but some viewport-linked data cannot yet be preserved safely. You can view and edit it in this conversation, but DXF export is unavailable. The original file is unchanged. Check the linked data in your CAD software before reopening it.',
    unsafeDxfExport:'DXF export was blocked to avoid losing viewport-linked data. The current drawing remains in this conversation and the original file is unchanged. Check the linked data in your CAD software before reopening it.',
    openDrawing:'Open drawing',dropDrawing:'Drop to open drawing',importFailed:'Drawing not opened. Check the file format.',
    importBusy:'Wait for the current request before opening a drawing.',importingDrawing:'Opening drawing. Please wait…',drawingLoaded:'Drawing opened',entities:'entities',
    storageFailed:'Could not save this conversation locally. Download the DXF drawing and check browser storage.',proposalUnsaved:'Not saved',
    historyEmpty:'No conversations found',busyHistory:'Stop the current request before managing this conversation.',
    undoDrawing:'Undo',redoDrawing:'Redo',historyRestored:'Drawing history',
    historyUnavailable:'The current drawing was restored, but undo history from an older session or beyond storage limits is unavailable. New edits can still be undone.',
    historyLimited:'After refresh: {undo} undo steps and {redo} redo steps can be recovered. All current history remains available until then.',
  },
}
const examples = {
  zh: {
    line:'请从坐标 (0, 0) 到 (100, 0) 画一条水平直线，单位为 mm。',
    circle:'请以坐标 (0, 0) 为圆心，画一个半径 25 mm 的圆。',
    outline:'请从坐标 (0, 0) 开始，画一个宽 120 mm、高 80 mm 的闭合矩形轮廓。',
  },
  en: {
    line:'Draw a horizontal line from (0, 0) to (100, 0), in millimeters.',
    circle:'Draw a circle centered at (0, 0) with a 25 mm radius.',
    outline:'Draw a closed rectangular outline from (0, 0), 120 mm wide and 80 mm high.',
  },
}
const importedExamples = {
  zh: {
    line:{label:'读图纸内容',prompt:'请读取当前图纸，说明单位、图层和主要内容。暂时不要修改图纸。'},
    circle:{label:'查找工程名称',prompt:'请查找图纸里的工程名称和图纸名称，给出原始文字及位置。暂时不要修改。'},
    outline:{label:'检查图层',prompt:'请读取并列出当前图层和各图层的对象数量，暂时不要修改图纸。'},
  },
  en: {
    line:{label:'Read this drawing',prompt:'Read the current drawing and describe its units, layers, and main contents. Do not change it.'},
    circle:{label:'Find project labels',prompt:'Find the project-name and drawing-name labels, reporting their original text and positions. Do not change them.'},
    outline:{label:'Inspect layers',prompt:'Read and list the current layers and their entity counts. Do not change the drawing.'},
  },
}

const byId = id => document.getElementById(id)
Object.assign(copy.zh, {
  pin:'置顶',unpin:'取消置顶',pinned:'置顶',copyMessage:'复制',copied:'已复制',retryMessage:'重新尝试',
  drawingWorkspace:'图纸',chatTab:'对话',currentView:'当前图纸',proposalView:'修改预览',
  closeWorkspace:'收起图纸',latest:'回到最新消息',reviewHint:'当前图纸尚未修改。核对预览后再应用。',
  changedObjects:'涉及对象',beforeLabel:'修改前',afterLabel:'修改后',openWorkspace:'在工作区查看',
  progressModel:'正在等待模型响应',progressRead:'正在读取图纸',progressProposal:'正在生成修改提案',
  progressTool:'正在检查图纸',progressFailed:'工具检查未通过，正在返回结果',
  hideSidebar:'收起侧栏',showSidebar:'展开侧栏',privacy:'隐私与存储',
  removeDrawing:'移除图纸',removeDrawingTitle:'移除这张图纸？',
  removeDrawingDescription:'这张图纸已有应用的修改。移除会清除当前图纸、修改提案和撤销历史；对话和模型设置会保留。请先下载需要保留的图纸。',
  removingDrawing:'正在移除图纸…',deletingConversation:'正在删除对话…',progressWriting:'正在生成回复',revisionLabel:'版本 {revision}',
  reviewSavingHint:'正在处理审核并保存本地历史，请稍候。',
})
Object.assign(copy.en, {
  pin:'Pin',unpin:'Unpin',pinned:'Pinned',copyMessage:'Copy',copied:'Copied',retryMessage:'Retry',
  drawingWorkspace:'Drawing',chatTab:'Chat',currentView:'Current drawing',proposalView:'Proposed changes',
  closeWorkspace:'Hide drawing',latest:'Jump to latest',reviewHint:'The current drawing is unchanged. Review the preview before applying.',
  changedObjects:'Affected objects',beforeLabel:'Before',afterLabel:'After',openWorkspace:'View in workspace',
  progressModel:'Waiting for the model',progressRead:'Reading the drawing',progressProposal:'Preparing a change proposal',
  progressTool:'Checking the drawing',progressFailed:'A tool check failed; returning the result',
  hideSidebar:'Collapse sidebar',showSidebar:'Expand sidebar',privacy:'Privacy & storage',
  removeDrawing:'Remove drawing',removeDrawingTitle:'Remove this drawing?',
  removeDrawingDescription:'This drawing has applied changes. Removing it clears the current drawing, proposals, and undo history. Your conversation and model settings stay saved. Download any drawing you want to keep first.',
  removingDrawing:'Removing drawing…',deletingConversation:'Deleting conversation…',progressWriting:'Writing the response',revisionLabel:'Revision {revision}',
  reviewSavingHint:'Processing the review and saving local history. Please wait.',
})
for (const labels of Object.values(copy)) {
  labels.drawingTab = labels.drawingWorkspace
  labels.jumpLatest = labels.latest
  labels.privacySummary = labels.privacy
  labels.proposalDrawing = labels.proposalView
  labels.downloadDrawing = labels.download
  labels.docs = labels.docs.replace(' ↗','')
}
const ui = {
  conversation:byId('conversation'), empty:byId('empty-state'), messages:byId('messages'),
  list:byId('conversation-list'), count:byId('history-count'), input:byId('chat-input'), send:byId('chat-send'), stop:byId('chat-stop'),
  form:byId('chat-form'), dialog:byId('settings-dialog'), settingsForm:byId('settings-form'),
  endpoint:byId('settings-endpoint'), model:byId('settings-model'), key:byId('settings-key'),
  provider:byId('settings-provider'), commonModel:byId('settings-common-model'),
  protocol:byId('settings-protocol'), details:byId('settings-details'),
  settingsError:byId('settings-error'), pill:byId('connection-pill'), settingsOpen:byId('settings-open'),
  sidebar:byId('sidebar'), scrim:byId('mobile-scrim'), menu:byId('menu-button'),
  drawingFile:byId('drawing-file'), openDrawing:byId('open-drawing'), attachDrawing:byId('attach-drawing'),
  drawingContext:byId('drawing-context'), drawingName:byId('drawing-name'), drawingMeta:byId('drawing-meta'),
  removeDrawing:byId('remove-drawing'), removeDrawingDialog:byId('remove-drawing-dialog'), removeDrawingForm:byId('remove-drawing-form'),
  drawingCanvas:byId('drawing-canvas'), importError:byId('import-error'), dropOverlay:byId('drawing-drop-overlay'),
  historySearch:byId('history-search'), historyDialog:byId('history-dialog'), historyForm:byId('history-form'),
  historyDialogTitle:byId('history-dialog-title'), historyDialogDescription:byId('history-dialog-description'),
  historyTitleInput:byId('history-title-input'), historyConfirm:byId('history-confirm'),
  historyActions:byId('drawing-history-actions'), undo:byId('drawing-undo'), redo:byId('drawing-redo'),
  historyStatus:byId('drawing-history-status'), historyWarning:byId('drawing-history-warning'),
  workspace:byId('workspace-body'), drawingPanel:byId('drawing-panel'), workspaceViewer:byId('workspace-viewer'),
  workspaceReview:byId('workspace-review'), workspaceTitle:byId('workspace-title'), workspaceMeta:byId('workspace-meta'),
  workspaceToggle:byId('workspace-toggle'), workspaceClose:byId('workspace-close'), divider:byId('workspace-divider'),
  currentView:byId('view-current'), proposalView:byId('view-proposal'), workspaceDownload:byId('workspace-download'),
  workspaceUndo:byId('workspace-undo'), workspaceRedo:byId('workspace-redo'),
  workspaceTabs:byId('workspace-tabs'), tabChat:byId('tab-chat'), tabDrawing:byId('tab-drawing'), jumpLatest:byId('jump-latest'),
}
let language = navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
let settings = null
let sessions = []
let active = null
let pendingSend = false
let busy = false
let activeRequest = null
let activeRequestSession = null
let activeRequestFinished = null
let importing = false
let removing = false
let deleting = false
let pendingRemoval = null
let pendingDeletion = null
let removalSession = null
let hydrated = false
let persistSerial = Promise.resolve()
let pendingImport = null
const savingMessages = new WeakSet()
const unsavedMessages = new WeakSet()
const savingProposals = new WeakSet()
const unsavedProposals = new WeakSet()
let initialLoad
let historyAction = null
const drawingViewers = new Set()
const viewerMounts = new Map()
const messageNodes = new Map()
let contextViewer = null
let renderVersion = 0
let renderedSession = null
let workspaceViewer = null
let workspaceSession = null
let workspaceVisible = false
let workspaceMode = 'document'
let workspacePlanId = null
let workspaceReviewKey = ''
let followLatest = true
const t = key => copy[language][key] ?? key
function viewerLabels(title) {
  return { title, zoomIn:t('zoomIn'), zoomOut:t('zoomOut'), fit:t('fitDrawing'), enlarge:t('viewDrawing'),
    close:t('closeViewer'), hint:t('viewerHint'), unavailable:t('previewMissing') }
}
function disposeDrawingViewers() {
  for (const viewer of drawingViewers) viewer.destroy()
  drawingViewers.clear()
  viewerMounts.clear()
  messageNodes.clear()
  contextViewer = null
  if (!ui.drawingCanvas.isConnected) ui.drawingContext.append(ui.drawingCanvas)
}
function registerViewer(viewer, mount) {
  drawingViewers.add(viewer)
  viewerMounts.set(viewer, mount)
}
function disposeMessageViewers(node) {
  for (const [viewer, mount] of viewerMounts) if (node.contains(mount)) {
    viewer.destroy()
    viewerMounts.delete(viewer)
    drawingViewers.delete(viewer)
  }
}
for (const preset of CHAT_MODEL_PROVIDER_PRESETS) {
  const option = document.createElement('option')
  option.value = preset.id
  ui.provider.append(option)
}
ui.provider.value = 'custom'
function populateCommonModels() {
  const preset = getChatModelProviderPreset(ui.provider.value)
  const selected = ui.model.value.trim()
  ui.commonModel.replaceChildren()
  for (const name of preset.models) {
    const option = document.createElement('option')
    option.value = name
    option.textContent = name
    ui.commonModel.append(option)
  }
  const custom = document.createElement('option')
  custom.value = ''
  custom.textContent = t('customModel')
  ui.commonModel.append(custom)
  ui.commonModel.disabled = preset.models.length === 0
  ui.commonModel.value = preset.models.includes(selected) ? selected : ''
}
function relabelProviders() {
  for (const [index, preset] of CHAT_MODEL_PROVIDER_PRESETS.entries()) {
    ui.provider.options[index].textContent = preset.label[language === 'zh' ? 1 : 0]
  }
  populateCommonModels()
}
function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg')
  svg.classList.add('ui-icon')
  svg.setAttribute('aria-hidden','true')
  const use = document.createElementNS('http://www.w3.org/2000/svg','use')
  use.setAttribute('href',`#icon-${name}`)
  svg.append(use)
  return svg
}
function setLanguage(next) {
  language = next
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
  document.title = next === 'zh' ? 'KJDraw AI — 对话式工程绘图' : 'KJDraw AI — Conversational engineering drawings'
  for (const node of document.querySelectorAll('[data-text]')) node.textContent = t(node.dataset.text)
  relabelProviders()
  ui.input.placeholder = t('promptPlaceholder')
  ui.historySearch.placeholder = t('searchHistory')
  ui.historySearch.setAttribute('aria-label', t('searchHistory'))
  refreshKeyPlaceholder()
  byId('language-button').textContent = next === 'zh' ? 'EN' : '中文'
  byId('language-button').setAttribute('aria-label', next === 'zh' ? 'Switch to English' : '切换到中文')
  ui.send.setAttribute('aria-label', t('send'))
  ui.removeDrawing.setAttribute('aria-label',t('removeDrawing'))
  ui.removeDrawing.title = t('removeDrawing')
  byId('sidebar-toggle').setAttribute('aria-label',t('hideSidebar'))
  ui.menu.setAttribute('aria-label',t('showSidebar'))
  ui.workspaceClose.setAttribute('aria-label',t('closeWorkspace'))
  ui.workspaceToggle.setAttribute('aria-label',t('drawingWorkspace'))
  ui.jumpLatest.setAttribute('aria-label',t('latest'))
  updateConnection()
  render()
}
function updateConnection() {
  ui.pill.classList.toggle('connected', Boolean(settings))
  ui.pill.querySelector('[data-text]').textContent = t(settings ? 'connected' : 'notConnected')
  ui.settingsOpen.querySelector('[data-text]').textContent = t(settings ? 'manage' : 'connect')
}
function sessionRecord(runtime, source) {
  return { id: crypto.randomUUID(), title:source?.name ?? t('newConversation'), messages:[], runtime, source, pinned:false, draft:'', updatedAt:Date.now() }
}
function activateSession(session) {
  if (active && !active.messages.length && !active.source) {
    active.runtime.destroy()
    sessions = sessions.filter(item => item !== active)
  }
  sessions.unshift(session)
  active = session
  render()
  return session
}
function createSession({ runtime = createAiChatRuntime(settings ?? {}), source = null } = {}) {
  const session = sessionRecord(runtime, source)
  if (!active) session.draft = ui.input.value
  return activateSession(session)
}
function hasUnsupportedDxfMetadata(state) {
  try { return JSON.parse(state.drawing)?.opaquePayloads?.['dxf:viewport-metadata-unsupported:v1'] != null }
  catch { return false }
}
function drawingExportError(error) {
  const seen = new Set()
  for (let current = error, depth = 0; current && depth < 4 && !seen.has(current); current = current.cause, depth++) {
    seen.add(current)
    if (typeof current.message === 'string' && current.message.startsWith('DXF viewport metadata:')) return t('unsafeDxfExport')
  }
  return error?.message ?? t('failedDownload')
}
function queuePersist({ extraSession = null, replacementSession = null, deletedSession = null, activeIdOverride } = {}) {
  // Every awaited barrier is a new serial write, never an older coalesced save.
  // Imports remain staged until their own transaction completes; background
  // renders cannot overwrite the candidate or report it opened prematurely.
  if (!hydrated || pendingImport && !extraSession) return Promise.resolve(false)
  const operation = persistSerial.catch(() => {}).then(async () => {
    // Only the staged removal/deletion may write during its barrier. Previously
    // queued background saves must not write the still-visible old session
    // after a candidate commit and resurrect its drawing/conversation.
    if (pendingRemoval && replacementSession !== pendingRemoval || pendingDeletion && deletedSession !== pendingDeletion) return false
    const saved = []
    // A staged import takes over an empty draft conversation atomically. The
    // candidate already carries that draft; do not persist a duplicate chat.
    const base = extraSession ? [...sessions.filter(session => session !== active || session.messages.length || session.source), extraSession] : sessions
    const included = base.filter(session => session !== deletedSession).map(session => session.id === replacementSession?.id ? replacementSession : session)
    for (const session of included.filter(item => item.messages.length || item.source || item.draft || item.drawingRemoved)) {
      const record = {
        id: session.id, title: session.title, source: session.source, updatedAt: session.updatedAt,
        pinned: session.pinned === true, draft: String(session.draft ?? '').slice(0,12000),
        ...(session.drawingRemoved ? { drawingRemoved:true } : {}),
        messages: session.messages.filter(message => message.status !== 'pending').map(message => ({
          role: message.role, text: message.text, status: message.status,
          ...(message.proposals ? { proposals: message.proposals.map(proposal => ({
            planId: proposal.planId, command: proposal.command, expectedRevision: proposal.expectedRevision,
            preview: proposal.preview, engineeringEvidence: proposal.engineeringEvidence, uiState: proposal.uiState,
          })) } : {}),
        })),
      }
      const state = await session.runtime.exportLocalState()
      saved.push({ ...record, state })
    }
    await saveLocalHistory({
      version: 1, activeId: extraSession?.id ?? (activeIdOverride !== undefined ? activeIdOverride : active?.id ?? null), sessions: saved,
      connection: settings ? {
        endpoint: settings.endpoint, model: settings.model, apiKey: settings.apiKey,
        provider: settings.provider, protocol: settings.protocol,
      } : null,
    })
    updateHistoryStorageNotice()
    return true
  })
  persistSerial = operation
  // Background writes still surface errors; callers receive the rejection and
  // must not turn it into a successful completion indication.
  operation.catch(() => showImportError(t('storageFailed')))
  return operation
}
async function persistTerminal(session, messages, proposals = []) {
  for (const message of messages) savingMessages.add(message)
  for (const proposal of proposals) savingProposals.add(proposal)
  try {
    if (!await queuePersist()) throw new Error('Local history is unavailable')
    for (const message of messages) unsavedMessages.delete(message)
    for (const proposal of proposals) unsavedProposals.delete(proposal)
    return true
  } catch {
    for (const message of messages) {
      unsavedMessages.add(message)
      for (const proposal of message.proposals ?? []) if (proposal.uiState === 'pending') {
        session.runtime.reject(proposal.planId)
        proposal.uiState = 'expired'
      }
    }
    for (const proposal of proposals) unsavedProposals.add(proposal)
    showImportError(t('storageFailed'))
    return false
  } finally {
    for (const message of messages) savingMessages.delete(message)
    for (const proposal of proposals) savingProposals.delete(proposal)
  }
}
async function restoreSessions() {
  let loaded = false
  try {
    const saved = await loadLocalHistory()
    if (saved?.connection) {
      const candidate = Object.fromEntries(['endpoint', 'model', 'apiKey', 'provider', 'protocol']
        .map(key => [key, saved.connection[key]]))
      try {
        const probe = createAiChatRuntime(candidate)
        if (probe.configured) settings = candidate
        probe.destroy()
      } catch { settings = null }
    }
    if (saved?.version === 1 && Array.isArray(saved.sessions)) {
      for (const item of saved.sessions) {
        if (!item || typeof item.id !== 'string' || !Array.isArray(item.messages)) continue
        const runtime = createAiChatRuntime(settings ?? {})
        try {
          await runtime.restoreLocalState(item.state)
          const messages = item.messages.filter(message => ['user', 'assistant'].includes(message?.role)).map(message => ({
            role: message.role, text: String(message.text ?? ''), status: message.status,
            ...(Array.isArray(message.proposals) ? { proposals: message.proposals.map(proposal => ({
              ...proposal, uiState: proposal.uiState === 'pending' ? 'expired' : proposal.uiState,
            })) } : {}),
          }))
          const source = item.source ? { ...item.source, exportRestricted: hasUnsupportedDxfMetadata(item.state) } : null
          sessions.push({ id: item.id, title: String(item.title ?? t('newConversation')), source,
            updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(), messages, runtime,
            drawingRemoved:item.drawingRemoved === true,
            pinned:item.pinned === true, draft: typeof item.draft === 'string' ? item.draft.slice(0,12000) : '' })
        } catch { runtime.destroy() }
      }
      active = sessions.find(session => session.id === saved.activeId) ?? sessions[0] ?? null
    }
    loaded = true
  } catch {
    showImportError(t('storageFailed'))
  } finally {
    hydrated = loaded
    updateConnection()
    render()
  }
}
function currentSession() { return active ?? createSession() }
function renderSidebar() {
  ui.list.replaceChildren()
  const saved = sessions.filter(item => item.messages.length || item.source || item.draft)
  const query = ui.historySearch.value.trim().normalize('NFKC').toLowerCase()
  const visible = saved.filter(item => item.title.normalize('NFKC').toLowerCase().includes(query))
    .sort((a,b) => Number(b.pinned === true) - Number(a.pinned === true) || b.updatedAt - a.updatedAt)
  const now = new Date()
  const midnight = new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime()
  let lastGroup = ''
  for (const session of visible) {
    const age = Math.max(0, midnight - session.updatedAt)
    const group = session.pinned ? 'pinned' : session.updatedAt >= midnight ? 'today' : age < 86400000 ? 'yesterday' : age < 7*86400000 ? 'lastWeek' : 'older'
    if (!query && group !== lastGroup) {
      ui.list.append(element('div','history-group',t(group)))
      lastGroup = group
    }
    const row = element('div','history-row'+(session === active ? ' active' : ''))
    const button = element('button','conversation-item')
    button.type = 'button'
    button.setAttribute('aria-current',session === active ? 'page' : 'false')
    button.title = session.title
    button.append(element('span','chat-title',session.title))
    button.addEventListener('click',()=>{
      if (removing || deleting) return
      if (active) active.draft = ui.input.value
      active = session; render(); queuePersist(); closeSidebar()
    })
    const menu = element('details','history-menu')
    const trigger = element('summary','history-menu-trigger')
    trigger.append(icon('more'))
    trigger.setAttribute('aria-label',session.title + ' — ' + t('rename') + ' / ' + t('deleteChat'))
    menu.append(trigger)
    const menuItems = element('div','history-menu-items history-menu-popup')
    menuItems.setAttribute('popover','manual')
    for (const action of ['rename',session.pinned ? 'unpin' : 'pin','deleteChat']) {
      const actionButton = element('button','history-menu-action'+(action === 'deleteChat' ? ' danger' : ''))
      actionButton.append(icon(action === 'rename' ? 'edit' : action === 'deleteChat' ? 'trash' : 'pin'),element('span','',t(action)))
      actionButton.type = 'button'
      actionButton.addEventListener('click',()=>{
        if (removing || deleting) return
        menu.open = false
        if (action === 'pin' || action === 'unpin') {
          session.pinned = action === 'pin'
          renderSidebar(); queuePersist()
        } else openHistoryAction(action,session)
      })
      menuItems.append(actionButton)
    }
    menu.append(menuItems)
    menu.addEventListener('toggle',()=>{
      if (!menu.open) { if(menuItems.matches(':popover-open')) menuItems.hidePopover(); return }
      for (const other of ui.list.querySelectorAll('.history-menu[open]')) if(other !== menu) other.open=false
      const rect = trigger.getBoundingClientRect()
      menuItems.showPopover()
      const height = menuItems.getBoundingClientRect().height
      menuItems.style.left = `${Math.min(innerWidth-176,Math.max(8,rect.right-164))}px`
      menuItems.style.top = `${Math.max(8,Math.min(innerHeight-height-8,rect.bottom+4))}px`
    })
    row.append(button,menu)
    ui.list.append(row)
  }
  if (!visible.length && query) ui.list.append(element('p','history-empty',t('historyEmpty')))
  ui.count.textContent = String(saved.length)
}
function openHistoryAction(action,session) {
  if (removing || deleting) return
  if (busy || importing) { showImportError(t('busyHistory')); return }
  historyAction = {action,session}
  ui.historyDialogTitle.textContent = t(action === 'rename' ? 'renameTitle' : 'deleteTitle')
  ui.historyDialogDescription.textContent = action === 'rename' ? '' : t('deleteDescription')
  ui.historyTitleInput.hidden = action !== 'rename'
  ui.historyTitleInput.required = action === 'rename'
  ui.historyTitleInput.value = action === 'rename' ? session.title : ''
  ui.historyConfirm.textContent = t(action)
  ui.historyConfirm.classList.toggle('danger',action === 'deleteChat')
  ui.historyDialog.showModal()
  if (action === 'rename') ui.historyTitleInput.select()
}
function updateComposerAvailability() {
  ui.send.disabled = busy || importing
  ui.input.readOnly = removing || deleting
  ui.form.setAttribute('aria-busy', String(busy || importing))
  const pendingLabel = deleting ? 'deletingConversation' : removing ? 'removingDrawing' : 'importingDrawing'
  ui.send.title = importing ? t(pendingLabel) : busy ? t('working') : ''
  ui.send.querySelector('[data-text="send"]').textContent = t(importing ? pendingLabel : 'send')
  ui.form.querySelector('[data-text="composerHint"]').textContent = t(importing ? pendingLabel : busy ? 'working' : 'composerHint')
  ui.removeDrawing.disabled = importing || busy && activeRequestSession !== active
  for (const button of ui.messages.querySelectorAll('[data-testid="drawing-download"]')) button.disabled = busy || importing
  for (const button of ui.messages.querySelectorAll('[data-testid="proposal-approve"], [data-testid="proposal-reject"]')) button.disabled = busy || importing
}
function render() {
  updateComposerAvailability()
  const switched = renderedSession !== active
  if (switched) {
    disposeDrawingViewers()
    ui.messages.replaceChildren()
    renderedSession = active
    ui.input.value = active?.draft ?? ''
    resizeComposer()
    followLatest = true
  }
  const version = ++renderVersion
  renderSidebar()
  const source = active?.source
  ui.empty.querySelector('h1').textContent = source ? (language === 'zh' ? '想怎样修改这张图？' : 'What would you like to change?') : t('heroTitle')
  ui.empty.querySelector('p').textContent = source ? (language === 'zh' ? '描述要修改的内容，先核对预览，再确认应用。' : 'Describe the change, check the preview, then confirm.') : t('heroDescription')
  for (const button of ui.empty.querySelectorAll('[data-prompt]')) {
    button.textContent = source ? importedExamples[language][button.dataset.prompt].label : t(button.dataset.text)
  }
  const drawingHistory = active?.runtime.drawingHistory
  ui.historyActions.hidden = !source && !active?.messages.some(message => message.proposals?.some(proposal => proposal.uiState === 'approved'))
  ui.undo.disabled = busy || importing || !drawingHistory?.canUndo
  ui.redo.disabled = busy || importing || !drawingHistory?.canRedo
  ui.undo.title = drawingHistory?.undoLabel ?? t('undoDrawing')
  ui.redo.title = drawingHistory?.redoLabel ?? t('redoDrawing')
  ui.historyStatus.textContent = active ? `REV ${active.runtime.revision}` : ''
  updateHistoryStorageNotice()
  let exportWarning = document.querySelector('[data-testid="drawing-export-warning"]')
  if (!exportWarning) {
    exportWarning = element('p', 'import-error')
    exportWarning.dataset.testid = 'drawing-export-warning'
    exportWarning.setAttribute('role', 'alert')
    ui.drawingContext.before(exportWarning)
  }
  exportWarning.hidden = !source?.exportRestricted
  exportWarning.textContent = source?.exportRestricted ? t('unsafeDxfWarning') : ''
  ui.drawingContext.hidden = !source
  if (source) {
    ui.drawingName.textContent = source.name
    ui.drawingMeta.textContent = `${source.entityCount} ${t('entities')} · ${source.units}`
    if (ui.drawingContext.open) requestAnimationFrame(()=>{ if (version === renderVersion) renderDrawingContext(active) })
  } else { ui.drawingName.textContent = ''; ui.drawingMeta.textContent = '' }
  const messages = active?.messages ?? []
  document.body.classList.toggle('chat-empty', messages.length === 0)
  ui.empty.hidden = messages.length > 0
  ui.messages.hidden = messages.length === 0
  const retained = new Set(messages)
  for (const [message, entry] of messageNodes) if (!retained.has(message)) {
    disposeMessageViewers(entry.node)
    entry.node.remove()
    messageNodes.delete(message)
  }
  let cursor = ui.messages.firstChild
  for (const message of messages) {
    const saving = savingMessages.has(message), unsaved = unsavedMessages.has(message)
    const key = JSON.stringify([language,message.text,message.status,saving,unsaved,
      message.proposals?.map(proposal => [proposal.planId,proposal.uiState,savingProposals.has(proposal),unsavedProposals.has(proposal)])])
    let entry = messageNodes.get(message)
    if (entry?.key === key) {
      if (entry.node !== cursor) ui.messages.insertBefore(entry.node,cursor)
      cursor = entry.node.nextSibling
      continue
    }
    if (entry) disposeMessageViewers(entry.node)
    const wrapper = element('article','message '+message.role+(message.status === 'error' || unsaved ? ' error' : ''))
    wrapper.dataset.testid = message.status === 'error' || unsaved ? 'chat-error' : 'chat-message'
    const avatar = element('span','message-avatar',message.role === 'user' ? 'U' : 'K')
    avatar.setAttribute('aria-hidden','true')
    const body = element('div','message-body')
    body.append(element('div','message-role',t(message.role === 'user' ? 'you' : 'assistant')))
    if (message.status === 'pending' || saving) {
      if (message.status === 'pending' && message.text) {
        const content = element('div','message-content message-streaming')
        content.dataset.testid = 'chat-streaming-text'
        renderMessageMarkdown(content,message.text)
        body.append(content)
      }
      const progress = element('div','message-progress',saving ? t('working') : message.text && message.progress?.phase === 'model' ? t('progressWriting') : progressText(message.progress))
      progress.dataset.phase = message.progress?.phase ?? 'model'
      body.append(progress)
    }
    else if (unsaved) body.append(element('div','message-content',t('storageFailed')))
    else {
      const content = element('div', 'message-content')
      if (message.role === 'user') content.textContent = message.text || t('emptyResponse')
      else renderMessageMarkdown(content, message.text || t('emptyResponse'))
      body.append(content)
    }
    if (message.status === 'not-proposed' && !saving && !unsaved) {
      const notice = element('div','message-progress',t('noProposal'))
      notice.dataset.testid = 'chat-no-proposal'
      body.append(notice)
    }
    if (!saving && message.proposals?.length) for (const proposal of message.proposals) body.append(createProposalCard(active,proposal))
    if (!saving && !unsaved && message.status !== 'pending') {
      const actions = element('div','message-actions')
      const copyButton = element('button','message-copy')
      const copyLabel = element('span','',t('copyMessage'))
      copyButton.append(icon('copy'),copyLabel)
      copyButton.type = 'button'
      copyButton.addEventListener('click',async()=>{
        try {
          await navigator.clipboard.writeText(message.text ?? '')
          copyLabel.textContent = t('copied')
          setTimeout(()=>{copyLabel.textContent=t('copyMessage')},1500)
        } catch { copyLabel.textContent = t('retry') }
      })
      actions.append(copyButton)
      if (message.status === 'error' || message.status === 'not-proposed') {
        const retry = element('button','message-retry',t('retryMessage'))
        retry.type = 'button'
        retry.addEventListener('click',()=>{
          if (busy || importing) return
          const index = messages.indexOf(message)
          const request = messages.slice(0,index).findLast(item=>item.role === 'user')
          if (!request) return
          setDraft(request.text); ui.input.focus()
        })
        actions.append(retry)
      }
      body.append(actions)
    }
    wrapper.append(avatar,body)
    if (entry) {
      if (entry.node === cursor) cursor = entry.node.nextSibling
      entry.node.replaceWith(wrapper)
    } else ui.messages.insertBefore(wrapper,cursor)
    messageNodes.set(message,{key,node:wrapper})
    cursor = wrapper.nextSibling
  }
  for (const viewer of drawingViewers) viewer.refresh({preserveCamera:true})
  renderWorkspace()
  requestAnimationFrame(()=>{
    if (followLatest) ui.conversation.scrollTop = ui.conversation.scrollHeight
    updateLatestButton()
  })
}
function progressText(progress) {
  if (!progress || progress.phase === 'model') return t('progressModel')
  if (progress.ok === false) return t('progressFailed')
  if (progress.toolName?.startsWith('cad_propose_')) return t('progressProposal')
  if (/^cad_(read|find|query)_/.test(progress.toolName ?? '')) return t('progressRead')
  return t('progressTool')
}
function renderStreamingMessage(session,message) {
  if (active !== session || message.status !== 'pending') return
  const entry = messageNodes.get(message)
  const body = entry?.node.querySelector('.message-body')
  if (!body) return
  const following = followLatest
  let content = body.querySelector('.message-content')
  if (!content) {
    content = element('div','message-content message-streaming')
    content.dataset.testid = 'chat-streaming-text'
    body.querySelector('.message-progress').before(content)
  }
  renderMessageMarkdown(content,message.text)
  if (message.progress?.phase === 'model') body.querySelector('.message-progress').textContent = t('progressWriting')
  entry.key = null
  if (following) ui.conversation.scrollTop = ui.conversation.scrollHeight
  updateLatestButton()
}
function resizeComposer() {
  ui.input.style.height = 'auto'
  ui.input.style.height = `${Math.min(200,Math.max(60,ui.input.scrollHeight))}px`
}
function updateLatestButton() {
  ui.jumpLatest.hidden = ui.messages.hidden || ui.conversation.scrollHeight - ui.conversation.scrollTop - ui.conversation.clientHeight < 100
}
function pendingWorkspaceProposal() {
  const pending = (active?.messages ?? []).flatMap(message => message.proposals ?? [])
    .filter(proposal => proposal.uiState === 'pending' && !unsavedProposals.has(proposal))
  return pending.find(proposal=>proposal.planId === workspacePlanId) ?? pending.at(-1) ?? null
}
function showWorkspace(proposal = null) {
  workspaceVisible = true
  if (proposal?.uiState === 'pending') {
    workspacePlanId = proposal.planId
    workspaceMode = 'proposal'
  } else workspaceMode = 'document'
  renderWorkspace()
}
function renderWorkspace() {
  if (!ui.workspace) return
  const pending = pendingWorkspaceProposal()
  const saving = (active?.messages ?? []).flatMap(message=>message.proposals ?? []).find(proposal=>savingProposals.has(proposal))
  const review = saving ?? pending
  const hasDrawing = Boolean(active && (active.source || active.runtime.entityCount || pending))
  if (workspaceSession !== active) {
    workspaceViewer?.destroy()
    workspaceViewer = null
    workspaceSession = active
    workspaceReviewKey = ''
    workspaceVisible = hasDrawing
    workspacePlanId = pending?.planId ?? null
    workspaceMode = pending ? 'proposal' : 'document'
    ui.workspace.dataset.mobileView = 'chat'
  }
  if (pending && pending.planId !== workspacePlanId) {
    workspacePlanId = pending.planId
    workspaceMode = 'proposal'
    workspaceVisible = true
  }
  if (!pending && workspaceMode === 'proposal') workspaceMode = 'document'
  // Approval consumes the pending plan before its durable history write ends.
  // Any already scheduled RAF must paint the actual native document during
  // this barrier, never an expired proposal. Keep the requested review mode
  // so a failed approval with a still-valid pending plan can return to it.
  const displayedMode = saving ? 'document' : workspaceMode
  const visible = workspaceVisible && hasDrawing
  ui.drawingPanel.hidden = ui.divider.hidden = !visible
  ui.workspaceTabs.hidden = !hasDrawing
  ui.workspaceToggle.hidden = !hasDrawing
  ui.workspaceToggle.setAttribute('aria-expanded',String(visible))
  document.body.classList.toggle('has-drawing',hasDrawing)
  ui.workspaceTitle.textContent = active?.source?.name ?? t('currentDrawing')
  ui.workspaceMeta.textContent = active ? `${active.runtime.entityCount} ${t('entities')} · REV ${active.runtime.revision}` : ''
  ui.currentView.textContent = t('currentView')
  ui.proposalView.textContent = t('proposalView')
  ui.proposalView.hidden = !pending
  ui.proposalView.disabled = !pending || Boolean(saving) || busy || importing
  ui.currentView.setAttribute('aria-selected',String(displayedMode === 'document'))
  ui.proposalView.setAttribute('aria-selected',String(displayedMode === 'proposal'))
  ui.workspaceDownload.disabled = !active || busy || importing || Boolean(active.source?.exportRestricted) || !active.runtime.entityCount
  ui.workspaceUndo.disabled = ui.undo.disabled
  ui.workspaceRedo.disabled = ui.redo.disabled
  ui.tabChat.setAttribute('aria-selected',String(ui.workspace.dataset.mobileView !== 'drawing'))
  ui.tabDrawing.setAttribute('aria-selected',String(ui.workspace.dataset.mobileView === 'drawing'))
  const reviewKey = JSON.stringify([language,review?.planId,review?.uiState,busy,importing,Boolean(saving)])
  if (workspaceReviewKey !== reviewKey) {
    workspaceReviewKey = reviewKey
    ui.workspaceReview.replaceChildren()
    ui.workspaceReview.hidden = !review
    if (review) {
      const heading = element('h3','workspace-review-title',t(saving ? 'working' : 'proposalPending'))
      const summary = element('p','workspace-review-summary',t(saving ? 'reviewSavingHint' : 'reviewHint'))
      const before = review.preview?.before, after = review.preview?.after
      if (Array.isArray(before) && Array.isArray(after)) summary.append(element('span','workspace-change-count',
        ` ${t('changedObjects')}: ${t('beforeLabel')} ${before.length} → ${t('afterLabel')} ${after.length}`))
      const actions = element('div','workspace-review-actions')
      for (const [action,label] of [['approve','approve'],['reject','reject']]) {
        const button = element('button',action === 'approve' ? 'approve' : '',t(label))
        button.type = 'button'
        button.id = `workspace-${action}`
        button.disabled = busy || importing || Boolean(saving)
        button.addEventListener('click',()=>{
          const card = [...ui.messages.querySelectorAll('[data-plan-id]')].find(node=>node.dataset.planId === review.planId)
          card?.querySelector(`[data-testid="proposal-${action}"]`)?.click()
        })
        actions.append(button)
      }
      ui.workspaceReview.append(heading,summary,actions)
    }
  }
  if (!visible) return
  const options = {mode:displayedMode,planId:pending?.planId,preserveCamera:true,
    labels:viewerLabels(t(displayedMode === 'proposal' ? 'proposalView' : 'currentView'))}
  try {
    if (!workspaceViewer) workspaceViewer = createDrawingViewer({container:ui.workspaceViewer,runtime:active.runtime,...options})
    else workspaceViewer.refresh(options)
  } catch { ui.workspaceViewer.replaceChildren(element('p','proposal-preview-fallback',t('previewMissing'))) }
}
function updateHistoryStorageNotice() {
  const runtime = active?.runtime
  const saved = runtime?.historyStorage
  ui.historyWarning.hidden = !runtime?.historyRestoreWarning && !saved?.limited
  ui.historyWarning.textContent = runtime?.historyRestoreWarning ? t('historyUnavailable')
    : t('historyLimited').replace('{undo}',saved?.undoCount ?? 0).replace('{redo}',saved?.redoCount ?? 0)
}
function renderDrawingContext(session) {
  if (session !== active || !ui.drawingContext.open || !ui.drawingCanvas.isConnected) return
  if (contextViewer) { contextViewer.refresh({preserveCamera:true}); return }
  let mount = byId('drawing-viewer-mount')
  if (!mount) {
    mount = element('div')
    mount.id = 'drawing-viewer-mount'
    ui.drawingContext.append(mount)
  }
  try {
    contextViewer = createDrawingViewer({ container:mount, canvas:ui.drawingCanvas, runtime:session.runtime,
      mode:'document', labels:viewerLabels(session.source?.name ?? t('currentDrawing')) })
    registerViewer(contextViewer,mount)
  } catch { mount.replaceChildren(element('p','proposal-preview-fallback',t('previewMissing'))) }
}
function createProposalCard(session, proposal) {
  const card = element('section','proposal-card')
  card.dataset.testid = 'drawing-result'
  card.dataset.planId = proposal.planId
  card.setAttribute('aria-label',t('proposal'))
  const header = element('div','proposal-head')
  const titleGroup = element('div')
  const state = savingProposals.has(proposal) ? 'saving' : unsavedProposals.has(proposal) ? 'unsaved' : proposal.uiState ?? 'pending'
  titleGroup.append(element('h3','proposal-title',t(state === 'approved' ? 'currentDrawing' : 'proposal')),
    element('p','proposal-subtitle',t('revisionLabel').replace('{revision}',String(state === 'approved' ? session.runtime.revision : proposal.expectedRevision ?? '?'))))
  const tag = element('span','proposal-tag '+(state === 'approved' ? 'approved' : state === 'rejected' ? 'rejected' : ''),t(state === 'approved' ? 'proposalApproved' : state === 'rejected' ? 'proposalRejected' : state === 'expired' ? 'proposalExpired' : state === 'saving' ? 'working' : state === 'unsaved' ? 'proposalUnsaved' : 'proposalPending'))
  header.append(titleGroup,tag)
  const preview = element('div','proposal-preview')
  let viewer = null
  if (state === 'pending' || state === 'approved' || state === 'unsaved' || state === 'saving') {
    requestAnimationFrame(()=>{
      if (!preview.isConnected || session !== active) return
      try {
        const pendingView = proposal.uiState === 'pending' && !savingProposals.has(proposal)
        viewer = createDrawingViewer({ container:preview, runtime:session.runtime,
          mode:pendingView ? 'proposal' : 'document', planId:proposal.planId,
          labels:viewerLabels(t(pendingView ? 'proposal' : 'currentDrawing')) })
        registerViewer(viewer,preview)
      } catch { preview.replaceChildren(element('div','proposal-preview-fallback',t('previewMissing'))) }
    })
  } else preview.append(element('div','proposal-preview-fallback',t(state === 'rejected' ? 'proposalRejected' : 'proposalExpired')))
  const details = element('details','proposal-details')
  details.append(element('summary','',t('reviewDetails')))
  const safeDetails = {command:proposal.command,expectedRevision:proposal.expectedRevision,preview:proposal.preview,engineeringEvidence:proposal.engineeringEvidence}
  details.append(element('pre','',JSON.stringify(safeDetails,null,2)))
  const actions = element('div','proposal-actions')
  if (state === 'pending' || state === 'approved' || state === 'unsaved') {
    const openWorkspace = element('button','open-workspace',t('openWorkspace'))
    openWorkspace.type = 'button'
    openWorkspace.addEventListener('click',()=>{
      showWorkspace(proposal)
      if (matchMedia('(max-width:800px)').matches) {
        ui.workspace.dataset.mobileView = 'drawing'
        renderWorkspace()
      }
    })
    actions.append(openWorkspace)
  }
  if (state === 'pending') {
    const approve = element('button','approve',t('approve'))
    const reject = element('button','',t('reject'))
    approve.type = reject.type = 'button'
    approve.dataset.testid = 'proposal-approve'
    reject.dataset.testid = 'proposal-reject'
    approve.addEventListener('click',async()=>{
      if (busy || importing) return
      busy = true
      updateComposerAvailability()
      savingProposals.add(proposal)
      approve.disabled = reject.disabled = true
      viewer?.refresh({mode:'document',preserveCamera:true,labels:viewerLabels(t('currentDrawing'))})
      renderWorkspace()
      let result
      try { result = await session.runtime.approve(proposal.planId) }
      catch { result = { status:'error', error:{message:t('retry')} } }
      let message
      if (result.status === 'applied') {
        proposal.uiState = 'approved'
        if (session.source) session.source.entityCount = session.runtime.entityCount
        for (const message of session.messages) for (const other of message.proposals ?? []) if (other !== proposal && other.uiState === 'pending') other.uiState = 'expired'
        message = {role:'assistant',text:result.text}
      } else {
        // A failed adapter may leave a valid plan, but native approval can also
        // consume it. Do not advertise a retryable pending preview unless the
        // actual runtime still accepts that exact plan/revision.
        try { session.runtime.getViewerCamera({mode:'proposal',planId:proposal.planId}) }
        catch { proposal.uiState = 'expired' }
        message = {role:'assistant',status:'error',text:result.error?.message ?? t('retry')}
      }
      session.messages.push(message)
      await persistTerminal(session, [message], [proposal])
      if (proposal.uiState === 'pending' && !unsavedProposals.has(proposal)) {
        approve.disabled = reject.disabled = false
        viewer?.refresh({mode:'proposal',planId:proposal.planId,preserveCamera:true,labels:viewerLabels(t('proposal'))})
      }
      busy = false
      render()
    })
    reject.addEventListener('click',async()=>{
      if (busy || importing) return
      busy = true
      updateComposerAvailability()
      savingProposals.add(proposal)
      approve.disabled = reject.disabled = true
      viewer?.refresh({mode:'document',preserveCamera:true,labels:viewerLabels(t('currentDrawing'))})
      renderWorkspace()
      const result = session.runtime.reject(proposal.planId)
      const message = result.status === 'rejected' ? {role:'assistant',text:result.text}
        : {role:'assistant',status:'error',text:result.error?.message ?? t('retry')}
      if (result.status === 'rejected') proposal.uiState = 'rejected'
      else {
        try { session.runtime.getViewerCamera({mode:'proposal',planId:proposal.planId}) }
        catch { proposal.uiState = 'expired' }
      }
      session.messages.push(message)
      await persistTerminal(session, [message], [proposal])
      busy = false
      render()
    })
    actions.append(approve,reject)
  }
  if (state === 'approved' || state === 'unsaved') {
    const download = element('button','',t('download'))
    download.type = 'button'
    download.dataset.testid = 'drawing-download'
    download.addEventListener('click',()=>downloadDrawing(session))
    const expand = element('button','',t('viewDrawing'))
    expand.type = 'button'
    expand.dataset.testid = 'drawing-expand'
    expand.addEventListener('click',()=>viewer?.enlarge())
    actions.append(download,expand)
  }
  const changes = geologySourceChanges(proposal.engineeringEvidence)
  const sourceReview = element('div','source-review')
  if (changes.length) {
    sourceReview.dataset.testid = 'geology-source-changes'
    sourceReview.append(element('h4','',language === 'zh' ? '钻孔数据修改' : 'Borehole data changes'))
    const table = element('table'), head = element('tr')
    for (const text of language === 'zh' ? ['钻孔 / 字段','修改前','修改后'] : ['Borehole / field','Before','After']) head.append(element('th','',text))
    const thead = element('thead'); thead.append(head); table.append(thead)
    const tbody = element('tbody')
    const labels = language === 'zh'
      ? {collarElevation:'孔口高程',depth:'孔深',station:'里程',initialWaterDepth:'初见水位',stableWaterDepth:'稳定水位',strata:'分层',observations:'取样 / 标贯',groundwaterObservations:'地下水观测'}
      : {collarElevation:'Collar elevation',depth:'Depth',station:'Station',initialWaterDepth:'Initial water depth',stableWaterDepth:'Stable water depth',strata:'Strata',observations:'Samples / SPT',groundwaterObservations:'Groundwater observations'}
    for (const change of changes) {
      const row = element('tr')
      for (const text of [`${change.holeId} · ${labels[change.field]}`,change.before,change.after]) row.append(element('td','',text))
      tbody.append(row)
    }
    table.append(tbody); sourceReview.append(table)
  }
  card.append(header,preview,...(changes.length ? [sourceReview] : []),details,actions)
  return card
}
async function downloadDrawing(session) {
  if (busy || importing) return false
  try {
    const data = await session.runtime.exportDocument('DXF')
    const blob = new Blob([data],{type:'application/dxf'})
    const url = URL.createObjectURL(blob)
    const link = element('a')
    link.href = url
    link.download = `${(session.source?.name ?? 'kjdraw-ai-drawing').replace(/\.(kjd|kjp|dxf)$/i,'')}.dxf`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(()=>URL.revokeObjectURL(url),60000)
    return true
  } catch(error) {
    session.messages.push({role:'assistant',status:'error',text:drawingExportError(error)})
    if(active===session) render()
    queuePersist()
    return false
  }
}
function showSettings(continueSend = false) {
  pendingSend = continueSend
  ui.settingsError.hidden = true
  ui.provider.value = settings?.provider ?? (language === 'zh' ? 'deepseek' : 'openai-responses')
  const preset = getChatModelProviderPreset(ui.provider.value)
  ui.model.value = settings?.model ?? preset.models[0] ?? ''
  ui.endpoint.value = settings?.endpoint ?? formatChatModelUpstreamEndpoint(preset, ui.model.value)
  ui.protocol.value = settings?.protocol ?? preset.protocol
  populateCommonModels()
  ui.details.open = ui.provider.value === 'custom'
  ui.key.value = ''
  refreshKeyPlaceholder()
  ui.dialog.showModal()
  ui.provider.focus()
}
function hideSettings() {ui.key.value='';ui.dialog.close();pendingSend=false}
function canReuseKey(endpoint = ui.endpoint.value.trim(), provider = ui.provider.value, protocol = ui.protocol.value) {
  return Boolean(settings?.apiKey && settings.endpoint === endpoint && settings.provider === provider && settings.protocol === protocol)
}
function refreshKeyPlaceholder() {
  ui.key.placeholder = canReuseKey() ? (language === 'zh' ? '已设置，留空沿用' : 'Set; leave blank to keep')
    : (language === 'zh' ? '输入服务商 API 密钥' : 'Enter provider API key')
}
export function requestErrorMessage(error, fallback) {
  const details = error?.details
  const phases = { 'request-extensions': ['模型请求设置', 'Model request settings'], 'tool-schema': ['可用工具说明', 'Available tool definitions'],
    request: ['本次请求与工具读取记录', 'The request and tool-read history'], response: ['模型返回内容', 'The model response'],
    stream: ['模型流式返回内容', 'The streamed model response'], image: ['附加图片', 'The attached image'] }
  if (error?.code !== 'KJMODEL_SIZE_LIMIT' || !details || !Object.hasOwn(phases, details.phase) ||
    !Number.isSafeInteger(details.actualBytes) || details.actualBytes < 0 ||
    !Number.isSafeInteger(details.maxBytes) || details.maxBytes <= 0) return error?.message ?? fallback
  const label = phases[details.phase][language === 'zh' ? 0 : 1]
  return language === 'zh'
    ? `${label}超过大小限制（实际 ${details.actualBytes} 字节，上限 ${details.maxBytes} 字节）。图纸未修改；请精简对应内容后重试。`
    : `${label} exceeded the size limit (${details.actualBytes} bytes; maximum ${details.maxBytes} bytes). The drawing is unchanged. Reduce that content and try again.`
}
async function submitPrompt() {
  await initialLoad
  const prompt = ui.input.value.trim()
  if (!prompt || busy || importing) return
  clearTimeout(draftTimer)
  if (!settings) { showSettings(true); queuePersist(); return }
  const session = currentSession()
  if (settings) session.runtime.configure(settings)
  if (!session.messages.length) session.title = prompt.replace(/\s+/g,' ').slice(0,34)
  session.messages.push({role:'user',text:prompt})
  session.updatedAt = Date.now()
  const waiting = {role:'assistant',status:'pending',text:''}
  session.messages.push(waiting)
  busy = true
  followLatest = true
  activeRequest = new AbortController()
  const controller = activeRequest
  activeRequestSession = session
  let finishRequest
  activeRequestFinished = new Promise(resolve=>{finishRequest=resolve})
  let streamFrame = null
  ui.send.hidden = true
  ui.stop.hidden = false
  ui.input.value = ''
  session.draft = ''
  resizeComposer()
  render()
  try {
    const result = await session.runtime.send(prompt,{signal:controller.signal,onProgress:progress=>{
      if (controller.signal.aborted) return
      waiting.progress = progress
      const progressNode = messageNodes.get(waiting)?.node.querySelector('.message-progress')
      if (progressNode) {
        progressNode.textContent = waiting.text && progress.phase === 'model' ? t('progressWriting') : progressText(progress)
        progressNode.dataset.phase = progress.phase
      }
    },onTextDelta:event=>{
      if (controller.signal.aborted || removing) return
      waiting.text = event.text
      if (streamFrame === null) streamFrame = requestAnimationFrame(()=>{
        streamFrame = null
        renderStreamingMessage(session,waiting)
      })
    }})
    const index = session.messages.indexOf(waiting)
    if (index >= 0) session.messages.splice(index,1)
    if (result.status === 'proposal') {
      // Mirror the runtime's successful replacement handoff, not request
      // submission. A failed/cancelled run leaves an unchanged review usable.
      for (const message of session.messages) for (const proposal of message.proposals ?? []) if (proposal.uiState === 'pending') proposal.uiState = 'expired'
      session.messages.push({role:'assistant',text:result.text,proposals:(result.proposals?.length ? result.proposals : [result.proposal]).map(proposal => ({...proposal, uiState:'pending'}))})
      if (active === session) ui.drawingContext.open = false
    }
    else if (result.status === 'message') session.messages.push({role:'assistant',text:result.text,...(result.noProposal ? {status:'not-proposed'} : {})})
    else if (result.status === 'cancelled') {
      session.messages.push({role:'assistant',text:t('stopped')})
      restoreRequestDraft(session,prompt)
    }
    else {
      session.messages.push({role:'assistant',status:'error',text:requestErrorMessage(result.error, result.text || t('retry'))})
      restoreRequestDraft(session,prompt)
    }
  } catch(error) {
    const index = session.messages.indexOf(waiting)
    if (index >= 0) session.messages.splice(index,1)
    session.messages.push({role:'assistant',status:'error',text:error?.message ?? t('retry')})
    restoreRequestDraft(session,prompt)
  } finally {
    if (streamFrame !== null) cancelAnimationFrame(streamFrame)
    if (active === session) session.draft = ui.input.value
    const terminal = session.messages.filter(message => message !== waiting && message.role === 'assistant').at(-1)
    if (terminal) await persistTerminal(session, [terminal])
    busy = false
    activeRequest = null
    activeRequestSession = null
    ui.stop.hidden = true
    ui.send.hidden = false
    render()
    if (active === session) { resizeComposer(); ui.input.focus() }
    finishRequest()
    activeRequestFinished = null
  }
}
function restoreRequestDraft(session,prompt) {
  if (active === session) {
    if (!ui.input.value) ui.input.value = prompt
    session.draft = ui.input.value
  } else if (!session.draft) session.draft = prompt
}
function setDraft(value) {
  if (removing || deleting) return
  ui.input.value = value
  currentSession().draft = value
  resizeComposer()
  clearTimeout(draftTimer)
  draftTimer = setTimeout(()=>{if(!busy && !importing) queuePersist()},500)
}
function closeSidebar(){ui.sidebar.classList.remove('open');ui.scrim.hidden=true;ui.menu.setAttribute('aria-expanded','false')}
function showImportError(message) {
  ui.importError.textContent = message
  ui.importError.hidden = false
}
async function requestDrawingRemoval() {
  await initialLoad
  if (!active?.source || importing || busy && activeRequestSession !== active) return
  if (active.runtime.hasAppliedChanges) {
    removalSession = active
    ui.removeDrawingDialog.showModal()
    byId('remove-drawing-cancel').focus()
  } else await removeDrawing(active)
}
async function removeDrawing(session) {
  if (session !== active || !session.source || importing || busy && activeRequestSession !== session) return
  importing = removing = true
  ui.openDrawing.disabled = ui.attachDrawing.disabled = true
  updateComposerAvailability()
  let candidate = null
  try {
    // A removed drawing cannot still be read or receive a late proposal from
    // an in-flight request. Wait through its durable cancellation completion.
    if (activeRequestSession === session) {
      const finished = activeRequestFinished
      activeRequest.abort()
      await finished
    }
    const name = session.source.name
    // A completely separate blank runtime makes removal durable-first. The
    // original drawing, source recipe, history and pending plans remain intact
    // until the candidate's actual IndexedDB completion receipt is delivered.
    const runtime = createAiChatRuntime({ ...(settings ?? {}), toolProfile:session.runtime.toolProfile })
    candidate = { ...session, runtime, source:null, drawingRemoved:true, updatedAt:Date.now(),
      messages:session.messages.map(message=>{ const { proposals, ...retained } = message; return structuredClone(retained) }),
      draft:ui.input.value,
      title:session.title === name ? session.messages.find(message=>message.role === 'user')?.text.replace(/\s+/g,' ').slice(0,34) ?? t('newConversation') : session.title }
    pendingRemoval = candidate
    if (!await queuePersist({ replacementSession:candidate })) throw new Error(t('storageFailed'))
    const previousRuntime = session.runtime
    // Cancellation may have restored the request draft programmatically while
    // the composer is read-only. Install that exact captured draft unchanged.
    candidate.draft = ui.input.value
    Object.assign(session, candidate)
    candidate = null
    previousRuntime.destroy()
    disposeDrawingViewers()
    ui.messages.replaceChildren()
    workspaceViewer?.destroy()
    workspaceViewer = null
    ui.workspaceViewer.replaceChildren()
    workspaceVisible = false
    workspaceMode = 'document'
    workspacePlanId = null
    workspaceReviewKey = ''
    ui.workspace.dataset.mobileView = 'chat'
    ui.drawingContext.open = false
    ui.drawingFile.value = ''
    ui.importError.hidden = true
    render()
  } catch(error) {
    candidate?.runtime.destroy()
    showImportError(t('storageFailed'))
  } finally {
    pendingRemoval = null
    importing = removing = false
    ui.openDrawing.disabled = ui.attachDrawing.disabled = false
    render()
    queuePersist()
    ui.input.focus()
  }
}
async function openDrawing(file) {
  if (!file) return
  await initialLoad
  if (busy || importing) { showImportError(t('importBusy')); return }
  importing = true
  ui.openDrawing.disabled = ui.attachDrawing.disabled = true
  updateComposerAvailability()
  const runtime = createAiChatRuntime(settings ?? {})
  try {
    const source = await runtime.importDocument(file)
    source.exportRestricted = hasUnsupportedDxfMetadata(await runtime.exportLocalState())
    const candidate = sessionRecord(runtime, source)
    candidate.draft = ui.input.value
    pendingImport = candidate
    if (!await queuePersist({ extraSession: candidate })) throw new Error(t('storageFailed'))
    pendingImport = null
    ui.drawingContext.open = false
    activateSession(candidate)
    ui.importError.hidden = true
    render()
    ui.input.focus()
  } catch (error) {
    pendingImport = null
    runtime.destroy()
    showImportError(error?.message ?? t('importFailed'))
  } finally {
    pendingImport = null
    importing = false
    ui.openDrawing.disabled = ui.attachDrawing.disabled = false
    updateComposerAvailability()
    ui.drawingFile.value = ''
    ui.dropOverlay.hidden = true
    renderWorkspace()
    queuePersist()
  }
}
function hasDroppedFiles(event) { return [...(event.dataTransfer?.types ?? [])].includes('Files') }
async function applyDrawingHistory(kind) {
  await initialLoad
  if (!active || busy || importing) return
  const session = active
  busy = true
  render()
  try {
    const result = await session.runtime.applyHistory(kind)
    if (result.status === 'applied') {
      for (const message of session.messages) for (const proposal of message.proposals ?? []) {
        if (proposal.uiState === 'pending') proposal.uiState = 'expired'
      }
      if (session.source) session.source.entityCount = session.runtime.entityCount
      session.messages.push({ role:'assistant', text:result.text })
      session.updatedAt = Date.now()
    } else session.messages.push({ role:'assistant', status:'error', text:result.error?.message ?? t('retry') })
  } catch (error) {
    session.messages.push({ role:'assistant', status:'error', text:error?.message ?? t('retry') })
  } finally {
    const terminal = session.messages.filter(message => message.role === 'assistant').at(-1)
    if (terminal) await persistTerminal(session, [terminal])
    busy = false
    render()
  }
}
ui.undo.addEventListener('click',()=>applyDrawingHistory('undo'))
ui.redo.addEventListener('click',()=>applyDrawingHistory('redo'))
for (const button of [ui.openDrawing,ui.attachDrawing]) button.addEventListener('click',()=>ui.drawingFile.click())
ui.drawingFile.addEventListener('change',()=>openDrawing(ui.drawingFile.files?.[0]))
ui.drawingContext.addEventListener('toggle',()=>{ if (ui.drawingContext.open && active?.source) requestAnimationFrame(()=>renderDrawingContext(active)) })
ui.removeDrawing.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();requestDrawingRemoval()})
ui.removeDrawingForm.addEventListener('submit',event=>{
  event.preventDefault()
  const session = removalSession
  ui.removeDrawingDialog.close()
  removalSession = null
  if (session) removeDrawing(session)
})
byId('remove-drawing-cancel').addEventListener('click',()=>ui.removeDrawingDialog.close())
ui.removeDrawingDialog.addEventListener('close',()=>{removalSession=null})
window.addEventListener('dragover',event=>{
  if (!hasDroppedFiles(event)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  ui.dropOverlay.hidden = false
})
window.addEventListener('dragleave',event=>{ if (!event.relatedTarget) ui.dropOverlay.hidden = true })
window.addEventListener('drop',event=>{
  if (!hasDroppedFiles(event)) return
  event.preventDefault()
  ui.dropOverlay.hidden = true
  openDrawing(event.dataTransfer.files?.[0])
})
ui.stop.addEventListener('click',()=>{activeRequest?.abort()})
ui.form.addEventListener('submit',event=>{event.preventDefault();submitPrompt()})
ui.input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();submitPrompt()}})
let draftTimer = null
ui.input.addEventListener('input',()=>{
  resizeComposer()
  const session = currentSession()
  session.draft = ui.input.value
  clearTimeout(draftTimer)
  draftTimer = setTimeout(()=>{if(!busy && !importing) queuePersist()},500)
})
ui.conversation.addEventListener('scroll',()=>{
  followLatest = ui.conversation.scrollHeight - ui.conversation.scrollTop - ui.conversation.clientHeight < 100
  updateLatestButton()
},{passive:true})
ui.jumpLatest.addEventListener('click',()=>{
  followLatest = true
  ui.conversation.scrollTo({top:ui.conversation.scrollHeight,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth'})
})
ui.workspaceToggle.addEventListener('click',()=>{
  workspaceVisible = !workspaceVisible
  if (!workspaceVisible) ui.workspace.dataset.mobileView = 'chat'
  renderWorkspace()
})
ui.workspaceClose.addEventListener('click',()=>{
  workspaceVisible = false
  ui.workspace.dataset.mobileView = 'chat'
  renderWorkspace()
})
ui.currentView.addEventListener('click',()=>{workspaceMode='document';renderWorkspace()})
ui.proposalView.addEventListener('click',()=>{workspaceMode='proposal';renderWorkspace()})
ui.workspaceDownload.addEventListener('click',event=>{event.preventDefault();if(active && !busy && !importing && !ui.workspaceDownload.disabled) downloadDrawing(active)})
ui.workspaceUndo.addEventListener('click',()=>applyDrawingHistory('undo'))
ui.workspaceRedo.addEventListener('click',()=>applyDrawingHistory('redo'))
ui.tabChat.addEventListener('click',()=>{ui.workspace.dataset.mobileView='chat';renderWorkspace()})
ui.tabDrawing.addEventListener('click',()=>{workspaceVisible=true;ui.workspace.dataset.mobileView='drawing';renderWorkspace()})
let dividerPointer = null
function setWorkspaceWidth(width) {
  const max = Math.max(300,ui.workspace.clientWidth - 340)
  ui.workspace.style.setProperty('--drawing-width',`${Math.min(max,Math.max(300,width))}px`)
  ui.divider.setAttribute('aria-valuenow',String(Math.round(Math.min(max,Math.max(300,width)))))
}
ui.divider.addEventListener('pointerdown',event=>{
  if (event.button !== 0) return
  dividerPointer = event.pointerId
  ui.divider.setPointerCapture(event.pointerId)
  ui.workspace.classList.add('is-resizing')
  event.preventDefault()
})
ui.divider.addEventListener('pointermove',event=>{
  if (dividerPointer !== event.pointerId) return
  setWorkspaceWidth(ui.workspace.getBoundingClientRect().right - event.clientX)
})
for (const eventName of ['pointerup','pointercancel','lostpointercapture']) ui.divider.addEventListener(eventName,()=>{
  dividerPointer = null
  ui.workspace.classList.remove('is-resizing')
})
ui.divider.addEventListener('keydown',event=>{
  if (!['ArrowLeft','ArrowRight','Home'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Home') ui.workspace.style.removeProperty('--drawing-width')
  else setWorkspaceWidth(ui.drawingPanel.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 32 : -32))
})
byId('sidebar-toggle').addEventListener('click',()=>{
  const collapsed = document.querySelector('.app-shell').classList.toggle('sidebar-collapsed')
  byId('sidebar-toggle').setAttribute('aria-expanded',String(!collapsed))
})
ui.provider.addEventListener('change',()=>{
  const preset = getChatModelProviderPreset(ui.provider.value)
  if (preset.id === 'custom') {
    ui.protocol.value = 'chat-completions'
    ui.details.open = true
    populateCommonModels()
    refreshKeyPlaceholder()
    ui.endpoint.focus()
    return
  }
  ui.protocol.value = preset.protocol
  ui.model.value = preset.models[0] ?? ''
  ui.endpoint.value = formatChatModelUpstreamEndpoint(preset, ui.model.value)
  populateCommonModels()
  ui.details.open = false
  refreshKeyPlaceholder()
})
ui.commonModel.addEventListener('change',()=>{
  const preset = getChatModelProviderPreset(ui.provider.value)
  const oldAutomatic = formatChatModelUpstreamEndpoint(preset, ui.model.value)
  if (!ui.commonModel.value) { ui.details.open = true; ui.model.focus(); return }
  ui.model.value = ui.commonModel.value
  if (ui.endpoint.value === oldAutomatic) ui.endpoint.value = formatChatModelUpstreamEndpoint(preset, ui.model.value)
  refreshKeyPlaceholder()
})
ui.endpoint.addEventListener('input',refreshKeyPlaceholder)
ui.model.addEventListener('input',()=>{
  const preset = getChatModelProviderPreset(ui.provider.value)
  ui.commonModel.value = preset.models.includes(ui.model.value.trim()) ? ui.model.value.trim() : ''
})
ui.protocol.addEventListener('change',()=>{
  if (ui.provider.value !== 'custom' && ui.protocol.value !== getChatModelProviderPreset(ui.provider.value).protocol) {
    ui.provider.value = 'custom'
    populateCommonModels()
  }
  refreshKeyPlaceholder()
})
ui.settingsForm.addEventListener('submit',async event=>{
  event.preventDefault()
  if (busy || importing) {ui.settingsError.textContent=t('importBusy');ui.settingsError.hidden=false;return}
  const endpoint=ui.endpoint.value.trim(), model=ui.model.value.trim()
  const provider=ui.provider.value, protocol=ui.protocol.value
  const apiKey=ui.key.value.trim() || (canReuseKey(endpoint,provider,protocol) ? settings.apiKey : '')
  if(!endpoint||!model){ui.settingsError.textContent=t('invalidSettings');ui.settingsError.hidden=false;return}
  if(provider !== 'custom' && !apiKey){ui.settingsError.textContent=t('keyRequired');ui.settingsError.hidden=false;return}
  try {
    const url=new URL(endpoint)
    if(!['https:','http:'].includes(url.protocol) || endpoint.includes('{')) throw new Error()
    currentSession().runtime.configure({endpoint,model,apiKey,provider,protocol})
  } catch(error) {ui.settingsError.textContent=error?.message && error.message !== 'Invalid URL' ? error.message : t('invalidEndpoint');ui.settingsError.hidden=false;return}
  settings={endpoint,model,apiKey,provider,protocol}
  const shouldSend=pendingSend
  try {
    if (!await queuePersist()) throw new Error('Local history is unavailable')
  } catch {ui.settingsError.textContent=t('storageFailed');ui.settingsError.hidden=false;return}
  hideSettings()
  updateConnection()
  if(shouldSend) submitPrompt()
})
byId('settings-close').addEventListener('click',hideSettings)
byId('settings-cancel').addEventListener('click',hideSettings)
ui.dialog.addEventListener('close',()=>{ui.key.value='';pendingSend=false})
ui.settingsOpen.addEventListener('click',()=>showSettings(false))
byId('new-chat').addEventListener('click',async()=>{
  await initialLoad
  if (removing || deleting) return
  if(active?.messages.length || active?.source) { active.draft = ui.input.value; createSession() }
  else { if(active) active.draft='';ui.input.value='';render();resizeComposer() }
  queuePersist();closeSidebar();ui.input.focus()
})
ui.historySearch.addEventListener('input',renderSidebar)
document.addEventListener('click',event=>{
  for (const menu of ui.list.querySelectorAll('.history-menu[open]')) if (!menu.contains(event.target)) menu.open = false
})
document.addEventListener('keydown',event=>{
  if(event.key === 'Escape') for(const menu of ui.list.querySelectorAll('.history-menu[open]')) menu.open=false
})
byId('history-cancel').addEventListener('click',()=>ui.historyDialog.close())
ui.historyDialog.addEventListener('close',()=>{ historyAction = null })
ui.historyForm.addEventListener('submit',async event=>{
  event.preventDefault()
  if (removing || deleting || importing) return
  const choice = historyAction
  if (!choice || !sessions.includes(choice.session)) { ui.historyDialog.close(); return }
  if (choice.action === 'rename') {
    const title = ui.historyTitleInput.value.trim()
    if (!title) { ui.historyTitleInput.setCustomValidity(t('emptyTitle')); ui.historyTitleInput.reportValidity(); return }
    choice.session.title = title
    choice.session.updatedAt = Date.now()
  } else {
    if (busy) { ui.historyDialog.close(); showImportError(t('busyHistory')); return }
    const nextActive = active === choice.session ? sessions.find(session=>session !== choice.session) ?? null : active
    deleting = importing = true
    pendingDeletion = choice.session
    ui.historyDialog.close()
    ui.openDrawing.disabled = ui.attachDrawing.disabled = true
    updateComposerAvailability()
    try {
      if (!await queuePersist({ deletedSession:choice.session, activeIdOverride:nextActive?.id ?? null })) throw new Error(t('storageFailed'))
      choice.session.runtime.destroy()
      sessions = sessions.filter(session=>session !== choice.session)
      active = nextActive
    } catch {
      showImportError(t('storageFailed'))
    } finally {
      pendingDeletion = null
      deleting = importing = false
      ui.openDrawing.disabled = ui.attachDrawing.disabled = false
      render()
      queuePersist()
    }
    return
  }
  ui.historyDialog.close()
  render()
  queuePersist()
})
ui.historyTitleInput.addEventListener('input',()=>ui.historyTitleInput.setCustomValidity(''))
byId('language-button').addEventListener('click',()=>setLanguage(language==='zh'?'en':'zh'))
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{
  setDraft(active?.source ? importedExamples[language][button.dataset.prompt].prompt : examples[language][button.dataset.prompt])
  ui.input.focus()
}))
ui.menu.addEventListener('click',()=>{
  document.querySelector('.app-shell').classList.remove('sidebar-collapsed')
  byId('sidebar-toggle').setAttribute('aria-expanded','true')
  if (!matchMedia('(max-width:800px)').matches) return
  ui.sidebar.classList.add('open');ui.scrim.hidden=false;ui.menu.setAttribute('aria-expanded','true')
})
byId('sidebar-close').addEventListener('click',closeSidebar)
ui.scrim.addEventListener('click',closeSidebar)
// Completed turns and approvals are durable before their terminal UI appears;
// do not pretend an asynchronous write started at pagehide can finish reliably.
window.addEventListener('pagehide',()=>{ui.key.value=''})
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()})
setLanguage(language)
initialLoad = restoreSessions()
