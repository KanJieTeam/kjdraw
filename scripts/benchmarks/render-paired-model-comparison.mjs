// Offline, read-only rendering of complete paired live benchmark evidence. No model requests.
// toolChoiceMode: forced (including legacy reports with no field) requires a named function choice.
// auto requires explicit tool_choice="auto". Both supply exactly one report-selected drawing tool.
// drawingTool defaults to cad_propose_drawing; compact and pattern are explicit alternate tools.
// taskSuite defaults to pilot; parametric additionally requires its task-generator source hash.
// The modes are reported separately: auto can decline a tool, while forced constrains tool selection.
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const arms = ['kjdraw-tool', 'direct-dxf']
const sha = value => createHash('sha256').update(value).digest('hex')
const hashPattern = /^[a-f0-9]{64}$/
const integer = value => Number.isSafeInteger(value) && value >= 0
const duration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 }
const sum = values => { if (!values.length || !values.every(integer)) return null; const total = values.reduce((a, b) => a + b, 0); return integer(total) ? total : null }
async function boundedFile(path) { const info = await stat(path); if (!info.isFile() || info.size > 4194304) throw new Error('ARTIFACT_SIZE'); return readFile(path) }
async function artifact(root, name, hash) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(name) || basename(name) !== name || !hashPattern.test(hash ?? '')) throw new Error('ARTIFACT_REFERENCE')
  const path = await realpath(resolve(root, name))
  if (dirname(path) !== root) throw new Error('ARTIFACT_ESCAPE')
  const bytes = await boundedFile(path)
  if (sha(bytes) !== hash) throw new Error('ARTIFACT_HASH')
  return bytes
}
const taskLabels = { 'perforated-panel-209': 'Perforated panel', 'fin-frame-78': 'Fin frame', 'dual-region-panel-140': 'Dual-region panel' }
function chart(title, subtitle, groups, notes, evidence, scaleMax = 0) {
  const max = scaleMax || Math.max(1, ...groups.flatMap(group => group.rows.map(row => row.value))) * 1.16
  const baseline = 320, plotHeight = 166, colors = ['#2563eb', '#94a3b8']
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = max * index / 4, y = baseline - plotHeight * index / 4
    const label = scaleMax === 100 ? `${Math.round(value)}%` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(value < 10 ? 1 : 0)
    return `<line x1="76" y1="${y}" x2="978" y2="${y}" stroke="#e2e8f0"/><text x="64" y="${y + 4}" text-anchor="end" font-size="11" fill="#64748b">${esc(label)}</text>`
  }).join('')
  const bars = groups.map((group, groupIndex) => {
    const center = 220 + groupIndex * 300
    const rows = group.rows.map((row, index) => {
      const height = row.value / max * plotHeight, x = center - 78 + index * 84, y = baseline - height
      return `<rect data-task="${esc(group.id)}" data-arm="${arms[index]}" data-value="${row.value}" x="${x}" y="${y.toFixed(2)}" width="72" height="${height.toFixed(2)}" rx="4" fill="${colors[index]}"/><text x="${x + 36}" y="${(y - 9).toFixed(2)}" text-anchor="middle" font-size="14" font-weight="700">${esc(row.display)}</text>`
    }).join('')
    return `${rows}<text x="${center}" y="344" text-anchor="middle" font-size="14" font-weight="700">${esc(taskLabels[group.id] ?? group.id)}</text><text x="${center}" y="362" text-anchor="middle" font-size="11" fill="#64748b">${evidence.repetitions} attempts per arm</text>`
  }).join('')
  const accessible = [subtitle, evidence.scopeNote, ...notes, `Tool: ${evidence.drawingTool}`, evidence.settingsText, 'All failures remain in denominators.'].join(' ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1020" height="480" viewBox="0 0 1020 480" role="img" aria-labelledby="title desc"><title id="title">${esc(title)} · requested ${esc(evidence.requestedModel)} · returned ${esc(evidence.returnedModel)}</title><desc id="desc">${esc(accessible)}</desc><rect width="1020" height="480" rx="12" fill="#fff"/><g font-family="Arial, sans-serif" fill="#17283e"><text x="30" y="35" font-size="25" font-weight="700">${esc(title)}</text><text x="30" y="59" font-size="13" fill="#475569">${esc(subtitle)}</text><text x="30" y="82" font-size="12" fill="#64748b">Requested: ${esc(evidence.requestedModel)} · Returned: ${esc(evidence.returnedModel)} · ${evidence.samplesPerArm} attempts per arm</text><rect x="30" y="101" width="12" height="12" rx="2" fill="${colors[0]}"/><text x="49" y="112" font-size="13">KJDraw</text><rect x="145" y="101" width="12" height="12" rx="2" fill="${colors[1]}"/><text x="164" y="112" font-size="13">Direct DXF</text><text x="978" y="112" text-anchor="end" font-size="11" fill="#64748b">tool_choice=${esc(evidence.toolChoiceMode)} · ${esc(evidence.createdAt.slice(0, 10))}</text>${grid}${bars}<text x="30" y="393" font-size="11" fill="#475569">${esc(notes[0])}</text><text x="30" y="412" font-size="11" fill="#475569">${esc(notes[1])}</text><text x="30" y="434" font-size="11" fill="#64748b">${esc(evidence.scopeNote)}</text><text x="30" y="460" font-size="10" fill="#64748b">Source report SHA-256: ${evidence.reportSha256.slice(0, 12)} · ezdxf ${esc(evidence.validator.version)} · Full settings, hashes and counts: comparison.json</text><a href="comparison.json"><text x="978" y="460" text-anchor="end" font-size="11" fill="#2563eb">Evidence ↗</text></a></g></svg>\n`
}

export async function renderPairedModelComparison({ input, output } = {}) {
  if (typeof input !== 'string' || typeof output !== 'string' || !input.trim() || !output.trim()) throw new Error('Provide input and a new output directory')
  const root = await realpath(resolve(input)), bytes = await boundedFile(resolve(root, 'report.json'))
  const report = JSON.parse(bytes.toString('utf8'))
  if (report.mode !== 'live') throw new Error('Only live benchmark reports are accepted; fixture evidence is never charted')
  const reasons = new Set(), reject = reason => reasons.add(reason)
  if (report.exploratory === true) reject('EXPLORATORY_NOT_PUBLIC_EVIDENCE')
  const toolChoiceMode = report.toolChoiceMode === undefined ? 'forced' : report.toolChoiceMode
  if (!['auto', 'forced'].includes(toolChoiceMode)) reject('INVALID_TOOL_CHOICE_MODE')
  const drawingTool = report.drawingTool === undefined ? 'cad_propose_drawing' : report.drawingTool
  if (!['cad_propose_drawing', 'cad_propose_drawing_compact', 'cad_propose_drawing_pattern'].includes(drawingTool)) reject('INVALID_DRAWING_TOOL')
  const taskSuite = report.taskSuite === undefined ? 'pilot' : report.taskSuite
  if (!['pilot', 'parametric'].includes(taskSuite)) reject('INVALID_TASK_SUITE')
  if (taskSuite === 'parametric' && !hashPattern.test(report.source?.['parametric-drawing-tasks.mjs'] ?? '')) reject('PARAMETRIC_SOURCE_HASH_MISSING')
  const scopeNote = taskSuite === 'parametric' ? 'Parametric: 3 specified repeat-pattern geometry tasks; no annotations, complete drawings or autonomous design.' : 'Pilot: 3 simple specified geometry tasks; no annotations, complete drawings or autonomous design.'
  const tasks = Array.isArray(report.tasks) ? report.tasks : [], runs = Array.isArray(report.runs) ? report.runs : []
  if (report.schema !== 'com.kanjie.kjdraw.benchmark.paired-model@1' || report.protocol !== 'chat-completions') reject('UNSUPPORTED_REPORT_SCHEMA')
  if (report.status !== 'complete' || report.stopReason || report.unexecutedRequests !== 0) reject('INTERRUPTED_OR_INCOMPLETE')
  if (!integer(report.repetitions) || report.repetitions < 5 || report.repetitions > 30 || tasks.length !== 3 || runs.length > 180) reject('INVALID_PAIRED_PLAN')
  const planned = tasks.length * report.repetitions * 2
  if (report.plannedRequests !== planned || report.attemptedRequests !== planned || runs.length !== planned || report.maxRequests < planned) reject('INCOMPLETE_PAIRED_PLAN')
  const ids = new Set(tasks.map(task => task.id))
  if (ids.size !== tasks.length || tasks.some(task => typeof task.id !== 'string' || typeof task.prompt !== 'string' || task.expected === undefined || sha(JSON.stringify(task.expected)) !== task.fixtureSha256)) reject('INVALID_TASK_DEFINITION')
  if (typeof report.model !== 'string' || !report.model || report.model.length > 256 || !report.consistentReturnedModel) reject('INCONSISTENT_MODEL')
  const returned = new Set(runs.map(run => run.returnedModel))
  if (returned.size !== 1 || [...returned].some(model => typeof model !== 'string' || !model || model.length > 256) || !Array.isArray(report.returnedModels) || report.returnedModels.length !== 1 || report.returnedModels[0] !== [...returned][0]) reject('INCONSISTENT_MODEL')
  if (!report.settings || typeof report.settings !== 'object' || Array.isArray(report.settings) || report.settings.stream !== false || !integer(report.settings.max_tokens) || report.settings.max_tokens < 4096 || report.settings.max_tokens > 32768) reject('INVALID_SETTINGS')
  if (report.validator?.validator !== 'ezdxf' || typeof report.validator.version !== 'string') reject('INDEPENDENT_VALIDATOR_MISSING')
  if (!report.source || ['paired-model-benchmark.mjs', 'paired-model-validator.py', 'model-drawing-pilot.mjs', 'deepseek-drawing-pilot.py', 'model-usage.js', 'sdkRuntimeSha256'].some(key => !hashPattern.test(report.source?.[key] ?? ''))) reject('SOURCE_HASHES_MISSING')
  if (!Number.isFinite(Date.parse(report.createdAt))) reject('REPORT_DATE_MISSING')
  const pairs = new Map(), signatures = new Map(), armSignatures = new Map(), artifactNames = new Set()
  let commonParameters
  for (const run of runs.slice(0, 180)) {
    if (!arms.includes(run.arm) || !ids.has(run.taskId) || !integer(run.repetition) || run.repetition < 1 || run.repetition > report.repetitions || ![0, 1].includes(run.order)) { reject('INVALID_RUN_IDENTITY'); continue }
    const id = `${run.taskId}:${run.repetition}`, pair = pairs.get(id) ?? []
    pair.push(run); pairs.set(id, pair)
    if (!['passed', 'geometry-failed', 'failed'].includes(run.status) || typeof run.validation?.passed !== 'boolean' || (run.status === 'passed') !== run.validation.passed) reject('INVALID_RUN_OUTCOME')
    if (run.requestedModel !== report.model) reject('INCONSISTENT_MODEL')
    if (!duration(run.transportLatencyMs) || !duration(run.totalMs) || run.totalMs < run.transportLatencyMs) reject('MISSING_OR_INVALID_TIMING')
    if (!run.usage || run.usage.protocol !== report.protocol || !['inputTokens', 'outputTokens', 'totalTokens'].every(key => integer(run.usage[key])) || run.usage.inputTokens + run.usage.outputTokens !== run.usage.totalTokens || !Array.isArray(run.usage.invalidFields) || run.usage.invalidFields.length) reject('MISSING_OR_INVALID_USAGE')
    for (const key of ['cacheReadInputTokens', 'cacheMissInputTokens']) if (run.usage?.[key] !== null && run.usage?.[key] !== undefined && !integer(run.usage[key])) reject('INVALID_CACHE_USAGE')
    try {
      for (const key of ['request', 'response', 'dxf']) {
        const name = run.files?.[key], digest = run[`${key}Sha256`]
        if (!name && !digest && key === 'dxf' && run.status === 'failed') continue
        if (artifactNames.has(name)) throw new Error('ARTIFACT_REUSED')
        artifactNames.add(name)
        const raw = await artifact(root, name, digest)
        if (key === 'request') {
          if (run.requestBytes !== raw.length) throw new Error('REQUEST_SIZE')
          const request = JSON.parse(raw.toString('utf8'))
          if (request.model !== report.model || Object.entries(report.settings ?? {}).some(([name, value]) => canonical(request[name]) !== canonical(value))) throw new Error('REQUEST_SETTINGS')
          const params = Object.fromEntries(Object.entries(request).filter(([key]) => !['messages', 'tools', 'tool_choice'].includes(key)))
          const signature = canonical(params)
          if (commonParameters !== undefined && commonParameters !== signature) throw new Error('UNPAIRED_SETTINGS')
          commonParameters = signature
          if (!Array.isArray(request.messages) || request.messages.length !== 2 || request.messages[0].role !== 'system' || typeof request.messages[0].content !== 'string' || request.messages[1].role !== 'user') throw new Error('REQUEST_PROMPT')
          const validToolChoice = toolChoiceMode === 'auto' ? request.tool_choice === 'auto' : toolChoiceMode === 'forced' && request.tool_choice?.type === 'function' && request.tool_choice?.function?.name === drawingTool
          if (run.arm === 'kjdraw-tool' ? !Array.isArray(request.tools) || request.tools.length !== 1 || request.tools[0]?.type !== 'function' || request.tools[0]?.function?.name !== drawingTool || !validToolChoice : request.tools !== undefined || request.tool_choice !== undefined) throw new Error('REQUEST_ARM_MISMATCH')
          const armSignature = canonical({ system: request.messages[0], tools: request.tools, toolChoice: request.tool_choice })
          if (armSignatures.has(run.arm) && armSignatures.get(run.arm) !== armSignature) throw new Error('INCONSISTENT_ARM_INSTRUCTIONS')
          armSignatures.set(run.arm, armSignature)
          const prompt = request.messages[1].content
          if (typeof prompt !== 'string' || !prompt.endsWith(tasks.find(task => task.id === run.taskId).prompt)) throw new Error('REQUEST_PROMPT')
          const prior = signatures.get(run.taskId)
          if (prior !== undefined && prior !== prompt) throw new Error('UNPAIRED_PROMPTS')
          signatures.set(run.taskId, prompt)
        } else if (key === 'response') {
          const response = JSON.parse(raw.toString('utf8'))
          if (response.model !== run.returnedModel || JSON.stringify(response.usage) !== JSON.stringify(run.usage)) throw new Error('RESPONSE_RECORD_MISMATCH')
        }
      }
      if (run.status !== 'failed' && (run.validation.validator !== 'ezdxf' || run.validation.version !== report.validator.version)) throw new Error('VALIDATION_RECORD_MISSING')
    } catch (error) { reject(['ARTIFACT_REFERENCE', 'ARTIFACT_ESCAPE', 'ARTIFACT_HASH', 'ARTIFACT_SIZE', 'ARTIFACT_REUSED', 'REQUEST_SIZE', 'REQUEST_SETTINGS', 'REQUEST_ARM_MISMATCH', 'INCONSISTENT_ARM_INSTRUCTIONS', 'UNPAIRED_SETTINGS', 'REQUEST_PROMPT', 'UNPAIRED_PROMPTS', 'RESPONSE_RECORD_MISMATCH', 'VALIDATION_RECORD_MISSING'].includes(error.message) ? error.message : 'ARTIFACT_UNREADABLE') }
  }
  if (pairs.size !== tasks.length * report.repetitions || [...pairs.values()].some(pair => pair.length !== 2 || new Set(pair.map(run => run.arm)).size !== 2 || new Set(pair.map(run => run.order)).size !== 2)) reject('MISSING_OR_DUPLICATE_PAIR')
  const summaries = Object.fromEntries(arms.map(arm => {
    const selected = runs.filter(run => run.arm === arm)
    return [arm, { attempted: selected.length, passed: selected.filter(run => run.validation?.passed === true).length, inputTokens: sum(selected.map(run => run.usage?.inputTokens)), outputTokens: sum(selected.map(run => run.usage?.outputTokens)), totalTokens: sum(selected.map(run => run.usage?.totalTokens)), cacheReadInputTokens: sum(selected.map(run => run.usage?.cacheReadInputTokens)), cacheMissInputTokens: sum(selected.map(run => run.usage?.cacheMissInputTokens)), transportMedianMs: selected.length && selected.every(run => duration(run.transportLatencyMs)) ? median(selected.map(run => run.transportLatencyMs)) : null, endToEndMedianMs: selected.length && selected.every(run => duration(run.totalMs)) ? median(selected.map(run => run.totalMs)) : null }]
  }))
  const perTask = tasks.map(task => ({ taskId: task.id, arms: Object.fromEntries(arms.map(arm => {
    const selected = runs.filter(run => run.taskId === task.id && run.arm === arm)
    const attempted = selected.length, passed = selected.filter(run => run.validation?.passed === true).length
    return [arm, { attempted, passed, passRatePercent: attempted ? passed / attempted * 100 : null, inputTokens: sum(selected.map(run => run.usage?.inputTokens)), outputTokens: sum(selected.map(run => run.usage?.outputTokens)), totalTokens: sum(selected.map(run => run.usage?.totalTokens)), reasoningOutputTokens: sum(selected.map(run => run.usage?.reasoningOutputTokens)), cacheReadInputTokens: sum(selected.map(run => run.usage?.cacheReadInputTokens)), cacheMissInputTokens: sum(selected.map(run => run.usage?.cacheMissInputTokens)), transportMedianMs: selected.length && selected.every(run => duration(run.transportLatencyMs)) ? median(selected.map(run => run.transportLatencyMs)) : null, endToEndMedianMs: selected.length && selected.every(run => duration(run.totalMs)) ? median(selected.map(run => run.totalMs)) : null }]
  })) }))
  if (Object.values(summaries).some(value => ['inputTokens', 'outputTokens', 'totalTokens'].some(key => value[key] === null))) reject('INCOMPLETE_USAGE_TOTALS')
  const result = { schema: 'com.kanjie.kjdraw.benchmark.comparison@1', status: reasons.size ? 'not-comparable' : 'comparable', reasons: [...reasons], publicationReviewRequired: true, independentValidationRerun: false, integrityNote: 'Artifact hashes match the supplied report; this does not authenticate the provider or rerun geometry validation.', reportSha256: sha(bytes), requestedModel: report.model, returnedModel: [...returned][0] ?? null, createdAt: report.createdAt, settings: report.settings, drawingTool, taskSuite, scopeNote, toolChoiceMode, toolChoiceNote: toolChoiceMode === 'auto' ? 'Auto: the model may choose whether to call the one supplied CAD tool; failed or declined generations remain in the denominator.' : 'Forced: the request names the one supplied CAD tool; this constrains tool selection. Legacy reports with no mode field use forced.', source: report.source, validator: report.validator, repetitions: report.repetitions, samplesPerArm: planned / 2, summaries, perTask, charts: [], scope: `${scopeNote} All attempted runs, including failures, remain in denominators and token totals. This one-shot experiment does not establish equal quality or general CAD capability.` }
  await mkdir(resolve(output))
  if (!reasons.size) {
    const evidence = { ...result, settingsText: `Settings: tool_choice=${toolChoiceMode} · ${Object.entries(report.settings).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' · ')}` }
    const groups = (key, display, divisor = 1) => perTask.map(task => ({ id: task.taskId, rows: arms.map(arm => ({ value: task.arms[arm][key] / divisor, display: display(task.arms[arm]) })) }))
    const number = value => value.toLocaleString('en-US')
    const plots = {
      'tokens.svg': chart('Total model tokens by CAD task', `Inclusive input + output, including reasoning. Sum of all ${report.repetitions} attempts per arm for each task.`, groups('totalTokens', row => number(row.totalTokens)), ['Cache hit and miss are included in input; reasoning is included in output. Neither is added twice.', 'All failed attempts included. Lower token use does not imply equal drawing quality; no price estimates.'], evidence),
      'timing.svg': chart('Median transport time by CAD task', 'HTTP request-to-response wall time, not provider inference time. All attempts included.', groups('transportMedianMs', row => `${(row.transportMedianMs / 1000).toFixed(3)} s`, 1000), [`Median of all ${report.repetitions} attempts per arm for each task, including failed generations; seconds.`, 'SDK materialization and independent validation are excluded here; end-to-end medians are in comparison.json.'], evidence),
      'geometry.svg': chart('Strict DXF + geometry pass rate', 'Native format, units, independent geometry and zero audit errors/fixes.', groups('passRatePercent', row => `${row.passed}/${row.attempted} (${row.passRatePercent.toFixed(0)}%)`), [`All ${report.repetitions} attempts per arm for each task remain in the denominator, including audit/format failures.`, 'Reported ezdxf checks; artifact hashes verified. Rendering does not rerun geometry validation.'], evidence, 100),
    }
    for (const [name, svg] of Object.entries(plots)) { await writeFile(resolve(output, name), svg, { flag: 'wx' }); result.charts.push(name) }
  }
  await writeFile(resolve(output, 'comparison.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args.some(arg => !/^--(?:input|output)=.+$/.test(arg)) || new Set(args.map(arg => arg.split('=')[0])).size !== 2) throw new Error('Use --input=report-directory --output=new-directory')
  const options = Object.fromEntries(args.map(arg => { const split = arg.indexOf('='); return [arg.slice(2, split), arg.slice(split + 1)] }))
  const result = await renderPairedModelComparison(options)
  console.log(JSON.stringify({ status: result.status, reasons: result.reasons, charts: result.charts }))
  if (result.status !== 'comparable') process.exitCode = 1
}
