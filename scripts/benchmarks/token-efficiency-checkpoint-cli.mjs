// Resumable entrypoint for the frozen paired CAD benchmark. Live execution needs
// both an explicit paid-run switch and a hash-pinned, trusted review gate.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runCheckpointedTokenBenchmark } from './token-efficiency-checkpoint.mjs'
import { runTokenEfficiencyUnit } from './token-efficiency-runner.mjs'
import { tokenEfficiencyTaskCorpus } from './token-efficiency-task-corpus.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const hashPattern = /^[0-9a-f]{64}$/
const sourceFiles = ['token-efficiency-checkpoint-cli.mjs', 'token-efficiency-checkpoint.mjs', 'aggregate-multiround-comparison.mjs', 'token-efficiency-runner.mjs',
  'token-efficiency-scorer.mjs', 'token-efficiency-identity-validator.py', 'declarative-ezdxf-baseline.mjs',
  'declarative-ezdxf-worker.py', 'declarative-ezdxf-manufacturing.py', 'token-kjdraw-arm.mjs',
  'token-provider-transport.mjs', 'token-efficiency-task-corpus.mjs', 'manufacturing-task-suite.mjs',
  '../../packages/kjdraw-sdk/src/agent-compact-tool-surface.js', '../../packages/kjdraw-sdk/src/agent-skill-json.js',
  '../../packages/kjdraw-sdk/src/agent-drawing-compact.js', '../../packages/kjdraw-sdk/src/agent-tools.js',
  '../../packages/kjdraw-sdk/src/sdk.js', '../../packages/kjdraw-sdk/package.json', '../../package-lock.json']

function fixedConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || !Array.isArray(config.models) || !config.models.length ||
    Object.keys(config).some(key => !['models', 'repetitions', 'taskIds', 'timeoutMs', 'interfaceMode'].includes(key)) ||
    !Number.isSafeInteger(config.repetitions) || config.repetitions < 3 || config.repetitions > 30 ||
    config.taskIds !== undefined && (!Array.isArray(config.taskIds) || !config.taskIds.length ||
      config.taskIds.some(id => typeof id !== 'string') || new Set(config.taskIds).size !== config.taskIds.length) ||
    config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 120000) ||
    config.interfaceMode !== undefined && !['function-tools', 'skill-json'].includes(config.interfaceMode)) throw new Error('INVALID_CHECKPOINT_CONFIG')
  for (const entry of config.models) {
    if (!entry || !['deepseek', 'qwen', 'glm'].includes(entry.provider) || typeof entry.model !== 'string' ||
      Object.keys(entry).some(key => !['provider', 'model', 'settings'].includes(key)) ||
      !/^[a-zA-Z0-9._-]{1,128}$/.test(entry.model) || !entry.settings || typeof entry.settings !== 'object' || Array.isArray(entry.settings) ||
      ['model', 'messages', 'stream', 'tools', 'tool_choice', 'authorization', 'apiKey', 'api_key', 'headers', 'endpoint'].some(key => Object.hasOwn(entry.settings, key))) throw new Error('INVALID_CHECKPOINT_MODEL')
  }
  const requested = config.taskIds ? new Set(config.taskIds) : null
  const tasks = tokenEfficiencyTaskCorpus.filter(task => !requested || requested.has(task.id))
  if (requested && tasks.length !== requested.size) throw new Error('UNKNOWN_TASK_ID')
  return { tasks, models: config.models, repetitions: config.repetitions, timeoutMs: config.timeoutMs ?? 60000,
    interfaceMode: config.interfaceMode ?? 'function-tools' }
}

async function sourceContext(reviewGateSha256) {
  const parts = []
  for (const name of sourceFiles) {
    const bytes = await readFile(new URL(name, import.meta.url))
    parts.push([name, sha256(bytes)])
  }
  return sha256(JSON.stringify({ sources: parts, reviewGateSha256 }))
}

export async function runTokenCheckpointCli({ config, output, mode = 'fixture', dryRun = true, confirmPaid = false,
  reviewProposal, reviewGateSha256 = null, modelCall, compileBaseline, scoreRound, scoreSeed,
  createKjdraw, validatorProbe, saveModelArtifacts } = {}) {
  if (!['fixture', 'live'].includes(mode)) throw new Error('INVALID_CHECKPOINT_MODE')
  const fixed = fixedConfig(config)
  if (!dryRun && (typeof output !== 'string' || !output.trim())) throw new Error('CHECKPOINT_OUTPUT_REQUIRED')
  if (mode === 'live' && !dryRun && (!confirmPaid || typeof reviewProposal !== 'function' || !hashPattern.test(reviewGateSha256 ?? ''))) throw new Error('EXPLICIT_LIVE_REVIEW_AND_PAYMENT_CONFIRMATION_REQUIRED')
  if (mode === 'fixture' && !dryRun && typeof modelCall !== 'function') throw new Error('FIXTURE_MODEL_REQUIRED')
  const executionContextSha256 = await sourceContext(mode === 'live' ? reviewGateSha256 : 'fixture')
  return runCheckpointedTokenBenchmark({ tasks: fixed.tasks, models: fixed.models, repetitions: fixed.repetitions,
    executionMode: mode, executionContextSha256, output, dryRun,
    executeUnit: async ({ task, model, repetition }) => {
      const modelArtifacts = []
      const result = await runTokenEfficiencyUnit({ task, repetition,
        protocolRepetitions: fixed.repetitions, provider: model.provider, model: model.model, settings: model.settings,
        timeoutMs: fixed.timeoutMs, mode, interfaceMode: fixed.interfaceMode, reviewProposal,
        modelCall, compileBaseline, scoreRound, scoreSeed, createKjdraw, validatorProbe,
        saveModelArtifacts: async artifact => {
          modelArtifacts.push({ ...artifact, interfaceMode: fixed.interfaceMode }) // Runner has already redacted configured provider keys.
          if (saveModelArtifacts) await saveModelArtifacts(artifact)
        } })
      return { ...result, modelArtifacts }
    } })
}

function argsMap(argv) {
  const options = new Map()
  for (const arg of argv) {
    const matched = /^--([a-z][a-z-]*)(?:=(.*))?$/.exec(arg)
    if (!matched || options.has(matched[1])) throw new Error('INVALID_CLI_OPTION')
    options.set(matched[1], matched[2] ?? true)
  }
  if ([...options.keys()].some(key => !['config', 'output', 'run', 'mode', 'confirm-paid', 'review-gate', 'review-gate-sha256'].includes(key))) throw new Error('INVALID_CLI_OPTION')
  return options
}

export async function main(argv = process.argv.slice(2)) {
  const args = argsMap(argv)
  const configPath = args.get('config'), output = args.get('output'), dryRun = !args.has('run'), mode = args.get('mode') ?? 'live'
  if (typeof configPath !== 'string' || !isAbsolute(configPath) || typeof output !== 'string' || !isAbsolute(output) ||
    args.get('run') !== undefined && args.get('run') !== true ||
    args.get('confirm-paid') !== undefined && args.get('confirm-paid') !== true) throw new Error('ABSOLUTE_CONFIG_AND_OUTPUT_REQUIRED')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  let reviewProposal, reviewGateSha256 = null
  if (!dryRun) {
    if (mode !== 'live' || args.get('confirm-paid') !== true) throw new Error('DIRECT_CLI_LIVE_ONLY_WITH_PAID_CONFIRMATION')
    const gatePath = args.get('review-gate'), declared = args.get('review-gate-sha256')
    if (typeof gatePath !== 'string' || !isAbsolute(gatePath) || !hashPattern.test(declared ?? '')) throw new Error('HASH_PINNED_REVIEW_GATE_REQUIRED')
    const actual = sha256(await readFile(gatePath))
    if (actual !== declared) throw new Error('REVIEW_GATE_HASH_MISMATCH')
    const trusted = await import(pathToFileURL(resolve(gatePath)).href)
    if (typeof trusted.reviewProposal !== 'function') throw new Error('REVIEW_GATE_EXPORT_REQUIRED')
    reviewProposal = trusted.reviewProposal; reviewGateSha256 = actual
  }
  const result = await runTokenCheckpointCli({ config, output, mode, dryRun, confirmPaid: args.get('confirm-paid') === true,
    reviewProposal, reviewGateSha256 })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error?.code ?? error?.message ?? 'CHECKPOINT_CLI_FAILED'}\n`); process.exitCode = 1 })
}
