// Generated from mechanical-topology.ts by scripts/build-typescript.mjs. Do not edit directly.
const tolerance = 1e-4;
const near = (a, b)=>Math.abs(a - b) <= tolerance;
const point = (value)=>Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every((item)=>typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1_000_000) ? [
        value[0],
        value[1]
    ] : null;
const scalar = (value)=>typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000 ? value : null;
function circle(entity) {
    const payload = entity?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const center = point(payload.center), radius = scalar(payload.radius);
    return center && radius != null ? {
        x: center[0],
        y: center[1],
        radius
    } : null;
}
function arc(entity) {
    const base = circle(entity);
    if (!base) return null;
    const start = entity.payload.startAngle, end = entity.payload.endAngle;
    return typeof start === 'number' && Number.isFinite(start) && typeof end === 'number' && Number.isFinite(end) ? {
        ...base,
        start,
        end
    } : null;
}
function middleAngle(value) {
    const turn = Math.PI * 2;
    const start = (value.start % turn + turn) % turn;
    const sweep = ((value.end - value.start) % turn + turn) % turn;
    return start + sweep / 2;
}
function crownArc(value, housingRadius, upper) {
    const midpoint = middleAngle(value);
    if (Math.sin(midpoint) > 0 !== upper || Math.abs(Math.cos(midpoint)) > 0.1) return false;
    const endpoints = [
        value.start,
        value.end
    ].map((angle)=>({
            x: value.radius * Math.cos(angle),
            y: value.radius * Math.sin(angle)
        }));
    const expectedY = Math.sqrt(value.radius ** 2 - housingRadius ** 2);
    return endpoints.every(({ x, y })=>near(Math.abs(x), housingRadius) && near(y, upper ? expectedY : -expectedY)) && endpoints[0].x * endpoints[1].x < 0;
}
export function detectMechanicalBearingSeatEndView(entities) {
    if (!Array.isArray(entities) || entities.length > 100_000) return {
        status: 'none',
        candidates: []
    };
    const circles = entities.filter((entity)=>entity?.type === 'CIRCLE').map(circle).filter((value)=>value != null);
    const arcs = entities.filter((entity)=>entity?.type === 'ARC').map(arc).filter((value)=>value != null);
    const pairCount = arcs.length * (arcs.length - 1) / 2;
    if (pairCount * Math.max(circles.length, 1) > 2_000_000) return {
        status: 'none',
        candidates: []
    };
    const found = [];
    for(let first = 0; first < arcs.length; first++)for(let second = first + 1; second < arcs.length; second++){
        const a = arcs[first], b = arcs[second];
        if (!near(a.x, b.x) || !near(a.y, b.y) || !near(a.radius, b.radius)) continue;
        const concentric = circles.filter((item)=>near(item.x, a.x) && near(item.y, a.y)).sort((left, right)=>left.radius - right.radius);
        if (concentric.length !== 2) continue;
        const bore = concentric[0], housing = concentric[1];
        if (near(bore.radius, housing.radius) || housing.radius >= a.radius) continue;
        if (!(crownArc(a, housing.radius, true) && crownArc(b, housing.radius, false)) && !(crownArc(b, housing.radius, true) && crownArc(a, housing.radius, false))) continue;
        const holes = circles.filter((item)=>near(item.x, a.x) && !near(item.y, a.y) && item.radius < housing.radius);
        const pairs = [];
        for(let i = 0; i < holes.length; i++)for(let j = i + 1; j < holes.length; j++){
            const lower = holes[i].y < holes[j].y ? holes[i] : holes[j];
            const upper = holes[i].y < holes[j].y ? holes[j] : holes[i];
            if (lower.y < a.y && upper.y > a.y && near(lower.radius, upper.radius) && near((lower.y + upper.y) / 2, a.y) && upper.y - lower.y >= 2 * upper.radius && upper.y - a.y + upper.radius <= a.radius + tolerance) pairs.push([
                lower,
                upper
            ]);
        }
        if (pairs.length !== 1) continue;
        const [lower, upper] = pairs[0];
        found.push({
            center: [
                a.x,
                a.y
            ],
            crownRadius: a.radius,
            housingDiameter: housing.radius * 2,
            boreDiameter: bore.radius * 2,
            mountingHoleDiameter: lower.radius * 2,
            mountingHoleSpacing: upper.y - lower.y
        });
    }
    const unique = found.filter((item, index)=>found.findIndex((other)=>near(item.center[0], other.center[0]) && near(item.center[1], other.center[1]) && near(item.crownRadius, other.crownRadius)) === index);
    return {
        status: unique.length === 0 ? 'none' : unique.length === 1 ? 'match' : 'ambiguous',
        candidates: unique
    };
}
export function detectMechanicalFourHoleBoltCircle(entities) {
    if (!Array.isArray(entities) || entities.length > 100_000) return {
        status: 'none',
        candidates: []
    };
    const circles = entities.filter((entity)=>entity?.type === 'CIRCLE').map(circle).filter((value)=>value != null);
    if (circles.length ** 3 > 2_000_000) return {
        status: 'none',
        candidates: []
    };
    const found = [];
    for(let i = 0; i < circles.length; i++)for(let j = i + 1; j < circles.length; j++){
        const a = circles[i], b = circles[j];
        if (!near(a.radius, b.radius)) continue;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const vx = a.x - cx, vy = a.y - cy;
        const pitchRadius = Math.hypot(vx, vy);
        if (pitchRadius <= a.radius + tolerance) continue;
        const positive = circles.filter((item)=>near(item.radius, a.radius) && near(item.x, cx - vy) && near(item.y, cy + vx));
        const negative = circles.filter((item)=>near(item.radius, a.radius) && near(item.x, cx + vy) && near(item.y, cy - vx));
        if (positive.length !== 1 || negative.length !== 1) continue;
        const holes = [
            a,
            b,
            positive[0],
            negative[0]
        ];
        if (new Set(holes).size !== 4) continue;
        const holeCenters = holes.map((item)=>[
                item.x,
                item.y
            ]).sort((left, right)=>Math.atan2(left[1] - cy, left[0] - cx) - Math.atan2(right[1] - cy, right[0] - cx));
        if (found.some((item)=>near(item.center[0], cx) && near(item.center[1], cy) && near(item.pitchDiameter, pitchRadius * 2) && near(item.holeDiameter, a.radius * 2) && item.holeCenters.every((other, index)=>near(other[0], holeCenters[index][0]) && near(other[1], holeCenters[index][1])))) continue;
        const quarterTurn = Math.PI / 2;
        const angle = Math.atan2(holeCenters[0][1] - cy, holeCenters[0][0] - cx);
        const normalizedAngle = (angle % quarterTurn + quarterTurn) % quarterTurn;
        const startAngleRadians = Math.min(normalizedAngle, quarterTurn - normalizedAngle) < 1e-10 ? 0 : normalizedAngle;
        found.push({
            center: [
                cx,
                cy
            ],
            pitchDiameter: pitchRadius * 2,
            holeDiameter: a.radius * 2,
            startAngleRadians,
            holeCenters
        });
    }
    found.sort((left, right)=>left.center[0] - right.center[0] || left.center[1] - right.center[1] || left.pitchDiameter - right.pitchDiameter || left.holeDiameter - right.holeDiameter);
    return {
        status: found.length === 0 ? 'none' : found.length === 1 ? 'match' : 'ambiguous',
        candidates: found
    };
}
