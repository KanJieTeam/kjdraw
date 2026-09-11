import { type KJRoadDesignInput } from './road-design.js';
import { KJ_AGENT_PLAN_BINDING_CANONICALIZATION } from './agent-plans.js';
import { type ReadonlyDeep } from './utils.js';
export declare const KJDRAW_ROAD_INPUT_ASSET_SCHEMA: 'com.kanjie.kjdraw.road-design-input@1';
export interface KJAgentInputAssetRegistration {
    assetId: string;
    schema: typeof KJDRAW_ROAD_INPUT_ASSET_SCHEMA;
    data: KJRoadDesignInput;
}
export interface KJAgentInputAssetReference {
    assetId: string;
    sha256: string;
}
export interface KJAgentInputAssetDescriptor extends KJAgentInputAssetReference {
    schema: typeof KJDRAW_ROAD_INPUT_ASSET_SCHEMA;
    canonicalization: typeof KJ_AGENT_PLAN_BINDING_CANONICALIZATION;
    units: 'meter';
    byteLength: number;
    counts: {
        alignment: number;
        profile: number;
        sections: number;
        groundPoints: number;
    };
    stationRange: readonly [number, number];
}
export interface KJAgentInputAsset {
    descriptor: ReadonlyDeep<KJAgentInputAssetDescriptor>;
    data: ReadonlyDeep<KJRoadDesignInput>;
}
/** Validate and detach one immutable road input asset. Hosts authorize registration
 * in a document-bound tool session. Hashes detect content changes, not authorship.
 * Only the descriptor should be sent to a model; data is resolved locally. */
export declare function createAgentInputAsset(input: unknown): Promise<ReadonlyDeep<KJAgentInputAsset>>;
