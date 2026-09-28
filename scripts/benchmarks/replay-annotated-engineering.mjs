// Offline replay of saved annotated-engineering tool calls. No provider request or source-document mutation.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../../packages/kjdraw-sdk/src/agent-tools.js'
import { independentValidation } from './paired-model-benchmark.mjs'

const args = process.argv.slice(2)
if (!args.length || args.length > 2 || args.slice(1).some(arg => arg !== '--assert-original')) {
  console.error('Usage: node scripts/benchmarks/replay-annotated-engineering.mjs <extracted-run-directory> [--assert-original]')
  process.exit(2)
}
const folder = resolve(args[0])
const read = async name => JSON.parse(await readFile(resolve(folder, name), 'utf8'))
const report = await read('report.json')
if (report.taskSuite !== 'engineering' || report.drawingTool !== 'cad_propose_drawing_annotated' || report.tasks.length !== 1) throw new Error('Expected one annotated engineering task')
const expected = report.tasks[0].expected
const results = []
for (const run of report.runs.filter(item => item.arm === 'kjdraw-tool')) {
  const response = await read(run.files.response)
  const calls = response.choices?.[0]?.message?.tool_calls
  if (!Array.isArray(calls) || calls.length !== 1 || calls[0].function?.name !== report.drawingTool) throw new Error(`Missing one captured tool call in repetition ${run.repetition}`)
  const input = JSON.parse(calls[0].function.arguments)
  const sdk = createKJDrawSDK(), document = sdk.createDocument({ units: expected.units })
  const session = new KJAgentToolSession(sdk, document)
  const proposal = await session.call(report.drawingTool, input)
  let replay = proposal.ok ? { passed: false, reason: 'APPROVAL_FAILED' } : { passed: false, reason: proposal.error.message }
  if (proposal.ok) {
    // This is a fresh, synthetic document created only for replay, never a user drawing.
    const approval = await session.approve(proposal.value.planId, 'offline-benchmark-reviewer')
    if (approval.ok) {
      const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
      replay = independentValidation({ dxf, expected, taskSuite: 'engineering' })
    }
  }
  results.push({ repetition: run.repetition, originalPassed: run.status === 'passed', replayPassed: replay.passed, reason: replay.reason ?? null })
}
const changed = results.filter(item => item.originalPassed !== item.replayPassed)
console.log(JSON.stringify({ kind: 'offline saved-response engineering replay; no model calls', results, changedCount: changed.length }))
if (args.includes('--assert-original') && changed.length) process.exitCode = 1
