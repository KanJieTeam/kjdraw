import { type AffineMatrix3Input } from './matrix3.js';
export type GeometryEntityPayload = Record<string, unknown>;
export declare function transformEntityPayload(type: unknown, source: GeometryEntityPayload | null | undefined, matrix: AffineMatrix3Input): GeometryEntityPayload;
