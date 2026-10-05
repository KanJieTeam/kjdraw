//! Bounded, JSON-based native line/arc region operations.
//!
//! No wasm-bindgen or host imports are required. Inputs are allocated by the
//! caller; results remain owned by this module until the next `run` call.

use cavalier_contours::{
    core::{math::Vector2, Control},
    polyline::{
        BooleanOp, BooleanResultInfo, FindIntersectsOptions, PlineBooleanOptions, PlineCreation,
        PlineIntersect, PlineSelfIntersectOptions, PlineSource, PlineSourceMut, PlineVertex,
        Polyline,
    },
    shape_algorithms::{Shape, ShapeOffsetOptions},
};
use serde::{Deserialize, Serialize};
use std::{cell::RefCell, collections::HashMap, f64::consts::PI};

const MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_INPUT_LOOPS: usize = 64;
const MAX_INPUT_VERTICES: usize = 4096;
const MAX_EXPANDED_VERTICES: usize = 8192;
const MAX_OUTPUT_LOOPS: usize = 256;
const MAX_OUTPUT_VERTICES: usize = 32768;
const MAX_COORDINATE: f64 = 1e9;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    operation: String,
    contours: Vec<Vec<[f64; 3]>>,
    distance: Option<f64>,
    tolerance: f64,
}

#[derive(Debug, Serialize)]
struct Contour {
    vertices: Vec<[f64; 3]>,
    area: f64,
    hole: bool,
}

#[derive(Debug, Serialize)]
struct ResultGeometry {
    contours: Vec<Contour>,
    area: f64,
}

fn coordinate_valid(value: f64) -> bool {
    value.is_finite() && value.abs() <= MAX_COORDINATE
}

// Translating each ring independently avoids cancellation between small parts
// located far apart. Small-angle circular segment areas use a series rather
// than subtracting two almost equal sector/triangle areas.
fn stable_area<P: PlineSource<Num = f64> + ?Sized>(pline: &P) -> f64 {
    if !pline.is_closed() || pline.vertex_count() < 2 {
        return 0.0;
    }
    let origin = pline.at(0);
    let mut sum = 0.0;
    let mut correction = 0.0;
    for (a, b) in pline.iter_segments() {
        let mut term = (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
        if a.bulge != 0.0 {
            let sweep = 4.0 * a.bulge.atan();
            let radius =
                (b.x - a.x).hypot(b.y - a.y) * (1.0 + a.bulge * a.bulge) / (4.0 * a.bulge.abs());
            let segment = if sweep.abs() < 1e-3 {
                let t2 = sweep * sweep;
                sweep * t2 * (1.0 / 6.0 - t2 / 120.0 + t2 * t2 / 5040.0 - t2 * t2 * t2 / 362880.0)
            } else {
                sweep - sweep.sin()
            };
            term += radius * radius * segment;
        }
        let adjusted = term - correction;
        let next = sum + adjusted;
        correction = (next - sum) - adjusted;
        sum = next;
    }
    sum / 2.0
}

// Use the upstream extension traits so boolean classification, winding and
// collapsed-area checks also receive the stable metric, not merely receipts.
#[derive(Clone)]
struct StablePolyline(Polyline);
impl PlineSource for StablePolyline {
    type Num = f64;
    type OutputPolyline = Self;
    fn get_userdata_count(&self) -> usize {
        self.0.get_userdata_count()
    }
    fn get_userdata_values(&self) -> impl Iterator<Item = u64> + '_ {
        self.0.get_userdata_values()
    }
    fn vertex_count(&self) -> usize {
        self.0.vertex_count()
    }
    fn is_closed(&self) -> bool {
        self.0.is_closed()
    }
    fn get(&self, index: usize) -> Option<PlineVertex> {
        self.0.get(index)
    }
    fn at(&self, index: usize) -> PlineVertex {
        self.0.at(index)
    }
    fn area(&self) -> f64 {
        stable_area(self)
    }
}
impl PlineSourceMut for StablePolyline {
    fn set_userdata_values(&mut self, values: impl IntoIterator<Item = u64>) {
        self.0.set_userdata_values(values);
    }
    fn add_userdata_values(&mut self, values: impl IntoIterator<Item = u64>) {
        self.0.add_userdata_values(values);
    }
    fn set_vertex(&mut self, index: usize, vertex: PlineVertex) {
        self.0.set_vertex(index, vertex);
    }
    fn insert_vertex(&mut self, index: usize, vertex: PlineVertex) {
        self.0.insert_vertex(index, vertex);
    }
    fn remove(&mut self, index: usize) -> PlineVertex {
        self.0.remove(index)
    }
    fn clear(&mut self) {
        self.0.clear();
    }
    fn add_vertex(&mut self, vertex: PlineVertex) {
        self.0.add_vertex(vertex);
    }
    fn reserve(&mut self, additional: usize) {
        self.0.reserve(additional);
    }
    fn set_is_closed(&mut self, closed: bool) {
        self.0.set_is_closed(closed);
    }
    fn extend_vertexes<I: IntoIterator<Item = PlineVertex>>(&mut self, vertices: I) {
        self.0.extend_vertexes(vertices);
    }
}
impl PlineCreation for StablePolyline {
    fn with_capacity(capacity: usize, closed: bool) -> Self {
        Self(Polyline::with_capacity(capacity, closed))
    }
    fn from_iter<I: Iterator<Item = PlineVertex>>(vertices: I, closed: bool) -> Self {
        Self(Polyline::from_iter(vertices, closed))
    }
}

fn checked_translation(x: f64, y: f64, dx: f64, dy: f64) -> ([f64; 2], [f64; 2]) {
    let shifted = [x + dx, y + dy];
    // Error-free TwoSum residual measures the actual rounding of each
    // translation. Unlike a blanket coordinate-scale bound, exact integer
    // world coordinates continue to work at a tighter requested tolerance.
    let residual = |a: f64, b: f64, sum: f64| {
        let rounded_b = sum - a;
        (a - (sum - rounded_b)) + (b - rounded_b)
    };
    let error = [residual(x, dx, shifted[0]), residual(y, dy, shifted[1])];
    (shifted, error)
}

// A line interpolates its endpoint residuals. For a fixed-bulge circular arc,
// every point's residual is the midpoint residual plus a rotated/scaled chord
// residual. Its coefficient has norm at most max(1, |bulge|)/2. This includes
// the center/radius change of two semicircles, not merely coordinate components.
fn translation_boundary_error(rows: &[[f64; 3]], errors: &[[f64; 2]]) -> f64 {
    rows.iter().enumerate().fold(0.0_f64, |maximum, (i, row)| {
        let a = errors[i];
        let b = errors[(i + 1) % errors.len()];
        let error = if row[2] == 0.0 {
            a[0].hypot(a[1]).max(b[0].hypot(b[1]))
        } else {
            ((a[0] + b[0]) / 2.0).hypot((a[1] + b[1]) / 2.0)
                + row[2].abs().max(1.0) / 2.0 * (a[0] - b[0]).hypot(a[1] - b[1])
        };
        maximum.max(error)
    })
}

fn add_translation_error(used: f64, next: f64, eps: f64) -> Result<f64, String> {
    let total = used + next;
    if !total.is_finite() || total > eps {
        return Err(
            "Coordinate translation cumulative error cannot preserve the requested absolute tolerance"
                .into(),
        );
    }
    Ok(total)
}

fn require_exact_source_translation(error: f64) -> Result<(), String> {
    if error != 0.0 {
        // Perturbing the inputs of near-tangent Boolean or merging offset
        // boundaries can amplify even tiny source-coordinate quantization.
        // A one-to-one tolerance deduction cannot certify that topology.
        return Err("Coordinate translation would alter source geometry before the operation; exact source localization is required".into());
    }
    Ok(())
}

fn translate(pline: &mut Polyline, x: f64, y: f64) -> f64 {
    let rows: Vec<_> = pline.iter_vertexes().map(|v| [v.x, v.y, v.bulge]).collect();
    let mut errors = Vec::with_capacity(rows.len());
    for index in 0..pline.vertex_count() {
        let vertex = pline.at(index);
        let (shifted, error) = checked_translation(vertex.x, vertex.y, x, y);
        pline.set(index, shifted[0], shifted[1], vertex.bulge);
        errors.push(error);
    }
    translation_boundary_error(&rows, &errors)
}

fn offset_regions(
    plines: Vec<Polyline>,
    distance: f64,
    eps: f64,
) -> Result<Vec<(Polyline, bool, f64)>, String> {
    let bounds: Vec<_> = plines
        .iter()
        .map(|p| p.extents().expect("validated nonempty contour"))
        .collect();
    let mut groups: Vec<usize> = (0..plines.len()).collect();
    let padding = distance.abs() * 2.0 + eps;
    for i in 0..plines.len() {
        for j in (i + 1)..plines.len() {
            let a = bounds[i];
            let b = bounds[j];
            if a.min_x <= b.max_x + padding
                && a.max_x + padding >= b.min_x
                && a.min_y <= b.max_y + padding
                && a.max_y + padding >= b.min_y
            {
                let old = groups[j];
                let replacement = groups[i];
                for group in &mut groups {
                    if *group == old {
                        *group = replacement;
                    }
                }
            }
        }
    }
    let mut output = Vec::new();
    for group in 0..plines.len() {
        if !groups.contains(&group) {
            continue;
        }
        let mut members: Vec<_> = plines
            .iter()
            .enumerate()
            .filter(|(i, _)| groups[*i] == group)
            .map(|(_, p)| p.clone())
            .collect();
        let mut min = [f64::INFINITY; 2];
        let mut max = [f64::NEG_INFINITY; 2];
        for member in &members {
            for vertex in member.iter_vertexes() {
                min[0] = min[0].min(vertex.x);
                min[1] = min[1].min(vertex.y);
                max[0] = max[0].max(vertex.x);
                max[1] = max[1].max(vertex.y);
            }
        }
        let origin = [(min[0] + max[0]) / 2.0, (min[1] + max[1]) / 2.0];
        let mut group_error = 0.0_f64;
        let input_area: f64 = members.iter().map(stable_area).sum();
        let area_tolerance = members.iter().map(|p| p.path_length()).sum::<f64>() * eps * 8.0;
        for member in &mut members {
            group_error = group_error.max(translate(member, -origin[0], -origin[1]));
            if (member.area() - stable_area(member)).abs() > eps * member.path_length() * 8.0
                || (member.area() < 0.0) != (stable_area(member) < 0.0)
            {
                return Err("Region extent cannot preserve internal offset area classification at this tolerance".into());
            }
        }
        require_exact_source_translation(group_error)?;
        let result = Shape::from_plines(members).parallel_offset(
            -distance,
            &ShapeOffsetOptions {
                pos_equal_eps: eps,
                offset_dist_eps: eps,
                slice_join_eps: eps,
            },
        );
        let mut local_output: Vec<_> = result
            .ccw_plines
            .into_iter()
            .map(|p| (p.polyline, false))
            .chain(result.cw_plines.into_iter().map(|p| (p.polyline, true)))
            .collect();
        let result_area: f64 = local_output.iter().map(|(p, _)| stable_area(p)).sum();
        if (distance > 0.0 && result_area + area_tolerance < input_area)
            || (distance < 0.0 && result_area > input_area + area_tolerance)
        {
            return Err("Offset result violates region area monotonicity at this tolerance".into());
        }
        for (pline, hole) in &mut local_output {
            if (stable_area(pline) < 0.0) != *hole {
                return Err(
                    "Offset result has unstable boundary classification at this tolerance".into(),
                );
            }
            let error = translate(pline, origin[0], origin[1]);
            let total = add_translation_error(0.0, error, eps)?;
            output.push((pline.clone(), *hole, total));
        }
    }
    Ok(output)
}

fn read_contour(rows: &[[f64; 3]], eps: f64) -> Result<Polyline, String> {
    if rows.len() < 2 {
        return Err("Each closed contour needs at least two vertices".into());
    }
    let mut pline = Polyline::new_closed();
    for (index, &[x, y, bulge]) in rows.iter().enumerate() {
        if !coordinate_valid(x) || !coordinate_valid(y) || !bulge.is_finite() || bulge.abs() > 1e6 {
            return Err("Coordinates or bulges are non-finite or exceed supported bounds".into());
        }
        // Upstream uses a fixed 1e-8 threshold to classify bulges as straight
        // lines, independently of positional tolerance. Refuse shallow arcs
        // explicitly instead of silently flattening a long, significant arc.
        if bulge != 0.0 && bulge.abs() < 1e-8 {
            return Err(
                "Nonzero arc bulges smaller than 1e-8 are outside the numerical contract".into(),
            );
        }
        let [ex, ey, _] = rows[(index + 1) % rows.len()];
        let dx = ex - x;
        let dy = ey - y;
        if dx.hypot(dy) <= eps {
            return Err("Contour has a zero-length or tolerance-sized segment".into());
        }
        if bulge != 0.0 {
            let radius = dx.hypot(dy) * (1.0 + bulge * bulge) / (4.0 * bulge.abs());
            if radius * f64::EPSILON * 16.0 > eps {
                return Err(
                    "Derived arc radius cannot preserve the requested absolute tolerance".into(),
                );
            }
        }
        if bulge.abs() <= 1.0 {
            pline.add(x, y, bulge);
            continue;
        }
        // Cavalier Contours accepts arcs of at most PI radians. Split larger
        // CAD bulges into exact circular arcs rather than tessellating them.
        let sweep = 4.0 * bulge.atan();
        let parts = (sweep.abs() / PI).ceil() as usize;
        let center_scale = (1.0 - bulge * bulge) / (4.0 * bulge);
        let cx = (x + ex) / 2.0 - dy * center_scale;
        let cy = (y + ey) / 2.0 + dx * center_scale;
        let radius = (x - cx).hypot(y - cy);
        let start = (y - cy).atan2(x - cx);
        let step = sweep / parts as f64;
        let part_bulge = (step / 4.0).tan();
        pline.add(x, y, part_bulge);
        for part in 1..parts {
            let angle = start + step * part as f64;
            let px = cx + radius * angle.cos();
            let py = cy + radius * angle.sin();
            if !coordinate_valid(px) || !coordinate_valid(py) {
                return Err("Arc extent exceeds supported coordinate bounds".into());
            }
            pline.add(px, py, part_bulge);
        }
    }
    if pline.vertex_count() > MAX_EXPANDED_VERTICES {
        return Err("Expanded contour exceeds the vertex limit".into());
    }
    let mut self_intersection = false;
    pline.visit_self_intersects_opt(
        &mut |_: PlineIntersect<f64>| {
            self_intersection = true;
            Control::Break(())
        },
        &PlineSelfIntersectOptions {
            pos_equal_eps: eps,
            ..Default::default()
        },
    );
    if self_intersection {
        return Err("Self-intersecting contours are not supported".into());
    }
    if !stable_area(&pline).is_finite() || stable_area(&pline).abs() <= eps * eps {
        return Err("Contour is degenerate or has no area at this tolerance".into());
    }
    Ok(pline)
}

fn validate_region(plines: &[Polyline], eps: f64) -> Result<(), String> {
    for i in 0..plines.len() {
        for j in (i + 1)..plines.len() {
            let intersections = plines[i].find_intersects_opt(
                &plines[j],
                &FindIntersectsOptions {
                    pos_equal_eps: eps,
                    ..Default::default()
                },
            );
            if !intersections.basic_intersects.is_empty()
                || !intersections.overlapping_intersects.is_empty()
            {
                return Err("Offset region boundaries may not touch, overlap or intersect".into());
            }
        }
        let vertex = plines[i].at(0);
        let depth = plines
            .iter()
            .enumerate()
            .filter(|(j, p)| *j != i && p.winding_number(Vector2::new(vertex.x, vertex.y)) != 0)
            .count();
        if (stable_area(&plines[i]) > 0.0) != (depth % 2 == 0) {
            return Err("Offset regions require CCW outer boundaries and CW holes".into());
        }
    }
    Ok(())
}

fn output_contour(mut pline: Polyline, hole: bool, eps: f64) -> Result<Contour, String> {
    if (stable_area(&pline) < 0.0) != hole {
        pline.invert_direction_mut();
    }
    let area = stable_area(&pline);
    for (a, b) in pline.iter_segments() {
        if a.bulge != 0.0 {
            let radius =
                (b.x - a.x).hypot(b.y - a.y) * (1.0 + a.bulge * a.bulge) / (4.0 * a.bulge.abs());
            if radius * f64::EPSILON * 16.0 > eps {
                return Err(
                    "Result arc radius cannot preserve the requested absolute tolerance".into(),
                );
            }
        }
    }
    let vertices: Vec<_> = pline.iter_vertexes().map(|v| [v.x, v.y, v.bulge]).collect();
    if vertices.len() < 2
        || !area.is_finite()
        || area.abs() <= eps * eps
        || vertices
            .iter()
            .any(|v| !coordinate_valid(v[0]) || !coordinate_valid(v[1]) || !v[2].is_finite())
    {
        return Err("Kernel produced a non-finite or degenerate result".into());
    }
    Ok(Contour {
        vertices,
        area,
        hole,
    })
}

fn run_geometry(mut request: Request) -> Result<ResultGeometry, String> {
    if !request.tolerance.is_finite() || !(1e-9..=1e-2).contains(&request.tolerance) {
        return Err("Tolerance must be finite and between 1e-9 and 1e-2".into());
    }
    if request.contours.is_empty()
        || request.contours.len() > MAX_INPUT_LOOPS
        || request.contours.iter().map(Vec::len).sum::<usize>() > MAX_INPUT_VERTICES
    {
        return Err("Input exceeds the contour or vertex limit, or is empty".into());
    }
    let eps = request.tolerance;
    // Work near a common origin. The upstream orientation/area formula is a
    // world-space shoelace sum; a small part translated near 1e9 would otherwise
    // lose its area to cancellation. Translation preserves native arc bulges.
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for vertices in &request.contours {
        for vertex in vertices {
            if !coordinate_valid(vertex[0]) || !coordinate_valid(vertex[1]) {
                return Err("Coordinates are non-finite or exceed supported bounds".into());
            }
            bounds[0] = bounds[0].min(vertex[0]);
            bounds[1] = bounds[1].min(vertex[1]);
            bounds[2] = bounds[2].max(vertex[0]);
            bounds[3] = bounds[3].max(vertex[1]);
        }
    }
    let origin = [(bounds[0] + bounds[2]) / 2.0, (bounds[1] + bounds[3]) / 2.0];
    for vertices in &mut request.contours {
        let mut errors = Vec::with_capacity(vertices.len());
        for vertex in vertices.iter_mut() {
            let (shifted, error) =
                checked_translation(vertex[0], vertex[1], -origin[0], -origin[1]);
            vertex[0] = shifted[0];
            vertex[1] = shifted[1];
            errors.push(error);
        }
        let error = translation_boundary_error(vertices, &errors);
        require_exact_source_translation(error)?;
    }
    let mut plines = request
        .contours
        .iter()
        .map(|p| read_contour(p, eps))
        .collect::<Result<Vec<_>, _>>()?;
    if plines.iter().map(|p| p.vertex_count()).sum::<usize>() > MAX_EXPANDED_VERTICES {
        return Err("Expanded contours exceed the vertex limit".into());
    }
    let output = if request.operation == "offset" {
        let distance = request.distance.ok_or("Offset requires distance")?;
        if !distance.is_finite() || distance.abs() > MAX_COORDINATE {
            return Err("Offset distance is non-finite or exceeds supported bounds".into());
        }
        // A single CAD outline has no hole ambiguity: clockwise input describes
        // the same filled region. Multiple boundaries use explicit outer/hole
        // winding and are checked against their actual nesting below.
        if plines.len() == 1 && stable_area(&plines[0]) < 0.0 {
            plines[0].invert_direction_mut();
        }
        validate_region(&plines, eps)?;
        if distance == 0.0 {
            plines
                .into_iter()
                .map(|p| {
                    let hole = stable_area(&p) < 0.0;
                    (p, hole, 0.0)
                })
                .collect::<Vec<_>>()
        } else {
            offset_regions(plines, distance, eps)?
        }
    } else {
        if plines.len() != 2 {
            return Err("Boolean operations require exactly two simple closed contours".into());
        }
        let operation = match request.operation.as_str() {
            "union" => BooleanOp::Or,
            "intersection" => BooleanOp::And,
            "difference" => BooleanOp::Not,
            _ => return Err("Unsupported contour operation".into()),
        };
        for pline in &mut plines {
            if stable_area(pline) < 0.0 {
                pline.invert_direction_mut();
            }
        }
        let result = StablePolyline(plines[0].clone()).boolean_opt(
            &StablePolyline(plines[1].clone()),
            operation,
            &PlineBooleanOptions {
                pos_equal_eps: eps,
                collapsed_area_eps: Some(eps * eps),
                ..Default::default()
            },
        );
        if matches!(result.result_info, BooleanResultInfo::InvalidInput) {
            return Err("Kernel rejected the boolean inputs".into());
        }
        result
            .pos_plines
            .into_iter()
            .map(|p| (p.pline.0, false, 0.0))
            .chain(
                result
                    .neg_plines
                    .into_iter()
                    .map(|p| (p.pline.0, true, 0.0)),
            )
            .collect()
    };
    if output.len() > MAX_OUTPUT_LOOPS
        || output
            .iter()
            .map(|(p, _, _)| p.vertex_count())
            .sum::<usize>()
            > MAX_OUTPUT_VERTICES
    {
        return Err("Result exceeds the contour or vertex limit".into());
    }
    let mut contours = Vec::with_capacity(output.len());
    for (mut pline, hole, used_error) in output {
        if (stable_area(&pline) < 0.0) != hole {
            pline.invert_direction_mut();
        }
        let error = translate(&mut pline, origin[0], origin[1]);
        add_translation_error(used_error, error, eps)?;
        if (stable_area(&pline) < 0.0) != hole {
            return Err(
                "Final world coordinates have invalid region area or boundary classification"
                    .into(),
            );
        }
        let contour = output_contour(pline, hole, eps)?;
        if !contour.area.is_finite()
            || contour.area.abs() <= eps * eps
            || (contour.area < 0.0) != contour.hole
        {
            return Err(
                "Final world coordinates have invalid region area or boundary classification"
                    .into(),
            );
        }
        contours.push(contour);
    }
    let mut area: f64 = contours.iter().map(|p| p.area).sum();
    if area == 0.0 {
        area = 0.0;
    }
    if !area.is_finite() || area < -eps * eps {
        return Err("Kernel produced invalid region area".into());
    }
    Ok(ResultGeometry { contours, area })
}

/// Parse and evaluate one bounded request. Errors use the same JSON envelope in
/// Rust tests and the wasm ABI, so invalid requests cannot be mistaken for an
/// empty (but valid) geometric result.
pub fn evaluate_json(bytes: &[u8]) -> Vec<u8> {
    let result = if bytes.len() > MAX_BYTES {
        Err("Request exceeds the byte limit".to_owned())
    } else {
        serde_json::from_slice::<Request>(bytes)
            .map_err(|e| format!("Invalid contour request: {e}"))
            .and_then(run_geometry)
    };
    match result {
        Ok(value) => serde_json::to_vec(&value).expect("finite contour results are serializable"),
        Err(error) => serde_json::to_vec(&serde_json::json!({ "error": error })).unwrap(),
    }
}

thread_local! {
    static INPUTS: RefCell<HashMap<usize, Box<[u8]>>> = RefCell::new(HashMap::new());
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[no_mangle]
pub extern "C" fn kjcontour_abi_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn kjcontour_alloc(len: usize) -> usize {
    if len == 0 || len > MAX_BYTES {
        return 0;
    }
    INPUTS.with(|inputs| {
        if inputs.borrow().values().map(|b| b.len()).sum::<usize>() + len > MAX_BYTES * 4 {
            return 0;
        }
        let mut buffer = vec![0u8; len].into_boxed_slice();
        let pointer = buffer.as_mut_ptr() as usize;
        inputs.borrow_mut().insert(pointer, buffer);
        pointer
    })
}

#[no_mangle]
pub extern "C" fn kjcontour_free(pointer: usize, len: usize) {
    INPUTS.with(|inputs| {
        let mut inputs = inputs.borrow_mut();
        if inputs.get(&pointer).is_some_and(|b| b.len() == len) {
            inputs.remove(&pointer);
        }
    });
}

#[no_mangle]
pub extern "C" fn kjcontour_run(pointer: usize, len: usize) -> i32 {
    let result = INPUTS.with(|inputs| {
        let inputs = inputs.borrow();
        match inputs.get(&pointer).filter(|b| b.len() == len) {
            Some(bytes) => evaluate_json(bytes),
            None => br#"{"error":"Invalid or unowned request buffer"}"#.to_vec(),
        }
    });
    let failed = result.starts_with(b"{\"error\"");
    RESULT.with(|buffer| *buffer.borrow_mut() = result);
    i32::from(failed)
}

#[no_mangle]
pub extern "C" fn kjcontour_result_ptr() -> usize {
    RESULT.with(|result| result.borrow().as_ptr() as usize)
}

#[no_mangle]
pub extern "C" fn kjcontour_result_len() -> usize {
    RESULT.with(|result| result.borrow().len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn evaluate(operation: &str, contours: Value, distance: f64) -> Value {
        serde_json::from_slice(&evaluate_json(&serde_json::to_vec(&json!({
            "operation": operation, "contours": contours, "distance": distance, "tolerance": 1e-7,
        })).unwrap())).unwrap()
    }

    #[test]
    fn json_decimal_coordinates_preserve_the_callers_f64_bits() {
        // JS JSON.stringify decimals that the default serde_json parser shifts
        // by one world-coordinate ULP before any geometric validation can run.
        for decimal in [
            "10000002.185602779",
            "9999997.814397221",
            "10000002.956991995",
            "9999997.043008005",
            "10000003.535533905",
            "0.21764705882352942",
            "0.9823529411764705",
        ] {
            let parsed: f64 = serde_json::from_str(decimal).unwrap();
            let expected: f64 = decimal.parse().unwrap();
            assert_eq!(parsed.to_bits(), expected.to_bits(), "{decimal}");
            let roundtrip: f64 =
                serde_json::from_slice(&serde_json::to_vec(&parsed).unwrap()).unwrap();
            assert_eq!(roundtrip.to_bits(), expected.to_bits(), "{decimal}");
        }
    }

    #[test]
    fn inexact_source_frames_are_refused_before_topology_calculation() {
        let x = 5e8;
        let ulp = 2.0_f64.powi(-24);
        for operation in ["offset", "union", "intersection", "difference"] {
            let result = evaluate(
                operation,
                json!([
                    [[x - 1.0, x + ulp, 1], [x + 1.0, x + ulp, 1]],
                    [[-x + ulp - 1.0, -x, 1], [-x + ulp + 1.0, -x, 1]]
                ]),
                1.00000002985,
            );
            assert!(result["error"]
                .as_str()
                .unwrap()
                .contains("exact source localization"));
        }
    }

    #[test]
    fn cumulative_output_frames_cannot_reuse_the_same_tolerance() {
        let eps = 2e-8;
        let distance = 1.000000021;
        let expected_radius: f64 = 1.0 + distance;
        let group_radius = ((1e8 + expected_radius) - (1e8 - expected_radius)) / 2.0;
        let final_radius =
            (((1e8 + expected_radius) + 1e8) - ((1e8 - expected_radius) + 1e8)) / 2.0;
        assert!((group_radius - expected_radius).abs() < eps);
        assert!((final_radius - group_radius).abs() < eps);
        assert!((final_radius - expected_radius).abs() > eps);
        let bytes = serde_json::to_vec(&json!({
            "operation":"offset", "distance":distance, "tolerance":eps,
            "contours":[[[2e8-1.0,0,1],[2e8+1.0,0,1]],[[-1,0,1],[1,0,1]]]
        }))
        .unwrap();
        let result: Value = serde_json::from_slice(&evaluate_json(&bytes)).unwrap();
        assert!(result["error"]
            .as_str()
            .unwrap()
            .contains("cumulative error"));
    }

    #[test]
    fn exactly_localized_near_tangent_circles_keep_their_native_boundary() {
        let center = 9e8;
        let separation = 2.0 - 2.0_f64.powi(-23);
        let result = evaluate(
            "intersection",
            json!([
                [[center - 1.0, 0, 1], [center + 1.0, 0, 1]],
                [
                    [center + separation - 1.0, 0, 1],
                    [center + separation + 1.0, 0, 1]
                ]
            ]),
            0.0,
        );
        assert!(result.get("error").is_none(), "{result}");
        let vertices = result["contours"][0]["vertices"].as_array().unwrap();
        let expected_half_height = ((1.0 - separation / 2.0) * (1.0 + separation / 2.0)).sqrt();
        let max_height = vertices
            .iter()
            .map(|point| point[1].as_f64().unwrap().abs())
            .fold(0.0_f64, f64::max);
        assert!(
            (max_height - expected_half_height).abs() <= 1e-7,
            "{result}"
        );
        for point in vertices {
            let x = point[0].as_f64().unwrap();
            let y = point[1].as_f64().unwrap();
            let d0 = (x - center).hypot(y);
            let d1 = (x - center - separation).hypot(y);
            assert!((d0 - 1.0).abs().min((d1 - 1.0).abs()) <= 1e-7);
            assert!(d0.max(d1) <= 1.0 + 1e-7);
        }
    }

    #[test]
    fn rotated_world_circles_preserve_offset_distance_or_refuse() {
        let center = 1e7;
        let eps = 1e-9;
        let mut accepted = 0;
        for i in 1..=24 {
            let radius = 3.0 + i as f64 / 11.0;
            let distance = 0.1 + i as f64 / 17.0;
            let q = radius / 2.0_f64.sqrt();
            let points = [[center + q, center + q], [center - q, center - q]];
            let input_radius =
                (points[0][0] - points[1][0]).hypot(points[0][1] - points[1][1]) / 2.0;
            let bytes = serde_json::to_vec(&json!({
                "operation":"offset", "distance":distance, "tolerance":eps,
                "contours":[[[points[0][0],points[0][1],1],[points[1][0],points[1][1],1]]]
            }))
            .unwrap();
            let result: Value = serde_json::from_slice(&evaluate_json(&bytes)).unwrap();
            if result.get("error").is_some() {
                continue;
            }
            accepted += 1;
            let vertices = result["contours"][0]["vertices"].as_array().unwrap();
            let a = [
                vertices[0][0].as_f64().unwrap(),
                vertices[0][1].as_f64().unwrap(),
            ];
            let b = [
                vertices[1][0].as_f64().unwrap(),
                vertices[1][1].as_f64().unwrap(),
            ];
            let output_radius = (a[0] - b[0]).hypot(a[1] - b[1]) / 2.0;
            let center_error = ((a[0] + b[0]) / 2.0 - center).hypot((a[1] + b[1]) / 2.0 - center);
            let boundary_error = center_error + (output_radius - input_radius - distance).abs();
            assert!(boundary_error <= eps, "circle {i}: {boundary_error}");
        }
        assert!(
            accepted > 0,
            "precision guard must preserve representable results"
        );
    }

    #[test]
    fn circles_keep_arcs_and_collapse() {
        let circle = json!([[[-5.0, 0.0, 1.0], [5.0, 0.0, 1.0]]]);
        let result = evaluate("offset", circle.clone(), 2.0);
        assert!((result["area"].as_f64().unwrap() - PI * 49.0).abs() < 1e-7);
        assert!(result["contours"][0]["vertices"]
            .as_array()
            .unwrap()
            .iter()
            .all(|v| v[2].as_f64().unwrap() != 0.0));
        assert_eq!(evaluate("offset", circle, -6.0)["contours"], json!([]));
    }

    #[test]
    fn difference_orients_the_hole() {
        let result = evaluate(
            "difference",
            json!([
                [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
                [[3, 3, 0], [7, 3, 0], [7, 7, 0], [3, 7, 0]]
            ]),
            0.0,
        );
        assert_eq!(result["area"], 84.0);
        assert_eq!(result["contours"][1]["hole"], true);
        assert_eq!(result["contours"][1]["area"], -16.0);
    }

    #[test]
    fn larger_than_semicircle_bulges_are_split_without_chords() {
        let result = evaluate("offset", json!([[[0, 0, 2], [2, 0, 0]]]), 0.0);
        let sweep = 4.0 * 2.0_f64.atan();
        let expected_area = 0.5 * 1.25_f64.powi(2) * (sweep - sweep.sin());
        assert!((result["area"].as_f64().unwrap() - expected_area).abs() < 1e-10);
        let vertices = result["contours"][0]["vertices"].as_array().unwrap();
        assert_eq!(vertices.len(), 3);
        assert_eq!(
            vertices
                .iter()
                .filter(|v| v[2].as_f64().unwrap() != 0.0)
                .count(),
            2
        );
        assert!(vertices.iter().all(|v| v[2].as_f64().unwrap().abs() <= 1.0));
    }

    #[test]
    fn rectangle_offset_area_uses_round_outer_joins_and_sharp_inner_joins() {
        let rectangle = json!([[[0, 0, 0], [100, 0, 0], [100, 50, 0], [0, 50, 0]]]);
        let outward = evaluate("offset", rectangle.clone(), 2.0);
        assert!((outward["area"].as_f64().unwrap() - (5000.0 + 600.0 + PI * 4.0)).abs() < 1e-7);
        assert_eq!(evaluate("offset", rectangle, -2.0)["area"], 4416.0);
    }

    #[test]
    fn holes_can_disappear_and_islands_can_merge() {
        let with_hole = json!([
            [[0, 0, 0], [100, 0, 0], [100, 50, 0], [0, 50, 0]],
            [[40, 20, 0], [40, 30, 0], [60, 30, 0], [60, 20, 0]]
        ]);
        let filled = evaluate("offset", with_hole, 6.0);
        assert_eq!(filled["contours"].as_array().unwrap().len(), 1);
        assert!((filled["area"].as_f64().unwrap() - (5000.0 + 1800.0 + PI * 36.0)).abs() < 1e-6);
        let merged = evaluate(
            "offset",
            json!([[[-11, 0, 1], [-1, 0, 1]], [[1, 0, 1], [11, 0, 1]]]),
            2.0,
        );
        let lens = 2.0 * 49.0 * (12.0_f64 / 14.0).acos() - 6.0 * 52.0_f64.sqrt();
        assert_eq!(merged["contours"].as_array().unwrap().len(), 1);
        assert!((merged["area"].as_f64().unwrap() - (98.0 * PI - lens)).abs() < 1e-7);
    }

    #[test]
    fn a_narrow_neck_splits_into_two_contours() {
        let result = evaluate(
            "offset",
            json!([[
                [0, 0, 0],
                [4, 0, 0],
                [4, 1.5, 0],
                [8, 1.5, 0],
                [8, 0, 0],
                [12, 0, 0],
                [12, 4, 0],
                [8, 4, 0],
                [8, 2.5, 0],
                [4, 2.5, 0],
                [4, 4, 0],
                [0, 4, 0]
            ]]),
            -1.0,
        );
        let contours = result["contours"].as_array().unwrap();
        assert_eq!(contours.len(), 2);
        assert!(contours
            .iter()
            .all(|c| c["hole"] == false && c["area"].as_f64().unwrap() > 4.0));
    }

    #[test]
    fn region_topology_rejects_wrong_winding_and_touching_boundaries() {
        assert!(evaluate(
            "offset",
            json!([
                [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
                [[3, 3, 0], [7, 3, 0], [7, 7, 0], [3, 7, 0]]
            ]),
            1.0
        )["error"]
            .is_string());
        assert!(evaluate(
            "offset",
            json!([
                [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
                [[10, 0, 0], [20, 0, 0], [20, 10, 0], [10, 10, 0]]
            ]),
            1.0
        )["error"]
            .is_string());
    }

    #[test]
    fn single_outline_reversal_and_translation_preserve_region_geometry() {
        let ccw = evaluate("offset", json!([[[-5, 0, 1], [5, 0, 1]]]), 2.0);
        let cw = evaluate("offset", json!([[[5, 0, -1], [-5, 0, -1]]]), 2.0);
        assert_eq!(ccw["area"], cw["area"]);
        let shifted = evaluate("offset", json!([[[995, 2000, 1], [1005, 2000, 1]]]), 2.0);
        assert!((shifted["area"].as_f64().unwrap() - ccw["area"].as_f64().unwrap()).abs() < 1e-7);
        let min_x = |r: &Value| {
            r["contours"][0]["vertices"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v[0].as_f64().unwrap())
                .fold(f64::INFINITY, f64::min)
        };
        assert!((min_x(&shifted) - min_x(&ccw) - 1000.0).abs() < 1e-9);
    }

    #[test]
    fn small_parts_near_large_world_coordinates_keep_their_area() {
        let result = evaluate(
            "offset",
            json!([[
                [900000000, 900000000, 0],
                [900000010, 900000000, 0],
                [900000010, 900000010, 0],
                [900000000, 900000010, 0]
            ]]),
            -1.0,
        );
        assert_eq!(result["area"], 64.0);
        assert_eq!(result["contours"][0]["vertices"][0][0], 900000001.0);
    }

    #[test]
    fn world_coordinate_quantization_is_refused_and_receipts_measure_final_vertices() {
        let center = 9e8;
        for eps in [1e-9, 1e-7] {
            let bytes = serde_json::to_vec(&json!({
                "operation": "offset", "distance": 0.01, "tolerance": eps,
                "contours": [[[center + 0.1, center, 1], [center - 0.1, center, 1]]],
            }))
            .unwrap();
            let result: Value = serde_json::from_slice(&evaluate_json(&bytes)).unwrap();
            if eps == 1e-9 {
                assert!(result["error"]
                    .as_str()
                    .unwrap()
                    .contains("Coordinate translation"));
            } else {
                let vertices = result["contours"][0]["vertices"].as_array().unwrap();
                let diameter =
                    (vertices[0][0].as_f64().unwrap() - vertices[1][0].as_f64().unwrap()).abs();
                let final_area = PI * (diameter / 2.0).powi(2);
                assert!((result["area"].as_f64().unwrap() - final_area).abs() < 1e-15);
                assert_eq!(result["area"], result["contours"][0]["area"]);
                assert!((diameter / 2.0 - 0.11).abs() < eps);
            }
        }
    }

    #[test]
    fn far_separated_small_rings_keep_boolean_and_offset_area() {
        for shift in [1e8, 9e8] {
            let squares = json!([
                [
                    [shift, shift, 0],
                    [shift + 10.0, shift, 0],
                    [shift + 10.0, shift + 10.0, 0],
                    [shift, shift + 10.0, 0]
                ],
                [
                    [-shift, -shift, 0],
                    [-shift + 10.0, -shift, 0],
                    [-shift + 10.0, -shift + 10.0, 0],
                    [-shift, -shift + 10.0, 0]
                ]
            ]);
            assert_eq!(evaluate("union", squares.clone(), 0.0)["area"], 200.0);
            assert_eq!(evaluate("difference", squares.clone(), 0.0)["area"], 100.0);
            assert_eq!(evaluate("intersection", squares.clone(), 0.0)["area"], 0.0);
            let inward = evaluate("offset", squares.clone(), -1.0);
            assert_eq!(inward["area"], 128.0);
            assert_eq!(inward["contours"].as_array().unwrap().len(), 2);
            let outward = evaluate("offset", squares, 1.0);
            assert!((outward["area"].as_f64().unwrap() - 2.0 * (140.0 + PI)).abs() < 1e-6);
        }
    }

    #[test]
    fn far_islands_with_circle_holes_keep_offset_topology() {
        let shift = 9e8;
        let regions = json!([
            [
                [shift, shift, 0],
                [shift + 20.0, shift, 0],
                [shift + 20.0, shift + 20.0, 0],
                [shift, shift + 20.0, 0]
            ],
            [
                [shift + 8.0, shift + 10.0, -1],
                [shift + 12.0, shift + 10.0, -1]
            ],
            [
                [-shift, -shift, 0],
                [-shift + 20.0, -shift, 0],
                [-shift + 20.0, -shift + 20.0, 0],
                [-shift, -shift + 20.0, 0]
            ],
            [
                [-shift + 8.0, -shift + 10.0, -1],
                [-shift + 12.0, -shift + 10.0, -1]
            ]
        ]);
        let outward = evaluate("offset", regions.clone(), 1.0);
        assert!((outward["area"].as_f64().unwrap() - 960.0).abs() < 1e-6);
        assert_eq!(outward["contours"].as_array().unwrap().len(), 4);
        let inward = evaluate("offset", regions, -1.0);
        assert!((inward["area"].as_f64().unwrap() - (648.0 - 18.0 * PI)).abs() < 1e-6);
    }

    #[test]
    fn derived_radius_rejects_shallow_arcs_that_cannot_meet_absolute_tolerance() {
        for bulge in [1e-8, 2e-8, 1e-6] {
            let result = evaluate(
                "offset",
                json!([[
                    [-500000000, 0, bulge],
                    [500000000, 0, 0],
                    [500000000, 1000, 0],
                    [-500000000, 1000, 0]
                ]]),
                1.0,
            );
            assert!(result["error"]
                .as_str()
                .unwrap()
                .contains("Derived arc radius"));
        }
        assert!(
            evaluate("offset", json!([[[-5, 0, 1], [5, 0, 1]]]), 9e8)["error"]
                .as_str()
                .unwrap()
                .contains("Result arc radius")
        );
    }

    #[test]
    fn invalid_inputs_are_errors() {
        assert!(evaluate(
            "offset",
            json!([[[0, 0, 1e-9], [1000000000, 0, 0], [0, 100, 0]]]),
            1.0
        )["error"]
            .as_str()
            .unwrap()
            .contains("bulges smaller than 1e-8"));
        assert!(evaluate(
            "union",
            json!([
                [[0, 0, 0], [2, 2, 0], [0, 2, 0], [2, 0, 0]],
                [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]]
            ]),
            0.0
        )["error"]
            .is_string());
        assert!(
            evaluate("offset", json!([[[0, 0, 0], [0, 0, 0], [1, 1, 0]]]), 1.0)["error"]
                .is_string()
        );
    }
}
