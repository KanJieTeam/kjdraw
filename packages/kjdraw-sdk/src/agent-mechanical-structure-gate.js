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
    const layouts = {
        source: sourceLayouts.size,
        candidate: candidateLayouts.size,
        missing: 0,
        extra: 0,
        plotFields: 0,
        paperEntityTypes: 0,
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
        const before = Array.isArray(original.payload.viewportIds) ? original.payload.viewportIds : [], after = Array.isArray(generated.payload.viewportIds) ? generated.payload.viewportIds : [];
        layouts.viewportFields += Math.abs(before.length - after.length);
        for(let index = 0; index < Math.min(before.length, after.length); index++)layouts.viewportFields += fields(source.getObject(String(before[index]))?.payload ?? {}, candidate.getObject(String(after[index]))?.payload ?? {});
    }
    for (const name of candidateLayouts.keys())if (!sourceLayouts.has(name)) layouts.extra++;
    for (const [name, original] of sourceLayers){
        const generated = candidateLayers.get(name);
        if (!generated) {
            layers.missing++;
            continue;
        }
        layers.fields += fields(original.payload, generated.payload);
    }
    for (const name of candidateLayers.keys())if (!sourceLayers.has(name)) layers.extra++;
    return {
        passed: layouts.missing + layouts.extra + layouts.plotFields + layouts.paperEntityTypes + layouts.viewportFields + layers.missing + layers.extra + layers.fields === 0,
        layouts,
        layers
    };
}
