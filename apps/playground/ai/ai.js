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
    importBusy:'请等待当前请求结束后再打开图纸。',drawingLoaded:'已打开图纸',entities:'个对象',
    storageFailed:'本地会话保存失败。请先下载 DXF 图纸，并检查浏览器存储空间。',
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
    importBusy:'Wait for the current request before opening a drawing.',drawingLoaded:'Drawing opened',entities:'entities',
    storageFailed:'Could not save this conversation locally. Download the DXF drawing and check browser storage.',
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

const byId = id => document.getElementById(id)
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
  drawingCanvas:byId('drawing-canvas'), importError:byId('import-error'), dropOverlay:byId('drawing-drop-overlay'),
  historySearch:byId('history-search'), historyDialog:byId('history-dialog'), historyForm:byId('history-form'),
  historyDialogTitle:byId('history-dialog-title'), historyDialogDescription:byId('history-dialog-description'),
  historyTitleInput:byId('history-title-input'), historyConfirm:byId('history-confirm'),
  historyActions:byId('drawing-history-actions'), undo:byId('drawing-undo'), redo:byId('drawing-redo'),
  historyStatus:byId('drawing-history-status'), historyWarning:byId('drawing-history-warning'),
}
let language = navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
let settings = null
let sessions = []
let active = null
let pendingSend = false
let busy = false
let activeRequest = null
let importing = false
let hydrated = false
let persistRequested = false
let persistSerial = Promise.resolve()
let initialLoad
let historyAction = null
const drawingViewers = new Set()
let contextViewer = null
let renderVersion = 0
const t = key => copy[language][key] ?? key
function viewerLabels(title) {
  return { title, zoomIn:t('zoomIn'), zoomOut:t('zoomOut'), fit:t('fitDrawing'), enlarge:t('viewDrawing'),
    close:t('closeViewer'), hint:t('viewerHint'), unavailable:t('previewMissing') }
}
function disposeDrawingViewers() {
  for (const viewer of drawingViewers) viewer.destroy()
  drawingViewers.clear()
  contextViewer = null
  if (!ui.drawingCanvas.isConnected) ui.drawingContext.append(ui.drawingCanvas)
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
  updateConnection()
  render()
}
function updateConnection() {
  ui.pill.classList.toggle('connected', Boolean(settings))
  ui.pill.querySelector('[data-text]').textContent = t(settings ? 'connected' : 'notConnected')
  ui.settingsOpen.querySelector('[data-text]').textContent = t(settings ? 'manage' : 'connect')
}
function createSession({ runtime = createAiChatRuntime(settings ?? {}), source = null } = {}) {
  if (active && !active.messages.length && !active.source) {
    active.runtime.destroy()
    sessions = sessions.filter(item => item !== active)
  }
  const session = { id: crypto.randomUUID(), title:source?.name ?? t('newConversation'), messages:[], runtime, source, updatedAt:Date.now() }
  sessions.unshift(session)
  active = session
  render()
  return session
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
function queuePersist() {
  if (!hydrated || persistRequested) return
  persistRequested = true
  persistSerial = persistSerial.catch(() => {}).then(async () => {
    persistRequested = false
    const saved = []
    for (const session of sessions.filter(item => item.messages.length || item.source)) {
      const state = await session.runtime.exportLocalState()
      saved.push({
        id: session.id, title: session.title, source: session.source, updatedAt: session.updatedAt,
        messages: session.messages.filter(message => message.status !== 'pending').map(message => ({
          role: message.role, text: message.text, status: message.status,
          ...(message.proposals ? { proposals: message.proposals.map(proposal => ({
            planId: proposal.planId, command: proposal.command, expectedRevision: proposal.expectedRevision,
            preview: proposal.preview, engineeringEvidence: proposal.engineeringEvidence, uiState: proposal.uiState,
          })) } : {}),
        })),
        state,
      })
    }
    await saveLocalHistory({
      version: 1, activeId: active?.id ?? null, sessions: saved,
      connection: settings ? {
        endpoint: settings.endpoint, model: settings.model, apiKey: settings.apiKey,
        provider: settings.provider, protocol: settings.protocol,
      } : null,
    })
    updateHistoryStorageNotice()
  }).catch(() => showImportError(t('storageFailed')))
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
            updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(), messages, runtime })
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
  const saved = sessions.filter(item => item.messages.length || item.source)
  const query = ui.historySearch.value.trim().normalize('NFKC').toLowerCase()
  const visible = saved.filter(item => item.title.normalize('NFKC').toLowerCase().includes(query))
    .sort((a,b) => b.updatedAt - a.updatedAt)
  const now = new Date()
  const midnight = new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime()
  let lastGroup = ''
  for (const session of visible) {
    const age = Math.max(0, midnight - session.updatedAt)
    const group = session.updatedAt >= midnight ? 'today' : age < 86400000 ? 'yesterday' : age < 7*86400000 ? 'lastWeek' : 'older'
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
    button.addEventListener('click',()=>{ active = session; render(); closeSidebar() })
    const menu = element('details','history-menu')
    const trigger = element('summary','history-menu-trigger','···')
    trigger.setAttribute('aria-label',session.title + ' — ' + t('rename') + ' / ' + t('deleteChat'))
    menu.append(trigger)
    for (const action of ['rename','deleteChat']) {
      const actionButton = element('button','history-menu-action'+(action === 'deleteChat' ? ' danger' : ''),t(action))
      actionButton.type = 'button'
      actionButton.addEventListener('click',()=>{ menu.open = false; openHistoryAction(action,session) })
      menu.append(actionButton)
    }
    row.append(button,menu)
    ui.list.append(row)
  }
  if (!visible.length && query) ui.list.append(element('p','history-empty',t('historyEmpty')))
  ui.count.textContent = String(saved.length)
}
function openHistoryAction(action,session) {
  if (busy) { showImportError(t('busyHistory')); return }
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
function render() {
  disposeDrawingViewers()
  const version = ++renderVersion
  renderSidebar()
  const source = active?.source
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
  }
  const messages = active?.messages ?? []
  document.body.classList.toggle('chat-empty', messages.length === 0)
  ui.empty.hidden = messages.length > 0
  ui.messages.hidden = messages.length === 0
  ui.messages.replaceChildren()
  for (const message of messages) {
    const wrapper = element('article','message '+message.role+(message.status === 'error' ? ' error' : ''))
    wrapper.dataset.testid = message.status === 'error' ? 'chat-error' : 'chat-message'
    const avatar = element('span','message-avatar',message.role === 'user' ? 'U' : 'K')
    avatar.setAttribute('aria-hidden','true')
    const body = element('div','message-body')
    body.append(element('div','message-role',t(message.role === 'user' ? 'you' : 'assistant')))
    if (message.status === 'pending') body.append(element('div','message-progress',t('working')))
    else {
      const content = element('div', 'message-content')
      if (message.role === 'user') content.textContent = message.text || t('emptyResponse')
      else renderMessageMarkdown(content, message.text || t('emptyResponse'))
      body.append(content)
    }
    if (message.status === 'not-proposed') {
      const notice = element('div','message-progress',t('noProposal'))
      notice.dataset.testid = 'chat-no-proposal'
      body.append(notice)
    }
    if (message.proposals?.length) for (const proposal of message.proposals) body.append(createProposalCard(active,proposal))
    wrapper.append(avatar,body)
    ui.messages.append(wrapper)
  }
  requestAnimationFrame(()=>{ ui.conversation.scrollTop = ui.conversation.scrollHeight })
  queuePersist()
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
  if (contextViewer) { contextViewer.refresh(); return }
  let mount = byId('drawing-viewer-mount')
  if (!mount) {
    mount = element('div')
    mount.id = 'drawing-viewer-mount'
    ui.drawingContext.append(mount)
  }
  try {
    contextViewer = createDrawingViewer({ container:mount, canvas:ui.drawingCanvas, runtime:session.runtime,
      mode:'document', labels:viewerLabels(session.source?.name ?? t('currentDrawing')) })
    drawingViewers.add(contextViewer)
  } catch { mount.replaceChildren(element('p','proposal-preview-fallback',t('previewMissing'))) }
}
function createProposalCard(session, proposal) {
  const card = element('section','proposal-card')
  card.dataset.testid = 'drawing-result'
  card.setAttribute('aria-label',t('proposal'))
  const header = element('div','proposal-head')
  const titleGroup = element('div')
  const state = proposal.uiState ?? 'pending'
  titleGroup.append(element('h3','proposal-title',t(state === 'approved' ? 'currentDrawing' : 'proposal')),
    element('p','proposal-subtitle',`REV ${state === 'approved' ? session.runtime.revision : proposal.expectedRevision ?? '?'} · ${proposal.command ?? ''}`))
  const tag = element('span','proposal-tag '+(state === 'approved' ? 'approved' : state === 'rejected' ? 'rejected' : ''),t(state === 'approved' ? 'proposalApproved' : state === 'rejected' ? 'proposalRejected' : state === 'expired' ? 'proposalExpired' : 'proposalPending'))
  header.append(titleGroup,tag)
  const preview = element('div','proposal-preview')
  let viewer = null
  if (state === 'pending' || state === 'approved') {
    requestAnimationFrame(()=>{
      if (!preview.isConnected || session !== active) return
      try {
        viewer = createDrawingViewer({ container:preview, runtime:session.runtime,
          mode:state === 'pending' ? 'proposal' : 'document', planId:proposal.planId,
          labels:viewerLabels(t(state === 'approved' ? 'currentDrawing' : 'proposal')) })
        drawingViewers.add(viewer)
      } catch { preview.replaceChildren(element('div','proposal-preview-fallback',t('previewMissing'))) }
    })
  } else preview.append(element('div','proposal-preview-fallback',t(state === 'rejected' ? 'proposalRejected' : 'proposalExpired')))
  const details = element('details','proposal-details')
  details.append(element('summary','',t('reviewDetails')))
  const safeDetails = {command:proposal.command,expectedRevision:proposal.expectedRevision,preview:proposal.preview,engineeringEvidence:proposal.engineeringEvidence}
  details.append(element('pre','',JSON.stringify(safeDetails,null,2)))
  const actions = element('div','proposal-actions')
  if (state === 'pending') {
    const approve = element('button','approve',t('approve'))
    const reject = element('button','',t('reject'))
    approve.type = reject.type = 'button'
    approve.dataset.testid = 'proposal-approve'
    reject.dataset.testid = 'proposal-reject'
    approve.addEventListener('click',async()=>{
      approve.disabled = reject.disabled = true
      const result = await session.runtime.approve(proposal.planId)
      if (result.status === 'applied') {
        proposal.uiState = 'approved'
        if (session.source) session.source.entityCount = session.runtime.entityCount
        for (const message of session.messages) for (const other of message.proposals ?? []) if (other !== proposal && other.uiState === 'pending') other.uiState = 'expired'
        session.messages.push({role:'assistant',text:result.text})
      } else {
        approve.disabled = reject.disabled = false
        session.messages.push({role:'assistant',status:'error',text:result.error?.message ?? t('retry')})
      }
      if (active === session) render()
    })
    reject.addEventListener('click',()=>{
      const result = session.runtime.reject(proposal.planId)
      if (result.status === 'rejected') {proposal.uiState = 'rejected';session.messages.push({role:'assistant',text:result.text})}
      else session.messages.push({role:'assistant',status:'error',text:result.error?.message ?? t('retry')})
      if (active === session) render()
    })
    actions.append(approve,reject)
  }
  if (state === 'approved') {
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
async function submitPrompt() {
  await initialLoad
  const prompt = ui.input.value.trim()
  if (!prompt || busy) return
  if (!settings) { showSettings(true); return }
  const session = currentSession()
  if (settings) session.runtime.configure(settings)
  for (const message of session.messages) for (const proposal of message.proposals ?? []) if (proposal.uiState === 'pending') proposal.uiState = 'expired'
  if (!session.messages.length) session.title = prompt.replace(/\s+/g,' ').slice(0,34)
  session.messages.push({role:'user',text:prompt})
  session.updatedAt = Date.now()
  const waiting = {role:'assistant',status:'pending',text:''}
  session.messages.push(waiting)
  busy = true
  activeRequest = new AbortController()
  ui.send.hidden = true
  ui.stop.hidden = false
  ui.input.value = ''
  render()
  try {
    const result = await session.runtime.send(prompt,{signal:activeRequest.signal})
    const index = session.messages.indexOf(waiting)
    if (index >= 0) session.messages.splice(index,1)
    if (result.status === 'proposal') {
      session.messages.push({role:'assistant',text:result.text,proposals:(result.proposals?.length ? result.proposals : [result.proposal]).map(proposal => ({...proposal, uiState:'pending'}))})
      if (active === session) ui.drawingContext.open = false
    }
    else if (result.status === 'message') session.messages.push({role:'assistant',text:result.text,...(result.noProposal ? {status:'not-proposed'} : {})})
    else if (result.status === 'cancelled') {
      session.messages.push({role:'assistant',text:t('stopped')})
      if (!ui.input.value) ui.input.value = prompt
    }
    else {
      session.messages.push({role:'assistant',status:'error',text:result.error?.message ?? result.text ?? t('retry')})
      if (!ui.input.value) ui.input.value = prompt
    }
  } catch(error) {
    const index = session.messages.indexOf(waiting)
    if (index >= 0) session.messages.splice(index,1)
    session.messages.push({role:'assistant',status:'error',text:error?.message ?? t('retry')})
    if (!ui.input.value) ui.input.value = prompt
  } finally {
    busy = false
    activeRequest = null
    ui.stop.hidden = true
    ui.send.hidden = false
    if (active === session) render()
    ui.input.focus()
  }
}
function closeSidebar(){ui.sidebar.classList.remove('open');ui.scrim.hidden=true;ui.menu.setAttribute('aria-expanded','false')}
function showImportError(message) {
  ui.importError.textContent = message
  ui.importError.hidden = false
}
async function openDrawing(file) {
  if (!file) return
  await initialLoad
  if (busy || importing) { showImportError(t('importBusy')); return }
  importing = true
  ui.openDrawing.disabled = ui.attachDrawing.disabled = true
  const runtime = createAiChatRuntime(settings ?? {})
  try {
    const source = await runtime.importDocument(file)
    source.exportRestricted = hasUnsupportedDxfMetadata(await runtime.exportLocalState())
    createSession({ runtime, source })
    ui.importError.hidden = true
    ui.drawingContext.open = true
    render()
    ui.input.focus()
  } catch (error) {
    runtime.destroy()
    showImportError(error?.message ?? t('importFailed'))
  } finally {
    importing = false
    ui.openDrawing.disabled = ui.attachDrawing.disabled = false
    ui.drawingFile.value = ''
    ui.dropOverlay.hidden = true
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
  } finally {
    busy = false
    if (active === session) render()
    else queuePersist()
  }
}
ui.undo.addEventListener('click',()=>applyDrawingHistory('undo'))
ui.redo.addEventListener('click',()=>applyDrawingHistory('redo'))
for (const button of [ui.openDrawing,ui.attachDrawing]) button.addEventListener('click',()=>ui.drawingFile.click())
ui.drawingFile.addEventListener('change',()=>openDrawing(ui.drawingFile.files?.[0]))
ui.drawingContext.addEventListener('toggle',()=>{ if (ui.drawingContext.open && active?.source) requestAnimationFrame(()=>renderDrawingContext(active)) })
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
ui.settingsForm.addEventListener('submit',event=>{
  event.preventDefault()
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
  hideSettings()
  updateConnection()
  queuePersist()
  if(shouldSend) submitPrompt()
})
byId('settings-close').addEventListener('click',hideSettings)
byId('settings-cancel').addEventListener('click',hideSettings)
ui.dialog.addEventListener('close',()=>{ui.key.value='';pendingSend=false})
ui.settingsOpen.addEventListener('click',()=>showSettings(false))
byId('new-chat').addEventListener('click',async()=>{await initialLoad;if(active?.messages.length || active?.source) createSession();else render();closeSidebar();ui.input.focus()})
ui.historySearch.addEventListener('input',renderSidebar)
document.addEventListener('click',event=>{
  for (const menu of ui.list.querySelectorAll('.history-menu[open]')) if (!menu.contains(event.target)) menu.open = false
})
byId('history-cancel').addEventListener('click',()=>ui.historyDialog.close())
ui.historyDialog.addEventListener('close',()=>{ historyAction = null })
ui.historyForm.addEventListener('submit',event=>{
  event.preventDefault()
  const choice = historyAction
  if (!choice || !sessions.includes(choice.session)) { ui.historyDialog.close(); return }
  if (choice.action === 'rename') {
    const title = ui.historyTitleInput.value.trim()
    if (!title) { ui.historyTitleInput.setCustomValidity(t('emptyTitle')); ui.historyTitleInput.reportValidity(); return }
    choice.session.title = title
    choice.session.updatedAt = Date.now()
  } else {
    if (busy) { ui.historyDialog.close(); showImportError(t('busyHistory')); return }
    choice.session.runtime.destroy()
    sessions = sessions.filter(item => item !== choice.session)
    if (active === choice.session) active = sessions[0] ?? null
  }
  ui.historyDialog.close()
  render()
})
ui.historyTitleInput.addEventListener('input',()=>ui.historyTitleInput.setCustomValidity(''))
byId('language-button').addEventListener('click',()=>setLanguage(language==='zh'?'en':'zh'))
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{ui.input.value=examples[language][button.dataset.prompt];ui.input.focus()}))
ui.menu.addEventListener('click',()=>{ui.sidebar.classList.add('open');ui.scrim.hidden=false;ui.menu.setAttribute('aria-expanded','true')})
byId('sidebar-close').addEventListener('click',closeSidebar)
ui.scrim.addEventListener('click',closeSidebar)
window.addEventListener('pagehide',()=>{ui.key.value='';queuePersist()})
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()})
setLanguage(language)
initialLoad = restoreSessions()
