export declare const KJDRAW_CARTESIAN_CHART_VERSION: '1.0.0';
export interface KJAgentCartesianChartSeries {
    id: string;
    name: string;
    kind: 'line' | 'bar';
    values: number[];
    color?: number;
}
export interface KJAgentCartesianChartInput {
    version: typeof KJDRAW_CARTESIAN_CHART_VERSION;
    expectedRevision: number;
    units: 'millimeter';
    drawingId: string;
    title: string;
    categories: string[];
    series: KJAgentCartesianChartSeries[];
    origin?: [number, number];
    width?: number;
    height?: number;
    textHeight?: number;
    xLabel?: string;
    yLabel?: string;
    showValues?: boolean;
    yAxis?: {
        minimum: number;
        maximum: number;
        tick: number;
    };
}
interface ChartDocument {
    id: string;
    revision: number;
    snapshot(): {
        header?: {
            units?: string;
        };
    };
    listEntities(): readonly unknown[];
}
type EntitySpec = {
    type: string;
    payload: Record<string, unknown>;
    options: {
        id: string;
    };
};
export declare function buildAgentCartesianChart(document: ChartDocument, source: KJAgentCartesianChartInput): {
    commandArgs: {
        entities: EntitySpec[];
        resources: {
            linetypes: {
                id: string;
                name: string;
                pattern: number[];
            }[];
            layers: {
                id: string;
                name: string;
                color: number;
                linetypeId: string;
                lineweight: number;
            }[];
        };
    };
    evidence: {
        drawingId: string;
        skillId: string;
        skillVersion: "1.0.0";
        units: string;
        expectedRevision: number;
        entityCount: number;
        bounds: {
            min: number[];
            max: number[];
            width: number;
            height: number;
        };
        parameters: {
            title: string;
            categoryCount: number;
            series: {
                id: string;
                name: string;
                kind: "bar" | "line";
                color: number;
                valueCount: number;
            }[];
            yAxis: {
                minimum: number;
                maximum: number;
                tick: number;
            };
            showValues: boolean;
        };
        limitations: string[];
    };
};
export {};
