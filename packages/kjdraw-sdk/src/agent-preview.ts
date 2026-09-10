import { KJCommandRegistry, registerCoreCommands } from './commands.js'
import type { KJDocument } from './document.js'
import { KJValidationError } from './errors.js'
import type { KJObjectPayload, KJReadonlyObjectRecord } from './schema.js'
import { canonicalStringify, deepFreeze, type ReadonlyDeep } from './utils.js'

export interface KJAgentPreviewEntity {
  readonly id: string
  readonly type: string
  readonly payload: ReadonlyDeep<KJObjectPayload>
}
export interface KJAgentGeometryPreview {
  readonly documentId: string
  readonly revision: number
  readonly command: 'CREATEBATCH' | 'MOVE'
  readonly before: readonly KJAgentPreviewEntity[]
  readonly after: readonly KJAgentPreviewEntity[]
}
const project = (entity: KJReadonlyObjectRecord): KJAgentPreviewEntity => ({ id: entity.id, type: entity.type, payload: entity.payload })
const supported = ['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE']
const movable = [...supported, 'XLINE', 'RAY']

/** Run bounded core geometry on a detached document. No host plugins, authority, network or source history is invoked. */
export async function createAgentGeometryPreview(document: KJDocument, command: 'CREATEBATCH' | 'MOVE', args: Record<string, unknown>): Promise<KJAgentGeometryPreview> {
  if (!['CREATEBATCH', 'MOVE'].includes(command)) throw new KJValidationError('This preview supports only CREATEBATCH and MOVE')
  if (command === 'CREATEBATCH') {
    if (!Array.isArray(args.entities) || !args.entities.length || args.entities.length > 64 || args.entities.some(spec => !spec || typeof spec !== 'object' || !supported.includes(String(spec.type)))) throw new KJValidationError('Preview creation requires 1–64 LINE/CIRCLE/ARC/LWPOLYLINE entities')
  } else if (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > 64 || args.ids.some(id => !movable.includes(document.getObject(String(id))?.type ?? ''))) throw new KJValidationError('Preview movement requires 1–64 LINE/CIRCLE/ARC/LWPOLYLINE/XLINE/RAY entities')
  const source = document.snapshot(), revision = document.revision
  if (Object.keys(source.objects).length > 250000) throw new KJValidationError('Agent preview exceeds the 250000 object document limit')
  const workingSet = command === 'MOVE' ? (args.ids as string[]).map(id => document.getObject(String(id))) : args.entities
  if (new TextEncoder().encode(JSON.stringify({ args, workingSet })).length > 4194304) throw new KJValidationError('Agent preview working set exceeds the 4 MiB limit')
  const draft = document.fork()
  const commands = new KJCommandRegistry()
  registerCoreCommands(commands)
  await commands.execute(command, { document: draft, expectedRevision: revision }, args)
  if (document.revision !== revision || document.snapshot() !== source) throw new KJValidationError('Drawing changed while preparing the preview; propose again')
  const before: KJAgentPreviewEntity[] = [], after: KJAgentPreviewEntity[] = []
  const old = new Map(document.listEntities().map(entity => [entity.id, entity]))
  for (const entity of draft.listEntities()) {
    const previous = old.get(entity.id)
    if (!previous || canonicalStringify(project(previous)) !== canonicalStringify(project(entity))) {
      if (previous) before.push(project(previous))
      after.push(project(entity))
    }
    old.delete(entity.id)
  }
  for (const entity of old.values()) before.push(project(entity))
  if (before.length > 64 || after.length > 64) throw new KJValidationError('Preview exceeds the changed-entity limit')
  const preview = { documentId: document.id, revision, command, before, after }
  if (new TextEncoder().encode(JSON.stringify(preview)).length > 262144) throw new KJValidationError('Agent geometry preview exceeds the 256 KiB output limit')
  return deepFreeze(preview) as KJAgentGeometryPreview
}

export function agentPreviewMatchesDocument(document: KJDocument, preview: KJAgentGeometryPreview): boolean {
  const retained = new Set(preview.after.map(entity => entity.id))
  return document.id === preview.documentId
    && preview.after.every(expected => {
      const actual = document.getObject(expected.id)
      return actual?.kind === 'entity' && canonicalStringify(project(actual)) === canonicalStringify(expected)
    })
    && preview.before.every(previous => retained.has(previous.id) || !document.getObject(previous.id))
}
