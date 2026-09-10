// Generated from agent-drawing-compact.ts by scripts/build-typescript.mjs. Do not edit directly.
export function decodeAgentCompactDrawing(input) {
    const point = (x, y)=>({
            x,
            y
        });
    return {
        expectedRevision: input.expectedRevision,
        units: input.units,
        lines: input.lines.map(([x1, y1, x2, y2])=>({
                start: point(x1, y1),
                end: point(x2, y2)
            })),
        circles: input.circles.map(([x, y, radius])=>({
                center: point(x, y),
                radius
            })),
        arcs: input.arcs.map(([x, y, radius, startDegrees, endDegrees])=>({
                center: point(x, y),
                radius,
                startDegrees,
                endDegrees
            })),
        polylines: input.polylines.map(({ points, closed })=>({
                vertices: points.map(([x, y])=>point(x, y)),
                closed
            }))
    };
}
