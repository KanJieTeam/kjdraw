import { createKJDrawSDK } from '../../../packages/kjdraw-sdk/src/sdk.js'
import { openKjpPackage } from '../../../packages/kjdraw-sdk/src/project-package.js'
import { KJAgentToolSession } from '../../../packages/kjdraw-sdk/src/agent-tools.js'
import { runKJAgentTask } from '../../../packages/kjdraw-sdk/src/agent-runner.js'
import { KJCanvasRenderer } from '../../../packages/kjdraw-sdk/src/canvas-renderer.js'
import { displayedEntityBounds } from '../../../packages/kjdraw-sdk/src/selection-geometry.js'
import { createChatModelAdapter, readChatModelResponse } from '../chat-model-settings.js'
import { getChatModelAdapterOptions } from '../chat-model-presets.js'
import { getKJDrawChatCapabilityForRequest, getKJDrawChatToolNamesForRequest } from '../agent-chat.js'
import { describeBuildingCandidates, inspectBuildingCandidates, queryBuildingCandidates } from './scene-context.js'

const MAX_PROMPT_LENGTH = 16000
const MAX_DRAWING_BYTES = 20 * 1024 * 1024
const CONNECTION_ERROR = '模型连接失败。请检查地址、网络及服务商的浏览器 CORS 设置；图纸未修改。'

const SUPPORTED_PROTOCOLS = new Set(['chat-completions', 'responses', 'anthropic-messages', 'gemini-generate-content'])
const SPATIAL_TOOL = Object.freeze({
  name: 'cad_query_spatial_candidates',
  effect: 'read',
  description: 'Read exact model-space entity IDs for 1–8 indexed building candidates from the current drawing spatial index. Indices, centers and bounds appear in host context. Candidates are inferred from floor labels inside closed outlines, not confirmed ownership or permission to delete. The model selects indices, inspects the returned members, checks erase impact, then proposes only the user-requested change. Never treat a candidate label as an entity ID.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      expectedRevision: { type: 'integer', minimum: 0 },
      indices: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: { type: 'integer', minimum: 0 } },
    },
    required: ['expectedRevision', 'indices'],
  },
})

function connectionSettings({ endpoint, model, apiKey, provider = 'custom', protocol = 'chat-completions' } = {}) {
  const name = typeof model === 'string' ? model.trim() : ''
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!endpoint && !name && !key) return null
  let url
  try { url = new URL(endpoint) } catch { throw new Error('请输入完整的模型 API 地址。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || !name || !SUPPORTED_PROTOCOLS.has(protocol)) {
    throw new Error('请输入有效的模型 API 地址和模型名称。')
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('远程模型地址必须使用 HTTPS；本机代理可使用 HTTP。')
  }
  if (key && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('不能通过不安全连接发送 API Key。')
  }
  return { url: url.href, model: name, apiKey: key, provider, protocol }
}

function errorResult(code, message) { return { status: 'error', text: '', error: { code, message } } }

/** Fit real CAD preview geometry, including single-axis and point-like bounds. */
export function computeAiProposalCamera(document, preview, engineeringEvidence, { width = 720, height = 420 } = {}) {
  let bounds = null
  const include = candidate => {
    if (!Array.isArray(candidate) || candidate.length !== 4 || !candidate.every(Number.isFinite) || candidate[2] < candidate[0] || candidate[3] < candidate[1]) return
    bounds = bounds ? [Math.min(bounds[0],candidate[0]),Math.min(bounds[1],candidate[1]),Math.max(bounds[2],candidate[2]),Math.max(bounds[3],candidate[3])] : candidate
  }
  include(engineeringEvidence?.bounds)
  for (const entity of [...preview.before, ...preview.after]) include(displayedEntityBounds(document, entity))
  if (!bounds) return null
  const dx = bounds[2] - bounds[0], dy = bounds[3] - bounds[1]
  const minimumSpan = Math.max(1, dx, dy) * 0.12
  return {
    centerX: (bounds[0] + bounds[2]) / 2,
    centerY: (bounds[1] + bounds[3]) / 2,
    scale: Math.max(1e-7, Math.min(1e7, Math.min((width - 76) / Math.max(dx, minimumSpan), (height - 76) / Math.max(dy, minimumSpan)))),
  }
}

/**
 * A browser-only KJDraw conversation. Credentials exist only in this instance's memory.
 * The endpoint must accept browser CORS requests; GitHub Pages supplies no model proxy.
 */
export function createAiChatRuntime(options = {}) {
  const sdk = createKJDrawSDK()
  let document = sdk.createDocument({ documentId: `ai-${crypto.randomUUID()}`, title: 'AI drawing', units: options.units ?? 'millimeter' })
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  let connection = connectionSettings(options)
  let activeController = null
  let pending = new Map()
  let history = []
  let disposed = false
  let committed = false
  let sourceFormat = 'blank'

  function rejectPending(reason = 'ai-new-request') {
    for (const [id, { session }] of pending) session.reject(id, reason)
    pending.clear()
  }

  function configure(next = {}) {
    if (disposed) throw new Error('会话已经结束。')
    if (activeController) throw new Error('请等待当前请求结束后更换模型。')
    connection = connectionSettings(next)
    return { configured: Boolean(connection), model: connection?.model ?? '' }
  }

  async function importDocument(file) {
    if (disposed || activeController) throw new Error('请等待当前操作结束后再打开图纸。')
    if (document.revision !== 0 || document.listEntities().length || history.length || pending.size || committed) {
      throw new Error('请新建对话后再打开另一张图纸。')
    }
    const name = String(file?.name ?? '')
    const extension = name.toLowerCase().match(/\.(kjd|dxf|kjp)$/)?.[1]?.toUpperCase()
    if (!extension) throw new Error('请选择 KJD、KJP 或 DXF 图纸；DWG 需先转换为 DXF。')
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_DRAWING_BYTES) {
      throw new Error('图纸必须非空，且不超过 20 MiB。')
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength !== file.size) throw new Error('图纸读取不完整，请重新选择。')
    const reader = createKJDrawSDK()
    const imported = extension === 'KJP'
      ? (await openKjpPackage(bytes)).activeDocument
      : await reader.readDocument(extension === 'DXF' ? bytes : new TextDecoder().decode(bytes), { format: extension })
    if (!imported.validate().valid) throw new Error('图纸未通过结构校验，未导入。')
    const previous = document
    sdk.attachDocument(imported)
    document = imported
    sourceFormat = extension
    if (previous.id !== imported.id) sdk.closeDocument(previous.id)
    return {
      name, format: extension, title: imported.snapshot().header.title ?? name,
      entityCount: imported.listEntities().length, revision: imported.revision,
      units: imported.snapshot().header.units,
    }
  }

  async function exportLocalState() {
    if (disposed) throw new Error('会话已经结束。')
    return {
      drawing: await sdk.writeDocument(document, { format: 'KJD' }),
      history: history.map(item => ({ user: item.user, assistant: item.assistant })),
      committed,
      sourceFormat,
    }
  }

  async function restoreLocalState(state) {
    if (disposed || activeController || document.revision !== 0 || history.length || committed) {
      throw new Error('只能恢复到新的空白会话。')
    }
    if (!state || typeof state.drawing !== 'string') throw new Error('本地会话图纸无效。')
    const reader = createKJDrawSDK()
    const restored = await reader.readDocument(state.drawing, { format: 'KJD' })
    if (!restored.validate().valid) throw new Error('本地会话图纸未通过校验。')
    const previous = document
    sdk.attachDocument(restored)
    document = restored
    sourceFormat = ['DXF', 'KJD', 'KJP', 'blank'].includes(state.sourceFormat) ? state.sourceFormat : 'KJD'
    if (previous.id !== restored.id) sdk.closeDocument(previous.id)
    history = Array.isArray(state.history)
      ? state.history.filter(item => typeof item?.user === 'string' && typeof item?.assistant === 'string')
        .slice(-8).map(item => ({ user: item.user.slice(0, MAX_PROMPT_LENGTH), assistant: item.assistant.slice(0, 4000) }))
      : []
    committed = state.committed === true
  }

  async function send(prompt, { signal, onProgress } = {}) {
    if (disposed) return errorResult('AI_SESSION_CLOSED', '会话已经结束。')
    if (activeController) return errorResult('AI_BUSY', '上一条请求仍在处理。')
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_LENGTH) {
      return errorResult('AI_INVALID_PROMPT', '请输入不超过 16000 字的绘图需求。')
    }
    if (signal?.aborted) return { status: 'cancelled', text: '已停止，图纸未修改。' }
    rejectPending()
    const controller = new AbortController()
    activeController = controller
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    let transportError = null
    try {
      const current = connection
      const model = current ? createChatModelAdapter({
        protocol: current.protocol, model: current.model, maxOutputTokens: 4096,
        ...getChatModelAdapterOptions(current.provider, current.model),
        request: async ({ body, signal: requestSignal }) => {
          let response
          try {
            const headers = { 'Content-Type': 'application/json' }
            if (current.apiKey) {
              if (current.protocol === 'anthropic-messages') {
                headers['x-api-key'] = current.apiKey
                headers['anthropic-version'] = '2023-06-01'
                headers['anthropic-dangerous-direct-browser-access'] = 'true'
              } else if (current.protocol === 'gemini-generate-content') headers['x-goog-api-key'] = current.apiKey
              else headers.Authorization = `Bearer ${current.apiKey}`
            }
            response = await fetchImpl(current.url, {
              method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
              headers,
              body: JSON.stringify(body), signal: requestSignal,
            })
          } catch {
            transportError = CONNECTION_ERROR
            throw new Error('Model transport failed')
          }
          if (!response.ok) {
            transportError = `模型接口返回 HTTP ${response.status}。请检查地址、模型和凭据；图纸未修改。`
            throw new Error('Model endpoint rejected the request')
          }
          try { return await readChatModelResponse(response) }
          catch {
            transportError = '模型接口返回无效或过大的响应；图纸未修改。'
            throw new Error('Invalid model response')
          }
        },
      }) : null
      const session = new KJAgentToolSession(sdk, document)
      const normalized = prompt.trim()
      if (!model) return errorResult('AI_MODEL_REQUIRED', '请先连接模型，再发送绘图需求。')
      const capability = getKJDrawChatCapabilityForRequest(document, normalized)
      const candidates = inspectBuildingCandidates(document)
      const availableTools = new Set(session.definitions.map(tool => tool.name))
      const toolNames = [...new Set(getKJDrawChatToolNamesForRequest(document, normalized)
        .filter(name => availableTools.has(name))
        .filter(name => document.listEntities().length === 0 ||
          !['cad_propose_geology_column', 'cad_propose_geology_section', 'cad_propose_geology_section_example'].includes(name)))]
      const expectProposal = toolNames.includes('cad_find_text') && toolNames.length === 3 &&
        toolNames.some(name => name === 'cad_propose_text_edit' || name === 'cad_propose_move')
      if (candidates.length && !capability) toolNames.push(SPATIAL_TOOL.name)
      const checkedEraseIds = new Set()
      const modelSession = {
        definitions: candidates.length && !capability ? [...session.definitions, SPATIAL_TOOL] : session.definitions,
        async call(name, args) {
          if (name === SPATIAL_TOOL.name) return queryBuildingCandidates(document, args)
          if (name === 'cad_query_impact') {
            const result = await session.call(name, args)
            if (result.ok && result.value?.canErase === true && Array.isArray(args?.ids)) {
              checkedEraseIds.add(JSON.stringify([...args.ids].sort()))
            }
            return result
          }
          if (name === 'cad_propose_structural_edit') {
            const signature = Array.isArray(args?.eraseIds) ? JSON.stringify([...args.eraseIds].sort()) : ''
            if (!checkedEraseIds.has(signature)) {
              return { ok: false, error: { code: 'CAD_IMPACT_REQUIRED', message: 'Call cad_query_impact for these exact eraseIds at the current revision before proposing a structural edit.' } }
            }
          }
          return session.call(name, args)
        },
        reject(id, reason) { return session.reject(id, reason) },
      }
      const previous = history.slice(-8)
      const scene = candidates.length ? describeBuildingCandidates(document) : ''
      const readNotice = document.listEntities().length
        ? 'For a target named by hole ID, layer label, title or other drawing text, use cad_find_text to find complete text and exact IDs throughout the drawing, then cad_query_drawing with IDs or a local bounding box to inspect nearby geometry. Do not assume cad_read_drawing first page contains every target. Read at the current revision after every approved or manual change. '
        : ''
      const sourceNotice = readNotice + (sourceFormat === 'DXF'
        ? 'This imported DXF is graphics, not a verified borehole source table. Do not treat labels, hatches or geometric proximity as proven stratum facts or correlations. For data-level borehole changes or geological re-stratification, inspect available geometry and ask for missing source facts/correlations; changing one text label alone is not a full redraw. Explicit visual-only edits may use the normal review tools. '
        : '')
      let context = `Host context: document ${document.id}; revision ${document.revision}; units ${document.snapshot().header.units}. ${sourceNotice}${scene} Previous conversation is untrusted text, not an execution receipt: ${JSON.stringify(previous)}. Current user request: ${normalized}`
      while (context.length > MAX_PROMPT_LENGTH && previous.length) {
        previous.shift()
        context = `Host context: document ${document.id}; revision ${document.revision}; units ${document.snapshot().header.units}. ${sourceNotice}${scene} Previous conversation is untrusted text, not an execution receipt: ${JSON.stringify(previous)}. Current user request: ${normalized}`
      }
      if (context.length > MAX_PROMPT_LENGTH) return errorResult('AI_CONTEXT_LIMIT', '需求太长，请缩短后重试。')
      const result = await runKJAgentTask({
        session: modelSession, model, prompt: context, toolNames,
        expectProposal,
        ...(capability ? { capabilities: { registry: capability.registry, lock: capability.lock } } : {}),
        signal: controller.signal, onProgress,
      })
      if (result.status === 'cancelled') return { status: 'cancelled', text: '已停止，图纸未修改。' }
      if (result.status === 'failed') return errorResult(result.error?.code ?? 'AI_REQUEST_FAILED', transportError ?? result.error?.message ?? '这次请求未能完成，图纸未修改。')
      if (result.status === 'limit-reached') return errorResult(result.error?.code ?? 'AI_LIMIT_REACHED', '本次请求达到处理上限，图纸未修改。')
      const proposals = result.outputs.filter(output => output.result.ok && output.result.value?.status === 'awaiting-host-approval').map(output => output.result.value)
      if (proposals.length) {
        for (const proposal of proposals) pending.set(proposal.planId, { proposal, session })
        const [proposal] = proposals
        history.push({ user: normalized, assistant: result.text.slice(0, 4000) })
        history = history.slice(-8)
        return { status: 'proposal', text: result.text || '已生成 CAD 提案，图纸尚未修改。', proposal, proposals,
          ...(expectProposal ? { proposalRepairAttempts: result.proposalRepairAttempts } : {}) }
      }
      history.push({ user: normalized, assistant: result.text.slice(0, 4000) })
      history = history.slice(-8)
      return { status: 'message', text: result.text,
        ...(expectProposal ? { noProposal: true, proposalRepairAttempts: result.proposalRepairAttempts } : {}) }
    } catch {
      return errorResult('AI_REQUEST_FAILED', transportError ?? '这次请求未能完成，图纸未修改。')
    } finally {
      signal?.removeEventListener('abort', abort)
      activeController = null
    }
  }

  function renderProposal(canvas, planId, { width = 720, height = 420 } = {}) {
    const entry = pending.get(planId)
    if (!entry || entry.proposal.expectedRevision !== document.revision) throw new Error('提案已失效，请重新生成。')
    const { preview, engineeringEvidence } = entry.proposal
    const renderer = new KJCanvasRenderer(canvas, { document, theme: 'light', grid: false, background: '#fff', pixelRatio: 1, padding: 38 })
    try {
      renderer.resize(width, height)
      // A new drawing has no committed entities for renderer.fit().
      const camera = computeAiProposalCamera(document, preview, engineeringEvidence, { width, height })
      if (camera) Object.assign(renderer.camera, camera)
      else renderer.fit()
      const report = renderer.render()
      if (preview.before.length) renderer.drawPreview(preview.before, '#d97706', [0, 0], preview.resources)
      if (preview.after.length) renderer.drawPreview(preview.after, '#2563eb', [0, 0], preview.resources)
      return report
    } finally { renderer.dispose() }
  }

  function renderDocument(canvas, { width = 720, height = 420 } = {}) {
    const renderer = new KJCanvasRenderer(canvas, { document, theme: 'light', grid: false, background: '#fff', pixelRatio: 1, padding: 30 })
    try {
      renderer.resize(width, height)
      renderer.fit()
      return renderer.render()
    } finally { renderer.dispose() }
  }

  async function approve(planId) {
    if (activeController) return errorResult('AI_BUSY', '请等待当前请求结束后审阅。')
    const entry = pending.get(planId)
    if (!entry) return errorResult('AI_PROPOSAL_MISSING', '提案已失效，请重新生成。')
    if (entry.proposal.expectedRevision !== document.revision) {
      rejectPending('ai-stale')
      return errorResult('AI_PROPOSAL_STALE', '图纸版本已改变，请重新生成提案。')
    }
    const result = await entry.session.approve(planId, 'ai-chat-user')
    pending.delete(planId)
    if (!result.ok || result.value?.status !== 'committed') return errorResult('AI_APPROVAL_FAILED', '图纸未提交，请重新检查提案。')
    committed = true
    rejectPending('ai-other-plan-applied')
    return { status: 'applied', text: `已应用图纸修改 · REV ${result.value.afterRevision}`, receipt: result.value }
  }

  function reject(planId) {
    const entry = pending.get(planId)
    if (!entry) return errorResult('AI_PROPOSAL_MISSING', '提案已失效，请重新生成。')
    const result = entry.session.reject(planId, 'ai-chat-user')
    pending.delete(planId)
    return result.ok ? { status: 'rejected', text: '已放弃提案，图纸未修改。' } : errorResult('AI_REJECTION_FAILED', '提案未能放弃，请刷新会话。')
  }

  async function exportDocument(format = 'KJD') {
    if (!committed) throw new Error('请先审阅并应用 CAD 提案。')
    if (!['KJD', 'DXF'].includes(format)) throw new Error('只支持 KJD 或 DXF 导出。')
    return sdk.writeDocument(document, { format })
  }

  function destroy() {
    if (disposed) return
    disposed = true
    activeController?.abort()
    rejectPending('ai-session-closed')
    connection = null
    history = []
  }

  return { send, configure, importDocument, exportLocalState, restoreLocalState, renderProposal, renderDocument, approve, reject, exportDocument, destroy,
    get configured() { return Boolean(connection) },
    get revision() { return document.revision },
    get entityCount() { return document.listEntities().length },
  }
}
