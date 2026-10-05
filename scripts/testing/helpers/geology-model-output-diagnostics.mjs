/** Pure, non-repairing classification of the returned Chat tool argument wire. */
export function inspectGeologyModelToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return { calls: [], issues: [{ index: null, code: 'MODEL_TOOL_CALLS_NOT_ARRAY' }] }
  const calls = [], issues = []
  for (const [index, call] of toolCalls.entries()) {
    const raw = call?.function?.arguments
    let args = null, code = null
    if (typeof raw !== 'string') code = 'MODEL_TOOL_ARGUMENTS_NOT_STRING'
    else {
      try {
        args = JSON.parse(raw)
        if (!args || typeof args !== 'object' || Array.isArray(args)) code = 'MODEL_TOOL_ARGUMENTS_NOT_OBJECT'
      } catch { code = 'MODEL_TOOL_ARGUMENTS_INVALID_JSON' }
    }
    calls.push({ id: call?.id, name: call?.function?.name, args })
    if (code) issues.push({ index, code })
  }
  return { calls, issues }
}

/** Trusted callback only: raw PUBLIC synthetic response, never a request/body,
 * credential, final response text, parser error message or repaired arguments.
 * Do not place this object in the ordinary aggregate/checkpoint report. */
export function geologyModelResponseDiagnostic(result, { scenarioId, request, evidenceOrigin, trace }) {
  return structuredClone({ scope: 'public-synthetic-returned-model-turn', scenarioId, request, evidenceOrigin,
    returnedModel: result.model, finishReason: result.finishReason,
    assistant: { role: 'assistant', tool_calls: result.toolCalls },
    argumentIssues: inspectGeologyModelToolCalls(result.toolCalls).issues, trace })
}
