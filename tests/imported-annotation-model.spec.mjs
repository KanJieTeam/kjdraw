import test from 'node:test'
import assert from 'node:assert/strict'
import { runImportedAnnotationModel, importedAnnotationModelProtocol } from '../scripts/benchmarks/imported-annotation-model.mjs'
import { publicAnnotationSheet } from './helpers/public-annotation-sheet.mjs'

function protocolFixture({ wrongText = false } = {}) {
  let requestCount = 0
  return async (_url, request) => {
    requestCount++
    const body = JSON.parse(request.body)
    const prompt = body.messages.find(message => message.role === 'user').content
    const userPrompt = prompt.split('Current user request: ').at(-1)
    const expectedRevision = Number(prompt.match(/revision (\d+);/)[1])
    const units = prompt.match(/units ([^.;]+)\./)[1]
    const text = userPrompt.match(/孔号标注“([^”]+)”/)[1]
    let name, args
    if (body.messages.at(-1).role === 'user') {
      name = 'cad_find_text'
      args = { expectedRevision, search: text, match: 'exact' }
    } else {
      const result = JSON.parse(body.messages.at(-1).content)
      assert.equal(result.ok, true)
      const id = result.value.matches[0].id
      if (userPrompt.includes('沿 X 移动')) {
        const [, dx, dy] = userPrompt.match(/沿 X 移动 (-?\d+)、沿 Y 移动 (-?\d+)/)
        name = 'cad_propose_move'
        args = { expectedRevision, units, ids: [id], dx: Number(dx), dy: Number(dy) }
      } else {
        name = 'cad_propose_text_edit'
        args = { expectedRevision, units, changes: [{ id, expectedText: text,
          text: wrongText ? 'WRONG' : userPrompt.match(/改成“([^”]+)”/)[1],
        }] }
      }
    }
    return Response.json({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
      id: 'model-fixture-' + requestCount, type: 'function', function: { name, arguments: JSON.stringify(args) },
    }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })
  }
}

const connection = { endpoint: 'https://model.fixture.invalid/v1/chat/completions', model: 'fixture', apiKey: 'fixture-only-key' }
test('live-test harness checks ten cumulative protocol edits with exact oracle and reported usage', async () => {
  const { dxf } = await publicAnnotationSheet()
  const report = await runImportedAnnotationModel({ bytes: new TextEncoder().encode(dxf), connection, fetchImpl: protocolFixture() })
  assert.equal(importedAnnotationModelProtocol.rounds, 10)
  assert.equal(report.passed, true, JSON.stringify(report))
  assert.equal(report.rounds.length, 10)
  assert.equal(report.requests, 20)
  assert.equal(report.totalTokens, 2400)
  assert.ok(report.rounds.every(round => round.passed))
  assert.equal(JSON.stringify(report).includes(connection.apiKey), false)
  assert.equal(JSON.stringify(report).includes('ZK03'), false, 'Result must not disclose source labels')
})

test('wrong proposal fails the cumulative journey without being counted as success', async () => {
  const { dxf } = await publicAnnotationSheet()
  const report = await runImportedAnnotationModel({ bytes: new TextEncoder().encode(dxf), connection,
    fetchImpl: protocolFixture({ wrongText: true }),
  })
  assert.equal(report.passed, false)
  assert.equal(report.rounds.length, 1)
  assert.equal(report.rounds[0].passed, false)
  assert.equal(report.rounds[0].failure, 'EXACT_ORACLE_OR_REOPEN_FAILED')
})

test('request budget bounds network calls and is not hidden as a completed journey', async () => {
  const { dxf } = await publicAnnotationSheet()
  const report = await runImportedAnnotationModel({ bytes: new TextEncoder().encode(dxf), connection,
    fetchImpl: protocolFixture(), maxRequests: 1,
  })
  assert.equal(report.requests, 1)
  assert.equal(report.passed, false)
  assert.equal(report.rounds[0].passed, false)
  assert.equal(report.rounds.length, 1)
})
