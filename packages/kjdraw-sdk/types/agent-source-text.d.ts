/** Validate already schema-checked FULL model source arguments. Encoding loss
 * is never repaired by guessing a material, identity or measurement label.
 * This does not verify provenance or whether a well-formed value is correct.
 */
export declare function validateAgentSourceText(input: unknown, path?: string): void;
