// Generated from agent-mechanical-structure-gate.ts by scripts/build-typescript.mjs. Do not edit directly.
export function auditMechanicalSheetStructure(source, candidate) {
    const named = (document, ids)=>new Map(ids.map((id)=>document.getObject(id)).filter((record)=>record && !record.erased).map((record)=>[
                String(record.name),
                record
            ]));
    const sourceLayouts = named(source, source.snapshot().spaces.layoutIds), candidateLayouts = named(candidate, candidate.snapshot().spaces.layoutIds);
    const sourceLayers = named(source, source.getTable('layers').records.filter((record)=>!record.erased).map((record)=>record.id));
    const candidateLayers = named(candidate, candidate.getTable('layers').records.filter((record)=>!record.erased).map((record)=>record.id));
    const fields = (a, b)=>[
            ...new Set([
                ...Object.keys(a),
                ...Object.keys(b)
            ])
        ].filter((key)=>JSON.stringify(a[key]) !== JSON.stringify(b[key])).length;
    const entityTypes = (document, owner)=>{
        const counts = {};
        if (typeof owner === 'string') for (const entity of document.listEntities({
            ownerId: owner
        }))counts[entity.type] = (counts[entity.type] ?? 0) + 1;
        return Object.entries(counts).sort(([a], [b])=>a.localeCompare(b));
    };
    const normalizeReferences = (document, value, key = '')=>{
        if (Array.isArray(value)) return value.map((item)=>normalizeReferences(document, item, key));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b])=>a.localeCompare(b)).map(([name, item])=>[
                name,
                normalizeReferences(document, item, name)
            ]));
        if (typeof value === 'string' && (key === 'layerId' || key === 'linetypeId' || key === 'styleId' || key === 'frozenLayerIds')) {
            const record = document.getObject(value);
            return record?.name == null ? value : `${record.kind}:${record.name}`;
        }
        return value;
    };
    const paperEntities = (document, owner)=>typeof owner === 'string' ? document.listEntities({
            ownerId: owner
        }).map((entity)=>JSON.stringify({
                type: entity.type,
                payload: normalizeReferences(document, entity.payload)
            })).sort() : [];
    const layouts = {
        source: sourceLayouts.size,
        candidate: candidateLayouts.size,
        missing: 0,
        extra: 0,
        plotFields: 0,
        paperEntityTypes: 0,
        paperEntitySemantics: 0,
        viewportFields: 0
    };
    const layers = {
        source: sourceLayers.size,
        candidate: candidateLayers.size,
        missing: 0,
        extra: 0,
        fields: 0
    };
    for (const [name, original] of sourceLayouts){
        const generated = candidateLayouts.get(name);
        if (!generated) {
            layouts.missing++;
            continue;
        }
        layouts.plotFields += fields(original.payload.dxfPlotSettings ?? {}, generated.payload.dxfPlotSettings ?? {});
        if (JSON.stringify(entityTypes(source, original.payload.blockRecordId)) !== JSON.stringify(entityTypes(candidate, generated.payload.blockRecordId))) layouts.paperEntityTypes++;
        if (JSON.stringify(paperEntities(source, original.payload.blockRecordId)) !== JSON.stringify(paperEntities(candidate, generated.payload.blockRecordId))) layouts.paperEntitySemantics++;
        const before = Array.isArray(original.payload.viewportIds) ? original.payload.viewportIds : [], after = Array.isArray(generated.payload.viewportIds) ? generated.payload.viewportIds : [];
        layouts.viewportFields += Math.abs(before.length - after.length);
        for(let index = 0; index < Math.min(before.length, after.length); index++)layouts.viewportFields += fields(normalizeReferences(source, source.getObject(String(before[index]))?.payload ?? {}), normalizeReferences(candidate, candidate.getObject(String(after[index]))?.payload ?? {}));
    }
    for (const name of candidateLayouts.keys())if (!sourceLayouts.has(name)) layouts.extra++;
    for (const [name, original] of sourceLayers){
        const generated = candidateLayers.get(name);
        if (!generated) {
            layers.missing++;
            continue;
        }
        layers.fields += fields(normalizeReferences(source, original.payload), normalizeReferences(candidate, generated.payload));
    }
    for (const name of candidateLayers.keys())if (!sourceLayers.has(name)) layers.extra++;
    return {
        passed: layouts.missing + layouts.extra + layouts.plotFields + layouts.paperEntityTypes + layouts.paperEntitySemantics + layouts.viewportFields + layers.missing + layers.extra + layers.fields === 0,
        layouts,
        layers
    };
}
