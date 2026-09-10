import { createKJDrawSDK, type KJAgentModel } from '@kanjieteam/kjdraw'
import { KJAgentToolSession } from '@kanjieteam/kjdraw/agent-tools'
import { createKJModelAdapter, type KJModelRequest } from '@kanjieteam/kjdraw/model-adapters'
import { runKJAgentTask, type KJAgentRunResult } from '@kanjieteam/kjdraw/agent-runner'
import { KJAgentCapabilityRegistry, type KJResolvedAgentCapabilities } from '@kanjieteam/kjdraw/agent-capabilities'

const sdk = createKJDrawSDK()
const session = new KJAgentToolSession(sdk, sdk.createDocument({ units: 'millimeter' }))
const transport = async (_request: KJModelRequest): Promise<unknown> => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Specify dimensions.' }] }] })
const model: KJAgentModel = createKJModelAdapter({ protocol: 'responses', model: 'host-selected', request: transport })
const result: KJAgentRunResult = await runKJAgentTask({ session, model, prompt: 'Draw a part.' })
if (result.status === 'awaiting-approval') console.log(result.proposalIds)
const registry = new KJAgentCapabilityRegistry()
registry.register({
  schema: 'com.kanjie.kjdraw.agent-capability', schemaVersion: 1, toolApiVersion: 1,
  id: 'example.inspection', version: '1.0.0', name: 'Inspection',
  instructions: 'Read the drawing before inspecting it.', requiredToolNames: ['cad_read_drawing'], requirements: [],
})
const lock = registry.createLock([{ id: 'example.inspection', version: '1.0.0' }])
const selected: KJResolvedAgentCapabilities = registry.resolve({ lock, allowedToolNames: session.definitions.map(tool => tool.name) })
const withCapabilities: KJAgentRunResult = await runKJAgentTask({ session, model, prompt: 'Inspect.', capabilities: { registry, lock }, toolNames: selected.toolNames })
console.log(withCapabilities.status)
// @ts-expect-error Project locks are immutable and upgrades require a new lock.
lock[0].version = '2.0.0'
// @ts-expect-error Models must be connected through an explicit known protocol or a custom KJAgentModel.
createKJModelAdapter({ protocol: 'any-vendor-name', model: 'x', request: transport })
// @ts-expect-error Model runners do not accept automatic approval switches.
runKJAgentTask({ session, model, prompt: 'draw', autoApprove: true })
