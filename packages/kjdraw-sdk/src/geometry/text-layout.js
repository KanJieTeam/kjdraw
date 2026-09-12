// Generated from text-layout.ts by scripts/build-typescript.mjs. Do not edit directly.
import { KJValidationError } from '../errors.js';
const number = (value, fallback = 0)=>value == null ? fallback : typeof value === 'number' && Number.isFinite(value) ? value : NaN;
const point = (value)=>Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every((v)=>typeof v === 'number' && Number.isFinite(v)) ? [
        value[0],
        value[1]
    ] : null;
export function textFontFamily(style = {}, fallback = 'ui-monospace, SFMono-Regular, Consolas, monospace') {
    const file = String(style.fontFile ?? style.fontFamily ?? '').split(/[\\/]/).at(-1).replace(/\.(?:ttf|ttc|otf|shx)$/i, '');
    const known = {
        times: 'Times New Roman',
        arial: 'Arial',
        simsun: 'SimSun',
        simhei: 'SimHei',
        simplex_: 'Simplex',
        txt_____: 'Txt',
        italic__: 'Italic'
    };
    const family = known[file.toLowerCase()] ?? (/^[\p{L}\p{N} _-]{1,80}$/u.test(file) ? file : '');
    return family ? `${JSON.stringify(family)}, ${fallback}` : fallback;
}
export function layoutCadText(payload, style = {}, measure) {
    const value = String(payload.text ?? payload.defaultValue ?? payload.value ?? ''), family = textFontFamily(style);
    const fixedHeight = number(style.fixedHeight), height = fixedHeight > 0 ? fixedHeight : number(payload.height, 2.5), widthFactor = number(payload.widthFactor, number(style.widthFactor, 1));
    const attachment = number(payload.attachmentPoint), horizontal = attachment ? (attachment - 1) % 3 : number(payload.horizontalAlignment), vertical = attachment ? attachment <= 3 ? 3 : attachment <= 6 ? 2 : 0 : number(payload.verticalAlignment), flags = number(payload.generationFlags);
    let position = point(payload.position), rotation = number(payload.rotation), xScale = widthFactor, yScale = 1;
    const oblique = number(payload.obliqueAngle, number(style.obliqueAngle)), alignment = point(payload.alignmentPoint);
    if (!position || ![
        height,
        widthFactor,
        horizontal,
        vertical,
        flags,
        rotation,
        oblique
    ].every(Number.isFinite) || height <= 0 || widthFactor <= 0 || ![
        0,
        1,
        2,
        3,
        4,
        5
    ].includes(horizontal) || ![
        0,
        1,
        2,
        3
    ].includes(vertical)) throw new KJValidationError('Unsupported CAD text placement');
    const naturalWidth = measure ? measure(value, height, family) : Math.max(height * .4, [
        ...value
    ].reduce((sum, char)=>sum + (char.charCodeAt(0) > 255 ? 1 : .6), 0) * height);
    if (!Number.isFinite(naturalWidth) || naturalWidth < 0) throw new KJValidationError('Invalid CAD text metrics');
    if (horizontal === 3 || horizontal === 5) {
        if (!alignment || naturalWidth <= 0) throw new KJValidationError('Fitted CAD text requires two distinct points');
        const dx = alignment[0] - position[0], dy = alignment[1] - position[1], length = Math.hypot(dx, dy);
        if (length <= 0) throw new KJValidationError('Fitted CAD text requires two distinct points');
        rotation = Math.atan2(dy, dx);
        xScale = length / naturalWidth;
        if (horizontal === 3) yScale = xScale / widthFactor;
    } else if (horizontal || vertical) {
        if (!alignment) throw new KJValidationError('Aligned CAD text requires an alignment point');
        position = alignment;
    }
    const left = horizontal === 1 || horizontal === 4 ? -naturalWidth / 2 : horizontal === 2 ? -naturalWidth : 0;
    const bottom = horizontal === 4 || vertical === 2 ? -height / 2 : vertical === 3 ? -height : 0;
    if ((flags & 2) !== 0 || payload.mirrored === true) xScale *= -1;
    if ((flags & 4) !== 0) yScale *= -1;
    const shear = Math.tan(oblique), c = Math.cos(rotation), s = Math.sin(rotation);
    if (!Number.isFinite(shear)) throw new KJValidationError('Invalid text oblique angle');
    const matrix = [
        c * xScale,
        s * xScale,
        (c * shear - s) * yScale,
        (s * shear + c) * yScale,
        position[0],
        position[1]
    ];
    const transform = (p)=>[
            matrix[0] * p[0] + matrix[2] * p[1] + matrix[4],
            matrix[1] * p[0] + matrix[3] * p[1] + matrix[5]
        ];
    return {
        text: value,
        family,
        height,
        left,
        bottom,
        width: naturalWidth,
        matrix,
        corners: [
            [
                left,
                bottom
            ],
            [
                left + naturalWidth,
                bottom
            ],
            [
                left + naturalWidth,
                bottom + height
            ],
            [
                left,
                bottom + height
            ]
        ].map((p)=>transform(p))
    };
}
