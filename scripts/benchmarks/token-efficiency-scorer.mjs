// Scorer-only adapter. Callers must never place task.expectedRounds or seed
// acceptance data in a model request, tool definition, or tool response.
import { fileURLToPath } from 'node:url'
import { delimiter, isAbsolute } from 'node:path'
import { independentValidation } from './paired-model-benchmark.mjs'
import { spawnSyncWithFileStdin } from '../spawn-file-stdin.mjs'

const identityScript = fileURLToPath(new URL('./token-efficiency-identity-validator.py', import.meta.url))
const fail = (...reasons) => ({ passed: false, reasons: [...new Set(reasons)] })
const pass = () => ({ passed: true, reasons: [] })
const pythonPath = ezdxfPath => ezdxfPath ? [ezdxfPath, process.env.PYTHONPATH].filter(Boolean).join(delimiter) : process.env.PYTHONPATH
function withEzdxfPath(ezdxfPath, operation) {
  if (ezdxfPath === null || ezdxfPath === undefined) return operation()
  if (typeof ezdxfPath !== 'string' || !isAbsolute(ezdxfPath)) return fail('INVALID_EZDXF_RUNTIME_PATH')
  const prior = process.env.PYTHONPATH
  process.env.PYTHONPATH = pythonPath(ezdxfPath)
  try { return operation() }
  finally { if (prior === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = prior }
}

function seedExpected(task) {
  const expected = { expectedRevision: 0, units: task.units, lines: [], circles: [], arcs: [], polylines: [] }
  for (const feature of task.seed.features) expected[feature.kind].push(feature.shape)
  return expected
}

function normalizedHandles(handles, features) {
  if (!handles || typeof handles !== 'object' || Array.isArray(handles)) return null
  const ids = features.map(feature => feature.id)
  if (Object.keys(handles).length !== ids.length || !ids.every(id => Object.hasOwn(handles, id))) return null
  const values = ids.map(id => handles[id])
  if (values.some(value => typeof value !== 'string' || !/^[0-9A-F]+$/i.test(value))) return null
  const uppercase = values.map(value => value.toUpperCase())
  if (new Set(uppercase).size !== uppercase.length) return null
  return Object.fromEntries(ids.map((id, index) => [id, uppercase[index]]))
}

function independentGeometry(dxf, expected, validatorKind, python, ezdxfPath) {
  try {
    const result = withEzdxfPath(ezdxfPath, () => independentValidation({ python, dxf, expected, validatorKind }))
    if (result?.passed === false && result.reasons?.includes('INVALID_EZDXF_RUNTIME_PATH')) return result
    return result.passed ? pass() : fail('GEOMETRY_OR_DXF_MISMATCH')
  } catch {
    return fail('INDEPENDENT_VALIDATOR_UNAVAILABLE')
  }
}

function independentIdentity(dxf, features, handles, python, ezdxfPath) {
  if (ezdxfPath !== null && ezdxfPath !== undefined && (typeof ezdxfPath !== 'string' || !isAbsolute(ezdxfPath))) return fail('INVALID_EZDXF_RUNTIME_PATH')
  let result
  try {
    result = spawnSyncWithFileStdin(python, ['-B', identityScript], JSON.stringify({ dxf, features, handles }), {
      encoding: 'utf8', timeout: 30000, maxBuffer: 65536, windowsHide: true,
      ...(ezdxfPath ? { env: { PYTHONPATH: pythonPath(ezdxfPath) } } : {}),
    })
  } catch { return fail('IDENTITY_VALIDATOR_UNAVAILABLE') }
  if (result.status !== 0 || result.error) return fail('IDENTITY_VALIDATOR_UNAVAILABLE')
  try {
    const response = JSON.parse(result.stdout)
    if (typeof response.passed !== 'boolean' || !Array.isArray(response.reasons) || response.reasons.some(reason => typeof reason !== 'string')) return fail('IDENTITY_VALIDATOR_UNAVAILABLE')
    return response.passed ? pass() : fail(...response.reasons)
  } catch { return fail('IDENTITY_VALIDATOR_UNAVAILABLE') }
}

// The arm tracks KJDraw entity IDs, while the independent scorer uses the
// exported DXF handles. The Python bridge verifies every returned handle.
export function featureHandlesFromKJDrawDocument({ document, featureIds } = {}) {
  if (!document || typeof document.getObject !== 'function' || !featureIds || typeof featureIds !== 'object' || Array.isArray(featureIds)) throw new TypeError('Provide a document and feature-ID map')
  const handles = {}
  for (const [featureId, entityId] of Object.entries(featureIds)) {
    const handle = document.getObject(entityId)?.handle
    if (typeof handle !== 'string' || !/^[0-9A-F]+$/i.test(handle)) throw new Error(`Missing DXF handle for feature ${featureId}`)
    handles[featureId] = handle.toUpperCase()
  }
  return handles
}

function scoreFeatures(dxf, features, featureHandles, previousFeatureHandles, python, ezdxfPath) {
  const current = normalizedHandles(featureHandles, features)
  if (!current) return fail('FEATURE_HANDLES_INVALID')
  if (previousFeatureHandles !== undefined) {
    const previous = normalizedHandles(previousFeatureHandles, features)
    if (!previous) return fail('PREVIOUS_FEATURE_HANDLES_INVALID')
    if (features.some(feature => previous[feature.id] !== current[feature.id])) return fail('FEATURE_HANDLE_CHANGED')
  }
  return independentIdentity(dxf, features, current, python, ezdxfPath)
}

export function scoreTokenEfficiencySeed({ task, dxf, featureHandles, python = process.env.KJDRAW_PYTHON ?? 'python', ezdxfPath = process.env.KJDRAW_EZDXF_PATH ?? null } = {}) {
  if (task?.category !== 'multi-round-edit' || !Array.isArray(task.seed?.features) || typeof dxf !== 'string' || !dxf) return fail('INVALID_SEED_INPUT')
  const geometry = independentGeometry(dxf, seedExpected(task), 'generic', python, ezdxfPath)
  if (!geometry.passed) return geometry
  return scoreFeatures(dxf, task.seed.features, featureHandles, undefined, python, ezdxfPath)
}

export function scoreTokenEfficiencyRound({ task, roundIndex, dxf, featureHandles, previousFeatureHandles, python = process.env.KJDRAW_PYTHON ?? 'python', ezdxfPath = process.env.KJDRAW_EZDXF_PATH ?? null } = {}) {
  if (!task || !Number.isSafeInteger(roundIndex) || roundIndex < 0 || !Array.isArray(task.expectedRounds) || roundIndex >= task.expectedRounds.length || typeof dxf !== 'string' || !dxf) return fail('INVALID_ROUND_INPUT')
  const expectedRound = task.expectedRounds[roundIndex]
  const geometry = independentGeometry(dxf, expectedRound.expected, expectedRound.validatorKind, python, ezdxfPath)
  if (!geometry.passed) return geometry
  if (task.category !== 'multi-round-edit') return pass()
  if (!Array.isArray(expectedRound.expectedFeatures)) return fail('EXPECTED_FEATURES_UNAVAILABLE')
  if (previousFeatureHandles === undefined) return fail('PREVIOUS_FEATURE_HANDLES_REQUIRED')
  return scoreFeatures(dxf, expectedRound.expectedFeatures, featureHandles, previousFeatureHandles, python, ezdxfPath)
}
