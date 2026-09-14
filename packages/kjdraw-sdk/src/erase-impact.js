// Generated from erase-impact.ts by scripts/build-typescript.mjs. Do not edit directly.
import { normalizeDimensionAssociations } from './dimension-associations.js';
import { readDesignRelations } from './design-relations.js';
import { KJRevisionConflictError, KJValidationError } from './errors.js';
import { resolveCommandLayerId } from './edit-policy.js';
import { deepFreeze } from './utils.js';
export const KJDRAW_ERASE_IMPACT_LIMITS = Object.freeze({
    maxObjects: 200000,
    maxReferences: 500000,
    maxConnectivityFeatures: 32768,
    maxConnectivityComparisons: 500000
});
const encoder = new TextEncoder();
function fail(message) {
    throw new KJValidationError(message);
}
function jsonBytes(value) {
    return encoder.encode(JSON.stringify(value)).length;
}
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function finite(value) {
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12;
}
function point3(value) {
    if (!Array.isArray(value) || value.length < 2 || value.length > 3 || !finite(value[0]) || !finite(value[1]) || value[2] != null && !finite(value[2])) return null;
    return [
        value[0],
        value[1],
        value[2] ?? 0
    ];
}
function endpointGeometry(entity) {
    const payload = entity.payload, add = (value)=>{
        const point = point3(value);
        return point ? {
            entityId: entity.id,
            ownerId: String(entity.ownerId),
            point
        } : null;
    };
    if (entity.type === 'LINE') return [
        add(payload.start),
        add(payload.end)
    ].filter((item)=>item !== null);
    if (entity.type === 'ARC') {
        const center = point3(payload.center), radius = payload.radius, start = payload.startAngle, end = payload.endAngle;
        if (!center || !finite(radius) || radius <= 0 || !finite(start) || !finite(end) || Math.abs(end - start) >= Math.PI * 2 - 1e-12) return [];
        return [
            start,
            end
        ].map((angle)=>({
                entityId: entity.id,
                ownerId: String(entity.ownerId),
                point: [
                    center[0] + radius * Math.cos(angle),
                    center[1] + radius * Math.sin(angle),
                    center[2]
                ]
            }));
    }
    if (entity.type === 'ELLIPSE') {
        const center = point3(payload.center), axis = point3(payload.majorAxis), ratio = payload.ratio, start = payload.startParameter ?? 0, end = payload.endParameter ?? Math.PI * 2;
        if (!center || !axis || axis[2] !== 0 || !finite(ratio) || ratio <= 0 || ratio > 1 || !finite(start) || !finite(end) || Math.hypot(axis[0], axis[1]) <= 1e-12 || Math.abs(end - start) >= Math.PI * 2 - 1e-12) return [];
        return [
            start,
            end
        ].map((parameter)=>({
                entityId: entity.id,
                ownerId: String(entity.ownerId),
                point: [
                    center[0] + axis[0] * Math.cos(parameter) - axis[1] * ratio * Math.sin(parameter),
                    center[1] + axis[1] * Math.cos(parameter) + axis[0] * ratio * Math.sin(parameter),
                    center[2]
                ]
            }));
    }
    if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
        if (!Array.isArray(payload.vertices) || payload.vertices.length < 2 || payload.vertices.length > 4096) return [];
        const points = payload.vertices.map((vertex)=>point3(vertex && typeof vertex === 'object' && !Array.isArray(vertex) ? vertex.point : vertex));
        if (points.some((point)=>point === null)) return [];
        return points.map((point)=>({
                entityId: entity.id,
                ownerId: String(entity.ownerId),
                point: point
            }));
    }
    return [];
}
function connectivityImpact(objects, erased, tolerance) {
    const entities = objects.filter((object)=>!object.erased && object.kind === 'entity');
    const endpoints = [];
    for (const entity of entities)for (const endpoint of endpointGeometry(entity)){
        endpoints.push(endpoint);
        if (endpoints.length > KJDRAW_ERASE_IMPACT_LIMITS.maxConnectivityFeatures) fail(`Erase impact connectivity exceeds ${KJDRAW_ERASE_IMPACT_LIMITS.maxConnectivityFeatures} features`);
    }
    endpoints.sort((a, b)=>compareText(a.ownerId, b.ownerId) || a.point[0] - b.point[0] || a.point[1] - b.point[1] || a.point[2] - b.point[2] || compareText(a.entityId, b.entityId));
    const entityIds = [
        ...new Set(endpoints.map((endpoint)=>endpoint.entityId))
    ].sort(), adjacency = new Map(entityIds.map((id)=>[
            id,
            new Set()
        ]));
    let comparisons = 0, ownerStart = 0;
    while(ownerStart < endpoints.length){
        let ownerEnd = ownerStart + 1;
        while(ownerEnd < endpoints.length && endpoints[ownerEnd].ownerId === endpoints[ownerStart].ownerId)ownerEnd++;
        for(let left = ownerStart; left < ownerEnd; left++)for(let right = left + 1; right < ownerEnd && endpoints[right].point[0] - endpoints[left].point[0] <= tolerance; right++){
            if (++comparisons > KJDRAW_ERASE_IMPACT_LIMITS.maxConnectivityComparisons) fail(`Erase impact connectivity exceeds ${KJDRAW_ERASE_IMPACT_LIMITS.maxConnectivityComparisons} comparisons`);
            const a = endpoints[left].point, b = endpoints[right].point;
            if ((a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 + (a[0] - b[0]) ** 2 <= tolerance ** 2) {
                const first = endpoints[left].entityId, second = endpoints[right].entityId;
                if (first !== second) {
                    adjacency.get(first).add(second);
                    adjacency.get(second).add(first);
                }
            }
        }
        ownerStart = ownerEnd;
    }
    const visited = new Set(), beforeComponents = [];
    for (const id of entityIds){
        if (visited.has(id)) continue;
        const queue = [
            id
        ], component = [];
        visited.add(id);
        while(queue.length){
            const current = queue.shift();
            component.push(current);
            for (const next of adjacency.get(current))if (!visited.has(next)) {
                visited.add(next);
                queue.push(next);
            }
        }
        component.sort();
        if (component.some((member)=>erased.has(member))) beforeComponents.push(component);
    }
    const afterComponents = [], disconnectCandidates = [];
    for (const before of beforeComponents){
        const retained = new Set(before.filter((id)=>!erased.has(id))), fragments = [];
        while(retained.size){
            const seed = [
                ...retained
            ].sort()[0], queue = [
                seed
            ], fragment = [];
            retained.delete(seed);
            while(queue.length){
                const current = queue.shift();
                fragment.push(current);
                for (const next of adjacency.get(current) ?? [])if (retained.has(next)) {
                    retained.delete(next);
                    queue.push(next);
                }
            }
            fragment.sort();
            fragments.push(fragment);
            afterComponents.push(fragment);
        }
        fragments.sort((a, b)=>compareText(a[0] ?? '', b[0] ?? ''));
        if (fragments.length > 1) disconnectCandidates.push({
            condition: 'selected-entities-bridge-retained-endpoint-connectivity',
            beforeEntityIds: before,
            removedEntityIds: before.filter((id)=>erased.has(id)),
            afterComponents: fragments,
            requiresCapabilityConfirmation: true
        });
    }
    afterComponents.sort((a, b)=>compareText(a[0] ?? '', b[0] ?? ''));
    return {
        semanticInference: 'none',
        before: {
            affectedComponents: beforeComponents
        },
        after: {
            retainedComponents: afterComponents
        },
        disconnectCandidates,
        comparisons,
        omittedNativeTypes: [
            'HATCH',
            'INSERT'
        ]
    };
}
function sourceHandles(hatch, count) {
    const found = new Map(), tags = hatch.payload.rawTags;
    if (Array.isArray(tags)) for(let index = 0; index < tags.length; index++){
        count();
        const tag = tags[index];
        if (!tag || typeof tag !== 'object' || Array.isArray(tag) || Number(tag.code) !== 97) continue;
        const nativeCount = Number(tag.value);
        const next = tags[index + 1];
        if (!next || typeof next !== 'object' || Array.isArray(next) || Number(next.code) !== 330) continue;
        if (!Number.isSafeInteger(nativeCount) || nativeCount < 1 || nativeCount > 4096) fail(`HATCH ${hatch.id} has an unsafe native 97/330 source count`);
        for(let offset = 1; offset <= nativeCount; offset++){
            count();
            const source = tags[index + offset];
            if (!source || typeof source !== 'object' || Array.isArray(source) || Number(source.code) !== 330) fail(`HATCH ${hatch.id} has an incomplete native 97/330 source list`);
            const handle = String(source.value ?? '').trim().toUpperCase();
            if (handle) found.set(handle, 'raw-97-330');
        }
    }
    if (Array.isArray(hatch.payload.boundaryLoops)) for (const loop of hatch.payload.boundaryLoops){
        count();
        const handles = loop && typeof loop === 'object' && !Array.isArray(loop) ? loop.sourceHandles : undefined;
        if (!Array.isArray(handles)) continue;
        for (const value of handles){
            count();
            const handle = String(value ?? '').trim().toUpperCase();
            if (handle && !found.has(handle)) found.set(handle, 'boundary-loop-sourceHandles');
        }
    }
    return [
        ...found
    ].sort(([a], [b])=>compareText(a, b)).map(([handle, reference])=>({
            handle,
            reference
        }));
}
function protectedReason(document, entity) {
    const layerId = effectiveLayerId(document, entity);
    const layer = layerId ? document.getObject(layerId) : null;
    return entity.payload.locked === true || layer?.payload.locked === true ? 'locked' : entity.payload.frozen === true || layer?.payload.frozen === true ? 'frozen' : entity.payload.visible === false || layer?.payload.visible === false ? 'hidden' : null;
}
function effectiveLayerId(document, entity) {
    const id = resolveCommandLayerId(entity.payload.layerId, document.getTable('layers')?.currentId);
    return id || null;
}
function matchingLeaderPosition(leader, annotation) {
    const left = point3(leader.payload.textPosition), right = point3(annotation.payload.position);
    return Boolean(left && right && Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]) <= 1e-9);
}
export function createEraseImpact(document, query, options = {}) {
    if (!query || typeof query !== 'object' || Array.isArray(query)) fail('Erase impact query must be an object');
    const allowed = [
        'expectedRevision',
        'units',
        'operation',
        'ids',
        'tolerance',
        'maxBytes'
    ];
    if (Object.keys(query).length !== allowed.length || Object.keys(query).some((key)=>!allowed.includes(key))) fail('Erase impact query requires exactly expectedRevision, units, operation, ids, tolerance and maxBytes');
    const diagnostic = options.mode !== 'decision';
    const maxIds = options.maxIds ?? 64, maxBytesLimit = options.maxBytesLimit ?? 262144;
    const maxObjects = options.maxObjectsLimit ?? KJDRAW_ERASE_IMPACT_LIMITS.maxObjects;
    if (!Number.isSafeInteger(maxObjects) || maxObjects < 1) fail('Erase impact maxObjectsLimit must be a positive safe integer');
    if (!Number.isSafeInteger(query.expectedRevision) || query.expectedRevision < 0) fail('Erase impact expectedRevision must be a nonnegative safe integer');
    if (document.revision !== query.expectedRevision) throw new KJRevisionConflictError(query.expectedRevision, document.revision);
    const state = document.snapshot();
    if (query.units !== state.header.units) fail('Unit mismatch; read the drawing units before querying erase impact');
    if (query.operation !== 'erase') fail('Erase impact operation must be erase');
    if (!Array.isArray(query.ids) || query.ids.length < 1 || query.ids.length > maxIds || query.ids.some((id)=>typeof id !== 'string' || !id || id.length > 256) || new Set(query.ids).size !== query.ids.length) fail(`Erase impact requires 1–${maxIds} unique bounded entity IDs`);
    if (!finite(query.tolerance) || query.tolerance <= 0 || query.tolerance > 1) fail('Erase impact tolerance must be greater than 0 and at most 1 drawing unit');
    if (diagnostic && (!Number.isSafeInteger(query.maxBytes) || query.maxBytes < 1024 || query.maxBytes > maxBytesLimit)) fail(`Erase impact maxBytes must be an integer from 1024 through ${maxBytesLimit}`);
    const objects = Object.values(state.objects).filter((object)=>!object.erased);
    if (objects.length > maxObjects) fail(`Erase impact exceeds ${maxObjects} live objects`);
    let references = 0;
    const count = (amount = 1)=>{
        references += amount;
        if (references > KJDRAW_ERASE_IMPACT_LIMITS.maxReferences) fail(`Erase impact exceeds ${KJDRAW_ERASE_IMPACT_LIMITS.maxReferences} references`);
    };
    const requestedIds = [
        ...query.ids
    ].sort(), requested = requestedIds.map((id)=>state.objects[id]).map((object, index)=>{
        if (!object || object.erased || object.kind !== 'entity' && !(options.allowCompoundRecords === true && object.kind === 'custom' && object.type === 'SEQEND')) fail(`Erase impact entity does not exist: ${requestedIds[index]}`);
        return object;
    });
    const blockers = [], blockerKeys = new Set();
    const block = (value)=>{
        const key = `${value.kind}\0${value.sourceId}\0${value.dependentId ?? ''}`;
        if (!blockerKeys.has(key)) {
            blockerKeys.add(key);
            blockers.push(value);
        }
    };
    const rootIds = new Set(requestedIds), effectiveIds = new Set(requestedIds), leaderPairs = [];
    const leadersByAnnotation = new Map(), attributesByInsert = new Map(), sequenceEndsByInsert = new Map(), instancesByDefinition = new Map();
    const designRecords = [], dimensionsByAssociation = [], hatches = [], selectionRecords = [], handleToEntity = new Map();
    for (const object of objects){
        if (object.type === 'DESIGN_RELATIONS') designRecords.push(object);
        if (object.kind === 'entity') {
            handleToEntity.set(object.handle.toUpperCase(), object);
            if (object.type === 'DIMENSION') dimensionsByAssociation.push(object);
            if (object.type === 'HATCH') hatches.push(object);
        } else if (object.kind === 'group' && object.type === 'SELECTION_SET') selectionRecords.push(object);
        if (object.kind === 'entity' && object.type === 'LEADER' && object.payload.annotationId != null) {
            const annotationId = String(object.payload.annotationId), values = leadersByAnnotation.get(annotationId) ?? [];
            values.push(object);
            leadersByAnnotation.set(annotationId, values);
            count();
        } else if (object.kind === 'entity' && object.type === 'ATTRIB' && object.payload.parentInsertId != null) {
            const insertId = String(object.payload.parentInsertId), values = attributesByInsert.get(insertId) ?? [];
            values.push(object.id);
            attributesByInsert.set(insertId, values);
            count();
        } else if (object.type === 'SEQEND' && object.ownerId != null) {
            const insertId = String(object.ownerId), values = sequenceEndsByInsert.get(insertId) ?? [];
            values.push(object.id);
            sequenceEndsByInsert.set(insertId, values);
            count();
        }
        if (object.kind === 'entity' && object.type === 'INSERT' && object.payload.blockRecordId != null) {
            const definitionId = String(object.payload.blockRecordId), values = instancesByDefinition.get(definitionId) ?? [];
            values.push(object.id);
            instancesByDefinition.set(definitionId, values);
            count();
        }
    }
    for (const values of leadersByAnnotation.values())values.sort((left, right)=>compareText(left.id, right.id));
    for (const values of attributesByInsert.values())values.sort(compareText);
    for (const values of sequenceEndsByInsert.values())values.sort(compareText);
    for (const values of instancesByDefinition.values())values.sort(compareText);
    designRecords.sort((a, b)=>compareText(a.id, b.id));
    dimensionsByAssociation.sort((a, b)=>compareText(a.id, b.id));
    hatches.sort((a, b)=>compareText(a.id, b.id));
    selectionRecords.sort((a, b)=>compareText(a.id, b.id));
    for (const member of requested){
        const candidates = member.type === 'LEADER' ? [
            member
        ] : member.type === 'MTEXT' ? leadersByAnnotation.get(member.id) ?? [] : [];
        if (!candidates.length && member.type !== 'LEADER') continue;
        if (member.type === 'LEADER' && member.payload.annotationId == null && member.payload.ownsAnnotation !== true && !member.payload.unresolvedLeaderAnnotation) continue;
        const leader = candidates[0], annotationId = String(leader?.payload.annotationId ?? ''), annotation = annotationId ? state.objects[annotationId] : undefined;
        const reverse = annotation ? leadersByAnnotation.get(annotation.id) ?? [] : [];
        const valid = candidates.length === 1 && leader?.payload.ownsAnnotation === true && leader.payload.annotationType === 0 && !leader.payload.unresolvedLeaderAnnotation && annotation?.kind === 'entity' && annotation.type === 'MTEXT' && reverse.length === 1 && reverse[0].id === leader.id && leader.ownerId === annotation.ownerId && effectiveLayerId(document, leader) === effectiveLayerId(document, annotation) && matchingLeaderPosition(leader, annotation);
        if (!valid) {
            block({
                kind: 'owned-leader-annotation',
                sourceId: member.id,
                dependentId: annotationId || null,
                message: 'ERASE rejects a broken or ambiguous owned LEADER + MTEXT annotation pair'
            });
            continue;
        }
        rootIds.add(leader.id);
        rootIds.add(annotation.id);
        effectiveIds.add(leader.id);
        effectiveIds.add(annotation.id);
        leaderPairs.push({
            leaderId: leader.id,
            annotationId: annotation.id,
            condition: 'owned-native-annotation-erased-atomically',
            resolvedBySameErase: true
        });
    }
    for (const id of rootIds){
        const entity = state.objects[id];
        if (!entity || entity.kind !== 'entity') continue;
        const reason = protectedReason(document, entity);
        if (reason) block({
            kind: 'protected-entity',
            sourceId: id,
            dependentId: null,
            reason,
            message: `ERASE cannot modify ${reason} entity ${id}`
        });
    }
    const insertAttachments = [];
    for (const id of [
        ...rootIds
    ]){
        const entity = state.objects[id];
        if (entity.type === 'ATTRIB' && entity.payload.parentInsertId || entity.type === 'SEQEND') {
            const parentId = String(entity.type === 'SEQEND' ? entity.ownerId ?? '' : entity.payload.parentInsertId);
            if (!rootIds.has(parentId)) block({
                kind: 'attached-insert-record',
                sourceId: id,
                dependentId: parentId,
                message: `ERASE must include parent INSERT ${parentId} when erasing attached ATTRIB ${id}`
            });
        }
        if (entity.type !== 'INSERT') continue;
        const attributeIds = Array.isArray(entity.payload.attributeIds) ? entity.payload.attributeIds.map(String).sort(compareText) : [], sequenceEndId = entity.payload.sequenceEndId == null ? null : String(entity.payload.sequenceEndId);
        const actualAttributeIds = attributesByInsert.get(entity.id) ?? [], actualSequenceEndIds = sequenceEndsByInsert.get(entity.id) ?? [];
        const complete = attributeIds.length === actualAttributeIds.length && attributeIds.every((childId, index)=>childId === actualAttributeIds[index] && state.objects[childId]?.kind === 'entity' && state.objects[childId]?.type === 'ATTRIB') && (sequenceEndId == null ? actualSequenceEndIds.length === 0 : actualSequenceEndIds.length === 1 && actualSequenceEndIds[0] === sequenceEndId && state.objects[sequenceEndId]?.type === 'SEQEND');
        if (!complete) block({
            kind: 'attached-insert-record',
            sourceId: entity.id,
            dependentId: null,
            message: `ERASE cannot safely resolve attached ATTRIB/SEQEND records for INSERT ${entity.id}`
        });
        for (const childId of attributeIds)effectiveIds.add(childId);
        if (sequenceEndId) effectiveIds.add(sequenceEndId);
        insertAttachments.push({
            insertId: entity.id,
            attributeIds,
            sequenceEndId,
            complete,
            condition: 'attached-records-erased-with-parent-insert',
            expandedGeometry: false,
            resolvedBySameErase: complete
        });
    }
    for (const id of [
        ...rootIds
    ]){
        const entity = state.objects[id], parentId = entity?.type === 'SEQEND' ? entity.ownerId : entity?.payload.parentInsertId;
        if (parentId && rootIds.has(String(parentId))) rootIds.delete(id);
    }
    const designRelations = [];
    let designViews = null;
    try {
        designViews = new Map(readDesignRelations(document).map((view)=>[
                view.id,
                view
            ]));
    } catch  {
        designViews = null;
    }
    for (const relation of designRecords){
        let entityIds = designViews?.get(relation.id)?.entityIds ?? [], valid = designViews?.has(relation.id) === true;
        if (!valid) {
            const definition = relation.payload.definition;
            const bindings = definition && typeof definition === 'object' && !Array.isArray(definition) ? definition.bindings : undefined;
            entityIds = Array.isArray(bindings) ? bindings.map((binding)=>String(binding && typeof binding === 'object' && !Array.isArray(binding) ? binding.entityId ?? '' : '')).filter(Boolean) : [];
        }
        count(entityIds.length);
        const affected = [
            ...new Set(entityIds.filter((id)=>effectiveIds.has(id)))
        ].sort();
        if (!affected.length) continue;
        designRelations.push({
            id: relation.id,
            name: relation.name,
            boundEntityIds: [
                ...new Set(entityIds)
            ].sort(),
            affectedEntityIds: affected,
            valid,
            condition: valid ? 'would-dangle-design-binding' : 'cannot-verify-design-binding',
            requiresCapabilityConfirmation: true,
            resolvedBySameErase: false
        });
        block({
            kind: 'design-relation',
            sourceId: affected[0],
            dependentId: relation.id,
            message: `ERASE must remove design relation ${relation.id} before erasing one of its bound entities`
        });
    }
    const dimensions = [];
    for (const dimension of dimensionsByAssociation){
        const raw = dimension.payload.dimensionAssociations;
        if (!Array.isArray(raw)) continue;
        let associations = [], valid = true;
        try {
            associations = normalizeDimensionAssociations(raw);
        } catch  {
            valid = false;
            associations = raw.map((value)=>({
                    entityId: String(value && typeof value === 'object' && !Array.isArray(value) ? value.entityId ?? '' : '')
                })).filter((value)=>value.entityId);
        }
        count(associations.length);
        const affected = [
            ...new Set(associations.map((value)=>value.entityId).filter((id)=>effectiveIds.has(id)))
        ].sort();
        if (!affected.length) continue;
        const resolved = effectiveIds.has(dimension.id);
        dimensions.push({
            id: dimension.id,
            affectedSourceIds: affected,
            associationCount: associations.length,
            valid,
            condition: valid ? 'would-dangle-dimension-association' : 'cannot-verify-dimension-association',
            requiresCapabilityConfirmation: true,
            resolvedBySameErase: resolved
        });
        if (!resolved) block({
            kind: 'dimension-association',
            sourceId: affected[0],
            dependentId: dimension.id,
            message: `ERASE must include dimension ${dimension.id} when erasing one of its referenced sources`
        });
    }
    const hatchSourceReferences = [];
    for (const hatch of hatches)for (const source of sourceHandles(hatch, count)){
        count();
        const entity = handleToEntity.get(source.handle);
        if (!entity || !effectiveIds.has(entity.id)) continue;
        const resolved = effectiveIds.has(hatch.id);
        hatchSourceReferences.push({
            hatchId: hatch.id,
            sourceId: entity.id,
            sourceHandle: source.handle,
            reference: source.reference,
            condition: 'would-dangle-native-hatch-source',
            requiresCapabilityConfirmation: true,
            resolvedBySameErase: resolved
        });
        if (!resolved) block({
            kind: 'hatch-source',
            sourceId: entity.id,
            dependentId: hatch.id,
            message: `ERASE must include HATCH ${hatch.id} when erasing native boundary source ${entity.id}`
        });
    }
    const selectionSets = [];
    if (diagnostic) for (const selection of selectionRecords){
        const members = selection.payload.memberIds;
        if (!Array.isArray(members)) continue;
        count(members.length);
        const affected = [
            ...new Set(members.filter((id)=>typeof id === 'string' && effectiveIds.has(id)))
        ].sort();
        if (affected.length) selectionSets.push({
            id: selection.id,
            name: selection.name,
            affectedMemberIds: affected,
            condition: 'memberships-removed-by-same-erase',
            requiresCapabilityConfirmation: false,
            resolvedBySameErase: true
        });
    }
    const blockDefinitionInstances = [];
    const definitionMembers = new Map();
    for (const id of effectiveIds){
        const entity = state.objects[id], owner = entity?.ownerId ? state.objects[entity.ownerId] : undefined;
        if (!entity || entity.kind !== 'entity' || owner?.kind !== 'block-record' || owner.payload.isSpace === true) continue;
        const members = definitionMembers.get(owner.id) ?? [];
        members.push(id);
        definitionMembers.set(owner.id, members);
    }
    for (const [definitionId, memberIds] of [
        ...definitionMembers
    ].sort(([a], [b])=>compareText(a, b))){
        if (!diagnostic) continue;
        const definition = state.objects[definitionId], instanceIds = instancesByDefinition.get(definitionId) ?? [];
        blockDefinitionInstances.push({
            blockRecordId: definitionId,
            definitionName: definition.name,
            affectedMemberIds: memberIds.sort(compareText),
            instanceIds,
            condition: 'instances-display-definition-after-member-removal',
            requiresCapabilityConfirmation: instanceIds.length > 0,
            expandedInstances: false
        });
    }
    const nativeCandidates = diagnostic ? requested.filter((entity)=>entity.kind === 'entity' && (entity.type === 'HATCH' || entity.type === 'INSERT')).map((entity)=>({
            id: entity.id,
            type: entity.type,
            structuralRole: entity.type === 'HATCH' ? 'region-fill' : 'block-instance',
            patternCandidate: {
                eligible: true,
                kind: entity.type === 'HATCH' ? 'region-fill' : 'symbol-candidate',
                inferredRole: null,
                boundaryRole: 'unassigned'
            },
            expandedGeometry: false
        })) : [];
    blockers.sort((a, b)=>compareText(a.kind, b.kind) || compareText(a.sourceId, b.sourceId) || compareText(a.dependentId ?? '', b.dependentId ?? ''));
    const result = {
        documentId: state.documentId,
        revision: state.revision,
        units: state.header.units,
        operation: 'erase',
        requestedIds,
        eraseRootIds: [
            ...rootIds
        ].sort(),
        effectiveEraseIds: [
            ...effectiveIds
        ].sort(),
        canErase: blockers.length === 0,
        blockers,
        designRelations,
        dimensions,
        leaderPairs: leaderPairs.sort((a, b)=>compareText(String(a.leaderId), String(b.leaderId))),
        hatchSourceReferences,
        selectionSets,
        insertAttachments,
        blockDefinitionInstances,
        nativeCandidates,
        connectivity: options.analyzeConnectivity === false || !diagnostic ? {
            semanticInference: 'none',
            status: 'skipped-for-core-reference-validation',
            before: {
                affectedComponents: []
            },
            after: {
                retainedComponents: []
            },
            disconnectCandidates: [],
            comparisons: 0,
            omittedNativeTypes: [
                'HATCH',
                'INSERT'
            ]
        } : connectivityImpact(objects, effectiveIds, query.tolerance),
        limits: {
            maxIds,
            maxObjects,
            scannedObjects: objects.length,
            maxReferences: KJDRAW_ERASE_IMPACT_LIMITS.maxReferences,
            references,
            maxConnectivityFeatures: KJDRAW_ERASE_IMPACT_LIMITS.maxConnectivityFeatures,
            maxConnectivityComparisons: KJDRAW_ERASE_IMPACT_LIMITS.maxConnectivityComparisons,
            maxBytes: query.maxBytes
        }
    };
    if (diagnostic && jsonBytes({
        ok: true,
        value: result
    }) > query.maxBytes) fail('Erase impact result exceeds maxBytes; query fewer IDs or increase maxBytes');
    if (document.revision !== state.revision) throw new KJRevisionConflictError(state.revision, document.revision);
    return deepFreeze(result);
}
