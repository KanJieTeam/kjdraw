import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runImportedAnnotationModel } from './imported-annotation-model.mjs'
import { callBenchmarkModel } from './token-provider-transport.mjs'
import { publicAnnotationSheet } from '../../tests/helpers/public-annotation-sheet.mjs'

const endpoints = Object.freeze({
  deepseek: 'https://api.deepseek.com/chat/completions',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
})
const codeFiles = Object.freeze([
  'scripts/benchmarks/imported-annotation-model.mjs',
  'scripts/benchmarks/imported-annotation-providers.mjs',
  'scripts/benchmarks/token-provider-transport.mjs',
  'tests/helpers/public-annotation-sheet.mjs',
  'tests/helpers/imported-drawing-edit-journey.mjs',
  'apps/playground/ai/runtime.js', 'apps/playground/agent-chat.js',
  'packages/kjdraw-sdk/src/agent-runner.js', 'packages/kjdraw-sdk/src/agent-tools.js',
  'packages/kjdraw-sdk/src/drawing-text-search.js', 'packages/kjdraw-sdk/src/dxf-adapter.js',
])

/** Real provider transport. Credentials stay in env; artifacts omit prompts/text/arguments. */
export async function runImportedAnnotationProvider({ provider, model, bytes, targetText, sourceKind = 'public-generated-sheet', onProgress = () => {} }) {
  if (!Object.hasOwn(endpoints, provider)) throw new Error('Use deepseek or qwen')
  const fingerprints = await Promise.all(codeFiles.map(async path => [path,
    createHash('sha256').update(await readFile(new URL('../../' + path, import.meta.url))).digest('hex'),
  ]))
  const trace = [], returnedModels = new Set(), transportFailures = []
  const keyName = provider === 'deepseek' ? 'KJDRAW_DEEPSEEK_API_KEY' : 'KJDRAW_QWEN_API_KEY'
  // The SDK adapter requires a key, but transport reads the process-only value.
  const apiKey = process.env[keyName]
  if (!apiKey) throw new Error('Missing locally configured provider credential')
  const report = await runImportedAnnotationModel({ bytes, targetText,
    connection: { provider, model, endpoint: endpoints[provider], protocol: 'chat-completions', apiKey },
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      const { messages, model: requestedModel, stream, ...settings } = body
      if (provider === 'deepseek') settings.thinking = { type: 'disabled' }
      else settings.enable_thinking = false
      const requestIndex = trace.length + transportFailures.length + 1
      onProgress({ provider, request: requestIndex, phase: 'request' })
      let result
      try {
        result = await callBenchmarkModel({ provider, model: requestedModel, messages, settings, timeoutMs: 60000 })
      } catch (error) {
        // Transport codes are fixed strings, never the provider response body.
        const code = typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'TRANSPORT_FAILURE'
        transportFailures.push({ request: requestIndex, code })
        onProgress({ provider, request: requestIndex, phase: 'error', code })
        return Response.json({ error: { code } }, { status: 503 })
      }
      returnedModels.add(result.model)
      const item = {
        request: requestIndex, toolsOffered: body.tools?.map(tool => tool.function.name) ?? [],
        toolCalls: result.toolCalls.map(tool => tool.function.name),
        requestBytes: Buffer.byteLength(JSON.stringify({ model: requestedModel, messages, ...settings, stream: false })),
        usage: result.usage, elapsedMs: Math.round(result.elapsedMs),
      }
      trace.push(item)
      onProgress({ provider, request: requestIndex, phase: 'response', tools: item.toolCalls, tokens: result.usage.totalTokens })
      return Response.json({ model: result.model, choices: [{ message: {
        role: 'assistant', content: result.content, tool_calls: result.toolCalls,
      }, finish_reason: result.finishReason }], usage: {
        prompt_tokens: result.usage.inputTokens, completion_tokens: result.usage.outputTokens,
        total_tokens: result.usage.totalTokens,
        ...(result.usage.cacheReadInputTokens === null ? {} : { prompt_cache_hit_tokens: result.usage.cacheReadInputTokens }),
        ...(result.usage.cacheMissInputTokens === null ? {} : { prompt_cache_miss_tokens: result.usage.cacheMissInputTokens }),
        ...(result.usage.reasoningOutputTokens === null ? {} : { completion_tokens_details: { reasoning_tokens: result.usage.reasoningOutputTokens } }),
      } })
    },
  })
  return {
    testedAt: new Date().toISOString(), provider, sourceKind,
    returnedModels: [...returnedModels], settings: { maxOutputTokens: 4096, reasoning: 'disabled', timeoutMs: 60000, maxRequests: 40 },
    codeSha256: Object.fromEntries(fingerprints), report, trace, transportFailures,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv.includes('--run')) {
    console.log('Dry run: zero model requests. Append --run --provider deepseek|qwen --model MODEL, with the corresponding provider key in process environment. Optional: --drawing FILE --target-text LABEL --output REPORT.json. Private drawing query context is sent to the selected provider; source files are never overwritten.')
  } else {
    const option = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
    const file = option('--drawing')
    const bytes = file ? new Uint8Array(await readFile(file)) : new TextEncoder().encode((await publicAnnotationSheet()).dxf)
    const result = await runImportedAnnotationProvider({ provider: option('--provider'), model: option('--model'), bytes,
      targetText: option('--target-text'), sourceKind: file ? 'private-local-drawing' : 'public-generated-sheet',
    })
    const output = option('--output')
    if (output) {
      if (!output.endsWith('.json')) throw new Error('Report output must end in .json')
      await mkdir(dirname(resolve(output)), { recursive: true })
      await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    }
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.report.passed ? 0 : 1
  }
}
