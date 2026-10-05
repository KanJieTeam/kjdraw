export interface CompactCadToolDefinition {
    name: string;
    inputSchema: Record<string, unknown>;
}
export interface CompactCadFunctionTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}
/** Public-prompt router for the constrained plate/slot benchmark vocabulary. */
export declare function routeCompactCadTools({ prompt, hasEditableSeed }: {
    prompt: string;
    hasEditableSeed?: boolean;
}): string[];
/** Projects a small model-visible surface; it does not relax SDK execution validation. */
export declare function projectCompactCadTools({ definitions, names, hostOwnsRevisionAndUnits }: {
    definitions: readonly CompactCadToolDefinition[];
    names: readonly string[];
    hostOwnsRevisionAndUnits?: boolean;
}): CompactCadFunctionTool[];
