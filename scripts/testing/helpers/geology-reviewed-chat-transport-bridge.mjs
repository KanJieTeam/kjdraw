import { callBenchmarkModel } from '../../benchmarks/token-provider-transport.mjs'

function fail(code) {
  const error = new Error(code)
  error.code = code
  throw error
}

/** The real chat runtime explicitly sends stream:false, while the benchmark
 * transport owns that field and rejects any caller-supplied stream property.
 * Remove only that exact declaration. Never weaken transport validation, strip
 * other owned fields, coerce streaming, or rewrite messages/CAD/tool arguments.
 */
export function benchmarkSettingsFromReviewedChat(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(settings))) fail('INVALID_REVIEWED_CHAT_SETTINGS')
  const descriptors = Object.getOwnPropertyDescriptors(settings)
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key]
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      fail('INVALID_REVIEWED_CHAT_SETTINGS')
  }
  if (Object.hasOwn(descriptors, 'stream') && descriptors.stream.value !== false) fail('INVALID_REVIEWED_CHAT_STREAM')
  const next = Object.create(Object.getPrototypeOf(settings))
  for (const key of Object.keys(descriptors)) if (key !== 'stream') Object.defineProperty(next, key, descriptors[key])
  return next
}

/** Exact delegation: adapter invocation is not proof of an HTTP request. This
 * bridge fabricates neither network counts nor provider usage/result fields.
 * A later runner must obtain network evidence from its real wire capture.
 */
export function callReviewedChatBenchmarkModel({ provider, model, messages, settings = {}, timeoutMs = 60000 } = {},
  transport = callBenchmarkModel) {
  if (typeof transport !== 'function') fail('INVALID_REVIEWED_CHAT_TRANSPORT')
  return transport({ provider, model, messages,
    settings: benchmarkSettingsFromReviewedChat(settings), timeoutMs })
}
