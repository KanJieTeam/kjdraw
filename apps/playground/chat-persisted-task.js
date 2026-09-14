import { inspectAgentTask, readAgentTasks, transitionAgentTask } from '../../packages/kjdraw-sdk/src/agent-tasks.js'
import { createAgentTaskToolBinding } from '../../packages/kjdraw-sdk/src/agent-task-runner.js'

// Only commands with atomic task receipts are offered by this host. This is not
// an SDK capability restriction and imported tool locks cannot extend it.
const proposalTools = new Set([
  'cad_propose_move', 'cad_propose_copy', 'cad_propose_offset', 'cad_propose_rotate',
  'cad_propose_scale', 'cad_propose_lengthen', 'cad_propose_stretch', 'cad_propose_polyline_edit',
  'cad_propose_component_insert', 'cad_propose_drawing_pattern', 'cad_propose_drawing_annotated',
  'cad_propose_manufacturing_sheet', 'cad_propose_architecture_plan', 'cad_propose_site_plan', 'cad_propose_cartesian_chart',
])

/** Capture only after an explicit host selection, never on document import. */
export function selectChatPersistedTask(document, taskId) {
  const task = readAgentTasks(document, [taskId])[0]
  return Object.freeze({ document, revision: document.revision, taskId: task.id, taskVersion: task.taskVersion, status: task.status })
}

/** Validate before recording a start or contacting a model. No data is mutated. */
export async function inspectChatPersistedTask({ document, session, selection, allowedToolNames, capabilityRegistry, signal, isCurrent }) {
  const exact = () => {
    if (signal?.aborted || isCurrent?.() === false) throw new Error('Task start was cancelled')
    if (!selection || selection.document !== document || selection.revision !== document.revision || !session.isBoundTo(document)) throw new Error('Task selection is stale')
  }
  exact()
  const inspection = await inspectAgentTask(document, selection.taskId)
  exact()
  const task = inspection.task
  if (task.taskVersion !== selection.taskVersion || task.status !== selection.status || !['ready', 'running'].includes(task.status)) throw new Error('Task is not ready to execute')
  if (!inspection.scopeMatches || !inspection.unitsMatch) throw new Error('Task scope changed')
  const names = task.definition.tools.names, allowed = new Set(allowedToolNames)
  if (names.some(name => !allowed.has(name))) throw new Error('Task tools exceed workbench policy')
  const current = createAgentTaskToolBinding(session.definitions, names)
  if (current.apiVersion !== task.definition.tools.apiVersion || current.contractHash !== task.definition.tools.contractHash) throw new Error('Task tool contract changed')
  const definitions = new Map(session.definitions.map(definition => [definition.name, definition]))
  if (names.some(name => definitions.get(name)?.effect === 'propose' && !proposalTools.has(name))) throw new Error('Task requires an unsupported atomic approval')
  if (!task.definition.requirements.length || task.definition.requirements.some(({ check }) =>
    check.toolName !== 'cad_check_geometry' || !check.geometryCheck || check.assertion.path !== 'passed'
    || check.assertion.operator !== 'is_true' || check.assertion.expected !== true)) throw new Error('Task requires deterministic geometry acceptance checks')
  if (task.definition.capabilities.length) {
    if (!capabilityRegistry || String(capabilityRegistry.toolApiVersion) !== current.apiVersion) throw new Error('Task capability registry is unavailable')
    const resolved = capabilityRegistry.resolve({ lock: task.definition.capabilities, allowedToolNames: names })
    if (!resolved.toolNames.includes('cad_check_geometry')) throw new Error('Task capability removes its acceptance check')
  }
  exact()
  return task
}

/** The run button authorizes this status checkpoint, not geometry approval. */
export async function startChatPersistedTask(options) {
  const task = await inspectChatPersistedTask(options)
  if (options.signal?.aborted || options.isCurrent?.() === false) throw new Error('Task start was cancelled')
  if (task.status === 'running') return task
  const { document, selection } = options
  await document.transact('Start reviewed workbench task', tx => transitionAgentTask(document, tx, {
    id: task.id, expectedRevision: selection.revision, expectedTaskVersion: task.taskVersion,
    expectedStatus: 'ready', to: 'running', at: new Date().toISOString(),
    actor: { kind: 'host', id: 'playground-chat-user' }, reason: 'User explicitly selected and started the displayed task.',
  }), { expectedRevision: selection.revision })
  return readAgentTasks(document, [task.id])[0]
}
