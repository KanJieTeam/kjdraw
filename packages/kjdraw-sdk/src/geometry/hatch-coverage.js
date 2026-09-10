// Generated from hatch-coverage.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from '../errors.js';
const invalid = ()=>{
    throw new KJValidationError('Invalid HATCH stroke coverage input');
};
const finite = (value)=>typeof value === 'number' && Number.isFinite(value);
const validPoint = (value)=>Array.isArray(value) && value.length >= 2 && finite(value[0]) && finite(value[1]);
export function createHatchStrokeCoverage(lines, strokeWidth) {
    if (!Array.isArray(lines) || lines.length > 4096 || !finite(strokeWidth) || strokeWidth <= 0) return invalid();
    const half = strokeWidth / 2;
    const families = lines.map((line)=>{
        if (!line || !finite(line.angle) || !validPoint(line.base) || !validPoint(line.offset) || !Array.isArray(line.dashes) || line.dashes.length > 128 || !line.dashes.every(finite)) return invalid();
        const u = [
            Math.cos(line.angle),
            Math.sin(line.angle)
        ], n = [
            -u[1],
            u[0]
        ];
        const along = line.offset[0] * u[0] + line.offset[1] * u[1];
        const spacing = line.offset[0] * n[0] + line.offset[1] * n[1];
        let cycle = 0;
        const intervals = [];
        for (const dash of line.dashes){
            const next = cycle + Math.abs(dash);
            if (dash > 0) intervals.push([
                cycle,
                next
            ]);
            cycle = next;
        }
        if (!finite(along) || !finite(spacing) || !finite(cycle) || line.dashes.length && cycle <= 0) return invalid();
        return {
            u,
            n,
            base: [
                line.base[0],
                line.base[1]
            ],
            spacing,
            cycle,
            residual: cycle ? along - Math.round(along / cycle) * cycle : 0,
            errorScale: Math.abs(line.offset[0]) + Math.abs(line.offset[1]) + cycle,
            intervals,
            continuous: !line.dashes.length,
            dots: line.dashes.includes(0)
        };
    });
    return Object.freeze({
        sample (point, budget = 128) {
            if (!validPoint(point) || !Number.isSafeInteger(budget) || budget < 1) return invalid();
            let work = 0, unresolved;
            const finish = (covered, reason)=>({
                    covered,
                    limited: covered === null,
                    work,
                    ...reason ? {
                        reason
                    } : {}
                });
            const consume = ()=>{
                if (work >= budget) return false;
                work++;
                return true;
            };
            for (const line of families){
                if (!consume()) return finish(null, 'budget');
                if (line.dots) {
                    unresolved ??= 'unsupported-dots';
                    continue;
                }
                if (!line.continuous && !line.intervals.length) continue;
                const dx = point[0] - line.base[0], dy = point[1] - line.base[1];
                const x = dx * line.u[0] + dy * line.u[1], y = dx * line.n[0] + dy * line.n[1];
                const rowMagnitude = line.spacing === 0 ? 0 : (Math.abs(y) + half) / Math.abs(line.spacing);
                const epsilon = Number.EPSILON * 32 * (1 + Math.abs(point[0]) + Math.abs(point[1]) + Math.abs(line.base[0]) + Math.abs(line.base[1]) + Math.abs(x) + Math.abs(y) + (rowMagnitude + 2) * line.errorScale);
                if (![
                    x,
                    y,
                    rowMagnitude,
                    epsilon,
                    line.residual
                ].every(finite) || rowMagnitude > Number.MAX_SAFE_INTEGER - 4 || epsilon >= half) {
                    unresolved ??= 'numeric-range';
                    continue;
                }
                if (line.continuous) {
                    const row = line.spacing === 0 ? 0 : Math.round(y / line.spacing);
                    const distance = Math.abs(y - row * line.spacing);
                    if (distance < half - epsilon) return finish(true);
                    if (distance <= half + epsilon) unresolved ??= 'numeric-boundary';
                    continue;
                }
                if (line.spacing === 0 && line.residual !== 0) {
                    unresolved ??= 'unsupported-collinear-phase';
                    continue;
                }
                const contains = (margin)=>{
                    const width = half + margin;
                    if (line.spacing === 0 && Math.abs(y) > width) return false;
                    const r0 = line.spacing === 0 ? 0 : (y - width) / line.spacing;
                    const r1 = line.spacing === 0 ? 0 : (y + width) / line.spacing;
                    const first = Math.ceil(Math.min(r0, r1)), last = Math.floor(Math.max(r0, r1));
                    if (![
                        first,
                        last
                    ].every(Number.isSafeInteger)) {
                        unresolved ??= 'numeric-range';
                        return null;
                    }
                    if (first > last) return false;
                    const a = x - first * line.residual, b = x - last * line.residual;
                    for (const interval of line.intervals){
                        const start = interval[0] - margin, end = interval[1] + margin;
                        if (start > end) continue;
                        const repeatFirst = Math.ceil((Math.min(a, b) - end) / line.cycle);
                        const repeatLast = Math.floor((Math.max(a, b) - start) / line.cycle);
                        if (![
                            repeatFirst,
                            repeatLast
                        ].every(Number.isSafeInteger)) {
                            unresolved ??= 'numeric-range';
                            return null;
                        }
                        for(let repeat = repeatFirst; repeat <= repeatLast; repeat++){
                            if (!consume()) {
                                unresolved = 'budget';
                                return null;
                            }
                            if (line.residual === 0) {
                                const phase = x - repeat * line.cycle;
                                if (phase >= start && phase <= end) return true;
                            } else {
                                const q0 = (x - repeat * line.cycle - end) / line.residual;
                                const q1 = (x - repeat * line.cycle - start) / line.residual;
                                if (Math.ceil(Math.max(first, Math.min(q0, q1))) <= Math.floor(Math.min(last, Math.max(q0, q1)))) return true;
                            }
                        }
                    }
                    return false;
                };
                const outer = contains(epsilon);
                if (outer === false) continue;
                if (outer === null) {
                    if (unresolved === 'budget') return finish(null, 'budget');
                    continue;
                }
                const inner = contains(-epsilon);
                if (inner === true) return finish(true);
                if (unresolved === 'budget') return finish(null, 'budget');
                unresolved ??= 'numeric-boundary';
            }
            return unresolved ? finish(null, unresolved) : finish(false);
        }
    });
}
