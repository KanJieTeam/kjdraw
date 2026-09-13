import type { KJAgentDrawingInput, KJAgentPoint } from './agent-drawing.js'

export interface KJAgentCompactDrawingInput {
  expectedRevision: number
  units: string
  lines: [number, number, number, number][]
  circles: [number, number, number][]
  /** Center XY, positive radius, then counterclockwise start/end angles in degrees. */
  arcs: [number, number, number, number, number][]
  /** Center XY, major-axis vector XY, ratio, then start/end parameters in degrees. */
  ellipses?: [number, number, number, number, number, number, number][]
  /** Open NURBS definitions stay structured because knot and weight lengths vary. */
  splines?: { degree: number; controlPoints: KJAgentPoint[]; knots?: number[]; weights?: number[] }[]
  polylines: { points: [number, number][]; closed: boolean }[]
}

/** Decode only after compact schema validation; validate the result against the full drawing schema before building entities. */
export function decodeAgentCompactDrawing(input: KJAgentCompactDrawingInput): KJAgentDrawingInput {
  const point = (x: number, y: number): KJAgentPoint => ({ x, y })
  return {
    expectedRevision: input.expectedRevision,
    units: input.units,
    lines: input.lines.map(([x1, y1, x2, y2]) => ({ start: point(x1, y1), end: point(x2, y2) })),
    circles: input.circles.map(([x, y, radius]) => ({ center: point(x, y), radius })),
    arcs: input.arcs.map(([x, y, radius, startDegrees, endDegrees]) => ({ center: point(x, y), radius, startDegrees, endDegrees })),
    ellipses: (input.ellipses ?? []).map(([x, y, majorX, majorY, ratio, startDegrees, endDegrees]) => ({
      center: point(x, y), majorAxis: point(majorX, majorY), ratio, startDegrees, endDegrees,
    })),
    splines: (input.splines ?? []).map(spline => ({
      degree: spline.degree,
      controlPoints: spline.controlPoints.map(({ x, y }) => point(x, y)),
      ...(spline.knots ? { knots: [...spline.knots] } : {}),
      ...(spline.weights ? { weights: [...spline.weights] } : {}),
    })),
    polylines: input.polylines.map(({ points, closed }) => ({ vertices: points.map(([x, y]) => point(x, y)), closed })),
  }
}
