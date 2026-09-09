// Paired one-shot benchmark helpers. Model output is data, never executable code.
import { createKJDrawSDK } from '../../packages/kjdraw-sdk/src/sdk.js'
import { KJAgentToolSession } from '../../packages/kjdraw-sdk/src/agent-tools.js'
import { createKJModelAdapter } from '../../packages/kjdraw-sdk/src/model-adapters.js'
import { mountingProfile } from '../../packages/kjdraw-sdk/examples/fixtures/mounting-profile.mjs'

const empty = () => ({ expectedRevision: 0, units: 'millimeter', lines: [], circles: [], arcs: [], polylines: [] })
export const pilotTasks = [
  { id: 'mounting-plate', prompt: 'Draw a closed rectangular plate outline with corners (0,0), (120,0), (120,60), (0,60). Add four diameter-6 holes centered at (10,10), (110,10), (110,50), (10,50). Add a horizontal rounded slot: two horizontal lines from (50,25) to (70,25) and from (70,35) to (50,35); right semicircle centered at (70,30), radius 5, counterclockwise from 270 to 90 degrees, and left semicircle centered at (50,30), radius 5, counterclockwise from 90 to 270 degrees.', expected: mountingProfile() },
  { id: 'bolt-flange', prompt: 'Draw a flange centered at (0,0): an outer circle of radius 50, a central bore of radius 12, and six radius-3 bolt holes equally spaced on a pitch circle of radius 35, starting at angle 0 degrees and increasing by 60 degrees counterclockwise. Do not draw the construction pitch circle.', expected: { ...empty(), circles: [{ center: { x: 0, y: 0 }, radius: 50 }, { center: { x: 0, y: 0 }, radius: 12 }, ...Array.from({ length: 6 }, (_, i) => ({ center: { x: 35 * Math.cos(i * Math.PI / 3), y: 35 * Math.sin(i * Math.PI / 3) }, radius: 3 }))] } },
  { id: 'stepped-profile', prompt: 'Draw one closed six-vertex outline in this order: (0,0), (90,0), (90,25), (40,25), (40,70), (0,70). Add radius-4 holes centered at (15,15), (75,12), and (20,55). No other geometry.', expected: { ...empty(), circles: [[15,15],[75,12],[20,55]].map(([x,y]) => ({ center: { x,y }, radius: 4 })), polylines: [{ vertices: [[0,0],[90,0],[90,25],[40,25],[40,70],[0,70]].map(([x,y]) => ({ x,y })), closed: true }] } },
]

if (process.argv[2] === 'prepare') {
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const definition = new KJAgentToolSession(sdk, drawing).definitions.find(tool => tool.name === 'cad_propose_drawing')
  console.log(JSON.stringify({ tasks: pilotTasks, tool: { type: 'function', function: { name: definition.name, description: definition.description, parameters: definition.inputSchema } } }))
} else if (process.argv[2] === 'materialize') {
  let input = ''
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 2097152) throw new Error('Input exceeds pilot limit') }
  const { response } = JSON.parse(input)
  const sdk = createKJDrawSDK(), drawing = sdk.createDocument({ units: 'millimeter' })
  const session = new KJAgentToolSession(sdk, drawing)
  const model = createKJModelAdapter({ protocol: 'chat-completions', model: response.model, request: async () => response })
  const conversation = model.createConversation({ instructions: 'Materialize the captured benchmark response.', tools: session.definitions })
  try {
    const turn = await conversation.next({ kind: 'prompt', text: 'Return one drawing proposal.' }, new AbortController().signal)
    if (turn.calls.length !== 1 || turn.calls[0].name !== 'cad_propose_drawing') throw new Error('Expected exactly one drawing proposal')
    const proposal = await session.call(turn.calls[0].name, turn.calls[0].arguments)
    if (!proposal.ok) throw new Error(proposal.error.message)
    // Only synthetic benchmark documents are approved here, never user drawings.
    const receipt = await session.approve(proposal.value.planId, 'synthetic-benchmark-reviewer')
    if (!receipt.ok) throw new Error(receipt.error.message)
    const data = await sdk.writeDocument(drawing, { format: 'DXF', version: '2018' })
    const dxf = typeof data === 'string' ? data : new TextDecoder().decode(data)
    console.log(JSON.stringify({ ok: true, dxf, entities: drawing.listEntities().length }))
  } catch (error) { console.log(JSON.stringify({ ok: false, error: String(error.message).slice(0, 300) })) }
}
