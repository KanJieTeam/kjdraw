// Generated from boundary-edit.ts by scripts/build-typescript.mjs. Do not edit directly.
import { extendEntityPayload, trimEntityPayloads } from './editing.js';
import { KJValidationError } from './errors.js';
import { normalizeStandardEntityPayload } from './standard-entities.js';
import { canonicalStringify, clone, deepFreeze, stableHash } from './utils.js';
const BOUNDARY_TYPES = new Set([
    'LINE',
    'RAY',
    'XLINE',
    'CIRCLE',
    'ARC'
]);
function sameValue(left, right) {
    return canonicalStringify(left) === canonicalStringify(right);
}
export class KJBoundaryEditSession {
    #document;
    #operation;
    #isDocumentCurrent;
    #locale;
    #phase = 'boundaries';
    #revision;
    #boundaryIds = [];
    #committedCount = 0;
    #previews = new WeakSet();
    constructor(operation, options){
        if (operation !== 'trim' && operation !== 'extend') throw new KJValidationError('Boundary operation must be trim or extend');
        this.#operation = operation;
        this.#document = options.document;
        this.#revision = options.document.revision;
        this.#locale = options.locale ?? 'en';
        this.#isDocumentCurrent = options.isDocumentCurrent ?? (()=>true);
        this.setBoundaries(options.boundaryIds ?? []);
    }
    get state() {
        return Object.freeze({
            phase: this.#phase,
            operation: this.#operation,
            boundaryIds: Object.freeze([
                ...this.#boundaryIds
            ]),
            expectedRevision: this.#revision,
            committedCount: this.#committedCount
        });
    }
    get prompt() {
        const name = this.#operation === 'trim' ? this.#text('Trim', '修剪') : this.#text('Extend', '延伸');
        if (this.#phase === 'boundaries') return this.#text(`${name}: select cutting boundaries (${this.#boundaryIds.length}) · Enter confirms · Esc cancels`, `${name}：选择边界（${this.#boundaryIds.length}）· Enter 确认 · Esc 取消`);
        if (this.#phase === 'targets') return this.#text(`${name}: click ${this.#operation === 'trim' ? 'each portion to remove' : 'near each end to extend'} · Enter finishes · Esc cancels`, `${name}：连续点选${this.#operation === 'trim' ? '要删除的区段' : '要延伸的一端'} · Enter 完成 · Esc 取消`);
        if (this.#phase === 'applying') return this.#text(`${name}: applying edit…`, `${name}：正在应用修改…`);
        return this.#text(`${name}: ${this.#phase === 'finished' ? 'finished' : 'cancelled'}`, `${name}：${this.#phase === 'finished' ? '已完成' : '已取消'}`);
    }
    setLocale(locale) {
        this.#locale = locale;
    }
    isCurrent() {
        return this.#phase !== 'finished' && this.#phase !== 'cancelled' && this.#isDocumentCurrent() && this.#document.revision === this.#revision;
    }
    setBoundaries(ids) {
        this.#requirePhase('boundaries');
        const next = [
            ...new Set(ids.map(String))
        ];
        for (const id of next){
            const entity = this.#entity(id);
            if (!BOUNDARY_TYPES.has(entity.type)) this.#fail('boundary-type', 'Boundaries must be lines, rays, construction lines, circles or arcs', '边界必须是直线、射线、构造线、圆或圆弧');
        }
        this.#boundaryIds = next;
    }
    confirmBoundaries() {
        this.#requirePhase('boundaries');
        if (!this.#boundaryIds.length) this.#fail('empty-boundaries', 'Select at least one cutting boundary', '请至少选择一条边界');
        this.#phase = 'targets';
    }
    preview(targetId, pickPoint) {
        this.#requirePhase('targets');
        const target = this.#entity(targetId);
        if (this.#boundaryIds.includes(targetId)) this.#fail('boundary-as-target', 'A cutting boundary cannot also be the target', '不能把已选边界同时作为修改目标');
        const supported = this.#operation === 'trim' ? [
            'LINE',
            'ARC',
            'CIRCLE'
        ] : [
            'LINE',
            'ARC'
        ];
        if (!supported.includes(target.type)) this.#fail('target-type', `${this.#operation.toUpperCase()} supports ${supported.join(', ')}`, `${this.#operation === 'trim' ? '修剪' : '延伸'}支持 ${supported.join('、')}`);
        const layer = target.payload.layerId ? this.#document.getObject(String(target.payload.layerId)) : null;
        if (target.payload.visible === false || layer?.payload.locked === true || layer?.payload.frozen === true || layer?.payload.visible === false) {
            this.#fail('protected-target', 'Show, unlock and thaw the target layer before editing', '请先显示、解锁并解冻目标图层');
        }
        const point = [
            Number(pickPoint?.[0]),
            Number(pickPoint?.[1])
        ];
        if (!point.every(Number.isFinite)) this.#fail('invalid-point', 'Pick coordinates must be finite', '点坐标必须是有限数值');
        const boundaries = this.#boundaryIds.map((id)=>this.#entity(id));
        let pieces;
        try {
            pieces = this.#operation === 'trim' ? trimEntityPayloads(target, boundaries, point) : [
                {
                    type: target.type,
                    payload: extendEntityPayload(target, boundaries, point)
                }
            ];
        } catch (cause) {
            throw new KJValidationError(this.#text(`Cannot ${this.#operation} here. Pick another portion or end; check the boundary intersections.`, `此处无法${this.#operation === 'trim' ? '修剪' : '延伸'}。请换一个区段或端点，并检查边界是否相交。`), {
                code: 'boundary-edit.geometry',
                reason: cause instanceof Error ? cause.message : String(cause)
            });
        }
        if (!pieces.length) this.#fail('empty-result', 'The edit must retain a non-empty entity', '修改必须保留有效图元');
        const preview = deepFreeze({
            documentId: this.#document.id,
            revision: this.#revision,
            operation: this.#operation,
            targetId,
            boundaryIds: [
                ...this.#boundaryIds
            ],
            pickPoint: point,
            pieces: clone(pieces),
            command: {
                command: this.#operation === 'trim' ? 'TRIM' : 'EXTEND',
                arguments: {
                    id: targetId,
                    boundaryIds: [
                        ...this.#boundaryIds
                    ],
                    pickPoint: point
                },
                expectedRevision: this.#revision
            }
        });
        this.#previews.add(preview);
        return preview;
    }
    async apply(preview, execute) {
        this.#requirePhase('targets');
        if (!this.#previews.has(preview) || preview.revision !== this.#revision) this.#fail('stale-preview', 'Preview is stale, consumed or belongs to another session', '预览已失效、已使用或属于另一会话');
        this.#previews.delete(preview);
        this.#phase = 'applying';
        const original = this.#entity(preview.targetId);
        const originalGroups = this.#operation === 'trim' ? this.#document.listObjects({
            kind: 'group'
        }).filter((group)=>[
                'GROUP',
                'SELECTION_SET'
            ].includes(group.type) && Array.isArray(group.payload.memberIds) && group.payload.memberIds.includes(original.id)) : [];
        const commits = [];
        const unsubscribe = this.#document.on('document:before-commit', (event)=>{
            const operations = event.revision.operations.filter((operation)=>!!operation && typeof operation === 'object');
            const compacted = operations.some((operation)=>operation.type === 'operations.compacted');
            const before = compacted ? event.before : null;
            const after = compacted ? event.after : null;
            const createdIds = compacted ? Object.values(after.objects).filter((object)=>object.kind === 'entity' && !(object.id in before.objects)).map((object)=>object.id) : operations.filter((operation)=>operation.type === 'object.create' && operation.kind === 'entity').map((operation)=>String(operation.id));
            commits.push({
                revision: event.revision,
                createdIds,
                operations,
                before,
                after
            });
        });
        try {
            const result = await execute(preview.command);
            const commit = commits[0];
            if (this.#document.revision !== this.#revision + 1 || !this.#isDocumentCurrent() || commits.length !== 1 || !commit || !this.#matchesCommit(preview, original, originalGroups, result, commit)) {
                this.cancel();
                this.#fail('unexpected-commit', 'The drawing changed or the executor did not commit the previewed edit. Inspect the drawing before continuing.', '图纸已切换，或执行器提交的修改与预览不一致。请检查图纸后再继续。');
            }
            this.#revision = this.#document.revision;
            this.#committedCount += 1;
            this.#previews = new WeakSet();
            if (this.#phase === 'applying') this.#phase = 'targets';
            return result;
        } catch (error) {
            if (this.#phase === 'applying') {
                if (this.#document.revision === this.#revision && this.#isDocumentCurrent()) this.#phase = 'targets';
                else this.cancel();
            }
            throw error;
        } finally{
            unsubscribe();
        }
    }
    #matchesCommit(preview, original, originalGroups, receipt, commit) {
        if (!receipt || typeof receipt !== 'object') return false;
        const result = receipt;
        const metadata = commit.revision.metadata;
        if (result.schema !== 'com.kanjie.kjdraw.command-receipt' || result.schemaVersion !== 1 || result.status !== 'committed' || result.documentId !== preview.documentId || result.command !== preview.command.command || result.beforeRevision !== preview.revision || result.afterRevision !== preview.revision + 1 || commit.revision.revision !== result.afterRevision || commit.revision.kind !== 'commit' || !result.commandEnvelopeId || metadata?.commandEnvelopeId !== result.commandEnvelopeId || metadata?.commandId !== preview.command.command || metadata?.commandArgumentsDigest !== stableHash(preview.command.arguments)) return false;
        const keepsIdentity = original.type === preview.pieces[0]?.type;
        const retained = keepsIdentity ? [
            this.#document.getObject(original.id)
        ] : [];
        if (!keepsIdentity && this.#document.getObject(original.id)) return false;
        retained.push(...commit.createdIds.map((id)=>this.#document.getObject(id)));
        if (retained.length !== preview.pieces.length || !retained.every((entity, index)=>{
            const piece = preview.pieces[index];
            return !!entity && !!piece && entity.kind === 'entity' && entity.ownerId === original.ownerId && entity.type === piece.type && canonicalStringify(entity.payload) === canonicalStringify(normalizeStandardEntityPayload(piece.type, clone(piece.payload))) && entity.name === original.name && entity.erased === false && sameValue(entity.extension, original.extension) && (entity.id === original.id || sameValue(entity.source, {
                derivedFromId: original.id,
                derivedFromHandle: original.handle
            }));
        })) return false;
        const retainedIds = retained.map((entity)=>entity.id);
        return commit.before && commit.after ? this.#matchesCompactedWrites(preview, original, originalGroups, retainedIds, commit) : this.#matchesRecordedWrites(preview, original, originalGroups, retainedIds, commit);
    }
    #expectedTarget(preview, original) {
        const expected = clone(original);
        if (original.type === preview.pieces[0]?.type) {
            expected.payload = normalizeStandardEntityPayload(original.type, clone(preview.pieces[0].payload));
        } else expected.erased = true;
        return expected;
    }
    #expectedGroup(group, sourceId, retainedIds) {
        const expected = clone(group);
        const members = Array.isArray(group.payload.memberIds) ? group.payload.memberIds : [];
        expected.payload.memberIds = [
            ...new Set(members.flatMap((id)=>id === sourceId ? [
                    ...retainedIds
                ] : [
                    id
                ]))
        ];
        return expected;
    }
    #matchesRecordedWrites(preview, original, originalGroups, retainedIds, commit) {
        const expectedTarget = this.#expectedTarget(preview, original);
        const expectedGroups = new Map(originalGroups.map((group)=>[
                group.id,
                this.#expectedGroup(group, original.id, retainedIds)
            ]));
        const changedGroupIds = new Set(originalGroups.filter((group)=>!sameValue(group, expectedGroups.get(group.id))).map((group)=>group.id));
        const groupWrites = new Map();
        const createdIds = [];
        let targetWrites = 0;
        for (const operation of commit.operations){
            const type = String(operation.type ?? ''), id = String(operation.id ?? '');
            if (type === 'object.create') {
                if (operation.kind !== 'entity' || !commit.createdIds.includes(id)) return false;
                createdIds.push(id);
                continue;
            }
            if (type !== 'object.update') return false;
            if (id === original.id) {
                targetWrites += 1;
                if (!sameValue(operation.before, original) || !sameValue(operation.after, expectedTarget)) return false;
                continue;
            }
            const group = originalGroups.find((candidate)=>candidate.id === id), expected = expectedGroups.get(id);
            if (!group || !expected || !changedGroupIds.has(id) || !sameValue(operation.before, group) || !sameValue(operation.after, expected)) return false;
            groupWrites.set(id, (groupWrites.get(id) ?? 0) + 1);
        }
        if (targetWrites !== 1 || !sameValue(createdIds, commit.createdIds) || [
            ...changedGroupIds
        ].some((id)=>groupWrites.get(id) !== 1) || groupWrites.size !== changedGroupIds.size) return false;
        if (!sameValue(this.#document.getObject(original.id, {
            includeErased: true
        }), expectedTarget)) return false;
        return originalGroups.every((group)=>sameValue(this.#document.getObject(group.id), expectedGroups.get(group.id)));
    }
    #matchesCompactedWrites(preview, original, originalGroups, retainedIds, commit) {
        const before = commit.before, after = commit.after;
        const expectedGroups = originalGroups.map((group)=>this.#expectedGroup(group, original.id, retainedIds));
        const changedGroupCount = originalGroups.filter((group, index)=>!sameValue(group, expectedGroups[index])).length;
        const expectedByType = {
            'object.update': 1 + changedGroupCount
        };
        if (commit.createdIds.length) expectedByType['object.create'] = commit.createdIds.length;
        const expectedOperationCount = Object.values(expectedByType).reduce((total, count)=>total + count, 0);
        const summary = commit.operations[0];
        if (before.revision !== preview.revision || after.revision !== preview.revision + 1 || after.revisions.length !== before.revisions.length + 1 || !sameValue(before.revisions, after.revisions.slice(0, -1)) || commit.operations.length !== 1 || summary?.type !== 'operations.compacted' || commit.revision.operationCount !== expectedOperationCount || Number(summary.operationCount) !== expectedOperationCount || !sameValue(summary.byType, expectedByType)) return false;
        const expected = clone(before);
        expected.revision = after.revision;
        expected.revisions = clone(after.revisions);
        expected.metadata.modifiedAt = after.metadata.modifiedAt;
        expected.header.handseed = after.header.handseed;
        expected.objects[original.id] = this.#expectedTarget(preview, original);
        for (const id of commit.createdIds){
            if (before.objects[id] || !after.objects[id]) return false;
            expected.objects[id] = clone(after.objects[id]);
        }
        if (commit.createdIds.length) {
            const ownerId = original.ownerId ?? '', beforeOwner = before.objects[ownerId];
            if (!beforeOwner || !after.objects[ownerId]) return false;
            const expectedOwner = clone(beforeOwner);
            const entityIds = Array.isArray(beforeOwner.payload.entityIds) ? [
                ...beforeOwner.payload.entityIds
            ] : [];
            for (const id of commit.createdIds)if (!entityIds.includes(id)) entityIds.push(id);
            expectedOwner.payload.entityIds = entityIds;
            expected.objects[ownerId] = expectedOwner;
        }
        for (const [index, group] of originalGroups.entries())expected.objects[group.id] = expectedGroups[index];
        return sameValue(expected, after);
    }
    finish() {
        this.#phase = 'finished';
        this.#previews = new WeakSet();
    }
    cancel() {
        this.#phase = 'cancelled';
        this.#previews = new WeakSet();
    }
    #entity(id) {
        const entity = this.#document.getObject(id);
        if (!entity || entity.kind !== 'entity') this.#fail('missing-entity', 'The selected entity is no longer available', '所选图元已不可用');
        return entity;
    }
    #requirePhase(phase) {
        if (!this.isCurrent()) {
            this.cancel();
            this.#fail('stale-session', 'Drawing changed or editing session ended; start the tool again', '图纸已变化或编辑已结束，请重新启动工具');
        }
        if (this.#phase !== phase) this.#fail('phase', 'Finish the current editing step first', '请先完成当前编辑步骤');
    }
    #text(en, zh) {
        return this.#locale === 'zh' ? zh : en;
    }
    #fail(code, en, zh) {
        throw new KJValidationError(this.#text(en, zh), {
            code: `boundary-edit.${code}`
        });
    }
}
export function createBoundaryEditSession(operation, options) {
    return new KJBoundaryEditSession(operation, options);
}
