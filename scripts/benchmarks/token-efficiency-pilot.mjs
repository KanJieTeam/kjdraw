// Small paid-provider smoke run. Synthetic task approval is never presented as human review.
import { callBenchmarkModel } from './token-provider-transport.mjs'
import { runTokenEfficiencyBenchmark } from './token-efficiency-runner.mjs'
import { tokenEfficiencyTaskCorpus } from './token-efficiency-task-corpus.mjs'
import { tokenEfficiencyPlan } from './token-efficiency-plan.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

const [provider, model, ids, interfaceMode = 'function-tools'] = process.argv.slice(2)
const chosen = typeof ids === 'string' ? ids.split(',') : []
if (!['deepseek', 'qwen', 'glm'].includes(provider) || !model || !chosen.length || chosen.some(id => !id) ||
  !['function-tools', 'skill-json'].includes(interfaceMode)) {
  process.stderr.write('Usage: node scripts/benchmarks/token-efficiency-pilot.mjs <deepseek|qwen|glm> <model-id> <task-id[,task-id...]> [function-tools|skill-json]. API keys are read from KJDRAW_<PROVIDER>_API_KEY.\n')
  process.exitCode = 2
} else {
  const tasks = chosen.map(id => tokenEfficiencyTaskCorpus.find(task => task.id === id))
  if (tasks.some(task => !task) || new Set(chosen).size !== chosen.length) {
    process.stderr.write('Unknown or duplicate task ID.\n')
    process.exitCode = 2
  } else {
    try {
      const artifactDirectory = process.env.KJDRAW_BENCH_ARTIFACT_DIR || null
      if (artifactDirectory && !isAbsolute(artifactDirectory)) throw new Error('ARTIFACT_DIRECTORY_NOT_ABSOLUTE')
      const artifactName = ({ taskId, arm, repetition, roundIndex }) => {
        const parts = [taskId, arm, String(repetition), String(roundIndex)]
        if (parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('INVALID_ARTIFACT_NAME')
        return parts.join('__')
      }
      const saveJson = async (name, value) => {
        if (!artifactDirectory) return
        await mkdir(artifactDirectory, { recursive: true })
        await writeFile(join(artifactDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
      }
      const report = await runTokenEfficiencyBenchmark({ tasks, provider, model, repetitions: 1,
        mode: 'pilot', interfaceMode, modelCall: callBenchmarkModel,
        settings: { temperature: 0, max_tokens: 4096 }, timeoutMs: 120000,
        saveModelArtifacts: artifactDirectory ? artifact => saveJson(`${artifactName(artifact)}__model.json`, artifact) : undefined,
        onRound: artifactDirectory ? async record => {
          const { dxf, ...metadata } = record
          const stem = artifactName(record)
          await saveJson(`${stem}__result.json`, metadata)
          if (typeof dxf === 'string') await writeFile(join(artifactDirectory, `${stem}.dxf`), dxf, { flag: 'wx' })
        } : undefined,
      })
      const plan = tokenEfficiencyPlan({ tasks, repetitions: 1, models: 1 })
      process.stdout.write(`${JSON.stringify({
        kind: 'paid-model-pilot-with-synthetic-approval',
        warning: 'Pilot only: one repetition, synthetic benchmark approval, not independent human acceptance and not evidence for a 99% claim.',
        artifactDirectory,
        corpusSha256: plan.corpusSha256, provider, requestedModel: model, interfaceMode,
        returnedModels: report.returnedModels, consistentReturnedModel: report.consistentReturnedModel,
        plannedRequests: report.plannedRequests, attemptedRequests: report.attemptedRequests,
        rounds: report.runs.map(run => ({ taskId: run.taskId, arm: run.arm, repetition: run.repetition,
          roundIndex: run.roundIndex, status: run.status, validation: run.validation,
          usage: run.usage, transportLatencyMs: run.transportLatencyMs, totalMs: run.totalMs,
          toolCallCount: run.toolCallCount, loadedTools: run.loadedTools,
          argumentDiagnostic: run.argumentDiagnostic ?? null,
          compilerReason: run.compilerReason ?? null,
          review: run.review, failure: run.failure,
          unexecuted: run.unexecuted })),
        paired: report.aggregate.paired,
      }, null, 2)}\n`)
      if (report.runs.some(run => run.status !== 'passed')) process.exitCode = 1
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,64}$/.test(error.code)
        ? error.code : 'PILOT_FAILED'
      process.stderr.write(`${code}\n`)
      process.exitCode = 1
    }
  }
}
