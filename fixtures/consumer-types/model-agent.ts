import { createKJDrawSDK, type KJAgentModel } from '@kanjieteam/kjdraw'
import { KJAgentToolSession } from '@kanjieteam/kjdraw/agent-tools'
import { createKJModelAdapter, type KJModelRequest } from '@kanjieteam/kjdraw/model-adapters'
import { runKJAgentTask, type KJAgentRunResult } from '@kanjieteam/kjdraw/agent-runner'

const sdk = createKJDrawSDK()
const session = new KJAgentToolSession(sdk, sdk.createDocument({ units: 'millimeter' }))
const transport = async (_request: KJModelRequest): Promise<unknown> => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Specify dimensions.' }] }] })
const model: KJAgentModel = createKJModelAdapter({ protocol: 'responses', model: 'host-selected', request: transport })
const result: KJAgentRunResult = await runKJAgentTask({ session, model, prompt: 'Draw a part.' })
if (result.status === 'awaiting-approval') console.log(result.proposalIds)
// @ts-expect-error Models must be connected through an explicit known protocol or a custom KJAgentModel.
createKJModelAdapter({ protocol: 'any-vendor-name', model: 'x', request: transport })
// @ts-expect-error Model runners do not accept automatic approval switches.
runKJAgentTask({ session, model, prompt: 'draw', autoApprove: true })
