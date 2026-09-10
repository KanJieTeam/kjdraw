// Generated from svg-adapter.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJDocument } from './document.js';
import { KJValidationError } from './errors.js';
import { defineFileAdapter } from './file-adapters.js';
import { exportDrawingSvg } from './svg-export.js';
export function createSVGFileAdapter() {
    return defineFileAdapter({
        id: 'kanjie.svg.vector',
        vendor: 'Kanjie',
        priority: 500,
        formats: {
            SVG: {
                read: [],
                write: [
                    '1.1'
                ],
                notes: [
                    'Physical vector output from explicit layout plot settings; not a CAD round-trip format'
                ]
            }
        },
        capabilities: {
            container: 'svg',
            paperSize: 'millimeters',
            explicitScale: true,
            viewportClipping: 'rectangular-top-view',
            unsupportedEntities: 'reject',
            partialOutput: false
        },
        preservation: {
            geometry: 'vector-projection',
            annotations: 'editable-text-with-font-approximations',
            documentState: 'read-only'
        },
        write: (document, options = {})=>{
            if (!(document instanceof KJDocument)) throw new KJValidationError('SVG writer requires a KJDocument');
            if (options.allowPartial !== undefined && options.allowPartial !== false) throw new KJValidationError('SVG file output requires complete geometry; use exportDrawingSvg to inspect partial output and diagnostics');
            if (options.signal instanceof AbortSignal && options.signal.aborted) throw new KJValidationError('SVG export aborted');
            const layoutId = options.layoutId ?? document.snapshot().spaces.activeLayoutId;
            if (typeof layoutId !== 'string' || !layoutId) throw new KJValidationError('SVG export requires a layoutId with physical page settings');
            if (options.maxEntities !== undefined && (typeof options.maxEntities !== 'number' || !Number.isSafeInteger(options.maxEntities))) throw new KJValidationError('SVG maxEntities must be an integer');
            return exportDrawingSvg(document, {
                layoutId,
                ...typeof options.maxEntities === 'number' ? {
                    maxEntities: options.maxEntities
                } : {}
            }).svg;
        }
    });
}
