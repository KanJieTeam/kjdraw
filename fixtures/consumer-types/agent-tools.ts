import { createKJDrawSDK, KJAgentToolSession as RootSession } from '@kanjieteam/kjdraw'
import { KJAgentToolSession, type KJAgentToolDefinition, type KJAgentToolResult } from '@kanjieteam/kjdraw/agent-tools'

const sdk = createKJDrawSDK()
const drawing = sdk.createDocument({ units: 'millimeter' })
const session: RootSession = new KJAgentToolSession(sdk, drawing)
const definitions: readonly KJAgentToolDefinition[] = session.definitions
const result: KJAgentToolResult = await session.call('cad_read_drawing', {})
if (!result.ok) console.log(result.error.code)
// @ts-expect-error Tool descriptors cannot be mutated by provider adapters.
definitions[0]!.name = 'execute_anything'
