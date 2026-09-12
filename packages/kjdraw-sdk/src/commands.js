// Generated from commands.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJRegistrationError, KJValidationError } from './errors.js';
import { validatePlotSettings } from './plot-settings.js';
import { createCommandEditScope } from './edit-policy.js';
import { applyRoadDrawingRevision } from './road-drawing-update.js';
import { entityArea2, entityLength2, distance2, dot2, reflectionAcrossLine3, rotationAround3, scaleAround3, transformEntityPayload, transformPoint3, translation3, vec2, subtract2 } from './geometry/index.js';
import { clone, deepFreeze, normalizeName, stableHash } from './utils.js';
import { editEntityGrip } from './grips.js';
import { intersectEntityPair2, nearestPointOnEntity2 } from './snapping.js';
import { KJ_SNAP_MODES } from './snapping.js';
import { breakEntityPayloads, chamferLinePair, editPolylinePayload, explodeEntity, extendEntityPayload, filletLinePair, joinEntityPayloads, lengthenEntityPayload, offsetEntityPayload, stretchEntityPayload, trimEntityPayloads } from './editing.js';
const AFFINE_ENTITY_TYPES = Object.freeze([
    'LINE',
    'RAY',
    'XLINE',
    'POINT',
    'CIRCLE',
    'ARC',
    'LWPOLYLINE',
    'POLYLINE',
    'WIPEOUT',
    'REVISION_CLOUD',
    'SPLINE',
    'ELLIPSE',
    'TEXT',
    'MTEXT',
    'ATTDEF',
    'ATTRIB',
    'INSERT',
    'IMAGE',
    'HATCH',
    'LEADER',
    'MLEADER',
    'DIMENSION',
    'VIEWPORT',
    'SOLID',
    'TRACE',
    'TABLE'
]);
export const KJ_CORE_COMMAND_CAPABILITIES = deepFreeze({
    UNDO: {
        domain: 'history'
    },
    REDO: {
        domain: 'history'
    },
    SELECT: {
        domain: 'selection',
        operations: [
            'replace',
            'add',
            'remove',
            'clear'
        ]
    },
    SELECTIONSAVE: {
        domain: 'selection',
        persistence: 'document-dictionary'
    },
    SELECTIONRESTORE: {
        domain: 'selection',
        persistence: 'document-dictionary'
    },
    CREATE: {
        domain: 'entity',
        supportedEntityTypes: '*'
    },
    CREATEBATCH: {
        domain: 'entity',
        supportedEntityTypes: '*',
        atomic: true,
        maximumEntities: 100000
    },
    ROAD_DRAWING_UPDATE: {
        domain: 'road-drawing',
        atomic: true,
        stableIds: true,
        requiresUnmodifiedPrevious: true
    },
    ERASE: {
        domain: 'object',
        supportedObjectKinds: '*'
    },
    RESTORE: {
        domain: 'object',
        supportedObjectKinds: '*'
    },
    PROPERTIES: {
        domain: 'object',
        supportedObjectKinds: '*'
    },
    SETVAR: {
        domain: 'document'
    },
    LAYERNEW: {
        domain: 'layer'
    },
    LAYERCURRENT: {
        domain: 'layer'
    },
    LAYERUPDATE: {
        domain: 'layer'
    },
    LAYERDELETE: {
        domain: 'layer',
        guard: 'referential-integrity'
    },
    MOVE: {
        domain: 'geometry',
        precision: 'exact',
        supportedEntityTypes: AFFINE_ENTITY_TYPES
    },
    ROTATE: {
        domain: 'geometry',
        precision: 'exact',
        supportedEntityTypes: AFFINE_ENTITY_TYPES
    },
    SCALE: {
        domain: 'geometry',
        precision: 'exact-uniform',
        supportedEntityTypes: AFFINE_ENTITY_TYPES
    },
    COPY: {
        domain: 'geometry',
        precision: 'exact',
        supportedEntityTypes: AFFINE_ENTITY_TYPES
    },
    MIRROR: {
        domain: 'geometry',
        precision: 'exact',
        supportedEntityTypes: AFFINE_ENTITY_TYPES
    },
    ARRAYRECT: {
        domain: 'geometry',
        precision: 'exact',
        supportedEntityTypes: AFFINE_ENTITY_TYPES
    },
    ARRAYPOLAR: {
        domain: 'geometry',
        precision: 'exact',
        supportedEntityTypes: AFFINE_ENTITY_TYPES
    },
    OFFSET: {
        domain: 'geometry',
        precision: 'exact',
        supportedEntityTypes: [
            'LINE',
            'RAY',
            'XLINE',
            'CIRCLE',
            'ARC'
        ]
    },
    BREAK: {
        domain: 'topology',
        precision: 'exact',
        supportedEntityTypes: [
            'LINE',
            'ARC'
        ]
    },
    JOIN: {
        domain: 'topology',
        precision: 'exact',
        supportedEntityTypes: [
            'LINE',
            'ARC',
            'LWPOLYLINE',
            'POLYLINE'
        ],
        maximumEntities: 4096
    },
    EXPLODE: {
        domain: 'topology',
        precision: 'exact',
        supportedEntityTypes: [
            'LWPOLYLINE',
            'POLYLINE',
            'REVISION_CLOUD',
            'WIPEOUT'
        ]
    },
    TRIM: {
        domain: 'topology',
        precision: 'exact',
        targetEntityTypes: [
            'LINE',
            'ARC',
            'CIRCLE'
        ],
        boundaryEntityTypes: [
            'LINE',
            'RAY',
            'XLINE',
            'CIRCLE',
            'ARC'
        ]
    },
    EXTEND: {
        domain: 'topology',
        precision: 'exact',
        targetEntityTypes: [
            'LINE',
            'ARC'
        ],
        boundaryEntityTypes: [
            'LINE',
            'RAY',
            'XLINE',
            'CIRCLE',
            'ARC'
        ]
    },
    LENGTHEN: {
        domain: 'topology',
        precision: 'exact',
        supportedEntityTypes: [
            'LINE',
            'ARC'
        ],
        modes: [
            'TOTAL',
            'DELTA',
            'PERCENT',
            'DYNAMIC'
        ],
        stableIdentity: true
    },
    STRETCH: {
        domain: 'topology',
        precision: 'exact',
        supportedEntityTypes: [
            'LINE',
            'LWPOLYLINE',
            'POLYLINE'
        ],
        selection: 'crossing-window',
        maximumEntities: 4096,
        stableIdentity: true
    },
    PEDIT: {
        domain: 'topology',
        precision: 'exact',
        supportedEntityTypes: [
            'LWPOLYLINE',
            'POLYLINE'
        ],
        operations: [
            'INSERT',
            'DELETE',
            'SET_BULGE'
        ],
        stableIdentity: true
    },
    CHAMFER: {
        domain: 'topology',
        precision: 'exact',
        supportedEntityTypes: [
            'LINE'
        ]
    },
    FILLET: {
        domain: 'topology',
        precision: 'exact',
        supportedEntityTypes: [
            'LINE'
        ]
    },
    GRIPEDIT: {
        domain: 'geometry',
        precision: 'exact',
        supportedEntityTypes: AFFINE_ENTITY_TYPES
    },
    LENGTH: {
        domain: 'measurement',
        exactEntityTypes: [
            'LINE',
            'RAY',
            'XLINE',
            'CIRCLE',
            'ARC',
            'LWPOLYLINE',
            'POLYLINE',
            'ELLIPSE',
            'SOLID',
            'TRACE'
        ],
        approximateEntityTypes: [
            'SPLINE'
        ]
    },
    AREA: {
        domain: 'measurement',
        exactEntityTypes: [
            'CIRCLE',
            'ELLIPSE',
            'LWPOLYLINE',
            'POLYLINE',
            'SOLID',
            'TRACE'
        ]
    },
    DISTANCE: {
        domain: 'measurement',
        precision: 'exact',
        modes: [
            'point-point',
            'point-entity'
        ],
        supportedEntityTypes: [
            'LINE',
            'RAY',
            'XLINE',
            'CIRCLE',
            'ARC',
            'LWPOLYLINE',
            'POLYLINE'
        ]
    },
    ANGLE: {
        domain: 'measurement',
        precision: 'exact',
        modes: [
            'vectors',
            'three-points'
        ]
    },
    INTERSECT: {
        domain: 'geometry-query',
        precision: 'exact',
        supportedEntityTypes: [
            'LINE',
            'RAY',
            'XLINE',
            'CIRCLE',
            'ARC',
            'LWPOLYLINE',
            'POLYLINE'
        ]
    },
    NEAREST: {
        domain: 'geometry-query',
        precision: 'exact',
        supportedEntityTypes: [
            'LINE',
            'RAY',
            'XLINE',
            'CIRCLE',
            'ARC',
            'LWPOLYLINE',
            'POLYLINE'
        ]
    },
    ORTHO: {
        domain: 'drafting-settings',
        systemVariable: 'ORTHOMODE'
    },
    SNAPSETTINGS: {
        domain: 'drafting-settings',
        snapModes: KJ_SNAP_MODES
    },
    BLOCKCREATE: {
        domain: 'block',
        precision: 'exact',
        supportedEntityTypes: AFFINE_ENTITY_TYPES
    },
    BLOCKINSERT: {
        domain: 'block',
        entityType: 'INSERT'
    },
    XREFATTACH: {
        domain: 'external-reference',
        authority: 'local-file-or-project-asset',
        remoteUrls: false
    },
    XREFRELOAD: {
        domain: 'external-reference',
        authority: 'local-file-or-project-asset'
    },
    XREFDETACH: {
        domain: 'external-reference'
    },
    GROUP: {
        domain: 'group',
        persistence: 'document-dictionary'
    },
    HATCH: {
        domain: 'entity',
        entityType: 'HATCH',
        boundaryModes: [
            'polyline',
            'line-arc-edges'
        ]
    },
    LINETYPE: {
        domain: 'table',
        table: 'linetypes',
        operations: [
            'create',
            'update'
        ]
    },
    TEXTSTYLE: {
        domain: 'table',
        table: 'textStyles',
        operations: [
            'create',
            'update'
        ]
    },
    DIMSTYLE: {
        domain: 'table',
        table: 'dimensionStyles',
        operations: [
            'create',
            'update'
        ]
    },
    UCS: {
        domain: 'table',
        table: 'ucs',
        operations: [
            'create',
            'update',
            'set-current'
        ]
    },
    LAYOUT: {
        domain: 'layout',
        operations: [
            'create',
            'set-current',
            'update'
        ]
    },
    VIEWPORT: {
        domain: 'layout',
        entityType: 'VIEWPORT',
        operations: [
            'create',
            'update'
        ]
    },
    PLOTSETUP: {
        domain: 'plot',
        persistence: 'layout',
        devices: [
            'pdf',
            'printer',
            'png'
        ]
    },
    PLOTSTYLE: {
        domain: 'plot',
        persistence: 'document-resource'
    },
    SEARCH: {
        domain: 'document-query',
        fields: [
            'id',
            'handle',
            'kind',
            'type',
            'name',
            'payload',
            'xdata'
        ]
    },
    COMPARE: {
        domain: 'document-query',
        identity: 'cad-handle',
        classifications: [
            'added',
            'removed',
            'changed',
            'unchanged'
        ]
    },
    SOLIDBOX: {
        domain: 'solid3d',
        authority: 'kjcore-rust-wasm',
        operation: 'primitive'
    },
    SOLIDCYLINDER: {
        domain: 'solid3d',
        authority: 'kjcore-rust-wasm',
        operation: 'primitive'
    },
    SOLIDCONE: {
        domain: 'solid3d',
        authority: 'kjcore-rust-wasm',
        operation: 'primitive'
    },
    SOLIDSPHERE: {
        domain: 'solid3d',
        authority: 'kjcore-rust-wasm',
        operation: 'primitive'
    },
    SOLIDSWEEP: {
        domain: 'solid3d',
        authority: 'kjcore-rust-wasm',
        operation: 'sweep',
        profile: 'convex'
    },
    SOLIDLOFT: {
        domain: 'solid3d',
        authority: 'kjcore-rust-wasm',
        operation: 'loft',
        profile: 'matched-convex'
    },
    SOLIDTRANSFORM: {
        domain: 'solid3d',
        authority: 'kjcore-rust-wasm',
        operation: 'matrix4'
    },
    SOLIDBOOLEAN: {
        domain: 'solid3d',
        authority: 'kjcore-rust-wasm',
        operations: [
            'union',
            'intersection',
            'difference'
        ],
        exactScope: 'axis-aligned-box'
    },
    SOLIDVALIDATE: {
        domain: 'solid3d-analysis',
        authority: 'kjcore-rust-wasm',
        checks: [
            'finite',
            'degenerate-triangles',
            'boundary-edges',
            'non-manifold-edges',
            'edge-orientation',
            'signed-volume'
        ]
    },
    SOLIDVOLUME: {
        domain: 'solid3d-analysis',
        authority: 'kjcore-rust-wasm',
        precision: 'exact-mesh'
    }
});
export class KJCommandRegistry {
    #commands = new Map();
    register(definition, { owner = 'application', replace = false } = {}) {
        const id = String(definition?.id ?? '').trim().toUpperCase();
        if (!id || typeof definition?.execute !== 'function') throw new KJRegistrationError('Command requires id and execute');
        if (this.#commands.has(id) && !replace) throw new KJRegistrationError(`Command already registered: ${id}`);
        const commandBase = {
            title: id,
            transactional: true,
            aliases: [],
            capabilities: {},
            ...definition
        };
        const command = deepFreeze({
            ...commandBase,
            id,
            aliases: (definition.aliases ?? []).map((value)=>String(value).toUpperCase()),
            capabilities: clone(definition.capabilities ?? KJ_CORE_COMMAND_CAPABILITIES[id] ?? {}),
            owner: String(owner)
        });
        const keys = [
            id,
            ...command.aliases
        ];
        const conflict = keys.find((key)=>this.#commands.has(key) && !replace);
        if (conflict) throw new KJRegistrationError(`Command or alias already registered: ${conflict}`);
        for (const key of keys)this.#commands.set(key, command);
        return ()=>{
            let removed = false;
            for (const [key, value] of this.#commands)if (value === command) {
                this.#commands.delete(key);
                removed = true;
            }
            return removed;
        };
    }
    resolve(id) {
        return this.#commands.get(String(id).trim().toUpperCase()) ?? null;
    }
    list() {
        return [
            ...new Set(this.#commands.values())
        ];
    }
    removeOwner(owner) {
        const targets = new Set([
            ...this.#commands.values()
        ].filter((command)=>command.owner === owner));
        for (const [key, command] of this.#commands)if (targets.has(command)) this.#commands.delete(key);
        return targets.size;
    }
    async execute(id, context = {}, args = {}) {
        const command = this.resolve(id);
        if (!command) throw new KJValidationError(`Unknown command: ${id}`);
        if (command.id === 'CREATEBATCH' && command.owner === '@kanjieteam/kjdraw' && Object.hasOwn(args, 'resources')) validateCommandData(args);
        if (command.id === 'ROAD_DRAWING_UPDATE' && command.owner === '@kanjieteam/kjdraw') validateCommandData(args, 'ROAD_DRAWING_UPDATE');
        if (command.canExecute && !await command.canExecute(context, clone(args))) throw new KJValidationError(`Command is not available: ${command.id}`);
        if (command.transactional === false) return command.execute({
            ...context,
            transaction: null
        }, clone(args));
        if (!context.document) throw new KJValidationError(`Command ${command.id} requires a document`);
        return context.document.transact(command.title ?? command.id, async (transaction)=>{
            const scope = createCommandEditScope(transaction, command.id);
            const result = await command.execute({
                ...context,
                transaction: scope.transaction
            }, clone(args));
            scope.validate();
            return result;
        }, {
            author: context.author,
            source: `command:${command.id}`,
            expectedRevision: context.expectedRevision,
            metadata: {
                commandId: command.id,
                ...[
                    'TRIM',
                    'EXTEND'
                ].includes(command.id) ? {
                    commandArgumentsDigest: stableHash(args)
                } : {},
                commandEnvelopeId: context.commandEnvelope?.id ?? null,
                commandProtocol: context.commandEnvelope ? `${context.commandEnvelope.schema}@${context.commandEnvelope.schemaVersion}` : null,
                commandOrigin: context.commandEnvelope?.origin ?? null
            }
        });
    }
}
export function registerCoreCommands(registry) {
    const disposers = [];
    disposers.push(registry.register({
        id: 'ROAD_DRAWING_UPDATE',
        title: 'Update road drawing',
        transactional: false,
        execute: ({ document, expectedRevision }, args)=>{
            if (!document) throw new KJValidationError('ROAD_DRAWING_UPDATE requires a document');
            if (Object.keys(args).length !== 2 || !Object.hasOwn(args, 'previous') || !Object.hasOwn(args, 'next')) throw new KJValidationError('ROAD_DRAWING_UPDATE requires exactly previous and next compiled drawings');
            return applyRoadDrawingRevision(document, args.previous, args.next, {
                expectedRevision: expectedRevision ?? document.revision
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'UNDO',
        aliases: [
            'U'
        ],
        title: 'Undo',
        transactional: false,
        execute: ({ document, expectedRevision }, args)=>document.undo({
                author: args.author,
                source: 'command:UNDO',
                expectedRevision
            })
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'REDO',
        title: 'Redo',
        transactional: false,
        execute: ({ document, expectedRevision }, args)=>document.redo({
                author: args.author,
                source: 'command:REDO',
                expectedRevision
            })
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'SELECT',
        title: 'Update selection',
        transactional: false,
        execute: ({ sdk, document }, args)=>{
            const selection = sdk.getSelectionManager(document.id)?.active;
            if (!selection) throw new KJValidationError('Selection manager is unavailable');
            const ids = args.ids ?? (args.id == null ? [] : [
                args.id
            ]);
            const operation = String(args.operation ?? 'replace').toLowerCase();
            if (operation === 'replace') selection.replace(ids);
            else if (operation === 'add') selection.add(ids);
            else if (operation === 'remove') selection.remove(ids);
            else if (operation === 'clear') selection.clear();
            else throw new KJValidationError(`Unknown selection operation: ${operation}`);
            return selection.ids;
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'SELECTIONSAVE',
        title: 'Save named selection',
        transactional: false,
        execute: ({ sdk, document }, args)=>{
            const manager = sdk.getSelectionManager(document.id);
            if (!manager) throw new KJValidationError('Selection manager is unavailable');
            return manager.saveNamed(args.name, {
                ids: args.ids ?? manager.active.ids,
                description: args.description
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'SELECTIONRESTORE',
        title: 'Restore named selection',
        transactional: false,
        execute: ({ sdk, document }, args)=>{
            const manager = sdk.getSelectionManager(document.id);
            if (!manager) throw new KJValidationError('Selection manager is unavailable');
            return manager.loadNamed(args.name, {
                append: Boolean(args.append)
            }).ids;
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'CREATE',
        title: 'Create entity',
        execute: ({ transaction }, args)=>transaction.createEntity(args.type, args.payload, args.options)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'CREATEBATCH',
        title: 'Create entity batch',
        execute: (context, args)=>createEntityBatch(context, args)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'ERASE',
        aliases: [
            'DELETE'
        ],
        title: 'Erase objects',
        execute: ({ document, transaction }, args)=>compoundRootIds(document, (args.ids ?? [
                args.id
            ]).filter(Boolean).map(String)).map((id)=>transaction.eraseObject(id))
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'RESTORE',
        title: 'Restore objects',
        execute: ({ document, transaction }, args)=>compoundRootIds(document, (args.ids ?? [
                args.id
            ]).filter(Boolean).map(String)).map((id)=>transaction.restoreObject(id))
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'PROPERTIES',
        title: 'Update object properties',
        execute: ({ transaction }, args)=>transaction.updateObject(args.id, args.patch)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'SETVAR',
        title: 'Set system variable',
        execute: ({ transaction }, args)=>transaction.setSystemVariable(args.name, args.value)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'ORTHO',
        title: 'Set orthogonal drafting mode',
        execute: ({ transaction }, args)=>transaction.setSystemVariable('ORTHOMODE', args.enabled === false || Number(args.enabled) === 0 ? 0 : 1)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'SNAPSETTINGS',
        title: 'Set object snap modes',
        execute: ({ transaction }, args)=>{
            const modes = [
                ...new Set((args.modes ?? []).map((value)=>String(value).toLowerCase()))
            ];
            for (const mode of modes)if (!KJ_SNAP_MODES.includes(mode)) throw new KJValidationError(`Unsupported snap mode: ${mode}`);
            const radius = Number(args.radius ?? 12);
            if (!(radius > 0) || !Number.isFinite(radius)) throw new KJValidationError('Snap radius must be a positive finite number');
            transaction.setSystemVariable('OSMODE', modes);
            transaction.setSystemVariable('APERTURE', radius);
            return {
                modes,
                radius
            };
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'LAYERNEW',
        title: 'Create layer',
        execute: ({ document, transaction }, args)=>transaction.upsertTableRecord('layers', {
                name: args.name,
                type: 'LAYER',
                payload: {
                    color: args.color ?? 7,
                    linetypeId: args.linetypeId ?? document.snapshot().tables.linetypes.currentId,
                    lineweight: args.lineweight ?? -1,
                    visible: args.visible !== false,
                    frozen: Boolean(args.frozen),
                    locked: Boolean(args.locked),
                    plottable: args.plottable !== false
                }
            })
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'LAYERCURRENT',
        title: 'Set current layer',
        execute: ({ document, transaction }, args)=>transaction.setCurrentTableRecord('layers', resolveTableRecord(document, 'layers', args.id ?? args.name).id)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'LAYERUPDATE',
        title: 'Update layer',
        execute: ({ document, transaction }, args)=>{
            const record = resolveTableRecord(document, 'layers', args.id ?? args.name);
            return transaction.updateObject(record.id, {
                name: args.newName ?? record.name,
                payload: {
                    ...args.patch
                }
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'LAYERDELETE',
        title: 'Delete layer',
        execute: ({ document, transaction }, args)=>transaction.removeTableRecord('layers', resolveTableRecord(document, 'layers', args.id ?? args.name).id)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'BLOCKCREATE',
        aliases: [
            'BLOCK',
            'B'
        ],
        title: 'Create block definition',
        execute: (context, args)=>createBlockDefinition(context, args)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'BLOCKINSERT',
        aliases: [
            'INSERT'
        ],
        title: 'Insert block reference',
        execute: ({ document, transaction }, args)=>{
            const record = resolveTableRecord(document, 'blockRecords', args.blockRecordId ?? args.id ?? args.name);
            if (record.payload?.isSpace) throw new KJValidationError('Model and paper spaces cannot be inserted as blocks');
            return transaction.createEntity('INSERT', {
                blockRecordId: record.id,
                position: args.position ?? [
                    0,
                    0,
                    0
                ],
                scale: args.scale ?? 1,
                rotation: args.rotation ?? 0,
                attributes: args.attributes ?? {},
                layerId: args.layerId
            }, {
                ownerId: args.ownerId
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'XREFATTACH',
        aliases: [
            'XATTACH'
        ],
        title: 'Attach local external reference',
        execute: ({ transaction }, args)=>{
            const id = String(args.id ?? args.name ?? '').trim();
            if (!id) throw new KJValidationError('External reference id is required');
            const source = normalizeExternalReferenceSource(args.source ?? args);
            return transaction.putResource('externalReferences', id, {
                id,
                name: String(args.name ?? id),
                source,
                referenceType: String(args.referenceType ?? 'overlay').toLowerCase(),
                insertionPoint: vec3(args.insertionPoint ?? [
                    0,
                    0,
                    0
                ], 'insertionPoint'),
                scale: normalizeXrefScale(args.scale),
                rotation: Number(args.rotation ?? 0),
                sha256: args.sha256 == null ? null : String(args.sha256).toLowerCase(),
                status: 'unresolved'
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'XREFRELOAD',
        title: 'Update local external reference status',
        execute: ({ document, transaction }, args)=>{
            const id = String(args.id ?? '');
            const current = document.snapshot().resources.externalReferences?.[id];
            if (!current) throw new KJValidationError(`External reference does not exist: ${id}`);
            return transaction.putResource('externalReferences', id, {
                ...current,
                sha256: args.sha256 == null ? current.sha256 : String(args.sha256).toLowerCase(),
                status: String(args.status ?? 'loaded').toLowerCase(),
                checkedAt: args.checkedAt ?? null
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'XREFDETACH',
        aliases: [
            'XDETACH'
        ],
        title: 'Detach external reference',
        execute: ({ transaction }, args)=>transaction.removeResource('externalReferences', String(args.id ?? ''))
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'GROUP',
        aliases: [
            'G'
        ],
        title: 'Create object group',
        execute: ({ document, transaction }, args)=>createObjectGroup(document, transaction, args)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'HATCH',
        aliases: [
            'H'
        ],
        title: 'Create hatch',
        execute: ({ transaction }, args)=>transaction.createEntity('HATCH', {
                boundaryLoops: args.boundaryLoops,
                patternName: args.patternName ?? 'SOLID',
                patternScale: args.patternScale ?? 1,
                patternAngle: args.patternAngle ?? 0,
                solid: args.solid,
                layerId: args.layerId
            }, {
                ownerId: args.ownerId
            })
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'LINETYPE',
        aliases: [
            'LT'
        ],
        title: 'Create or update linetype',
        execute: ({ transaction }, args)=>transaction.upsertTableRecord('linetypes', {
                name: args.name,
                type: 'LINETYPE',
                payload: {
                    description: args.description ?? '',
                    pattern: clone(args.pattern ?? [])
                }
            })
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'TEXTSTYLE',
        aliases: [
            'STYLE'
        ],
        title: 'Create or update text style',
        execute: ({ transaction }, args)=>transaction.upsertTableRecord('textStyles', {
                name: args.name,
                type: 'TEXT_STYLE',
                payload: {
                    fontFamily: String(args.fontFamily ?? 'sans-serif'),
                    fontFile: args.fontFile ?? null,
                    bigFontFile: args.bigFontFile ?? null,
                    fixedHeight: Number(args.fixedHeight ?? 0),
                    widthFactor: Number(args.widthFactor ?? 1),
                    obliqueAngle: Number(args.obliqueAngle ?? 0)
                }
            })
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'DIMSTYLE',
        aliases: [
            'D'
        ],
        title: 'Create or update dimension style',
        execute: ({ transaction }, args)=>transaction.upsertTableRecord('dimensionStyles', {
                name: args.name,
                type: 'DIM_STYLE',
                payload: clone(args.properties ?? args.payload ?? {})
            })
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'UCS',
        title: 'Create, update or activate UCS',
        execute: ({ document, transaction }, args)=>{
            if (String(args.operation ?? 'upsert').toLowerCase() === 'set-current') return transaction.setCurrentTableRecord('ucs', resolveTableRecord(document, 'ucs', args.id ?? args.name).id);
            return transaction.upsertTableRecord('ucs', {
                name: args.name,
                type: 'UCS',
                payload: {
                    origin: args.origin ?? [
                        0,
                        0,
                        0
                    ],
                    xAxis: args.xAxis ?? [
                        1,
                        0,
                        0
                    ],
                    yAxis: args.yAxis ?? [
                        0,
                        1,
                        0
                    ]
                }
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'LAYOUT',
        title: 'Create or activate layout',
        execute: ({ document, transaction }, args)=>{
            const operation = String(args.operation ?? 'create').toLowerCase();
            if (operation === 'create') return transaction.createLayout(args);
            if (operation === 'set-current') return transaction.setActiveLayout(resolveLayout(document, args.id ?? args.name).id);
            if (operation === 'update') {
                const layout = resolveLayout(document, args.id ?? args.name);
                return transaction.updateObject(layout.id, {
                    name: args.newName ?? layout.name,
                    payload: clone(args.patch ?? {})
                });
            }
            throw new KJValidationError(`Unsupported layout operation: ${operation}`);
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'VIEWPORT',
        aliases: [
            'MVIEW'
        ],
        title: 'Create paper-space viewport',
        execute: ({ document, transaction }, args)=>{
            const operation = String(args.operation ?? 'create').toLowerCase();
            if (operation === 'update') {
                const viewport = requiredEntity(document, args.id);
                if (viewport.type !== 'VIEWPORT') throw new KJValidationError(`Entity is not a viewport: ${args.id}`);
                return transaction.updateObject(viewport.id, {
                    payload: clone(args.patch ?? {})
                });
            }
            const layout = resolveLayout(document, args.layoutId ?? args.layoutName ?? document.spaces.activeLayoutId);
            const ownerId = args.ownerId ?? layout.payload.blockRecordId;
            const viewport = transaction.createEntity('VIEWPORT', {
                center: args.center,
                width: args.width,
                height: args.height,
                viewCenter: args.viewCenter ?? [
                    0,
                    0,
                    0
                ],
                viewHeight: args.viewHeight,
                twistAngle: args.twistAngle ?? 0,
                frozenLayerIds: args.frozenLayerIds ?? [],
                layerId: args.layerId
            }, {
                ownerId
            });
            transaction.updateObject(layout.id, {
                payload: {
                    viewportIds: [
                        ...layout.payload.viewportIds ?? [],
                        viewport.id
                    ]
                }
            });
            return viewport;
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'PLOTSETUP',
        aliases: [
            'PAGESETUP'
        ],
        title: 'Configure layout plotting',
        execute: ({ document, transaction }, args)=>{
            const layout = resolveLayout(document, args.layoutId ?? args.layoutName ?? document.spaces.activeLayoutId);
            if (args.dxf !== undefined) {
                validatePlotSettings(args.dxf);
                if (args.settings !== undefined) throw new KJValidationError('PLOTSETUP cannot mix dxf and native settings');
                const settings = {
                    ...layout.payload.dxfPlotSettings,
                    ...args.dxf
                };
                const changed = Object.keys(args.dxf);
                if (settings.plotType === 4 && changed.some((key)=>[
                        'plotType',
                        'windowMinX',
                        'windowMinY',
                        'windowMaxX',
                        'windowMaxY'
                    ].includes(key))) {
                    const { windowMinX: x0, windowMinY: y0, windowMaxX: x1, windowMaxY: y1 } = settings;
                    if (![
                        x0,
                        y0,
                        x1,
                        y1
                    ].every((value)=>typeof value === 'number' && Number.isFinite(value)) || !(x1 > x0 && y1 > y0)) throw new KJValidationError('Plot window requires four finite coordinates and positive width and height');
                }
                if (settings.plotType === 3 && changed.some((key)=>key === 'plotType' || key === 'viewName') && !settings.viewName?.trim()) throw new KJValidationError('Named-view plotting requires a view name');
                return transaction.updateObject(layout.id, {
                    payload: {
                        dxfPlotSettings: settings
                    }
                });
            }
            const settings = normalizePlotSettings(args.settings ?? args);
            if (settings.plotStyleId && !document.snapshot().resources.plotStyles?.[settings.plotStyleId]) throw new KJValidationError(`Plot style does not exist: ${settings.plotStyleId}`);
            return transaction.updateObject(layout.id, {
                payload: {
                    plotSettings: settings
                }
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'PLOTSTYLE',
        title: 'Create or update plot style',
        execute: ({ transaction }, args)=>{
            const id = String(args.id ?? args.name ?? '').trim();
            if (!id) throw new KJValidationError('Plot style id is required');
            return transaction.putResource('plotStyles', id, {
                id,
                name: String(args.name ?? id),
                mode: String(args.mode ?? 'color-dependent'),
                mappings: clone(args.mappings ?? {})
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'SEARCH',
        aliases: [
            'FIND'
        ],
        title: 'Search drawing information',
        transactional: false,
        execute: ({ document }, args)=>searchDocument(document, args)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'COMPARE',
        aliases: [
            'DWGCOMPARE'
        ],
        title: 'Compare drawings by CAD handle',
        transactional: false,
        execute: ({ document }, args)=>compareDocuments(document, args.otherDocument ?? args.other)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    for (const [id, method, title] of [
        [
            'SOLIDBOX',
            'box',
            'Create authoritative box'
        ],
        [
            'SOLIDCYLINDER',
            'cylinder',
            'Create authoritative cylinder'
        ],
        [
            'SOLIDCONE',
            'cone',
            'Create authoritative cone'
        ],
        [
            'SOLIDSPHERE',
            'sphere',
            'Create authoritative sphere'
        ],
        [
            'SOLIDSWEEP',
            'sweep',
            'Sweep authoritative solid'
        ],
        [
            'SOLIDLOFT',
            'loft',
            'Loft authoritative solid'
        ]
    ])disposers.push(registry.register({
        id,
        title,
        execute: (context, args)=>createAuthoritativeSolid(context, args, method)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'SOLIDTRANSFORM',
        title: 'Transform authoritative solid',
        execute: ({ sdk, document, transaction }, args)=>{
            const entity = requiredSolidEntity(document, args.id), source = openSolid(sdk, entity), result = source.transform(args.matrix);
            try {
                return transaction.updateObject(entity.id, {
                    payload: solidPayload(result, {
                        layerId: entity.payload.layerId
                    })
                });
            } finally{
                result.close();
                source.close();
            }
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'SOLIDBOOLEAN',
        title: 'Boolean authoritative solids',
        execute: ({ sdk, document, transaction }, args)=>{
            const first = requiredSolidEntity(document, args.firstId), second = requiredSolidEntity(document, args.secondId), a = openSolid(sdk, first), b = openSolid(sdk, second), result = a.boolean(b, args.operation ?? 'union');
            try {
                const created = transaction.createEntity('SOLID3D', solidPayload(result, {
                    layerId: args.layerId ?? first.payload.layerId
                }), {
                    ownerId: args.ownerId ?? first.ownerId
                });
                if (args.eraseSources !== false) {
                    transaction.eraseObject(first.id);
                    transaction.eraseObject(second.id);
                }
                return created;
            } finally{
                result.close();
                a.close();
                b.close();
            }
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'SOLIDVALIDATE',
        title: 'Validate authoritative solid',
        transactional: false,
        execute: ({ sdk, document }, args)=>{
            const entity = requiredSolidEntity(document, args.id), solid = openSolid(sdk, entity);
            try {
                solid.validate();
                return solid.serialize().validation;
            } finally{
                solid.close();
            }
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'SOLIDVOLUME',
        title: 'Measure authoritative solid volume',
        transactional: false,
        execute: ({ sdk, document }, args)=>{
            const entity = requiredSolidEntity(document, args.id), solid = openSolid(sdk, entity);
            try {
                return {
                    id: entity.id,
                    volume: solid.volume,
                    kernelAuthority: 'kjcore-rust-wasm'
                };
            } finally{
                solid.close();
            }
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'MOVE',
        aliases: [
            'M'
        ],
        title: 'Move objects',
        execute: (context, args)=>transformExisting(context, args, moveMatrix(args))
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'ROTATE',
        aliases: [
            'RO'
        ],
        title: 'Rotate objects',
        execute: (context, args)=>transformExisting(context, args, rotationAround3(commandAngle(args), vec2(args.center ?? args.basePoint ?? [
                0,
                0
            ])))
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'SCALE',
        aliases: [
            'SC'
        ],
        title: 'Scale objects',
        execute: (context, args)=>{
            const factor = Number(args.factor);
            if (!Number.isFinite(factor) || factor === 0) throw new KJValidationError('Scale factor must be a finite non-zero number');
            return transformExisting(context, args, scaleAround3(factor, factor, vec2(args.center ?? args.basePoint ?? [
                0,
                0
            ])));
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'COPY',
        aliases: [
            'CO',
            'CP'
        ],
        title: 'Copy objects',
        execute: (context, args)=>copyEntities(context, args, moveMatrix(args))
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'MIRROR',
        aliases: [
            'MI'
        ],
        title: 'Mirror objects',
        execute: (context, args)=>{
            rejectAttachedReorganization(context.document, args, 'MIRROR');
            const matrix = reflectionAcrossLine3(args.lineStart ?? args.start, args.lineEnd ?? args.end);
            const copies = copyEntities(context, args, matrix);
            if (args.eraseSource) for (const id of entityIds(args))context.transaction.eraseObject(id);
            return copies;
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'ARRAYRECT',
        aliases: [
            'ARRAYRECTANGULAR'
        ],
        title: 'Rectangular array',
        execute: (context, args)=>rectangularArray(context, args)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'ARRAYPOLAR',
        aliases: [
            'POLARARRAY'
        ],
        title: 'Polar array',
        execute: (context, args)=>polarArray(context, args)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'OFFSET',
        aliases: [
            'O'
        ],
        title: 'Offset entity',
        execute: ({ document, transaction }, args)=>{
            const entity = requiredEntity(document, args.id);
            return createDerived(transaction, entity, entity.type, {
                ...offsetEntityPayload(entity, args.distance, args),
                ...clone(args.payloadPatch ?? {})
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'BREAK',
        aliases: [
            'BR'
        ],
        title: 'Break entity',
        execute: ({ document, transaction }, args)=>{
            const entity = requiredEntity(document, args.id), pieces = breakEntityPayloads(entity, args);
            transaction.eraseObject(entity.id);
            const derived = pieces.map((piece)=>createDerived(transaction, entity, piece.type, piece.payload));
            replaceEntityMemberships(transaction, [
                entity.id
            ], derived.map((piece)=>piece.id));
            return derived;
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'JOIN',
        aliases: [
            'J'
        ],
        title: 'Join entities',
        execute: ({ document, transaction }, args)=>{
            const rawIds = args.ids ?? (args.id == null ? [] : [
                args.id
            ]);
            if (!Array.isArray(rawIds) || rawIds.length < 2) throw new KJValidationError('JOIN requires at least two entity ids');
            const ids = rawIds.map(String);
            if (new Set(ids).size !== ids.length) throw new KJValidationError('JOIN entity ids must be unique');
            const primaryId = String(args.id ?? ids[0]);
            if (!ids.includes(primaryId)) throw new KJValidationError('JOIN primary entity must be included in ids');
            const entities = ids.map((id)=>requiredEntity(document, id));
            if (entities.some((entity)=>entity.ownerId !== entities[0].ownerId)) throw new KJValidationError('JOIN entities must share one drawing space');
            rejectAttachedReorganization(document, {
                ids
            }, 'JOIN');
            const result = joinEntityPayloads(entities, {
                tolerance: args.tolerance,
                primaryId
            });
            const primary = entities.find((entity)=>entity.id === primaryId);
            let joined;
            if (result.type === primary.type) joined = transaction.updateObject(primary.id, {
                payload: result.payload
            });
            else joined = createDerived(transaction, primary, result.type, result.payload);
            for (const entity of entities)if (entity.id !== joined.id) transaction.eraseObject(entity.id);
            replaceEntityMemberships(transaction, ids, [
                joined.id
            ]);
            return joined;
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'EXPLODE',
        aliases: [
            'X'
        ],
        title: 'Explode entity',
        execute: ({ document, transaction }, args)=>{
            const entity = requiredEntity(document, args.id), pieces = explodeEntity(entity);
            transaction.eraseObject(entity.id);
            const derived = pieces.map((piece)=>createDerived(transaction, entity, piece.type, piece.payload));
            replaceEntityMemberships(transaction, [
                entity.id
            ], derived.map((piece)=>piece.id));
            return derived;
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'TRIM',
        aliases: [
            'TR'
        ],
        title: 'Trim entity',
        execute: ({ document, transaction }, args)=>{
            const entity = requiredEntity(document, args.id), boundaries = requiredBoundaries(document, args.boundaryIds, entity.id);
            const pieces = trimEntityPayloads(entity, boundaries, args.pickPoint);
            const first = pieces[0];
            if (!first) throw new KJValidationError('Trim must retain a non-empty entity');
            let primary;
            if (first.type === entity.type) primary = transaction.updateObject(entity.id, {
                payload: first.payload
            });
            else {
                transaction.eraseObject(entity.id);
                primary = createDerived(transaction, entity, first.type, first.payload);
            }
            const retainedIds = [
                primary.id
            ];
            for (const piece of pieces.slice(1))retainedIds.push(createDerived(transaction, entity, piece.type, piece.payload).id);
            replaceEntityMemberships(transaction, [
                entity.id
            ], retainedIds);
            return primary;
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'EXTEND',
        aliases: [
            'EX'
        ],
        title: 'Extend entity',
        execute: ({ document, transaction }, args)=>{
            const entity = requiredEntity(document, args.id), boundaries = requiredBoundaries(document, args.boundaryIds, entity.id);
            return transaction.updateObject(entity.id, {
                payload: extendEntityPayload(entity, boundaries, args.pickPoint)
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'LENGTHEN',
        aliases: [
            'LEN'
        ],
        title: 'Lengthen entity',
        execute: ({ document, transaction }, args)=>{
            const entity = requiredEntity(document, args.id);
            return transaction.updateObject(entity.id, {
                payload: lengthenEntityPayload(entity, args)
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'STRETCH',
        aliases: [
            'S'
        ],
        title: 'Stretch vertices',
        execute: ({ document, transaction }, args)=>{
            const ids = entityIds(args);
            if (ids.length > 4096) throw new KJValidationError('STRETCH supports at most 4096 entities per operation');
            const updates = ids.map((id)=>{
                const entity = requiredEntity(document, id);
                return {
                    entity,
                    payload: stretchEntityPayload(entity, args)
                };
            }).filter((value)=>value.payload != null);
            if (!updates.length) throw new KJValidationError('STRETCH crossing window contains no editable vertices');
            return updates.map((value)=>transaction.updateObject(value.entity.id, {
                    payload: value.payload
                }));
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'PEDIT',
        aliases: [
            'PE',
            'POLYLINEEDIT'
        ],
        title: 'Edit polyline topology',
        execute: ({ document, transaction }, args)=>{
            const entity = requiredEntity(document, args.id);
            return transaction.updateObject(entity.id, {
                payload: editPolylinePayload(entity, args)
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'CHAMFER',
        aliases: [
            'CHA'
        ],
        title: 'Chamfer lines',
        execute: (context, args)=>editLinePair(context, args, chamferLinePair)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'FILLET',
        aliases: [
            'F'
        ],
        title: 'Fillet lines',
        execute: (context, args)=>editLinePair(context, args, filletLinePair)
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'GRIPEDIT',
        title: 'Edit entity grip',
        execute: ({ document, transaction }, args)=>{
            const entity = requiredEntity(document, args.id);
            return transaction.updateObject(entity.id, {
                payload: editEntityGrip(entity, args.gripId, args.point)
            });
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'LENGTH',
        aliases: [
            'LISTLENGTH'
        ],
        title: 'Measure entity length',
        transactional: false,
        execute: ({ document }, args)=>entityIds(args).map((id)=>({
                    id,
                    ...entityLength2(requiredEntity(document, id))
                }))
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'AREA',
        title: 'Measure entity area',
        transactional: false,
        execute: ({ document }, args)=>entityIds(args).map((id)=>({
                    id,
                    ...entityArea2(requiredEntity(document, id))
                }))
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'NEAREST',
        title: 'Nearest point on entity',
        transactional: false,
        execute: ({ document }, args)=>({
                id: String(args.id),
                ...nearestPointOnEntity2(requiredEntity(document, args.id), args.point)
            })
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'INTERSECT',
        aliases: [
            'INTERSECTION'
        ],
        title: 'Intersect entities',
        transactional: false,
        execute: ({ document }, args)=>({
                firstId: String(args.firstId),
                secondId: String(args.secondId),
                ...intersectEntityPair2(requiredEntity(document, args.firstId), requiredEntity(document, args.secondId))
            })
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'DISTANCE',
        aliases: [
            'DI',
            'DIST'
        ],
        title: 'Measure distance',
        transactional: false,
        execute: ({ document }, args)=>{
            const point = vec2(args.point ?? args.firstPoint, 'point');
            if (args.id != null) return {
                mode: 'point-entity',
                id: String(args.id),
                ...nearestPointOnEntity2(requiredEntity(document, args.id), point)
            };
            const second = vec2(args.secondPoint, 'secondPoint');
            return {
                mode: 'point-point',
                firstPoint: point,
                secondPoint: second,
                distance: distance2(point, second)
            };
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    disposers.push(registry.register({
        id: 'ANGLE',
        aliases: [
            'ANG'
        ],
        title: 'Measure angle',
        transactional: false,
        execute: (_context, args)=>{
            const first = args.vertex == null ? vec2(args.firstVector, 'firstVector') : subtract2(vec2(args.firstPoint, 'firstPoint'), vec2(args.vertex, 'vertex'));
            const second = args.vertex == null ? vec2(args.secondVector, 'secondVector') : subtract2(vec2(args.secondPoint, 'secondPoint'), vec2(args.vertex, 'vertex'));
            const firstLength = Math.hypot(...first), secondLength = Math.hypot(...second);
            if (firstLength <= 1e-15 || secondLength <= 1e-15) throw new KJValidationError('Angle vectors must be non-zero');
            const radians = Math.acos(Math.max(-1, Math.min(1, dot2(first, second) / (firstLength * secondLength))));
            return {
                radians,
                degrees: radians * 180 / Math.PI
            };
        }
    }, {
        owner: '@kanjieteam/kjdraw'
    }));
    return ()=>disposers.reverse().forEach((dispose)=>dispose());
}
function entityIds(args = {}) {
    const ids = args.ids ?? (args.id == null ? [] : [
        args.id
    ]);
    if (!Array.isArray(ids) || !ids.length) throw new KJValidationError('Command requires at least one entity id');
    return [
        ...new Set(ids.map(String))
    ];
}
function solidAuthority(sdk) {
    const authority = sdk?.solidAuthority;
    if (!authority || authority.authoritative !== true || typeof authority.openMesh !== 'function') throw new KJValidationError('KJCore Rust 三维权威内核未就绪');
    return authority;
}
function solidPayload(session, extra = {}) {
    const value = session.serialize();
    if (value?.validation?.valid !== true) throw new KJValidationError('KJCore returned an invalid solid');
    return {
        ...value,
        ...clone(extra),
        kernelAuthority: 'kjcore-rust-wasm',
        solidModelVersion: 1
    };
}
function createAuthoritativeSolid({ sdk, transaction }, args, method) {
    const authority = solidAuthority(sdk), factory = authority[method];
    if (typeof factory !== 'function') throw new KJValidationError(`KJCore solid operation is unavailable: ${method}`);
    const session = factory(args);
    try {
        return transaction.createEntity('SOLID3D', solidPayload(session, args.layerId == null ? {} : {
            layerId: args.layerId
        }), args.ownerId === undefined ? {} : {
            ownerId: args.ownerId
        });
    } finally{
        session.close();
    }
}
function requiredSolidEntity(document, id) {
    const entity = requiredEntity(document, id);
    if (entity.type !== 'SOLID3D') throw new KJValidationError(`Entity is not an authoritative SOLID3D: ${String(id)}`);
    return entity;
}
function openSolid(sdk, entity) {
    return solidAuthority(sdk).openMesh({
        vertices: entity.payload.vertices,
        triangles: entity.payload.triangles
    });
}
function vec3(value, label) {
    if (!Array.isArray(value) || value.length < 2) throw new KJValidationError(`${label} must be a 2D or 3D point`);
    const result = [
        Number(value[0]),
        Number(value[1]),
        Number(value[2] ?? 0)
    ];
    if (!result.every(Number.isFinite)) throw new KJValidationError(`${label} must contain finite coordinates`);
    return result;
}
function normalizeXrefScale(value = 1) {
    const result = Array.isArray(value) ? vec3(value.length === 2 ? [
        ...value,
        1
    ] : value, 'scale') : [
        Number(value),
        Number(value),
        Number(value)
    ];
    if (!result.every((component)=>Number.isFinite(component) && component !== 0)) throw new KJValidationError('External reference scale must be finite and non-zero');
    return result;
}
function normalizeExternalReferenceSource(value = {}) {
    const source = typeof value === 'string' ? {
        kind: 'local-file',
        path: value
    } : clone(value);
    const kind = String(source?.kind ?? (source?.assetPath ? 'project-asset' : 'local-file')).toLowerCase();
    const path = String(source?.path ?? source?.assetPath ?? '').replace(/\\/g, '/').trim();
    if (!path) throw new KJValidationError('External reference local path or project asset path is required');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) throw new KJValidationError('External references cannot use remote URLs');
    if (kind === 'project-asset') {
        const parts = path.split('/');
        if (!path.startsWith('assets/xrefs/') || parts.some((part)=>!part || part === '.' || part === '..')) throw new KJValidationError('Project external references must use a safe assets/xrefs/ path');
    } else if (kind !== 'local-file') throw new KJValidationError(`Unsupported external reference source: ${kind}`);
    return {
        kind,
        path
    };
}
function normalizePlotSettings(value = {}) {
    const device = String(value.device ?? 'pdf').toLowerCase();
    if (![
        'pdf',
        'printer',
        'png'
    ].includes(device)) throw new KJValidationError(`Unsupported plot device: ${device}`);
    const area = String(value.area ?? 'layout').toLowerCase();
    if (![
        'layout',
        'display',
        'extents',
        'window'
    ].includes(area)) throw new KJValidationError(`Unsupported plot area: ${area}`);
    const rotation = Number(value.rotation ?? 0);
    if (![
        0,
        90,
        180,
        270
    ].includes(rotation)) throw new KJValidationError('Plot rotation must be 0, 90, 180 or 270 degrees');
    const scale = value.scale === 'fit' || value.fit === true ? {
        mode: 'fit'
    } : {
        mode: 'custom',
        numerator: Number(value.numerator ?? 1),
        denominator: Number(value.denominator ?? 1)
    };
    if (scale.mode === 'custom' && ![
        scale.numerator,
        scale.denominator
    ].every((number)=>Number.isFinite(number) && number > 0)) throw new KJValidationError('Custom plot scale must use positive finite values');
    const window = area === 'window' ? [
        vec3(value.window?.[0], 'plot window start'),
        vec3(value.window?.[1], 'plot window end')
    ] : null;
    return {
        device,
        media: String(value.media ?? 'ISO_A4'),
        area,
        window,
        scale,
        centered: value.centered !== false,
        rotation,
        plotStyleId: value.plotStyleId == null ? null : String(value.plotStyleId),
        lineweights: value.lineweights !== false,
        outputQualityDpi: Number(value.outputQualityDpi ?? 600)
    };
}
const BATCH_LINEWEIGHTS = new Set([
    -3,
    -2,
    -1,
    0,
    5,
    9,
    13,
    15,
    18,
    20,
    25,
    30,
    35,
    40,
    50,
    53,
    60,
    70,
    80,
    90,
    100,
    106,
    120,
    140,
    158,
    200,
    211
]);
function validateCommandData(input, label = 'CREATEBATCH resources') {
    let nodes = 0;
    const visit = (value, depth)=>{
        if (++nodes > 1000000 || depth > 32) throw new KJValidationError(`${label} exceeds the data traversal budget`);
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
        if (typeof value === 'number' && Number.isFinite(value)) return;
        if (!value || typeof value !== 'object') throw new KJValidationError(`${label} requires finite JSON data`);
        const array = Array.isArray(value);
        if (array ? Object.getPrototypeOf(value) !== Array.prototype : ![
            Object.prototype,
            null
        ].includes(Object.getPrototypeOf(value))) throw new KJValidationError(`${label} requires plain data objects and arrays`);
        for (const key of Reflect.ownKeys(value)){
            if (array && key === 'length') continue;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (typeof key !== 'string' || [
                '__proto__',
                'constructor',
                'prototype'
            ].includes(key) || !('value' in descriptor) || !descriptor.enumerable) throw new KJValidationError(`${label} rejects accessors and hidden or unsafe fields`);
            if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new KJValidationError(`${label} arrays reject custom properties`);
            visit(descriptor.value, depth + 1);
        }
        if (array) {
            for(let index = 0; index < value.length; index++)if (!Object.hasOwn(value, index)) throw new KJValidationError(`${label} arrays must be dense`);
        }
    };
    visit(input, 0);
}
function compoundRootIds(document, ids) {
    const selected = new Set(ids);
    return [
        ...selected
    ].filter((id)=>{
        const object = document.getObject(id, {
            includeErased: true
        });
        const parent = object?.payload.parentInsertId ?? (object?.type === 'SEQEND' ? object.ownerId : null);
        return !parent || !selected.has(parent);
    });
}
function createBatchResources(document, transaction, resources) {
    const fields = (value, expected)=>{
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== expected.length || expected.some((key)=>!Object.hasOwn(value, key))) throw new KJValidationError('CREATEBATCH resource fields do not match the declared format');
    };
    fields(resources, [
        'linetypes',
        'layers'
    ]);
    for (const group of [
        resources.linetypes,
        resources.layers
    ])if (!Array.isArray(group) || group.length > 16) throw new KJValidationError('CREATEBATCH resources allow at most 16 records per table');
    const ids = new Set(), linetypes = new Map(document.getTable('linetypes').records.filter((item)=>!item.erased).map((item)=>[
            item.id,
            item.name
        ]));
    const validateIdentity = (value, names)=>{
        if (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 256 || value.id !== value.id.trim() || /[\u0000-\u001f\u007f]/.test(value.id) || [
            '__proto__',
            'constructor',
            'prototype'
        ].includes(value.id)) throw new KJValidationError('CREATEBATCH resource IDs must be bounded nonempty data strings');
        if (ids.has(value.id) || Object.hasOwn(document.snapshot().objects, value.id)) throw new KJValidationError('CREATEBATCH resource IDs must be new and globally unique');
        if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 128 || value.name !== value.name.trim() || /[\u0000-\u001f\u007f<>/\\":;?*|=]/.test(value.name)) throw new KJValidationError('CREATEBATCH resource names must be bounded table names');
        const name = normalizeName(value.name);
        if (names.has(name)) throw new KJValidationError('CREATEBATCH resources cannot overwrite an existing table name');
        ids.add(value.id);
        names.add(name);
    };
    const typeNames = new Set(document.getTable('linetypes').records.map((item)=>normalizeName(String(item.name))));
    for (const type of resources.linetypes){
        fields(type, [
            'id',
            'name',
            'pattern'
        ]);
        validateIdentity(type, typeNames);
        if ([
            'BYLAYER',
            'BYBLOCK'
        ].includes(normalizeName(type.name))) throw new KJValidationError('CREATEBATCH resource linetype names cannot shadow inheritance keywords');
        if (!Array.isArray(type.pattern) || type.pattern.length > 32 || type.pattern.length % 2 !== 0 || type.pattern.some((segment, index)=>typeof segment !== 'number' || !Number.isFinite(segment) || Math.abs(segment) > 1e12 || (index % 2 === 0 ? segment <= 0 : segment >= 0))) throw new KJValidationError('CREATEBATCH linetype patterns must be empty for continuous lines or contain alternating positive dashes and negative gaps');
        const length = type.pattern.reduce((sum, segment)=>sum + Math.abs(segment), 0);
        if (type.pattern.length > 0 && !(length > 0) || !Number.isFinite(length)) throw new KJValidationError('CREATEBATCH nonempty linetype length must be finite and positive');
        linetypes.set(type.id, type.name);
    }
    const layerNames = new Set(document.getTable('layers').records.map((item)=>normalizeName(String(item.name))));
    for (const layer of resources.layers){
        fields(layer, [
            'id',
            'name',
            'color',
            'linetypeId',
            'lineweight'
        ]);
        validateIdentity(layer, layerNames);
        if (!Number.isInteger(layer.color) || layer.color < 1 || layer.color > 255) throw new KJValidationError('CREATEBATCH layer color must be an ACI integer from 1 to 255');
        if (!BATCH_LINEWEIGHTS.has(layer.lineweight)) throw new KJValidationError('CREATEBATCH layer lineweight must be a supported DXF hundredth-millimetre value');
        if (typeof layer.linetypeId !== 'string' || !linetypes.has(layer.linetypeId)) throw new KJValidationError('CREATEBATCH layer linetypeId must reference the linetype table');
    }
    for (const type of resources.linetypes)transaction.upsertTableRecord('linetypes', {
        id: type.id,
        name: type.name,
        type: 'LINETYPE',
        payload: {
            description: '',
            pattern: clone(type.pattern),
            totalPatternLength: type.pattern.reduce((sum, segment)=>sum + Math.abs(segment), 0),
            dxfFlags: 0
        }
    });
    for (const layer of resources.layers)transaction.upsertTableRecord('layers', {
        id: layer.id,
        name: layer.name,
        type: 'LAYER',
        payload: {
            color: layer.color,
            linetypeId: layer.linetypeId,
            linetypeName: linetypes.get(layer.linetypeId),
            lineweight: layer.lineweight,
            visible: true,
            frozen: false,
            locked: false,
            plottable: true
        }
    });
}
function createEntityBatch({ document, transaction }, args = {}) {
    const specs = args.entities;
    if (!Array.isArray(specs) || !specs.length) throw new KJValidationError('CREATEBATCH requires at least one entity');
    if (specs.length > 100000) throw new KJValidationError('CREATEBATCH exceeds the 100000 entity safety limit');
    if (Object.hasOwn(args, 'resources')) {
        createBatchResources(document, transaction, args.resources);
        const tableIds = (table)=>new Set([
                ...document.getTable(table).records.filter((item)=>!item.erased).map((item)=>item.id),
                ...args.resources[table].map((item)=>item.id)
            ]);
        const layers = tableIds('layers'), linetypes = tableIds('linetypes');
        for (const spec of specs){
            if (spec?.payload?.layerId !== undefined && !layers.has(spec.payload.layerId)) throw new KJValidationError('CREATEBATCH entity layerId must reference the layer table');
            if (spec?.payload?.linetypeId !== undefined && !linetypes.has(spec.payload.linetypeId)) throw new KJValidationError('CREATEBATCH entity linetypeId must reference the linetype table');
            if (spec?.payload?.lineweight !== undefined && !BATCH_LINEWEIGHTS.has(spec.payload.lineweight)) throw new KJValidationError('CREATEBATCH entity lineweight must be a supported DXF hundredth-millimetre value');
        }
    }
    const layerIds = new Map(document.getTable('layers').records.map((record)=>[
            String(record.name).toUpperCase(),
            record.id
        ]));
    for (const layer of args.resources?.layers ?? [])layerIds.set(layer.name.toUpperCase(), layer.id);
    const created = [];
    for (const spec of specs){
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new KJValidationError('CREATEBATCH entity specs must be objects');
        const layerName = String(spec.layerName ?? '0').trim() || '0';
        const layerKey = layerName.toUpperCase();
        let layerId = spec.payload?.layerId ?? layerIds.get(layerKey);
        if (!layerId) {
            if (Object.hasOwn(args, 'resources')) throw new KJValidationError('CREATEBATCH resource batches require an existing or explicitly declared layer');
            const layer = transaction.upsertTableRecord('layers', {
                name: layerName,
                type: 'LAYER',
                payload: {
                    color: spec.layer?.color ?? 7,
                    visible: spec.layer?.visible !== false,
                    frozen: Boolean(spec.layer?.frozen),
                    locked: Boolean(spec.layer?.locked),
                    plottable: spec.layer?.plottable !== false
                }
            });
            layerId = layer.id;
            layerIds.set(layerKey, layerId);
        }
        created.push(transaction.createEntity(spec.type, {
            ...clone(spec.payload ?? {}),
            layerId
        }, spec.options ?? {}));
    }
    return created;
}
function requiredEntity(document, id) {
    const entity = document?.getObject(String(id));
    if (!entity || entity.kind !== 'entity') throw new KJValidationError(`Entity does not exist: ${id}`);
    return entity;
}
function resolveTableRecord(document, tableName, value) {
    const table = document?.getTable(tableName);
    const key = String(value ?? '').toUpperCase();
    const record = table?.records.find((item)=>item.id === String(value) || String(item.name).toUpperCase() === key);
    if (!record) throw new KJValidationError(`${tableName} record does not exist: ${value}`);
    return record;
}
function resolveLayout(document, value) {
    const key = String(value ?? '').toUpperCase();
    const layout = document.spaces.layoutIds.map((id)=>document.getObject(id)).find((record)=>record?.id === String(value) || String(record?.name).toUpperCase() === key);
    if (!layout) throw new KJValidationError(`Layout does not exist: ${value}`);
    return layout;
}
function createBlockDefinition({ document, transaction }, args) {
    rejectAttachedReorganization(document, args, 'BLOCKCREATE');
    const name = String(args.name ?? '').trim();
    if (!name) throw new KJValidationError('Block name is required');
    if (document.getTable('blockRecords')?.records.some((record)=>String(record.name).toUpperCase() === name.toUpperCase())) throw new KJValidationError(`Block already exists: ${name}`);
    const entities = entityIds(args).map((id)=>requiredEntity(document, id));
    const ownerId = String(args.ownerId ?? entities[0].ownerId);
    if (entities.some((entity)=>entity.ownerId !== ownerId)) throw new KJValidationError('Block source entities must share one owner');
    const basePoint = vec2(args.basePoint ?? [
        0,
        0
    ]);
    const block = transaction.upsertTableRecord('blockRecords', {
        name,
        type: 'BLOCK_RECORD',
        payload: {
            entityIds: [],
            isSpace: false,
            basePoint: [
                0,
                0,
                0
            ],
            description: args.description ?? null
        }
    });
    const localMatrix = translation3(-basePoint[0], -basePoint[1]);
    if (args.keepSource) {
        for (const entity of entities)transaction.createEntity(entity.type, transformEntityPayload(entity.type, entity.payload, localMatrix), {
            ownerId: block.id,
            name: entity.name,
            extension: entity.extension,
            source: {
                blockSourceId: entity.id,
                blockSourceHandle: entity.handle
            }
        });
        return {
            block,
            insert: null
        };
    }
    for (const entity of entities){
        transaction.updateObject(entity.id, {
            payload: transformEntityPayload(entity.type, entity.payload, localMatrix)
        });
        transaction.reparentObject(entity.id, block.id);
    }
    const insert = transaction.createEntity('INSERT', {
        blockRecordId: block.id,
        position: [
            basePoint[0],
            basePoint[1],
            Number(args.basePoint?.[2] ?? 0)
        ],
        scale: [
            1,
            1,
            1
        ],
        rotation: 0,
        attributes: {}
    }, {
        ownerId
    });
    return {
        block,
        insert
    };
}
function createObjectGroup(document, transaction, args) {
    const name = String(args.name ?? '').trim();
    if (!name) throw new KJValidationError('Group name is required');
    const memberIds = entityIds(args).map((id)=>requiredEntity(document, id).id);
    const existing = document.listObjects({
        kind: 'group'
    }).find((group)=>String(group.name).toUpperCase() === name.toUpperCase());
    if (existing) throw new KJValidationError(`Group already exists: ${name}`);
    const group = transaction.createObject({
        kind: 'group',
        type: 'GROUP',
        ownerId: document.snapshot().namedObjectsDictionaryId,
        name,
        payload: {
            memberIds,
            selectable: args.selectable !== false,
            description: args.description ?? null
        }
    });
    transaction.addDictionaryEntry(document.snapshot().namedObjectsDictionaryId, `KJDRAW_GROUP:${name}`, group.id);
    return group;
}
function searchDocument(document, args = {}) {
    const query = String(args.query ?? '').trim().toLocaleLowerCase();
    if (!query) throw new KJValidationError('Search query is required');
    const kinds = args.kinds?.length ? new Set(args.kinds.map(String)) : null;
    const types = args.types?.length ? new Set(args.types.map((value)=>String(value).toUpperCase())) : null;
    const limit = Number(args.limit ?? 1000);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100000) throw new KJValidationError('Search limit must be an integer from 1 to 100000');
    const matches = [];
    for (const object of document.listObjects({
        includeErased: Boolean(args.includeErased)
    })){
        if (kinds && !kinds.has(object.kind)) continue;
        if (types && !types.has(object.type)) continue;
        const fields = {
            id: object.id,
            handle: object.handle,
            kind: object.kind,
            type: object.type,
            name: object.name ?? '',
            payload: JSON.stringify(object.payload ?? {}),
            xdata: JSON.stringify(object.extension?.xdata ?? {})
        };
        const matchedFields = Object.entries(fields).filter(([, value])=>String(value).toLocaleLowerCase().includes(query)).map(([name])=>name);
        if (matchedFields.length) matches.push(Object.freeze({
            id: object.id,
            handle: object.handle,
            kind: object.kind,
            type: object.type,
            name: object.name,
            matchedFields: Object.freeze(matchedFields)
        }));
        if (matches.length >= limit) break;
    }
    return Object.freeze({
        query,
        count: matches.length,
        truncated: matches.length === limit,
        matches: Object.freeze(matches)
    });
}
function compareDocuments(current, otherInput) {
    const source = otherInput;
    const snapshot = source?.snapshot?.() ?? source?.toJSON?.() ?? otherInput;
    if (!snapshot || typeof snapshot !== 'object' || !('objects' in snapshot) || !snapshot.objects || typeof snapshot.objects !== 'object') throw new KJValidationError('COMPARE requires another KJDocument or document state');
    const left = new Map(current.listObjects({
        includeErased: true
    }).map((object)=>[
            object.handle,
            object
        ]));
    const right = new Map(Object.values(snapshot.objects).map((object)=>{
        const comparableObject = object;
        return [
            String(comparableObject.handle).toUpperCase(),
            comparableObject
        ];
    }));
    const added = [];
    const removed = [];
    const changed = [];
    const unchanged = [];
    const comparable = (object)=>{
        const value = clone(object);
        delete value.id;
        delete value.source;
        return value;
    };
    for (const handle of [
        ...new Set([
            ...left.keys(),
            ...right.keys()
        ])
    ].sort((a, b)=>parseInt(a, 16) - parseInt(b, 16))){
        const before = left.get(handle), after = right.get(handle);
        if (!before) added.push({
            handle,
            type: after.type,
            afterId: after.id
        });
        else if (!after) removed.push({
            handle,
            type: before.type,
            beforeId: before.id
        });
        else if (stableHash(comparable(before)) !== stableHash(comparable(after))) changed.push({
            handle,
            beforeId: before.id,
            afterId: after.id,
            beforeType: before.type,
            afterType: after.type
        });
        else unchanged.push({
            handle,
            type: before.type,
            beforeId: before.id,
            afterId: after.id
        });
    }
    return deepFreeze({
        identical: !added.length && !removed.length && !changed.length,
        added,
        removed,
        changed,
        unchanged,
        counts: {
            added: added.length,
            removed: removed.length,
            changed: changed.length,
            unchanged: unchanged.length
        }
    });
}
function moveMatrix(args) {
    if (args.from != null || args.to != null) {
        const from = vec2(args.from ?? [
            0,
            0
        ]), to = vec2(args.to ?? [
            0,
            0
        ]);
        return translation3(to[0] - from[0], to[1] - from[1]);
    }
    const dx = Number(args.dx ?? 0), dy = Number(args.dy ?? 0);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new KJValidationError('Move displacement must be finite');
    return translation3(dx, dy);
}
function commandAngle(args) {
    const value = args.angleDegrees == null ? Number(args.angle ?? 0) : Number(args.angleDegrees) * Math.PI / 180;
    if (!Number.isFinite(value)) throw new KJValidationError('Rotation angle must be finite');
    return value;
}
function transformExisting({ document, transaction }, args, matrix) {
    const selected = new Set(entityIds(args));
    return [
        ...selected
    ].filter((id)=>{
        const entity = requiredEntity(document, id);
        return !entity.payload.parentInsertId || !selected.has(entity.payload.parentInsertId);
    }).flatMap((id)=>transaction.transformEntity(id, matrix));
}
function copyEntities({ document, transaction }, args, matrix) {
    const selected = new Set(entityIds(args));
    return [
        ...selected
    ].filter((id)=>{
        const entity = requiredEntity(document, id);
        return !entity.payload.parentInsertId || !selected.has(entity.payload.parentInsertId);
    }).map((id)=>{
        const entity = requiredEntity(document, id);
        if (entity.payload.parentInsertId) throw new KJValidationError('Copy attached attributes through their INSERT');
        const attributed = entity.type === 'INSERT' && Boolean(entity.payload.attributeIds?.length || entity.payload.sequenceEndId);
        if (attributed && args.payloadPatch && Object.keys(args.payloadPatch).length) throw new KJValidationError('Attributed INSERT copy does not support payloadPatch');
        const children = attributed ? (entity.payload.attributeIds ?? []).map((childId)=>requiredEntity(document, childId)) : [];
        if (attributed) for (const source of [
            entity,
            ...children
        ]){
            const layer = source.payload.layerId ? document.getObject(source.payload.layerId) : null;
            if (layer && (layer.payload.locked === true || layer.payload.frozen === true || layer.payload.visible === false)) throw new KJValidationError('Copy requires writable layers for the INSERT and every attached attribute');
        }
        const copied = transaction.createEntity(entity.type, {
            ...transformEntityPayload(entity.type, entity.payload, matrix),
            ...clone(args.payloadPatch ?? {}),
            ...attributed ? {
                attributeIds: [],
                sequenceEndId: null
            } : {}
        }, {
            ownerId: args.ownerId ?? entity.ownerId,
            name: entity.name,
            extension: entity.extension,
            source: {
                copiedFromId: entity.id,
                copiedFromHandle: entity.handle
            }
        });
        if (!attributed) return copied;
        const attributeIds = children.map((child)=>transaction.createEntity('ATTRIB', {
                ...transformEntityPayload('ATTRIB', child.payload, matrix),
                parentInsertId: copied.id
            }, {
                ownerId: copied.ownerId,
                name: child.name,
                extension: clone(child.extension),
                source: {
                    copiedFromId: child.id,
                    copiedFromHandle: child.handle
                }
            }).id);
        const end = entity.payload.sequenceEndId ? document.getObject(entity.payload.sequenceEndId) : null;
        if (!end) throw new KJValidationError('Attributed INSERT sequence end is missing');
        const sequence = transaction.createObject({
            kind: 'custom',
            type: 'SEQEND',
            ownerId: copied.id,
            payload: clone(end.payload),
            extension: clone(end.extension),
            source: {
                copiedFromId: end.id,
                copiedFromHandle: end.handle
            }
        });
        return transaction.updateObject(copied.id, {
            payload: {
                attributeIds,
                sequenceEndId: sequence.id
            }
        });
    });
}
function rejectAttachedReorganization(document, args, command) {
    for (const id of entityIds(args)){
        const entity = requiredEntity(document, id);
        if (entity.payload.parentInsertId || entity.type === 'INSERT' && (entity.payload.attributeIds?.length || entity.payload.sequenceEndId)) throw new KJValidationError(`${command} does not yet support attached attribute sequences`);
    }
}
function createDerived(transaction, source, type, payload) {
    return transaction.createEntity(type, payload, {
        ownerId: source.ownerId,
        name: source.name,
        extension: source.extension,
        source: {
            derivedFromId: source.id,
            derivedFromHandle: source.handle
        }
    });
}
function replaceEntityMemberships(transaction, sourceIds, retainedIds) {
    const sources = new Set(sourceIds);
    for (const group of Object.values(transaction._draft().objects)){
        if (group.erased || group.kind !== 'group' || ![
            'GROUP',
            'SELECTION_SET'
        ].includes(group.type)) continue;
        const members = group.payload.memberIds;
        if (!Array.isArray(members) || !members.some((id)=>sources.has(id))) continue;
        const memberIds = [
            ...new Set(members.flatMap((id)=>sources.has(id) ? [
                    ...retainedIds
                ] : [
                    id
                ]))
        ];
        if (memberIds.length === members.length && memberIds.every((id, index)=>id === members[index])) continue;
        transaction.updateObject(group.id, {
            payload: {
                memberIds
            }
        });
    }
}
function requiredBoundaries(document, ids, targetId) {
    if (!Array.isArray(ids) || !ids.length) throw new KJValidationError('Boundary entity ids are required');
    if (targetId && ids.includes(targetId)) throw new KJValidationError('The target cannot also be a cutting boundary');
    return ids.map((id)=>requiredEntity(document, id));
}
function editLinePair({ document, transaction }, args, operation) {
    const first = requiredEntity(document, args.firstId), second = requiredEntity(document, args.secondId);
    if (first.id === second.id) throw new KJValidationError('Line pair operation requires two different entities');
    const result = operation(first, second, args);
    const updatedFirst = transaction.updateObject(first.id, {
        payload: result.first
    });
    const updatedSecond = transaction.updateObject(second.id, {
        payload: result.second
    });
    let connector = null;
    if (result.connector.type !== 'LINE' || Math.hypot(result.connector.payload.end[0] - result.connector.payload.start[0], result.connector.payload.end[1] - result.connector.payload.start[1]) > 1e-12) {
        connector = createDerived(transaction, first, result.connector.type, {
            ...result.connector.payload,
            ...clone(args.connectorPayloadPatch ?? {})
        });
    }
    return {
        first: updatedFirst,
        second: updatedSecond,
        connector
    };
}
const MAX_ARRAY_ENTITY_CREATIONS = 100000;
function assertArrayCreationLimit(args, copyPositionCount) {
    const selectedEntityCount = entityIds(args).length;
    if (copyPositionCount > Math.floor(MAX_ARRAY_ENTITY_CREATIONS / selectedEntityCount)) {
        throw new KJValidationError(`Array exceeds the ${MAX_ARRAY_ENTITY_CREATIONS} created entity safety limit`);
    }
}
function rectangularArray(context, args) {
    rejectAttachedReorganization(context.document, args, 'ARRAYRECT');
    const rows = Number(args.rows ?? 1), columns = Number(args.columns ?? 1);
    const rowSpacing = Number(args.rowSpacing ?? 0), columnSpacing = Number(args.columnSpacing ?? 0);
    if (![
        rows,
        columns
    ].every(Number.isInteger) || rows < 1 || columns < 1) throw new KJValidationError('Array rows and columns must be positive integers');
    if (rows * columns > 100000) throw new KJValidationError('Array exceeds the 100000 instance safety limit');
    if (![
        rowSpacing,
        columnSpacing
    ].every(Number.isFinite)) throw new KJValidationError('Array spacing must be finite');
    const copyPositionCount = rows * columns - (args.includeSource !== false ? 1 : 0);
    assertArrayCreationLimit(args, copyPositionCount);
    const created = [];
    for(let row = 0; row < rows; row += 1){
        for(let column = 0; column < columns; column += 1){
            if (row === 0 && column === 0 && args.includeSource !== false) continue;
            created.push(...copyEntities(context, args, translation3(column * columnSpacing, row * rowSpacing)));
        }
    }
    return created;
}
function polarArray(context, args) {
    rejectAttachedReorganization(context.document, args, 'ARRAYPOLAR');
    const count = Number(args.count ?? args.items);
    if (!Number.isInteger(count) || count < 2 || count > 100000) throw new KJValidationError('Polar array count must be an integer from 2 to 100000');
    const center = vec2(args.center);
    const fillAngle = args.angleDegrees == null ? Number(args.angle ?? Math.PI * 2) : Number(args.angleDegrees) * Math.PI / 180;
    if (!Number.isFinite(fillAngle) || Math.abs(fillAngle) <= 1e-15) throw new KJValidationError('Polar array fill angle must be finite and non-zero');
    assertArrayCreationLimit(args, count - 1);
    const fullCircle = Math.abs(Math.abs(fillAngle) - Math.PI * 2) <= 1e-10;
    const step = fillAngle / (fullCircle ? count : count - 1), created = [];
    for(let index = 1; index < count; index += 1){
        const rotation = rotationAround3(step * index, center);
        let matrix = rotation;
        if (args.rotateItems === false) {
            const basePoint = vec2(args.basePoint);
            const rotated = transformPoint3(rotation, basePoint);
            matrix = translation3(rotated[0] - basePoint[0], rotated[1] - basePoint[1]);
        }
        created.push(...copyEntities(context, args, matrix));
    }
    return created;
}
