export const GEOLOGY_JSON_OBJECT_RESPONSE_FORMAT = Object.freeze({ type: 'json_object' })
export const GEOLOGY_JSON_OBJECT_PROTOCOL_VERSION = 'geology-user-scenarios-live-v5-json-object-v1'
const MAX_PUBLIC_RESPONSE_CHARACTERS = 1_048_576

export function validateGeologyAnswerEncoding(answerContractVersion, answerEncoding) {
  if (!['text', 'json-object'].includes(answerEncoding)) throw new Error('Use answerEncoding text or json-object')
  if (answerEncoding === 'json-object' && answerContractVersion !== 'v5') throw new Error('answerEncoding json-object requires answerContractVersion v5')
}

export function createGeologyJsonObjectProtocol(base) {
  if (base?.answerContractVersion !== 'v5') throw new Error('JSON answer encoding requires the v5 base protocol')
  return Object.freeze({ ...base,
    version: GEOLOGY_JSON_OBJECT_PROTOCOL_VERSION,
    answerEncoding: 'json-object',
    responseFormat: GEOLOGY_JSON_OBJECT_RESPONSE_FORMAT,
    responseFormatScope: 'Only scenarios with an existing public scenarioAnswerFrame receive json_object on their actual provider requests. Unframed mutation requests retain their original wire settings and native approval oracle. Prompts, caller facts, values and gold outcomes are unchanged.',
    finalMessageSource: 'The final actual provider assistant.content string, unchanged byte-for-byte: no concatenation, Markdown stripping, JSON repair or answer extraction. Runtime failure, a final tool-only turn, missing/empty content or finish_reason other than stop cannot be rescued by an earlier answer.',
    finalMessageValidation: 'JSON Object controls syntax only, not schema or factual correctness. Parse the whole final content and keep the existing strict independent oracle. A valid JSON object with wrong values or missing schema fields remains a failure. No new retries or requests; the existing per-case request cap remains 12.',
    diagnostics: 'Opt-in trusted public-synthetic response diagnostics additionally retain bounded raw assistant.content. Existing transport credential-reflection checks remain authoritative. Ordinary aggregate/checkpoint reports contain no raw content, prompts, headers, credentials or private drawing paths. Archived text-mode v3/v4/v5 evidence is never rescored.',
  })
}

export function geologyJsonObjectResponseFormat({ answerEncoding, answerFrame }) {
  return answerEncoding === 'json-object' && typeof answerFrame === 'string' && answerFrame.length > 0
    ? GEOLOGY_JSON_OBJECT_RESPONSE_FORMAT : null
}

/** Capture returned provider data only; never infer an answer from prior text. */
export function captureGeologyFinalProviderMessage(result) {
  return Object.freeze({
    content: typeof result?.content === 'string' && result.content.length <= MAX_PUBLIC_RESPONSE_CHARACTERS ? result.content : null,
    finishReason: result?.finishReason,
    toolCallCount: Array.isArray(result?.toolCalls) ? result.toolCalls.length : null,
  })
}

export function geologyFinalProviderMessageEvidence(message, runtimeStatus) {
  const rawFinalAnswer = typeof message?.content === 'string' ? message.content : ''
  if (runtimeStatus !== 'message' || message?.toolCallCount !== 0 || message?.finishReason !== 'stop' || !rawFinalAnswer.trim()) {
    return { answer: null, rawFinalAnswer, finalMessageValid: false }
  }
  try {
    const answer = JSON.parse(rawFinalAnswer)
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return { answer: null, rawFinalAnswer, finalMessageValid: false }
    return { answer, rawFinalAnswer, finalMessageValid: true }
  } catch { return { answer: null, rawFinalAnswer, finalMessageValid: false } }
}

/** Only extend the existing sanitized trusted diagnostic for public fixtures.
 * Transport validation has already rejected credential-reflecting responses.
 * Do not copy result headers, messages, parser exceptions or arbitrary fields.
 */
export function geologyJsonObjectResponseDiagnostic(result, diagnostic) {
  if (diagnostic?.scope !== 'public-synthetic-returned-model-turn') throw new Error('Raw content diagnostics require public synthetic response scope')
  const copy = structuredClone(diagnostic)
  const message = captureGeologyFinalProviderMessage(result)
  copy.assistant.content = message.content
  return copy
}
