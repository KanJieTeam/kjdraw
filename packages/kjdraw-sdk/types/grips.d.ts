import type { KJObjectPayload, KJReadonlyObjectRecord } from './schema.js';
export type KJGripPoint = [number, number, number];
export type KJPointInput = readonly number[] | {
    x: number;
    y: number;
    z?: number;
};
export interface KJEntityGrip extends Record<string, unknown> {
    id: string;
    entityId: string;
    role: string;
    point: readonly [number, number, number];
    vertexIndex?: number;
    segmentIndex?: number;
    controlPointIndex?: number;
    fitPointIndex?: number;
    definitionPointIndex?: number;
    angle?: number;
}
export declare function getEntityGrips(entity: KJReadonlyObjectRecord): readonly KJEntityGrip[];
export declare function editEntityGrip(entity: KJReadonlyObjectRecord, gripId: string, targetPoint: KJPointInput): KJObjectPayload;
