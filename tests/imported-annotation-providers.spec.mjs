import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { runImportedAnnotationProvider } from '../scripts/benchmarks/imported-annotation-providers.mjs'
import { publicAnnotationSheet } from './helpers/public-annotation-sheet.mjs'

test('provider harness keeps reported usage and model identity without disclosing prompts or credentials', async () => {
  const requests = []
  const server = http.createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    requests.push(body)
    const prompt = body.messages.find(message => message.role === 'user').content
    const user = prompt.split('Current user request: ').at(-1)
    const expectedRevision = Number(prompt.match(/revision (\d+);/)[1])
    const units = prompt.match(/units ([^.;]+)\./)[1]
    const text = user.match(/孔号标注“([^”]+)”/)[1]
    let name, args
    if (body.messages.at(-1).role === 'user') {
      name = 'cad_find_text'
      args = { expectedRevision, search: text, match: 'exact' }
    } else {
      const id = JSON.parse(body.messages.at(-1).content).value.matches[0].id
      if (user.includes('沿 X 移动')) {
        const [, dx, dy] = user.match(/沿 X 移动 (-?\d+)、沿 Y 移动 (-?\d+)/)
        name = 'cad_propose_move'
        args = { expectedRevision, units, ids: [id], dx: Number(dx), dy: Number(dy) }
      } else {
        name = 'cad_propose_text_edit'
        args = { expectedRevision, units, changes: [{ id, expectedText: text, text: user.match(/改成“([^”]+)”/)[1] }] }
      }
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ model: 'returned-fixture-model', choices: [{ message: {
      role: 'assistant', content: '', tool_calls: [{ id: 'fixture-' + requests.length, type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      }],
    }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20,
      total_tokens: 120, prompt_cache_hit_tokens: 60, prompt_cache_miss_tokens: 40,
    } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const envNames = ['KJDRAW_BENCH_FIXTURE_ENDPOINT', 'KJDRAW_DEEPSEEK_API_KEY', 'KJDRAW_QWEN_API_KEY', 'KJDRAW_BENCH_PROXY']
  const saved = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
  try {
    process.env.KJDRAW_BENCH_FIXTURE_ENDPOINT = `http://127.0.0.1:${server.address().port}`
    process.env.KJDRAW_DEEPSEEK_API_KEY = 'local-fixture-secret-deepseek'
    process.env.KJDRAW_QWEN_API_KEY = 'local-fixture-secret-qwen'
    delete process.env.KJDRAW_BENCH_PROXY
    const bytes = new TextEncoder().encode((await publicAnnotationSheet()).dxf)
    for (const provider of ['deepseek', 'qwen']) {
      const start = requests.length
      const artifact = await runImportedAnnotationProvider({ provider, model: 'requested-fixture-model', bytes })
      assert.equal(artifact.report.passed, true)
      assert.equal(artifact.report.requests, 20)
      assert.equal(artifact.report.totalTokens, 2400)
      assert.deepEqual(artifact.returnedModels, ['returned-fixture-model'])
      assert.equal(artifact.trace.length, 20)
      assert.equal(artifact.trace[0].usage.cacheReadInputTokens, 60)
      assert.equal(artifact.report.usage[0].cacheReadInputTokens, 60)
      assert.deepEqual(artifact.transportFailures, [])
      assert.ok(Object.values(artifact.codeSha256).every(hash => /^[a-f0-9]{64}$/.test(hash)))
      const wire = requests[start]
      if (provider === 'deepseek') assert.deepEqual(wire.thinking, { type: 'disabled' })
      else assert.equal(wire.enable_thinking, false)
      const json = JSON.stringify(artifact)
      assert.equal(json.includes('local-fixture-secret'), false)
      assert.equal(json.includes('ZK03'), false)
      assert.ok(artifact.trace.every(item => item.requestBytes > 0 && !Object.hasOwn(item, 'arguments')))
    }
  } finally {
    for (const name of envNames) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
    await new Promise(resolve => server.close(resolve))
  }
})

test('provider harness rejects an unknown provider before sending any request', async () => {
  await assert.rejects(runImportedAnnotationProvider({ provider: 'unknown', model: 'fixture', bytes: new Uint8Array() }), /Use deepseek or qwen/)
})
