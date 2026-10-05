// Local engine adapter for the paired, synthetic multi-turn pilot. No model access here.
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../../packages/kjdraw-sdk/src/agent-tools.js'

const input = JSON.parse(await new Promise((resolve, reject) => {
  let value = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { value += chunk; if (value.length > 2_000_000) reject(new Error('Input too large')) })
  process.stdin.on('end', () => resolve(value))
}))
const sdk = createKJDrawSDK()
const document = input.mode === 'init' || input.mode === 'definitions'
  ? sdk.createDocument({ documentId: 'synthetic-multiturn-pilot', units: 'millimeter' })
  : await sdk.readDocument(input.kjd, { format: 'KJD' })
const session = new KJAgentToolSession(sdk, document)
if (input.mode === 'definitions') {
  const wanted = ['cad_propose_move', 'cad_propose_circles', 'cad_propose_lines']
  process.stdout.write(JSON.stringify({ ok: true, tools: session.definitions.filter(item => wanted.includes(item.name))
    .map(item => ({ type: 'function', function: { name: item.name, description: item.description, parameters: item.inputSchema } })) }))
  process.exit(0)
}
const call = async (name, args) => {
  const proposal = await session.call(name, args)
  if (!proposal.ok) throw new Error(`Proposal rejected: ${proposal.error?.message ?? 'unknown'}`)
  // This reviewer exists only in a disposable synthetic benchmark, not a user workflow.
  const receipt = await session.approve(proposal.value.planId, 'synthetic-benchmark-reviewer')
  if (!receipt.ok) throw new Error(`Synthetic approval rejected: ${receipt.error?.message ?? 'unknown'}`)
}
try {
  if (input.mode === 'init') {
    await call('cad_propose_lines', { expectedRevision: document.revision, units: 'millimeter', lines: [
      { start: { x: 0, y: 0 }, end: { x: 120, y: 0 } },
      { start: { x: 120, y: 0 }, end: { x: 120, y: 60 } },
      { start: { x: 120, y: 60 }, end: { x: 0, y: 60 } },
      { start: { x: 0, y: 60 }, end: { x: 0, y: 0 } },
    ] })
    await call('cad_propose_circles', { expectedRevision: document.revision, units: 'millimeter', circles: [
      { center: { x: 10, y: 10 }, radius: 3 },
      { center: { x: 110, y: 10 }, radius: 3 },
      { center: { x: 110, y: 50 }, radius: 3 },
      { center: { x: 10, y: 50 }, radius: 3 },
    ] })
  } else if (input.mode === 'step') {
    await call(input.tool, input.args)
  } else throw new Error('Invalid mode')
  const kjd = await sdk.writeDocument(document, { format: 'KJD' })
  const dxf = await sdk.writeDocument(document, { format: 'DXF', version: '2018' })
  const reopened = await createKJDrawSDK().readDocument(kjd, { format: 'KJD' })
  if (reopened.listEntities().length !== document.listEntities().length) throw new Error('KJD reopen entity mismatch')
  process.stdout.write(JSON.stringify({ ok: true, kjd: typeof kjd === 'string' ? kjd : new TextDecoder().decode(kjd),
    dxf: typeof dxf === 'string' ? dxf : new TextDecoder().decode(dxf),
    revision: document.revision,
    entities: document.listEntities().map(({ id, type, payload }) => ({ id, type, payload })) }))
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error.message).slice(0, 200) }))
}
