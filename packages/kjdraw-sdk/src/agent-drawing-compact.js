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
        ellipses: (input.ellipses ?? []).map(([x, y, majorX, majorY, ratio, startDegrees, endDegrees])=>({
                center: point(x, y),
                majorAxis: point(majorX, majorY),
                ratio,
                startDegrees,
                endDegrees
            })),
        splines: (input.splines ?? []).map((spline)=>({
                degree: spline.degree,
                controlPoints: spline.controlPoints.map(({ x, y })=>point(x, y)),
                ...spline.knots ? {
                    knots: [
                        ...spline.knots
                    ]
                } : {},
                ...spline.weights ? {
                    weights: [
                        ...spline.weights
                    ]
                } : {}
            })),
        polylines: input.polylines.map(({ points, closed })=>({
                vertices: points.map(([x, y])=>point(x, y)),
                closed
            })),
        hatches: (input.hatches ?? []).map((hatch)=>({
                ...hatch,
                loops: hatch.loops.map((loop)=>({
                        vertices: loop.vertices.map(({ x, y })=>point(x, y))
                    }))
            }))
    };
}
