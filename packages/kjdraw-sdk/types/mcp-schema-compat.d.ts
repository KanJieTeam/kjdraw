import type { KJAgentToolSchema } from './agent-tools.js';
/**
 * MCP accepts full JSON Schema, but some production clients forward tool
 * schemas to providers that implement a smaller dialect. In particular,
 * Moonshot's Walle validator does not accept exclusiveMinimum. Keep the
 * authoritative Agent schema and runtime validation unchanged, while exposing
 * the same practical positive-number contract through an inclusive lower
 * bound at the MCP boundary.
 */
export declare const KJDRAW_MCP_SCHEMA_PROFILE = "moonshot-walle-compatible-v1";
/** Return a detached schema in the strict portable subset used by KJDraw MCP. */
export declare function portableMcpInputSchema(schema: KJAgentToolSchema): KJAgentToolSchema;
/** Fail closed if a future tool adds a keyword outside the provider-safe set. */
export declare function assertPortableMcpInputSchema(schema: KJAgentToolSchema, path?: string): void;
