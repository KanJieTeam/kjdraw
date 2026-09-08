// Generated from annotation.ts by scripts/build-typescript.mjs. Do not edit directly.
const finite = (value, fallback)=>Number.isFinite(Number(value)) && value != null ? Number(value) : fallback;
const point = (value)=>Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every((v)=>Number.isFinite(Number(v))) ? [
        Number(value[0]),
        Number(value[1])
    ] : null;
const plus = (a, b, factor = 1)=>[
        a[0] + b[0] * factor,
        a[1] + b[1] * factor
    ];
const delta = (a, b)=>[
        a[0] - b[0],
        a[1] - b[1]
    ];
const dot = (a, b)=>a[0] * b[0] + a[1] * b[1];
const length = (v)=>Math.hypot(v[0], v[1]);
export function projectDimension(payload, style = {}) {
    const points = Array.isArray(payload.definitionPoints) ? payload.definitionPoints.map(point) : [];
    const first = points[0], second = points[1];
    if (!first || !second) return null;
    const type = String(payload.dimensionType ?? 'ALIGNED').toUpperCase();
    const overall = Math.max(1e-9, finite(style.overallScale, 1));
    const height = Math.max(1e-9, finite(payload.textHeight ?? style.textHeight, 2.5) * overall);
    const arrowSize = Math.max(1e-9, finite(style.arrowSize, height * .7 / overall) * overall);
    const gap = Math.max(0, finite(style.extensionOffset, height * .2 / overall) * overall);
    const beyond = Math.max(0, finite(style.extensionBeyond, height * .35 / overall) * overall);
    const lines = [];
    const arrows = [];
    const arrow = (tip, direction)=>{
        const rear = plus(tip, direction, arrowSize), normal = [
            -direction[1],
            direction[0]
        ];
        arrows.push([
            tip,
            plus(rear, normal, arrowSize * .3),
            plus(rear, normal, -arrowSize * .3)
        ]);
    };
    let measurement, textPoint, rotation = 0, prefix = '';
    if (type === 'ALIGNED' || type === 'ROTATED' || type === 'LINEAR') {
        const a = second, b = points[2];
        if (!b) return null;
        const ab = delta(b, a), span = length(ab);
        if (span < 1e-12) return null;
        const angle = type === 'ALIGNED' ? Math.atan2(ab[1], ab[0]) : finite(payload.rotation, 0);
        const u = [
            Math.cos(angle),
            Math.sin(angle)
        ], n = [
            -u[1],
            u[0]
        ];
        const d1 = dot(delta(first, a), n), d2 = dot(delta(first, b), n);
        const q1 = plus(a, n, d1), q2 = plus(b, n, d2), direction = delta(q2, q1), dimensionSpan = length(direction);
        if (dimensionSpan < 1e-12) return null;
        const sign1 = Math.sign(d1) || 1, sign2 = Math.sign(d2) || 1;
        lines.push([
            plus(a, n, sign1 * gap),
            plus(q1, n, sign1 * beyond)
        ], [
            plus(b, n, sign2 * gap),
            plus(q2, n, sign2 * beyond)
        ], [
            q1,
            q2
        ]);
        const inward = [
            direction[0] / dimensionSpan,
            direction[1] / dimensionSpan
        ];
        arrow(q1, inward);
        arrow(q2, [
            -inward[0],
            -inward[1]
        ]);
        measurement = dimensionSpan;
        textPoint = plus([
            (q1[0] + q2[0]) / 2,
            (q1[1] + q2[1]) / 2
        ], n, height * .65);
        rotation = angle;
    } else if (type === 'RADIUS' || type === 'DIAMETER') {
        const direction = delta(second, first), span = length(direction);
        if (span < 1e-12) return null;
        const u = [
            direction[0] / span,
            direction[1] / span
        ];
        measurement = span;
        prefix = type === 'RADIUS' ? 'R' : '⌀';
        lines.push([
            first,
            second
        ]);
        arrow(second, [
            -u[0],
            -u[1]
        ]);
        if (type === 'DIAMETER') arrow(first, u);
        textPoint = plus(second, u, height * 1.1);
    } else return null;
    const precision = Math.max(0, Math.min(8, Math.trunc(finite(payload.precision ?? style.decimalPlaces, 2))));
    const measuredText = `${prefix}${measurement.toFixed(precision).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}`;
    const override = payload.textOverride;
    const text = override == null || override === '' ? measuredText : String(override).replaceAll('<>', measuredText);
    const overridePoint = point(payload.textPosition);
    if (overridePoint && (type === 'RADIUS' || type === 'DIAMETER')) lines.push([
        second,
        overridePoint
    ]);
    if (rotation > Math.PI / 2 || rotation < -Math.PI / 2) rotation += Math.PI;
    return {
        lines,
        arrows,
        label: {
            position: overridePoint ?? textPoint,
            text,
            height,
            rotation
        },
        measurement
    };
}
