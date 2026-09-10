// Offline, read-only rendering of complete paired live benchmark evidence. No model requests.
// toolChoiceMode: forced (including legacy reports with no field) requires a named function choice.
// auto requires explicit tool_choice="auto". Both supply exactly one cad_propose_drawing tool.
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
function chart(title, subtitle, rows, notes, evidence, scaleMax = 0) {
  const max = Math.max(1, scaleMax, ...rows.map(row => row.value)), height = 278 + rows.length * 46 + notes.length * 22
  const labels = rows.map((row, index) => {
    const y = 157 + index * 46, width = row.value / max * 510
    return `<text x="28" y="${y + 18}" font-size="14">${esc(row.label)}</text><rect x="292" y="${y}" width="${width.toFixed(2)}" height="25" rx="4" fill="${row.color}"/><text x="${(302 + width).toFixed(2)}" y="${y + 18}" font-size="14" font-weight="700">${esc(row.display ?? row.value.toLocaleString('en-US'))}</text>`
  }).join('')
  const bottom = 180 + rows.length * 46
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1020" height="${height}" viewBox="0 0 1020 ${height}" role="img" aria-labelledby="title desc"><title id="title">${esc(title)} · requested ${esc(evidence.requestedModel)} · returned ${esc(evidence.returnedModel)}</title><desc id="desc">${esc([subtitle, ...notes].join(' '))}</desc><rect width="1020" height="${height}" fill="#f8fafc"/><g font-family="Arial, sans-serif" fill="#17283e"><text x="28" y="36" font-size="24" font-weight="700">${esc(title)}</text><text x="28" y="62" font-size="13">${esc(subtitle)}</text><text x="28" y="85" font-size="12">Requested: ${esc(evidence.requestedModel)}</text><text x="28" y="105" font-size="12">Returned: ${esc(evidence.returnedModel)} · ${evidence.samplesPerArm} attempts per arm · ${evidence.repetitions} repetitions</text><text x="28" y="125" font-size="12">${esc(evidence.settingsText)}</text>${labels}${notes.map((note, index) => `<text x="28" y="${bottom + index * 22}" font-size="12">${esc(note)}</text>`).join('')}<text x="28" y="${height - 48}" font-size="11">Source report SHA-256: ${evidence.reportSha256}</text><text x="28" y="${height - 28}" font-size="11">${esc(evidence.createdAt)} · Validator ${esc(evidence.validator)} · Full source hashes and settings: comparison.json</text></g></svg>\n`
}

export async function renderPairedModelComparison({ input, output } = {}) {
  if (typeof input !== 'string' || typeof output !== 'string' || !input.trim() || !output.trim()) throw new Error('Provide input and a new output directory')
  const root = await realpath(resolve(input)), bytes = await boundedFile(resolve(root, 'report.json'))
  const report = JSON.parse(bytes.toString('utf8'))
  if (report.mode !== 'live') throw new Error('Only live benchmark reports are accepted; fixture evidence is never charted')
  const reasons = new Set(), reject = reason => reasons.add(reason)
  const toolChoiceMode = report.toolChoiceMode === undefined ? 'forced' : report.toolChoiceMode
  if (!['auto', 'forced'].includes(toolChoiceMode)) reject('INVALID_TOOL_CHOICE_MODE')
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
  if (!report.settings || typeof report.settings !== 'object' || Array.isArray(report.settings) || report.settings.stream !== false) reject('INVALID_SETTINGS')
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
          const validToolChoice = toolChoiceMode === 'auto' ? request.tool_choice === 'auto' : toolChoiceMode === 'forced' && request.tool_choice?.type === 'function' && request.tool_choice?.function?.name === 'cad_propose_drawing'
          if (run.arm === 'kjdraw-tool' ? !Array.isArray(request.tools) || request.tools.length !== 1 || request.tools[0]?.type !== 'function' || request.tools[0]?.function?.name !== 'cad_propose_drawing' || !validToolChoice : request.tools !== undefined || request.tool_choice !== undefined) throw new Error('REQUEST_ARM_MISMATCH')
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
  if (Object.values(summaries).some(value => ['inputTokens', 'outputTokens', 'totalTokens'].some(key => value[key] === null))) reject('INCOMPLETE_USAGE_TOTALS')
  const result = { schema: 'com.kanjie.kjdraw.benchmark.comparison@1', status: reasons.size ? 'not-comparable' : 'comparable', reasons: [...reasons], publicationReviewRequired: true, independentValidationRerun: false, integrityNote: 'Artifact hashes match the supplied report; this does not authenticate the provider or rerun geometry validation.', reportSha256: sha(bytes), requestedModel: report.model, returnedModel: [...returned][0] ?? null, createdAt: report.createdAt, settings: report.settings, toolChoiceMode, toolChoiceNote: toolChoiceMode === 'auto' ? 'Auto: the model may choose whether to call the one supplied CAD tool; failed or declined generations remain in the denominator.' : 'Forced: the request names the one supplied CAD tool; this constrains tool selection. Legacy reports with no mode field use forced.', source: report.source, validator: report.validator, repetitions: report.repetitions, samplesPerArm: planned / 2, summaries, charts: [], scope: 'Three fully specified synthetic one-shot tasks. All attempted runs, including failures, remain in denominators and token totals. This is not an equal-quality or complex autonomous CAD comparison.' }
  await mkdir(resolve(output))
  if (!reasons.size) {
    const evidence = { ...result, validator: `ezdxf ${report.validator.version}`, settingsText: `Settings: tool_choice=${toolChoiceMode} · ${Object.entries(report.settings).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' · ')}` }
    const labels = { 'kjdraw-tool': 'KJDraw tool', 'direct-dxf': 'Direct DXF' }, colors = { 'kjdraw-tool': '#17795e', 'direct-dxf': '#5465bc' }
    const tokenRows = arms.flatMap(arm => ['inputTokens', 'outputTokens'].map(key => ({ label: `${labels[arm]} · ${key === 'inputTokens' ? 'input' : 'output'}`, value: summaries[arm][key], color: colors[arm] })))
    const cacheNotes = arms.map(arm => `${labels[arm]} cache hit: ${summaries[arm].cacheReadInputTokens ?? 'unknown'}; miss: ${summaries[arm].cacheMissInputTokens ?? 'unknown'} (included in input; never added twice).`)
    const plots = {
      'tokens.svg': chart('Reported model tokens · all attempts', 'Inclusive input and output sums, including failed attempts. Lower token use does not imply equal drawing quality.', tokenRows, [...cacheNotes, 'Missing cache breakdown remains unknown. No price estimates. No failed attempts excluded.'], evidence),
      'timing.svg': chart('Median elapsed time · all attempts', 'Transport is HTTP response wall time. End-to-end includes SDK materialization and independent DXF validation.', arms.flatMap(arm => ['transportMedianMs', 'endToEndMedianMs'].map(key => ({ label: `${labels[arm]} · ${key === 'transportMedianMs' ? 'transport' : 'end-to-end'}`, value: summaries[arm][key] / 1000, display: `${(summaries[arm][key] / 1000).toFixed(3)} s`, color: colors[arm] }))), ['Medians over every attempt, including failures; client wall time is not provider inference time.', 'Different success rates may change end-to-end work. Report timings exclude pre-dispatch persistence.'], evidence),
      'geometry.svg': chart('Independent geometry pass rate', 'Reported ezdxf checks of actual DXF artifacts. Every attempted generation stays in the denominator.', arms.map(arm => ({ label: labels[arm], value: summaries[arm].passed / summaries[arm].attempted * 100, display: `${summaries[arm].passed}/${summaries[arm].attempted} (${(summaries[arm].passed / summaries[arm].attempted * 100).toFixed(1)}%)`, color: colors[arm] })), ['Three simple specified tasks; no claim about general CAD ability or unsupplied design requirements.', 'Hash verification checks stored evidence integrity; this renderer does not rerun geometry validation.'], evidence, 100),
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
