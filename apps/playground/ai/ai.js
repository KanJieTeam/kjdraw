import { createAiChatRuntime } from './runtime.js'
import { loadLocalHistory, saveLocalHistory } from './local-history.js'
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
    previewMissing:'暂时无法绘制预览，请检查提案详情。',reviewDetails:'查看提案详情',approve:'审核并应用',reject:'放弃提案',
    download:'下载 DXF 图纸',openEditor:'打开编辑器',applied:'修改已应用。可下载 DXF 图纸，在 CAD 软件中继续编辑。',
    emptyResponse:'模型没有返回可显示的内容。',retry:'请重试或检查模型设置。',newConversation:'新对话',
    failedDownload:'导出图纸失败。',editorHint:'编辑器会在新标签页打开。请使用“打开文件”导入刚下载的 DXF 图纸。',
    openDrawing:'打开图纸',dropDrawing:'松开以打开图纸',importFailed:'图纸未导入，请检查文件格式。',
    importBusy:'请等待当前请求结束后再打开图纸。',drawingLoaded:'已打开图纸',entities:'个对象',
    storageFailed:'本地会话保存失败。请先下载 DXF 图纸，并检查浏览器存储空间。',
    historyEmpty:'没有找到对话',busyHistory:'请先停止当前请求，再管理这段对话。',
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
    previewMissing:'Preview could not be rendered. Review the proposal details.',reviewDetails:'View proposal details',approve:'Review and apply',reject:'Discard proposal',
    download:'Download DXF drawing',openEditor:'Open editor',applied:'Change applied. Download the DXF drawing to continue editing in CAD software.',
    emptyResponse:'The model returned no displayable content.',retry:'Try again or check your model settings.',newConversation:'New chat',
    failedDownload:'Could not export drawing.',editorHint:'The editor opens in a new tab. Use Open file to import the downloaded DXF drawing.',
    openDrawing:'Open drawing',dropDrawing:'Drop to open drawing',importFailed:'Drawing not opened. Check the file format.',
    importBusy:'Wait for the current request before opening a drawing.',drawingLoaded:'Drawing opened',entities:'entities',
    storageFailed:'Could not save this conversation locally. Download the DXF drawing and check browser storage.',
    historyEmpty:'No conversations found',busyHistory:'Stop the current request before managing this conversation.',
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
const t = key => copy[language][key] ?? key
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
          sessions.push({ id: item.id, title: String(item.title ?? t('newConversation')), source: item.source ?? null,
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
  renderSidebar()
  const source = active?.source
  ui.drawingContext.hidden = !source
  if (source) {
    ui.drawingName.textContent = source.name
    ui.drawingMeta.textContent = `${source.entityCount} ${t('entities')} · ${source.units}`
    if (ui.drawingContext.open) requestAnimationFrame(()=>renderDrawingContext(active))
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
    else body.append(element('div','message-content',message.text || t('emptyResponse')))
    if (message.proposals?.length) for (const proposal of message.proposals) body.append(createProposalCard(active,proposal))
    wrapper.append(avatar,body)
    ui.messages.append(wrapper)
  }
  requestAnimationFrame(()=>{ ui.conversation.scrollTop = ui.conversation.scrollHeight })
  queuePersist()
}
function renderDrawingContext(session) {
  if (session !== active || !ui.drawingContext.open || !ui.drawingCanvas.isConnected) return
  try { session.runtime.renderDocument(ui.drawingCanvas,{width:760,height:190}) }
  catch { ui.drawingContext.open = false }
}
function createProposalCard(session, proposal) {
  const card = element('section','proposal-card')
  card.dataset.testid = 'drawing-result'
  card.setAttribute('aria-label',t('proposal'))
  const header = element('div','proposal-head')
  const titleGroup = element('div')
  titleGroup.append(element('h3','proposal-title',t('proposal')),element('p','proposal-subtitle',`REV ${proposal.expectedRevision ?? '?'} · ${proposal.command ?? ''}`))
  const state = proposal.uiState ?? 'pending'
  const tag = element('span','proposal-tag '+(state === 'approved' ? 'approved' : state === 'rejected' ? 'rejected' : ''),t(state === 'approved' ? 'proposalApproved' : state === 'rejected' ? 'proposalRejected' : state === 'expired' ? 'proposalExpired' : 'proposalPending'))
  header.append(titleGroup,tag)
  const preview = element('div','proposal-preview')
  if (state === 'pending') {
    const canvas = element('canvas')
    canvas.setAttribute('aria-label',t('proposal'))
    preview.append(canvas)
    requestAnimationFrame(()=>{
      if (!canvas.isConnected) return
      try { session.runtime.renderProposal(canvas,proposal.planId,{width:640,height:255}) }
      catch { preview.replaceChildren(element('div','proposal-preview-fallback',t('previewMissing'))) }
    })
  } else if (state === 'approved') {
    const canvas = element('canvas')
    canvas.setAttribute('aria-label',t('drawingLoaded'))
    preview.append(canvas)
    requestAnimationFrame(()=>{ if(canvas.isConnected) try { session.runtime.renderDocument(canvas,{width:640,height:255}) } catch {} })
  } else preview.append(element('div','proposal-preview-fallback',t('proposalExpired')))
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
    const editor = element('button','',t('openEditor'))
    editor.type = 'button'
    editor.addEventListener('click',async()=>{
      const ok = await downloadDrawing(session)
      if (ok) { window.open('../','_blank','noopener'); session.messages.push({role:'assistant',text:t('editorHint')}); if(active===session) render() }
    })
    actions.append(download,editor)
  }
  card.append(header,preview,details,actions)
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
    session.messages.push({role:'assistant',status:'error',text:error?.message ?? t('failedDownload')})
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
    if (result.status === 'proposal') session.messages.push({role:'assistant',text:result.text,proposals:(result.proposals?.length ? result.proposals : [result.proposal]).map(proposal => ({...proposal, uiState:'pending'}))})
    else if (result.status === 'message') session.messages.push({role:'assistant',text:result.text})
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
