import type { KJAgentToolDefinition, KJAgentToolResult } from './agent-tools.js'
import { KJDrawError } from './errors.js'
import { deepFreeze } from './utils.js'
import { extractKJModelUsage, type KJModelUsage } from './model-usage.js'

export type KJModelProtocol = 'responses' | 'chat-completions' | 'anthropic-messages' | 'gemini-generate-content'
export interface KJModelToolCall { readonly id: string; readonly name: string; readonly arguments: unknown }
export interface KJModelToolOutput { readonly id: string; readonly name: string; readonly result: KJAgentToolResult }
export interface KJModelTurn { readonly text: string; readonly calls: readonly KJModelToolCall[]; readonly usage?: KJModelUsage }
export type KJModelInput = { readonly kind: 'prompt'; readonly text: string } | { readonly kind: 'tool-results'; readonly results: readonly KJModelToolOutput[] }
export interface KJModelConversation {
  next(input: KJModelInput, signal: AbortSignal): Promise<KJModelTurn>
}
/** Custom models and framework/harness bridges implement this interface; no vendor SDK is required. */
export interface KJAgentModel {
  createConversation(options: KJModelConversationOptions): KJModelConversation
}
export interface KJModelConversationOptions {
  readonly instructions: string
  readonly tools: readonly KJAgentToolDefinition[]
  /** One observation per received transport response, even when response parsing later fails. Exceptions are isolated. */
  readonly onUsage?: (usage: KJModelUsage) => void
}
export interface KJModelRequest {
  readonly protocol: KJModelProtocol
  readonly model: string
  /** REST JSON body. Gemini's model belongs in the URL, not this body. */
  readonly body: Readonly<Record<string, unknown>>
  readonly signal: AbortSignal
}
export interface KJModelAdapterOptions {
  protocol: KJModelProtocol
  model: string
  /** Trusted host transport owns credentials, endpoint allowlisting and HTTP errors; return parsed, non-streaming JSON. */
  request: (request: KJModelRequest) => Promise<unknown>
  maxOutputTokens?: number
  /** Compatible endpoints differ; choose the field accepted by the selected model. */
  chatTokenParameter?: 'max_tokens' | 'max_completion_tokens'
  maxResponseBytes?: number
  maxHistoryBytes?: number
  /** Host-only observer; contains counters and timing, never response text or credentials. Exceptions are isolated. */
  onUsage?: (usage: KJModelUsage) => void
}
export class KJModelError extends KJDrawError {
  constructor(code: string, message: string) { super(message, { code }) }
}

function invalid(message: string): never { throw new KJModelError('KJMODEL_PROTOCOL', message) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected a JSON object from the model transport')
  return value as Record<string, unknown>
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid('Expected a complete model response array')
  return value
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) invalid('Missing or invalid tool identifier')
  return value
}
function jsonArguments(value: unknown): unknown {
  if (typeof value !== 'string') invalid('Tool arguments must be a JSON string')
  try { return JSON.parse(value) } catch { return null } // Runtime schema validation returns an actionable tool error.
}
function jsonCopy<T>(value: T, budget: number): T {
  const serialized = JSON.stringify(value)
  if (!serialized || new TextEncoder().encode(serialized).length > budget) throw new KJModelError('KJMODEL_SIZE_LIMIT', 'Model response or conversation exceeds its configured JSON byte limit')
  return JSON.parse(serialized) as T
}
function limit(value: number | undefined, fallback: number, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) invalid('Invalid model adapter limit')
  return resolved
}
function notifyUsage(observer: ((usage: KJModelUsage) => void) | undefined, usage: KJModelUsage): void {
  try { void Promise.resolve(observer?.(usage)).catch(() => {}) } catch { /* Accounting observers must not alter CAD or model execution. */ }
}

/** Four wire formats, one CAD tool schema. This adapter never fetches, approves edits or selects a model. */
export function createKJModelAdapter(options: KJModelAdapterOptions): KJAgentModel {
  const { protocol, request, onUsage: adapterUsage } = options
  if (!['responses', 'chat-completions', 'anthropic-messages', 'gemini-generate-content'].includes(protocol) || typeof request !== 'function') invalid('Choose an explicit protocol and host transport')
  if (adapterUsage !== undefined && typeof adapterUsage !== 'function') invalid('onUsage must be a function')
  const model = identifier(options.model)
  const outputTokens = limit(options.maxOutputTokens, 4096, 131072)
  const chatTokenParameter = options.chatTokenParameter ?? 'max_tokens'
  if (!['max_tokens', 'max_completion_tokens'].includes(chatTokenParameter)) invalid('Unsupported chat token-limit field')
  const responseBytes = limit(options.maxResponseBytes, 1048576, 16777216)
  const historyBytes = limit(options.maxHistoryBytes, 2097152, 16777216)
  return Object.freeze({
    createConversation({ instructions, tools, onUsage }: KJModelConversationOptions): KJModelConversation {
      if (onUsage !== undefined && typeof onUsage !== 'function') invalid('onUsage must be a function')
      const definitions = tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema }))
      const schema = jsonCopy(definitions, historyBytes)
      const history: unknown[] = []
      let pending: readonly KJModelToolCall[] = []
      let started = false, busy = false, ended = false, turnNumber = 0
      const geminiIds = new Map<string, string>()
      return {
        async next(input: KJModelInput, signal: AbortSignal): Promise<KJModelTurn> {
          if (busy || ended) invalid('Conversation is busy or has ended; start a fresh conversation')
          busy = true
          try {
            signal.throwIfAborted()
            if (!started) {
              if (input.kind !== 'prompt' || typeof input.text !== 'string') invalid('A conversation starts with a prompt')
              started = true
              if (protocol === 'gemini-generate-content') history.push({ role: 'user', parts: [{ text: input.text }] })
              else history.push({ role: 'user', content: input.text })
            } else {
              if (input.kind !== 'tool-results' || input.results.length !== pending.length || !pending.length) invalid('Every pending tool call needs exactly one result')
              const results = input.results
              for (let index = 0; index < pending.length; index++) {
                if (results[index]?.id !== pending[index]!.id || results[index]?.name !== pending[index]!.name) invalid('Tool results must preserve the original call IDs, names and order')
              }
              if (protocol === 'responses') history.push(...results.map(item => ({ type: 'function_call_output', call_id: item.id, output: JSON.stringify(item.result) })))
              else if (protocol === 'chat-completions') history.push(...results.map(item => ({ role: 'tool', tool_call_id: item.id, content: JSON.stringify(item.result) })))
              else if (protocol === 'anthropic-messages') history.push({ role: 'user', content: results.map(item => ({ type: 'tool_result', tool_use_id: item.id, content: JSON.stringify(item.result), is_error: !item.result.ok })) })
              else history.push({ role: 'function', parts: results.map(item => ({ functionResponse: { ...(geminiIds.has(item.id) ? { id: geminiIds.get(item.id) } : {}), name: item.name, response: item.result } })) })
            }
            let body: Record<string, unknown>
            if (protocol === 'responses') body = { model, instructions, input: history, tools: schema.map(tool => ({ type: 'function', ...tool, strict: false })), max_output_tokens: outputTokens, store: false, include: ['reasoning.encrypted_content'] }
            else if (protocol === 'chat-completions') body = { model, messages: [{ role: 'system', content: instructions }, ...history], tools: schema.map(tool => ({ type: 'function', function: tool })), [chatTokenParameter]: outputTokens, stream: false }
            else if (protocol === 'anthropic-messages') body = { model, system: instructions, messages: history, tools: schema.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })), max_tokens: outputTokens, stream: false }
            else body = { systemInstruction: { parts: [{ text: instructions }] }, contents: history, tools: [{ functionDeclarations: schema.map(tool => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }], generationConfig: { maxOutputTokens: outputTokens, candidateCount: 1 } }
            // Never expose mutable internal history, or credentials, through the public result.
            const outgoing = deepFreeze(jsonCopy(body, historyBytes))
            const startedAt = performance.now()
            const rawResponse = await request({ protocol, model, body: outgoing, signal })
            const usage = extractKJModelUsage(protocol, rawResponse, { latencyMs: Math.max(0, performance.now() - startedAt) })
            notifyUsage(onUsage, usage)
            notifyUsage(adapterUsage, usage)
            const response = record(jsonCopy(rawResponse, responseBytes))
            signal.throwIfAborted()
            turnNumber++
            let text = ''
            const calls: KJModelToolCall[] = []
            const addCall = (id: unknown, name: unknown, args: unknown) => calls.push({ id: identifier(id), name: identifier(name), arguments: args })
            if (protocol === 'responses') {
              if (response.status !== 'completed') throw new KJModelError('KJMODEL_INCOMPLETE', 'Response is incomplete or failed; no tool calls were dispatched')
              const output = array(response.output)
              for (const raw of output) {
                const item = record(raw)
                if (item.type === 'function_call') addCall(item.call_id, item.name, jsonArguments(item.arguments))
                else if (item.type === 'message') {
                  if (item.role !== 'assistant') invalid('Expected an assistant response')
                  for (const rawPart of array(item.content)) { const part = record(rawPart); if (part.type === 'output_text' && typeof part.text === 'string') text += part.text; else if (part.type === 'refusal') throw new KJModelError('KJMODEL_REFUSED', 'The model refused this request'); else invalid('Unsupported Responses message content') }
                } else if (item.type !== 'reasoning') invalid('Unsupported Responses output item; use a custom adapter for additional tools')
              }
              history.push(...output) // Includes reasoning items and opaque encrypted content.
            } else if (protocol === 'chat-completions') {
              const choices = array(response.choices)
              if (choices.length !== 1) invalid('Expected exactly one model choice')
              const choice = record(choices[0]), message = record(choice.message)
              if (!['stop', 'tool_calls'].includes(String(choice.finish_reason))) throw new KJModelError('KJMODEL_INCOMPLETE', 'Chat response is truncated, blocked or incomplete')
              if (message.role !== 'assistant') invalid('Expected an assistant message')
              if (message.refusal) throw new KJModelError('KJMODEL_REFUSED', 'The model refused this request')
              if (message.content !== null && message.content !== undefined && typeof message.content !== 'string') invalid('Only text and function-call chat messages are supported')
              text = typeof message.content === 'string' ? message.content : ''
              for (const raw of array(message.tool_calls ?? [])) { const item = record(raw), fn = record(item.function); if (item.type !== 'function') invalid('Unsupported chat tool type'); addCall(item.id, fn.name, jsonArguments(fn.arguments)) }
              if ((choice.finish_reason === 'tool_calls') !== (calls.length > 0)) invalid('Chat finish reason does not match its tool calls')
              history.push(message) // Preserve provider fields such as reasoning_content verbatim.
            } else if (protocol === 'anthropic-messages') {
              if (response.role !== 'assistant') invalid('Expected an assistant message')
              if (!['end_turn', 'tool_use', 'stop_sequence'].includes(String(response.stop_reason))) throw new KJModelError('KJMODEL_INCOMPLETE', 'Claude response is truncated, paused or incomplete')
              const content = array(response.content)
              for (const raw of content) { const item = record(raw); if (item.type === 'tool_use') addCall(item.id, item.name, item.input); else if (item.type === 'text' && typeof item.text === 'string') text += item.text; else if (!['thinking', 'redacted_thinking'].includes(String(item.type))) invalid('Unsupported Claude content block') }
              if ((response.stop_reason === 'tool_use') !== (calls.length > 0)) invalid('Claude stop reason does not match its tool calls')
              history.push({ role: 'assistant', content }) // Preserve signed thinking blocks.
            } else {
              const candidates = array(response.candidates)
              if (candidates.length !== 1) invalid('Expected exactly one Gemini candidate')
              const candidate = record(candidates[0])
              if (candidate.finishReason !== 'STOP') throw new KJModelError('KJMODEL_INCOMPLETE', 'Gemini response is blocked, truncated or incomplete')
              const content = record(candidate.content)
              if (content.role !== 'model') invalid('Expected a Gemini model turn')
              const parts = array(content.parts)
              for (const [index, raw] of parts.entries()) {
                const part = record(raw)
                if (part.functionCall) {
                  const call = record(part.functionCall)
                  const id = call.id === undefined ? `kj-gemini-${turnNumber}-${index}` : identifier(call.id)
                  if (call.id !== undefined) geminiIds.set(id, identifier(call.id))
                  addCall(id, call.name, call.args ?? {})
                } else if (typeof part.text === 'string') { if (part.thought !== true) text += part.text }
                else invalid('Unsupported Gemini part')
              }
              history.push(content) // Preserve thoughtSignature on its original part.
            }
            if (calls.length > 16 || new Set(calls.map(call => call.id)).size !== calls.length) invalid('Too many calls or duplicate call IDs in one model turn')
            if (!calls.length && !text.trim()) invalid('Model returned neither tool calls nor user-visible text')
            pending = calls
            ended = !calls.length
            return deepFreeze({ text, calls, usage }) as KJModelTurn
          } catch (error) { ended = true; throw error } finally { busy = false }
        },
      }
    },
  })
}
