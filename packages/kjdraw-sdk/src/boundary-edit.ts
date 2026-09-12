import type { KJDocument } from './document.js'
import { extendEntityPayload, trimEntityPayloads, type KJDerivedEntityPayload } from './editing.js'
import { KJValidationError } from './errors.js'
import { normalizeDimensionAssociations } from './dimension-associations.js'
import type { KJCommandReceipt } from './product-contract.js'
import type { KJDocumentState, KJObjectRecord, KJReadonlyObjectRecord, KJRevisionRecord } from './schema.js'
import { normalizeStandardEntityPayload } from './standard-entities.js'
import { canonicalStringify, clone, deepFreeze, stableHash, type ReadonlyDeep } from './utils.js'

export type KJBoundaryEditOperation = 'trim' | 'extend'
export type KJBoundaryEditPhase = 'boundaries' | 'targets' | 'applying' | 'finished' | 'cancelled'

export interface KJBoundaryEditOptions {
  document: KJDocument
  boundaryIds?: readonly string[]
  locale?: 'en' | 'zh'
  /** Hosts bind this to their mounted document/readonly state, not merely its ID. */
  isDocumentCurrent?: () => boolean
}

export interface KJBoundaryEditState {
  readonly phase: KJBoundaryEditPhase
  readonly operation: KJBoundaryEditOperation
  readonly boundaryIds: readonly string[]
  readonly expectedRevision: number
  readonly committedCount: number
}

export interface KJBoundaryEditCommand {
  readonly command: 'TRIM' | 'EXTEND'
  readonly arguments: {
    readonly id: string
    readonly boundaryIds: readonly string[]
    readonly pickPoint: readonly [number, number]
  }
  readonly expectedRevision: number
}

export type KJBoundaryEditPreview = ReadonlyDeep<{
  documentId: string
  revision: number
  operation: KJBoundaryEditOperation
  targetId: string
  boundaryIds: string[]
  pickPoint: [number, number]
  pieces: KJDerivedEntityPayload[]
  command: KJBoundaryEditCommand
}>

const BOUNDARY_TYPES = new Set(['LINE', 'RAY', 'XLINE', 'CIRCLE', 'ARC'])

interface KJBoundaryEditCommit {
  revision: ReadonlyDeep<KJRevisionRecord>
  createdIds: string[]
  operations: ReadonlyArray<Readonly<Record<string, unknown>>>
  before: ReadonlyDeep<KJDocumentState> | null
  after: ReadonlyDeep<KJDocumentState> | null
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right)
}

/**
 * UI-neutral continuous trim/extend workflow. Geometry comes from the same
 * helpers as the core commands; the host executes the existing SDK envelope.
 * Previews are local one-shot objects, not authentication or serialized AI
 * approvals. Cross-process/model approval uses the SDK's reviewed agent plans.
 */
export class KJBoundaryEditSession {
  readonly #document: KJDocument
  readonly #operation: KJBoundaryEditOperation
  readonly #isDocumentCurrent: () => boolean
  #locale: 'en' | 'zh'
  #phase: KJBoundaryEditPhase = 'boundaries'
  #revision: number
  #boundaryIds: string[] = []
  #committedCount = 0
  #previews = new WeakSet<object>()

  constructor(operation: KJBoundaryEditOperation, options: KJBoundaryEditOptions) {
    if (operation !== 'trim' && operation !== 'extend') throw new KJValidationError('Boundary operation must be trim or extend')
    this.#operation = operation
    this.#document = options.document
    this.#revision = options.document.revision
    this.#locale = options.locale ?? 'en'
    this.#isDocumentCurrent = options.isDocumentCurrent ?? (() => true)
    this.setBoundaries(options.boundaryIds ?? [])
  }

  get state(): KJBoundaryEditState {
    return Object.freeze({ phase: this.#phase, operation: this.#operation,
      boundaryIds: Object.freeze([...this.#boundaryIds]), expectedRevision: this.#revision, committedCount: this.#committedCount })
  }

  get prompt(): string {
    const name = this.#operation === 'trim' ? this.#text('Trim', '修剪') : this.#text('Extend', '延伸')
    if (this.#phase === 'boundaries') return this.#text(
      `${name}: select cutting boundaries (${this.#boundaryIds.length}) · Enter confirms · Esc cancels`,
      `${name}：选择边界（${this.#boundaryIds.length}）· Enter 确认 · Esc 取消`)
    if (this.#phase === 'targets') return this.#text(
      `${name}: click ${this.#operation === 'trim' ? 'each portion to remove' : 'near each end to extend'} · Enter finishes · Esc cancels`,
      `${name}：连续点选${this.#operation === 'trim' ? '要删除的区段' : '要延伸的一端'} · Enter 完成 · Esc 取消`)
    if (this.#phase === 'applying') return this.#text(`${name}: applying edit…`, `${name}：正在应用修改…`)
    return this.#text(`${name}: ${this.#phase === 'finished' ? 'finished' : 'cancelled'}`, `${name}：${this.#phase === 'finished' ? '已完成' : '已取消'}`)
  }

  setLocale(locale: 'en' | 'zh'): void { this.#locale = locale }

  /** Does not silently rebase a session after undo, replacement or another edit. */
  isCurrent(): boolean {
    return this.#phase !== 'finished' && this.#phase !== 'cancelled'
      && this.#isDocumentCurrent() && this.#document.revision === this.#revision
  }

  setBoundaries(ids: readonly string[]): void {
    this.#requirePhase('boundaries')
    const next = [...new Set(ids.map(String))]
    for (const id of next) {
      const entity = this.#entity(id)
      if (!BOUNDARY_TYPES.has(entity.type)) this.#fail('boundary-type', 'Boundaries must be lines, rays, construction lines, circles or arcs', '边界必须是直线、射线、构造线、圆或圆弧')
    }
    this.#boundaryIds = next
  }

  confirmBoundaries(): void {
    this.#requirePhase('boundaries')
    if (!this.#boundaryIds.length) this.#fail('empty-boundaries', 'Select at least one cutting boundary', '请至少选择一条边界')
    this.#phase = 'targets'
  }

  /** Computes exact retained primitives without mutating the document or history. */
  preview(targetId: string, pickPoint: readonly [number, number]): KJBoundaryEditPreview {
    this.#requirePhase('targets')
    const target = this.#entity(targetId)
    if (this.#boundaryIds.includes(targetId)) this.#fail('boundary-as-target', 'A cutting boundary cannot also be the target', '不能把已选边界同时作为修改目标')
    const supported = this.#operation === 'trim' ? ['LINE', 'ARC', 'CIRCLE'] : ['LINE', 'ARC']
    if (!supported.includes(target.type)) this.#fail('target-type', `${this.#operation.toUpperCase()} supports ${supported.join(', ')}`, `${this.#operation === 'trim' ? '修剪' : '延伸'}支持 ${supported.join('、')}`)
    const layer = target.payload.layerId ? this.#document.getObject(String(target.payload.layerId)) : null
    if (target.payload.visible === false || layer?.payload.locked === true || layer?.payload.frozen === true || layer?.payload.visible === false) {
      this.#fail('protected-target', 'Show, unlock and thaw the target layer before editing', '请先显示、解锁并解冻目标图层')
    }
    const point: [number, number] = [Number(pickPoint?.[0]), Number(pickPoint?.[1])]
    if (!point.every(Number.isFinite)) this.#fail('invalid-point', 'Pick coordinates must be finite', '点坐标必须是有限数值')
    const boundaries = this.#boundaryIds.map(id => this.#entity(id))
    let pieces: KJDerivedEntityPayload[]
    try {
      pieces = this.#operation === 'trim' ? trimEntityPayloads(target, boundaries, point)
        : [{ type: target.type, payload: extendEntityPayload(target, boundaries, point) }]
    } catch (cause) {
      throw new KJValidationError(this.#text(
        `Cannot ${this.#operation} here. Pick another portion or end; check the boundary intersections.`,
        `此处无法${this.#operation === 'trim' ? '修剪' : '延伸'}。请换一个区段或端点，并检查边界是否相交。`),
      { code: 'boundary-edit.geometry', reason: cause instanceof Error ? cause.message : String(cause) })
    }
    if (!pieces.length) this.#fail('empty-result', 'The edit must retain a non-empty entity', '修改必须保留有效图元')
    const preview = deepFreeze({ documentId: this.#document.id, revision: this.#revision,
      operation: this.#operation, targetId, boundaryIds: [...this.#boundaryIds], pickPoint: point,
      pieces: clone(pieces), command: { command: this.#operation === 'trim' ? 'TRIM' as const : 'EXTEND' as const,
        arguments: { id: targetId, boundaryIds: [...this.#boundaryIds], pickPoint: point }, expectedRevision: this.#revision } })
    this.#previews.add(preview)
    return preview
  }

  /**
   * Execute through the host's normal SDK command path. The callback must
   * propagate failures and return the SDK envelope receipt. The actual commit,
   * arguments and retained geometry must match the preview, not just revision +1.
   * Successful edits are separate undo steps. Cancel does not undo an already
   * dispatched transaction; it prevents the session from resuming afterwards.
   */
  async apply<TResult extends Readonly<KJCommandReceipt>>(preview: KJBoundaryEditPreview, execute: (request: KJBoundaryEditCommand) => Promise<TResult>): Promise<TResult> {
    this.#requirePhase('targets')
    if (!this.#previews.has(preview) || preview.revision !== this.#revision) this.#fail('stale-preview', 'Preview is stale, consumed or belongs to another session', '预览已失效、已使用或属于另一会话')
    this.#previews.delete(preview)
    this.#phase = 'applying'
    const original = this.#entity(preview.targetId)
    const originalGroups = this.#operation === 'trim'
      ? this.#document.listObjects({ kind: 'group' }).filter(group => ['GROUP', 'SELECTION_SET'].includes(group.type)
        && Array.isArray(group.payload.memberIds) && group.payload.memberIds.includes(original.id))
      : []
    const originalDimensions = this.#document.listEntities({ type: 'DIMENSION' }).filter(dimension =>
      Array.isArray(dimension.payload.dimensionAssociations)
      && normalizeDimensionAssociations(dimension.payload.dimensionAssociations).some(association => association.entityId === original.id))
    const commits: KJBoundaryEditCommit[] = []
    const unsubscribe = this.#document.on('document:before-commit', event => {
      const operations = event.revision.operations.filter((operation): operation is Readonly<Record<string, unknown>> => !!operation && typeof operation === 'object')
      // Large membership updates compact operation records. Read the snapshots
      // only in that case; ordinary pointer edits inspect the small operation list.
      const compacted = operations.some(operation => operation.type === 'operations.compacted')
      const before = compacted ? event.before : null
      const after = compacted ? event.after : null
      const createdIds = compacted
        ? Object.values(after!.objects).filter(object => object.kind === 'entity' && !(object.id in before!.objects)).map(object => object.id)
        : operations.filter(operation => operation.type === 'object.create' && operation.kind === 'entity').map(operation => String(operation.id))
      commits.push({ revision: event.revision, createdIds, operations, before, after })
    })
    try {
      const result = await execute(preview.command)
      const commit = commits[0]
      if (this.#document.revision !== this.#revision + 1 || !this.#isDocumentCurrent()
        || commits.length !== 1 || !commit || !this.#matchesCommit(preview, original, originalGroups, originalDimensions, result, commit)) {
        this.cancel()
        this.#fail('unexpected-commit', 'The drawing changed or the executor did not commit the previewed edit. Inspect the drawing before continuing.', '图纸已切换，或执行器提交的修改与预览不一致。请检查图纸后再继续。')
      }
      this.#revision = this.#document.revision
      this.#committedCount += 1
      this.#previews = new WeakSet()
      if (this.#phase === 'applying') this.#phase = 'targets'
      return result
    } catch (error) {
      if (this.#phase === 'applying') {
        if (this.#document.revision === this.#revision && this.#isDocumentCurrent()) this.#phase = 'targets'
        else this.cancel()
      }
      throw error
    } finally {
      unsubscribe()
    }
  }

  #matchesCommit(preview: KJBoundaryEditPreview, original: KJReadonlyObjectRecord,
    originalGroups: readonly KJReadonlyObjectRecord[], originalDimensions: readonly KJReadonlyObjectRecord[],
    receipt: unknown, commit: KJBoundaryEditCommit): boolean {
    if (!receipt || typeof receipt !== 'object') return false
    const result = receipt as Readonly<KJCommandReceipt>
    const metadata = commit.revision.metadata as Readonly<Record<string, unknown>> | undefined
    if (result.schema !== 'com.kanjie.kjdraw.command-receipt' || result.schemaVersion !== 1
      || result.status !== 'committed' || result.documentId !== preview.documentId || result.command !== preview.command.command
      || result.beforeRevision !== preview.revision || result.afterRevision !== preview.revision + 1
      || commit.revision.revision !== result.afterRevision || commit.revision.kind !== 'commit'
      || !result.commandEnvelopeId || metadata?.commandEnvelopeId !== result.commandEnvelopeId
      || metadata?.commandId !== preview.command.command || metadata?.commandArgumentsDigest !== stableHash(preview.command.arguments)) return false
    const keepsIdentity = original.type === preview.pieces[0]?.type
    const retained = keepsIdentity ? [this.#document.getObject(original.id)] : []
    if (!keepsIdentity && this.#document.getObject(original.id)) return false
    retained.push(...commit.createdIds.map(id => this.#document.getObject(id)))
    if (retained.length !== preview.pieces.length || !retained.every((entity, index) => {
      const piece = preview.pieces[index]
      return !!entity && !!piece && entity.kind === 'entity' && entity.ownerId === original.ownerId && entity.type === piece.type
        && canonicalStringify(entity.payload) === canonicalStringify(normalizeStandardEntityPayload(piece.type, clone(piece.payload)))
        && entity.name === original.name && entity.erased === false
        && sameValue(entity.extension, original.extension)
        && (entity.id === original.id || sameValue(entity.source, { derivedFromId: original.id, derivedFromHandle: original.handle }))
    })) return false
    const retainedIds = retained.map(entity => entity!.id)
    return commit.before && commit.after
      ? this.#matchesCompactedWrites(preview, original, originalGroups, originalDimensions, retainedIds, commit)
      : this.#matchesRecordedWrites(preview, original, originalGroups, originalDimensions, retainedIds, commit)
  }

  #expectedTarget(preview: KJBoundaryEditPreview, original: KJReadonlyObjectRecord): KJObjectRecord {
    const expected = clone(original) as KJObjectRecord
    if (original.type === preview.pieces[0]?.type) {
      expected.payload = normalizeStandardEntityPayload(original.type, clone(preview.pieces[0]!.payload))
    } else expected.erased = true
    return expected
  }

  #expectedGroup(group: KJReadonlyObjectRecord, sourceId: string, retainedIds: readonly string[]): KJObjectRecord {
    const expected = clone(group) as KJObjectRecord
    const members = Array.isArray(group.payload.memberIds) ? group.payload.memberIds : []
    expected.payload.memberIds = [...new Set(members.flatMap(id => id === sourceId ? [...retainedIds] : [id]))]
    return expected
  }

  #expectedDimension(dimension: KJReadonlyObjectRecord): KJObjectRecord | null {
    const current = this.#document.getObject(dimension.id)
    if (!current || current.kind !== 'entity' || current.type !== 'DIMENSION') return null
    const expected = clone(dimension) as KJObjectRecord
    expected.payload.definitionPoints = clone(current.payload.definitionPoints)
    expected.payload.measurement = current.payload.measurement
    expected.payload.blockName = current.payload.blockName
    return sameValue(expected, current) ? expected : null
  }

  #matchesRecordedWrites(preview: KJBoundaryEditPreview, original: KJReadonlyObjectRecord,
    originalGroups: readonly KJReadonlyObjectRecord[], originalDimensions: readonly KJReadonlyObjectRecord[],
    retainedIds: readonly string[], commit: KJBoundaryEditCommit): boolean {
    const expectedTarget = this.#expectedTarget(preview, original)
    const expectedGroups = new Map(originalGroups.map(group => [group.id, this.#expectedGroup(group, original.id, retainedIds)]))
    const changedGroupIds = new Set(originalGroups.filter(group => !sameValue(group, expectedGroups.get(group.id))).map(group => group.id))
    const expectedDimensions = new Map<string, KJObjectRecord>()
    for (const dimension of originalDimensions) {
      const expected = this.#expectedDimension(dimension)
      if (!expected) return false
      if (!sameValue(dimension, expected)) expectedDimensions.set(dimension.id, expected)
    }
    const groupWrites = new Map<string, number>()
    const dimensionWrites = new Map<string, number>()
    const createdIds: string[] = []
    let targetWrites = 0
    for (const operation of commit.operations) {
      const type = String(operation.type ?? ''), id = String(operation.id ?? '')
      if (type === 'object.create') {
        if (operation.kind !== 'entity' || !commit.createdIds.includes(id)) return false
        createdIds.push(id)
        continue
      }
      if (type !== 'object.update') return false
      if (id === original.id) {
        targetWrites += 1
        if (!sameValue(operation.before, original) || !sameValue(operation.after, expectedTarget)) return false
        continue
      }
      const dimension = originalDimensions.find(candidate => candidate.id === id), expectedDimension = expectedDimensions.get(id)
      if (dimension) {
        if (!expectedDimension || !sameValue(operation.before, dimension) || !sameValue(operation.after, expectedDimension)) return false
        dimensionWrites.set(id, (dimensionWrites.get(id) ?? 0) + 1)
        continue
      }
      const group = originalGroups.find(candidate => candidate.id === id), expected = expectedGroups.get(id)
      if (!group || !expected || !changedGroupIds.has(id)
        || !sameValue(operation.before, group) || !sameValue(operation.after, expected)) return false
      groupWrites.set(id, (groupWrites.get(id) ?? 0) + 1)
    }
    if (targetWrites !== 1 || !sameValue(createdIds, commit.createdIds)
      || [...changedGroupIds].some(id => groupWrites.get(id) !== 1) || groupWrites.size !== changedGroupIds.size
      || [...expectedDimensions].some(([id]) => dimensionWrites.get(id) !== 1) || dimensionWrites.size !== expectedDimensions.size) return false
    if (!sameValue(this.#document.getObject(original.id, { includeErased: true }), expectedTarget)) return false
    return originalGroups.every(group => sameValue(this.#document.getObject(group.id), expectedGroups.get(group.id)))
      && [...expectedDimensions].every(([id, expected]) => sameValue(this.#document.getObject(id), expected))
  }

  #matchesCompactedWrites(preview: KJBoundaryEditPreview, original: KJReadonlyObjectRecord,
    originalGroups: readonly KJReadonlyObjectRecord[], originalDimensions: readonly KJReadonlyObjectRecord[],
    retainedIds: readonly string[], commit: KJBoundaryEditCommit): boolean {
    const before = commit.before!, after = commit.after!
    const expectedGroups = originalGroups.map(group => this.#expectedGroup(group, original.id, retainedIds))
    const changedGroupCount = originalGroups.filter((group, index) => !sameValue(group, expectedGroups[index])).length
    const expectedDimensions = originalDimensions.map(dimension => this.#expectedDimension(dimension))
    if (expectedDimensions.some(dimension => !dimension)) return false
    const changedDimensionCount = originalDimensions.filter((dimension, index) => !sameValue(dimension, expectedDimensions[index])).length
    const expectedByType: Record<string, number> = { 'object.update': 1 + changedGroupCount + changedDimensionCount }
    if (commit.createdIds.length) expectedByType['object.create'] = commit.createdIds.length
    const expectedOperationCount = Object.values(expectedByType).reduce((total, count) => total + count, 0)
    const summary = commit.operations[0]
    if (before.revision !== preview.revision || after.revision !== preview.revision + 1
      || after.revisions.length !== before.revisions.length + 1
      || !sameValue(before.revisions, after.revisions.slice(0, -1))
      || commit.operations.length !== 1 || summary?.type !== 'operations.compacted'
      || commit.revision.operationCount !== expectedOperationCount
      || Number(summary.operationCount) !== expectedOperationCount || !sameValue(summary.byType, expectedByType)) return false
    const expected = clone(before) as KJDocumentState
    expected.revision = after.revision
    expected.revisions = clone(after.revisions) as KJRevisionRecord[]
    expected.metadata.modifiedAt = after.metadata.modifiedAt
    expected.header.handseed = after.header.handseed
    expected.objects[original.id] = this.#expectedTarget(preview, original)

    for (const id of commit.createdIds) {
      if (before.objects[id] || !after.objects[id]) return false
      expected.objects[id] = clone(after.objects[id]) as KJObjectRecord
    }
    if (commit.createdIds.length) {
      const ownerId = original.ownerId ?? '', beforeOwner = before.objects[ownerId]
      if (!beforeOwner || !after.objects[ownerId]) return false
      const expectedOwner = clone(beforeOwner) as KJObjectRecord
      const entityIds = Array.isArray(beforeOwner.payload.entityIds) ? [...beforeOwner.payload.entityIds] : []
      for (const id of commit.createdIds) if (!entityIds.includes(id)) entityIds.push(id)
      expectedOwner.payload.entityIds = entityIds
      expected.objects[ownerId] = expectedOwner
    }
    for (const [index, group] of originalGroups.entries()) expected.objects[group.id] = expectedGroups[index]!
    for (const [index, dimension] of originalDimensions.entries()) {
      if (!sameValue(dimension, expectedDimensions[index])) expected.objects[dimension.id] = expectedDimensions[index]!
    }
    return sameValue(expected, after)
  }

  finish(): void { this.#phase = 'finished'; this.#previews = new WeakSet() }
  cancel(): void { this.#phase = 'cancelled'; this.#previews = new WeakSet() }

  #entity(id: string): KJReadonlyObjectRecord {
    const entity = this.#document.getObject(id)
    if (!entity || entity.kind !== 'entity') this.#fail('missing-entity', 'The selected entity is no longer available', '所选图元已不可用')
    return entity
  }

  #requirePhase(phase: KJBoundaryEditPhase): void {
    if (!this.isCurrent()) {
      this.cancel()
      this.#fail('stale-session', 'Drawing changed or editing session ended; start the tool again', '图纸已变化或编辑已结束，请重新启动工具')
    }
    if (this.#phase !== phase) this.#fail('phase', 'Finish the current editing step first', '请先完成当前编辑步骤')
  }

  #text(en: string, zh: string): string { return this.#locale === 'zh' ? zh : en }
  #fail(code: string, en: string, zh: string): never {
    throw new KJValidationError(this.#text(en, zh), { code: `boundary-edit.${code}` })
  }
}

export function createBoundaryEditSession(operation: KJBoundaryEditOperation, options: KJBoundaryEditOptions): KJBoundaryEditSession {
  return new KJBoundaryEditSession(operation, options)
}
