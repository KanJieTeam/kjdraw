import { round4NativeAnswerFrame, round4NativeDescriptor } from './geology-round4-native-oracles.mjs'

// Additive and opt-in only: no archived prompts, answers, gold or scoring rules
// are rewritten. This is a public output-field encoding contract, not a fixture
// fact. It neither reads a drawing nor supplies identities or connection results.
export const ROUND4_READ_ANSWER_POLICY_VERSION = 'native-policy-codes-v1'
export const ROUND4_READ_ANSWER_POLICY_INTENTS = Object.freeze([
  'cad-query.native-object', 'cad-query.endpoint-topology',
])

const coordinatePolicy = 'The coordinateSpace answer field is a coordinate POLICY code, not the entity space name. '
  + 'The code "owner-local" means native definition coordinates in each entity\'s own ownerId basis, with no INSERT expansion, '
  + 'viewport projection or transformation into a common world space. Keep ownerId as the separate native identity field; '
  + 'do not replace this policy code with "model", "paper", "model-xy", "native-owner" or prose. '
  + 'Read every identity and geometric quantity from the actual current drawing.'
const topologyPolicy = 'The semanticInference answer field is an inference POLICY code. '
  + 'The code "none" means only native endpoint/vertex distance and owner identity are considered; '
  + 'no geological continuity, building membership or other industry meaning is inferred. '
  + 'This code makes no claim about whether the requested entities are connected. '
  + 'Read or compute every connection and distance from the actual bound native query.'

export function round4ReadAnswerPolicyInstructions(value, { answerPolicyVersion = 'legacy' } = {}) {
  if (answerPolicyVersion !== 'legacy' && answerPolicyVersion !== ROUND4_READ_ANSWER_POLICY_VERSION)
    throw new Error(`Unsupported R4 read answer policy: ${answerPolicyVersion}`)
  const descriptor = round4NativeDescriptor(value)
  if (answerPolicyVersion === 'legacy' || !ROUND4_READ_ANSWER_POLICY_INTENTS.includes(descriptor?.intent)) return null
  return `${coordinatePolicy}${descriptor.intent === 'cad-query.endpoint-topology' ? ` ${topologyPolicy}` : ''}`
}

/** Default legacy frame is byte-for-byte identical. A future frozen runner must
 * select this version explicitly and record it in its execution surface/report.
 * The opt-in text disambiguates field vocabulary; the existing exact oracle is
 * deliberately unchanged, including every native coordinate/identity/value.
 */
export function round4ReadAnswerFrameWithPolicy(value, options = {}) {
  const instructions = round4ReadAnswerPolicyInstructions(value, options)
  const frame = round4NativeAnswerFrame(value)
  return frame == null || instructions == null ? frame : `${frame}\nPublic answer field encoding (${ROUND4_READ_ANSWER_POLICY_VERSION}): ${instructions}`
}
