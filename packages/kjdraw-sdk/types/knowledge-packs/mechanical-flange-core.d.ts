/** Source-neutral rules for a parameterized orthographic flange-view core. */
export declare const KJDRAW_MECHANICAL_FLANGE_CORE_KNOWLEDGE_PACK: {
    readonly schema: typeof import("../knowledge-pack.js").KJDRAW_KNOWLEDGE_PACK_SCHEMA;
    readonly id: string;
    readonly version: string;
    readonly title: string;
    readonly domain: string;
    readonly license: {
        readonly spdx: string;
        readonly redistributable: boolean;
        readonly trainingAllowed: boolean;
    };
    readonly sources: readonly {
        readonly id: string;
        readonly title: string;
        readonly license: string;
        readonly contentHash: string;
        readonly uri?: string;
    }[];
    readonly ontology: {
        readonly objectKinds: readonly string[];
        readonly relationKinds: readonly string[];
    };
    readonly templates?: {
        readonly [x: string]: unknown;
    };
    readonly rules?: {
        readonly [x: string]: unknown;
    };
};
