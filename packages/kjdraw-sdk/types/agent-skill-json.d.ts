import { type CompactCadToolDefinition } from './agent-compact-tool-surface.js';
/** Opt-in text interface for the same SDK proposal tools; it does not execute or approve them. */
export declare function buildCadSkillJsonContract({ definitions, names, hostOwnsRevisionAndUnits }: {
    definitions: readonly CompactCadToolDefinition[];
    names: readonly string[];
    hostOwnsRevisionAndUnits?: boolean;
}): string;
/** Parse shape and allowlist only; the original SDK validates every tool argument. */
export declare function parseCadSkillJsonResponse({ content, names, maxCalls }: {
    content: string;
    names: readonly string[];
    maxCalls?: number;
}): {
    tool: string;
    args: Record<string, unknown>;
}[];
