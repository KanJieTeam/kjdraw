import type { KJDocument } from './document.js';
import type { KJTransaction } from './transaction.js';
import type { KJObjectRecord } from './schema.js';
/** Bounded affine expressions, without source code, evaluation or arbitrary paths. */
export interface KJDesignExpression {
    constant: number;
    terms: {
        parameter: string;
        coefficient: number;
    }[];
}
export interface KJDesignParameter {
    name: string;
    value: number;
    min: number;
    max: number;
}
export interface KJDerivedDesignParameter {
    name: string;
    expression: KJDesignExpression;
}
export interface KJDesignBinding {
    entityId: string;
    path: string;
    expression: KJDesignExpression;
}
export interface KJDesignRequirement {
    name: string;
    expression: KJDesignExpression;
    min: number;
    max: number;
}
export interface KJDesignDefinition {
    parameters: KJDesignParameter[];
    derived: KJDerivedDesignParameter[];
    bindings: KJDesignBinding[];
    requirements: KJDesignRequirement[];
}
export interface KJDesignRelationView {
    id: string;
    name: string;
    units: string;
    definition: KJDesignDefinition;
    values: Record<string, number>;
    entityIds: string[];
    driftedEntityIds: string[];
}
/** Persist a relation over already-correct native geometry. It never creates replacement entities. */
export declare function createDesignRelations(document: KJDocument, tx: KJTransaction, name: string, input: unknown): KJObjectRecord;
/** Atomically update parameters and all bound geometry. Manual geometry drift is a conflict. */
export declare function updateDesignRelations(document: KJDocument, tx: KJTransaction, id: string, changes: unknown): KJObjectRecord;
/** Read persisted design parameters, evaluated dependencies and explicit geometry conflict IDs. */
export declare function readDesignRelations(document: KJDocument): KJDesignRelationView[];
