import { createAiChatRuntime } from './runtime.js'
import { CHAT_MODEL_PROVIDER_PRESETS, getChatModelProviderPreset, formatChatModelUpstreamEndpoint } from '../chat-model-presets.js'

const copy = {
  zh: {
    newChat:'新建对话',recent:'最近对话',editor:'打开 CAD 编辑器',docs:'使用文档 ↗',beta:'预览版',
    notConnected:'未连接模型',connected:'模型已连接',connect:'连接模型',manage:'连接设置',
    heroTitle:'今天想画什么图？',heroDescription:'描述需求，检查提案，然后再应用到可编辑图纸。',
    suggestLine:'画一条 100 mm 水平线',suggestCircle:'画一个半径 25 mm 的圆',suggestOutline:'画一个 120 × 80 mm 矩形',
    promptLabel:'描述你想绘制或修改的图纸',promptPlaceholder:'描述你想绘制或修改的图纸…',
    composerHint:'Enter 发送 · Shift + Enter 换行',send:'发送',stop:'停止生成',stopped:'已停止，图纸未修改。',working:'正在处理图纸需求…',
    disclaimer:'对话及所需图纸上下文会发送给你选择的模型服务商；密钥仅保留在当前页面内存中。工程图须由你审核。',
    connectionSettings:'模型连接',connectModel:'连接你的模型',settingsIntro:'选择常用模型，或填写自己的接口。密钥、对话和绘图上下文会发给所选服务商；密钥不保存在浏览器中。',
    provider:'服务商',commonModel:'常用模型',customModel:'自定义模型…',connectionDetails:'连接详情与自定义',protocol:'接口协议',
    endpoint:'API 地址',model:'模型名称',apiKey:'API 密钥',cancel:'取消',saveConnection:'连接并继续',
    invalidSettings:'请填写完整的 API 地址和模型名称。',invalidEndpoint:'请输入完整的 http(s) API 地址。',keyRequired:'请填写该服务商的 API 密钥。',you:'你',assistant:'KJDraw AI',
    proposal:'CAD 修改提案',proposalPending:'待审核',proposalApproved:'已应用',proposalRejected:'已放弃',proposalExpired:'已失效',
    previewMissing:'暂时无法绘制预览，请检查提案详情。',reviewDetails:'查看提案详情',approve:'审核并应用',reject:'放弃提案',
    download:'下载 KJD 图纸',openEditor:'打开编辑器',applied:'修改已应用。下载 KJD 文件后，可在编辑器中打开。',
    emptyResponse:'模型没有返回可显示的内容。',retry:'请重试或检查模型设置。',newConversation:'新对话',
    failedDownload:'导出图纸失败。',editorHint:'编辑器会在新标签页打开。请使用 Open 导入刚下载的 KJD 文件。',
  },
  en: {
    newChat:'New chat',recent:'RECENT CHATS',editor:'Open CAD editor',docs:'Documentation ↗',beta:'PREVIEW',
    notConnected:'Model not connected',connected:'Model connected',connect:'Connect model',manage:'Connection settings',
    heroTitle:'What would you like to draw?',heroDescription:'Describe the drawing, review the proposal, then apply it to an editable file.',
    suggestLine:'Draw a 100 mm horizontal line',suggestCircle:'Draw a circle with a 25 mm radius',suggestOutline:'Draw a 120 × 80 mm rectangle',
    promptLabel:'Describe the drawing you want to create or change',promptPlaceholder:'Describe the drawing you want to create or change…',
    composerHint:'Enter to send · Shift + Enter for a new line',send:'Send',stop:'Stop',stopped:'Stopped. The drawing was not changed.',working:'Working on your drawing…',
    disclaimer:'Your conversation and needed drawing context go to your chosen model provider. Your key stays in this page’s memory; review drawings before use.',
    connectionSettings:'Model connection',connectModel:'Connect your model',settingsIntro:'Choose a common model or enter your own endpoint. Your key, conversation and drawing context go to that provider; the key is not stored in the browser.',
    provider:'Provider',commonModel:'Common model',customModel:'Custom model…',connectionDetails:'Connection details & custom setup',protocol:'API protocol',
    endpoint:'API endpoint',model:'Model name',apiKey:'API key',cancel:'Cancel',saveConnection:'Connect and continue',
    invalidSettings:'Enter an API endpoint and model name.',invalidEndpoint:'Enter a complete http(s) API endpoint.',keyRequired:'Enter an API key for this provider.',you:'You',assistant:'KJDraw AI',
    proposal:'CAD change proposal',proposalPending:'Awaiting review',proposalApproved:'Applied',proposalRejected:'Discarded',proposalExpired:'Expired',
    previewMissing:'Preview could not be rendered. Review the proposal details.',reviewDetails:'View proposal details',approve:'Review and apply',reject:'Discard proposal',
    download:'Download KJD drawing',openEditor:'Open editor',applied:'Change applied. Download the KJD file, then open it in the editor.',
    emptyResponse:'The model returned no displayable content.',retry:'Try again or check your model settings.',newConversation:'New chat',
    failedDownload:'Could not export drawing.',editorHint:'The editor opens in a new tab. Use Open to import the KJD file you downloaded.',
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
}
let language = navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
let settings = null
let sessions = []
let active = null
let pendingSend = false
let busy = false
let activeRequest = null
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
function createSession() {
  const session = { id: crypto.randomUUID(), title:t('newConversation'), messages:[], runtime:createAiChatRuntime(settings ?? {}) }
  sessions.unshift(session)
  active = session
  render()
  return session
}
function currentSession() { return active ?? createSession() }
function renderSidebar() {
  ui.list.replaceChildren()
  for (const session of sessions.filter(item => item.messages.length)) {
    const button = element('button','conversation-item'+(session === active ? ' active' : ''))
    button.type = 'button'
    button.setAttribute('aria-current',session === active ? 'page' : 'false')
    button.append(element('span','chat-icon','◇'),element('span','chat-title',session.title))
    button.addEventListener('click',()=>{ active = session; render(); closeSidebar() })
    ui.list.append(button)
  }
  ui.count.textContent = String(sessions.filter(item => item.messages.length).length)
}
function render() {
  renderSidebar()
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
  } else preview.append(element('div','proposal-preview-fallback',state === 'approved' ? t('applied') : t('proposalExpired')))
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
    const data = await session.runtime.exportDocument('KJD')
    const blob = new Blob([data],{type:'application/json'})
    const url = URL.createObjectURL(blob)
    const link = element('a')
    link.href = url
    link.download = 'kjdraw-ai-drawing.kjd'
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
  ui.key.placeholder = canReuseKey() ? (language === 'zh' ? '已设置，留空沿用' : 'Set; leave blank to keep') : 'sk-…'
}
async function submitPrompt() {
  const prompt = ui.input.value.trim()
  if (!prompt || busy) return
  if (!settings) { showSettings(true); return }
  const session = currentSession()
  session.runtime.configure(settings)
  for (const message of session.messages) for (const proposal of message.proposals ?? []) if (proposal.uiState === 'pending') proposal.uiState = 'expired'
  if (!session.messages.length) session.title = prompt.replace(/\s+/g,' ').slice(0,34)
  session.messages.push({role:'user',text:prompt})
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
  if(shouldSend) submitPrompt()
})
byId('settings-close').addEventListener('click',hideSettings)
byId('settings-cancel').addEventListener('click',hideSettings)
ui.dialog.addEventListener('close',()=>{ui.key.value='';pendingSend=false})
ui.settingsOpen.addEventListener('click',()=>showSettings(false))
byId('new-chat').addEventListener('click',()=>{if(active?.messages.length) createSession();else render();closeSidebar();ui.input.focus()})
byId('language-button').addEventListener('click',()=>setLanguage(language==='zh'?'en':'zh'))
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{ui.input.value=examples[language][button.dataset.prompt];ui.input.focus()}))
ui.menu.addEventListener('click',()=>{ui.sidebar.classList.add('open');ui.scrim.hidden=false;ui.menu.setAttribute('aria-expanded','true')})
byId('sidebar-close').addEventListener('click',closeSidebar)
ui.scrim.addEventListener('click',closeSidebar)
window.addEventListener('pagehide',()=>{settings=null;ui.key.value='';for(const session of sessions) session.runtime.destroy()})
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()})
setLanguage(language)
