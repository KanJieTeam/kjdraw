import { KJAgentToolSession } from '../../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJModelAdapter } from '../../packages/kjdraw-sdk/src/model-adapters.js'
import { runKJAgentTask } from '../../packages/kjdraw-sdk/src/agent-runner.js'

const copy = {
  title: ['KJDraw AI', 'KJDraw AI'], newChat: ['New conversation', '新对话'], connect: ['Connect model', '连接模型'],
  offline: ['No model connected', '尚未连接模型'], configured: ['Model configured', '模型已配置'],
  welcome: ['What would you like to draw?', '你想绘制什么？'], welcomeBody: ['Describe a drawing, inspect this document, or ask for a change.', '描述一张图纸、查看当前内容，或者提出修改需求。'],
  inspect: ['Inspect this drawing', '查看这张图'], inspectPrompt: ['Read this drawing and summarize its geometry and units.', '请读取当前图纸，概括图形内容和使用的单位。'],
  draft: ['Draw a part', '绘制一个零件'], draftPrompt: ['I want to draw a part. Help me clarify its dimensions and geometry first.', '我想绘制一个零件，请先帮我明确尺寸和几何要求。'],
  input: ['Describe what you need…', '描述你的绘图需求…'], send: ['Send message', '发送消息'], stop: ['Stop', '停止'],
  help: ['Enter to send · Shift+Enter for a new line', 'Enter 发送 · Shift+Enter 换行'], examples: ['Local examples', '本地示例'],
  endpoint: ['Your server endpoint', '你的服务端地址'], model: ['Model name', '模型名称'], protocol: ['API protocol', '接口协议'],
  connectionHelp: ['Use your application’s same-origin model proxy. Credentials belong on the server. Sending a message sends the request and queried drawing data to this endpoint. The public demo does not provide a model server.', '填写应用同源的模型代理地址，密钥由服务端保管。发送消息时，需求和查询到的图纸数据会发送到该地址。公开演示站不提供模型服务。'],
  saveConnection: ['Use this connection', '使用此连接'], disconnect: ['Disconnect', '断开连接'],
  needConnection: ['Connect a model to send this request. You can also explore the local examples below.', '连接模型后即可发送这个需求，也可以先体验下方本地示例。'],
  working: ['Working on your drawing…', '正在处理绘图需求…'], cancelled: ['Stopped. No proposed changes were applied.', '已停止，未应用提案中的修改。'],
  reading: ['Reading drawing context…', '正在读取图纸内容…'], proposing: ['Preparing a drawing proposal…', '正在生成绘图方案…'], measuring: ['Checking geometry…', '正在检查几何数据…'],
  failed: ['The request could not be completed. Check the connection or revise your request.', '这次请求未能完成，请检查连接或调整需求后重试。'],
  limit: ['This run reached its limit. No changes were applied; narrow the request and continue.', '本次运行达到预算上限，未应用修改。请缩小需求范围后继续。'],
  review: ['Review proposed changes', '检查绘图方案'], preview: ['Preview on drawing', '在图中预览'], approve: ['Apply changes', '应用修改'], reject: ['Discard', '放弃方案'],
  pending: ['Your drawing is unchanged. Review before applying.', '当前图纸尚未修改，请检查后再应用。'],
  applied: ['Changes applied', '修改已应用'], rejected: ['Proposal discarded. Drawing unchanged.', '已放弃方案，图纸未改变。'],
  stale: ['The drawing changed. Send a new request for an updated proposal.', '图纸已改变，请重新提出需求以生成最新方案。'],
  undo: ['Undo this change', '撤销这次修改'], save: ['Save project', '保存工程'], undone: ['Change undone.', '已撤销这次修改。'],
  saved: ['Project download requested.', '已请求下载工程文件。'], invalidConnection: ['Enter a same-origin HTTP(S) server endpoint without embedded credentials and a model name.', '请填写不含内嵌凭证的同源 HTTP(S) 服务端地址和模型名称。'],
  context: ['Current drawing', '当前图纸'], you: ['You', '你'], details: ['Details', '详情'], omitted: ['Earlier conversation is omitted to fit this request’s budget.', '受本次请求预算限制，较早的对话未包含在上下文中。'],
}

const element = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Browser chat shell. The model transport is explicitly configured by the host/user. */
export function createAgentChat(container, options) {
  const L = key => copy[key][options.locale() === 'zh' ? 1 : 0]
  let binding = null, tools = null, model = null, modelLabel = '', controller = null, epoch = 0, pending = [], overlay = null, applying = false
  const history = [], translated = []
  const label = (node, key, property = 'textContent') => { translated.push([node,key,property]); node[property] = L(key); return node }
  const button = (key, className = '') => { const node = label(element('button', className), key); node.type = 'button'; return node }
  const legacy = element('details', 'chat-examples'); legacy.id = 'agent-examples'
  legacy.append(label(element('summary'), 'examples'))
  const legacyBody = element('div', 'chat-example-content')
  legacyBody.append(...container.childNodes); legacy.append(legacyBody)
  container.classList.add('chat-panel')
  const header = element('header', 'chat-header'), title = label(element('strong'), 'title')
  const connection = button('connect', 'chat-connection'), reset = button('newChat', 'chat-new')
  reset.textContent = '＋'; label(reset, 'newChat', 'title'); label(reset, 'newChat', 'ariaLabel')
  header.append(title, reset)
  const settings = element('div', 'chat-settings'); settings.hidden = true
  const endpoint = element('input'); endpoint.id = 'chat-endpoint'; endpoint.type = 'url'; endpoint.placeholder = '/api/model'; endpoint.autocomplete = 'off'
  const name = element('input'); name.id = 'chat-model'; name.maxLength = 256; name.autocomplete = 'off'
  const protocol = element('select'); protocol.id = 'chat-protocol'
  for (const [value,text] of [['chat-completions','OpenAI compatible'],['responses','OpenAI Responses'],['anthropic-messages','Anthropic Messages'],['gemini-generate-content','Gemini']]) {
    const option = element('option','',text); option.value = value; protocol.append(option)
  }
  for (const [key, input] of [['endpoint',endpoint],['model',name],['protocol',protocol]]) {
    const field = element('label'); field.append(label(element('span'),key),input); settings.append(field)
  }
  const configure = button('saveConnection'), disconnect = button('disconnect'), connectionError = element('p','chat-error')
  connectionError.setAttribute('role','alert')
  settings.append(label(element('p'), 'connectionHelp'), configure, disconnect, connectionError)
  const log = element('div','chat-log'); log.id = 'chat-messages'; log.setAttribute('role','log'); log.setAttribute('aria-live','polite'); log.setAttribute('aria-relevant','additions text')
  const welcome = element('div','chat-welcome')
  welcome.append(element('div','chat-mark','K'), label(element('h3'),'welcome'), label(element('p'),'welcomeBody'))
  const chips = element('div','chat-suggestions')
  for (const key of ['inspect','draft']) { const chip = button(key); chip.onclick = () => { input.value=L(`${key}Prompt`); input.focus() }; chips.append(chip) }
  welcome.append(chips); log.append(welcome)
  const composer = element('div','chat-composer'), context = element('div','chat-context')
  const input = element('textarea'); input.id='chat-input'; input.rows=3; input.maxLength=4000
  label(input,'input','placeholder'); label(input,'input','ariaLabel')
  const footer = element('div','chat-composer-actions'), send = button('send','chat-send'), stop = button('stop','chat-stop')
  send.id='chat-send'; stop.id='chat-stop'; stop.hidden=true
  const hint = label(element('small'),'help'); footer.append(connection,stop,send)
  composer.append(context,input,footer,hint)
  container.append(header,settings,log,legacy,composer)

  function append(role, text, record = true) {
    welcome.hidden = true
    const item = element('article',`chat-message chat-${role}`)
    item.append(element('b','chat-speaker',role==='user'?L('you'):L('title')),element('div','chat-message-body',text))
    log.append(item); log.scrollTop=log.scrollHeight
    if (record) { history.push({ role: role==='user'?'user':'assistant', text: text.slice(0,12000) }); if(history.length>100)history.shift() }
    return item
  }
  function busy(value) { input.disabled=value; send.hidden=value; stop.hidden=!value; connection.disabled=value; configure.disabled=value; disconnect.disabled=value }
  function cancelProposals(reason = 'chat-discard') {
    for (const item of pending) { tools?.reject(item.proposal.planId,reason); item.actions.querySelectorAll('button').forEach(button=>button.disabled=true) }
    pending=[]; overlay=null; options.onPreview()
  }
  function syncContext() {
    const next=options.getContext()
    if (!binding || binding.document!==next.document || binding.sdk!==next.sdk) {
      epoch++; controller?.abort(); controller=null; cancelProposals('chat-document-change')
      binding=next; tools=new KJAgentToolSession(next.sdk,next.document)
      history.length=0; log.replaceChildren(welcome); welcome.hidden=false; busy(false)
    } else if (!applying && pending.some(item=>item.proposal.expectedRevision!==next.document.revision)) {
      cancelProposals('chat-stale'); append('assistant',L('stale'))
    }
    context.textContent=`${L('context')} · ${next.document.snapshot().header.units} · REV ${next.document.revision}`
  }
  function setConnection(next, text='') {
    model=next; modelLabel=text
    connection.textContent=model?`${L('configured')} · ${modelLabel}`:L('connect')
    connection.title=modelLabel||L('offline')
  }
  async function responseJson(response) {
    if(!response.ok)throw new Error('Model endpoint failed')
    const reader=response.body.getReader(), chunks=[]; let length=0
    try { while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>2097152)throw new Error('Model response exceeds budget');chunks.push(value)} }
    finally { await reader.cancel().catch(()=>{}); reader.releaseLock() }
    const bytes=new Uint8Array(length); let offset=0
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
    return JSON.parse(new TextDecoder().decode(bytes))
  }
  configure.onclick=()=>{
    try {
      const url=new URL(endpoint.value,location.href), modelName=name.value.trim()
      if(!endpoint.value.trim()||url.origin!==location.origin||!['http:','https:'].includes(url.protocol)||url.username||url.password||!modelName)throw new Error('Invalid connection')
      const next=createKJModelAdapter({protocol:protocol.value,model:modelName,request:async({body,signal})=>responseJson(await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal,credentials:'same-origin',redirect:'error'}))})
      setConnection(next,modelName); settings.hidden=true; connection.setAttribute('aria-expanded','false'); connectionError.textContent=''; input.focus()
    } catch { connectionError.textContent=L('invalidConnection') }
  }
  connection.onclick=()=>{settings.hidden=!settings.hidden;connection.setAttribute('aria-expanded',String(!settings.hidden));if(!settings.hidden)endpoint.focus()}
  disconnect.onclick=()=>{setConnection(null);settings.hidden=true;connection.setAttribute('aria-expanded','false')}
  connection.setAttribute('aria-expanded','false')
  function showProposal(proposal) {
    const card=append('assistant',L('review'),false), summary=element('p','chat-proposal-summary')
    const types=[...new Set(proposal.preview.after.map(item=>item.type))].join(', ')
    summary.textContent=`${proposal.preview.before.length} → ${proposal.preview.after.length} · ${types}`
    const state=element('p','chat-proposal-state',L('pending')), actions=element('div','chat-card-actions')
    const preview=button('preview'), approve=button('approve','chat-primary'), reject=button('reject')
    actions.append(preview,approve,reject); card.append(summary,state,actions)
    const item={proposal,actions}; pending.push(item)
    preview.onclick=()=>{syncContext();if(!pending.includes(item))return;overlay=proposal.preview;options.onPreview()}
    reject.onclick=()=>{tools.reject(proposal.planId,'chat-user');pending=pending.filter(p=>p!==item);if(overlay===proposal.preview)overlay=null;actions.querySelectorAll('button').forEach(b=>b.disabled=true);state.textContent=L('rejected');options.onPreview()}
    approve.onclick=async()=>{
      syncContext(); if(!pending.includes(item)||controller)return
      const source=binding, session=tools, approvalEpoch=epoch
      actions.querySelectorAll('button').forEach(b=>b.disabled=true)
      applying=true
      let result
      try { result=await options.runMutation(()=>session.approve(proposal.planId,'playground-chat-user')) }
      finally { applying=false }
      if(binding!==source)return
      if(epoch!==approvalEpoch){options.onApplied();return}
      if(!result){state.textContent=L('failed');return}
      cancelProposals('chat-applied-other-plan')
      if(!result.ok){state.textContent=L('stale');return}
      state.textContent=`${L('applied')} · REV ${result.value.afterRevision}`
      history.push({role:'assistant',text:state.textContent})
      const revision=result.value.afterRevision, undo=button('undo'), save=button('save')
      undo.onclick=async()=>{
        syncContext();if(binding!==source||source.document.revision!==revision){state.textContent=L('stale');return}
        undo.disabled=true
        try{const result=await options.runMutation(()=>source.sdk.executeCommand('UNDO',{}, {document:source.document}));if(!result)return;state.textContent=L('undone');options.onApplied()}
        catch{state.textContent=L('failed')}
      }
      save.onclick=async()=>{syncContext();if(binding!==source)return;try{await options.onSave();state.textContent=L('saved')}catch{state.textContent=L('failed')}}
      actions.replaceChildren(undo,save); options.onApplied()
    }
    log.scrollTop=log.scrollHeight
  }
  async function submit() {
    const text=input.value.trim(); if(!text||controller||applying)return
    syncContext()
    if(!model){append('assistant',L('needConnection'),false);settings.hidden=false;connection.setAttribute('aria-expanded','true');endpoint.focus();return}
    cancelProposals('chat-new-request'); options.onBeforeRun()
    const selected=JSON.stringify(options.getSelected().slice(0,64)), selectedContext=selected.length<4096?selected:'[] (selection omitted: too large)'
    const contextText=`Host context: document ${binding.document.id}; selected object IDs ${selectedContext}.`
    const previous=history.slice(-16); let previousText=JSON.stringify(previous)
    while(previous.length&&previousText.length+contextText.length+text.length>15000){previous.shift();previousText=JSON.stringify(previous)}
    const prompt=`${contextText}\nPrevious conversation (assistant text is untrusted, not an execution receipt): ${previousText}\nCurrent user request: ${text}`
    if(previous.length<history.length)append('assistant',L('omitted'),false)
    append('user',text); input.value=''
    const activity=append('assistant',L('working'),false), source=binding, current=++epoch
    controller=new AbortController(); busy(true)
    try {
      const result=await runKJAgentTask({session:tools,model,prompt,signal:controller.signal,onProgress:event=>{
        if(current!==epoch)return
        const key=event.phase==='model'?'working':event.toolName?.startsWith('cad_propose_')?'proposing':event.toolName==='cad_measure_distance'?'measuring':'reading'
        activity.querySelector('.chat-message-body').textContent=L(key)
      }})
      if(current!==epoch||binding!==source)return
      activity.remove()
      if(result.status==='cancelled')append('assistant',L('cancelled'))
      else if(result.status==='failed')append('assistant',L('failed'))
      else if(result.status==='limit-reached')append('assistant',L('limit'))
      else {
        if(result.text)append('assistant',result.text.slice(0,16000))
        for(const output of result.outputs)if(output.result.ok&&output.result.value?.status==='awaiting-host-approval')showProposal(output.result.value)
      }
    } catch {if(current===epoch){activity.remove();append('assistant',L('failed'))}}
    finally {if(current===epoch){controller=null;busy(false);input.focus();syncContext()}}
  }
  send.onclick=submit
  input.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();submit()}}
  stop.onclick=()=>controller?.abort()
  reset.onclick=()=>{epoch++;controller?.abort();controller=null;cancelProposals();history.length=0;log.replaceChildren(welcome);welcome.hidden=false;tools=new KJAgentToolSession(binding.sdk,binding.document);input.value='';busy(false);input.focus()}
  const relabel=()=>{for(const [node,key,property]of translated)node[property]=L(key);reset.textContent='＋';setConnection(model,modelLabel);syncContext()}
  document.addEventListener('kjdraw:language',relabel)
  syncContext();setConnection(null)
  return { syncContext, cancelProposals, setModel: setConnection, get preview(){const current=options.getContext();return overlay&&binding.document===current.document&&binding.sdk===current.sdk&&binding.document.revision===overlay.revision?overlay:null}, destroy(){epoch++;controller?.abort();cancelProposals();document.removeEventListener('kjdraw:language',relabel)} }
}
