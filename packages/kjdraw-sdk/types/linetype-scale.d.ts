type Values = Readonly<Record<string, unknown>>;
/** Native CAD linetype length in drawing units. Geometry transforms are applied
 * later by the renderer, exactly like the entity path itself. */
export declare function effectiveLinetypeScale(systemVariables: Values, payload: Values): number;
export {};
