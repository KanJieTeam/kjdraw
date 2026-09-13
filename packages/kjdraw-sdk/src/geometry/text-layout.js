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
function plainMText(value) {
    if (value.length > 65_536) throw new KJValidationError('MTEXT exceeds the 65536 character layout budget');
    if (/[{}]/.test(value)) throw new KJValidationError('Rich MTEXT formatting is not supported');
    const escaped = '\u0000';
    const plain = value.replaceAll('\\\\', escaped).replace(/\\P/gi, '\n');
    if (/\\[A-Za-z~]/.test(plain)) throw new KJValidationError('Rich MTEXT formatting is not supported');
    return plain.replaceAll(escaped, '\\').replace(/\r\n?/g, '\n');
}
export function layoutCadMText(payload, style = {}, measure) {
    const family = textFontFamily(style), fixedHeight = number(style.fixedHeight);
    const height = fixedHeight > 0 ? fixedHeight : number(payload.height, 2.5);
    const widthFactor = number(payload.widthFactor, number(style.widthFactor, 1)), rotation = number(payload.rotation);
    const oblique = number(payload.obliqueAngle, number(style.obliqueAngle)), attachment = number(payload.attachmentPoint, 1);
    const spacing = number(payload.lineSpacingFactor, number(payload.lineSpacing, 1.2)), position = point(payload.position);
    const referenceWidth = payload.width == null ? null : number(payload.width);
    if (!position || ![
        height,
        widthFactor,
        rotation,
        oblique,
        attachment,
        spacing,
        referenceWidth ?? 1
    ].every(Number.isFinite) || height <= 0 || widthFactor <= 0 || !Number.isInteger(attachment) || attachment < 1 || attachment > 9 || spacing < .25 || spacing > 4 || referenceWidth != null && referenceWidth <= 0) throw new KJValidationError('Unsupported CAD multiline text placement');
    const shear = Math.tan(oblique);
    if (!Number.isFinite(shear)) throw new KJValidationError('Invalid text oblique angle');
    const metric = (value)=>{
        const result = measure ? measure(value, height, family) : Math.max(value ? height * .4 : 0, [
            ...value
        ].reduce((sum, char)=>sum + (char.codePointAt(0) > 255 ? 1 : .6), 0) * height);
        if (!Number.isFinite(result) || result < 0) throw new KJValidationError('Invalid CAD text metrics');
        return result;
    };
    const limit = referenceWidth == null ? Infinity : referenceWidth / widthFactor;
    const rows = [];
    for (const paragraph of plainMText(String(payload.text ?? '')).split('\n')){
        if (!paragraph || limit === Infinity) {
            rows.push(paragraph);
            continue;
        }
        let line = '', lineWidth = 0;
        for (const char of paragraph){
            const charWidth = metric(char);
            if (line && lineWidth + charWidth > limit) {
                rows.push(line);
                line = char === ' ' ? '' : char;
                lineWidth = char === ' ' ? 0 : charWidth;
            } else {
                line += char;
                lineWidth += charWidth;
            }
        }
        rows.push(line);
    }
    if (!rows.length) rows.push('');
    if (rows.length > 4096) throw new KJValidationError('MTEXT exceeds the 4096 line layout budget');
    const widths = rows.map(metric), contentWidth = Math.max(0, ...widths), boxWidth = referenceWidth == null ? contentWidth : limit;
    const advance = height * spacing, boxHeight = height + (rows.length - 1) * advance;
    const column = (attachment - 1) % 3, band = Math.floor((attachment - 1) / 3);
    const left = column === 0 ? 0 : column === 1 ? -boxWidth / 2 : -boxWidth;
    const top = band === 0 ? 0 : band === 1 ? boxHeight / 2 : boxHeight;
    const lines = rows.map((text, index)=>({
            text,
            width: widths[index],
            left: column === 0 ? left : column === 1 ? -widths[index] / 2 : -widths[index],
            baseline: top - height - index * advance
        }));
    const flags = number(payload.generationFlags), xScale = widthFactor * ((flags & 2) !== 0 || payload.mirrored === true ? -1 : 1), yScale = (flags & 4) !== 0 ? -1 : 1;
    const c = Math.cos(rotation), s = Math.sin(rotation);
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
    const bottom = top - boxHeight;
    const corners = [
        [
            left,
            bottom
        ],
        [
            left + boxWidth,
            bottom
        ],
        [
            left + boxWidth,
            top
        ],
        [
            left,
            top
        ]
    ];
    return {
        text: String(payload.text ?? ''),
        family,
        height,
        width: boxWidth,
        lineAdvance: advance,
        lines,
        matrix,
        corners: corners.map(transform)
    };
}
