use kjcore::{
    boolean_boxes, box_solid, cone_solid, cylinder_solid, ellipse_arc_length,
    intersect_circle_circle, intersect_line_circle, intersect_line_line, loft_solid, orient2d,
    point_segment_distance, polyline_length, polyline_signed_area, rational_bspline_length,
    sphere_solid, sweep_solid, BooleanOperation, CadDocument, CadModelError, GeometryError,
    Intersection2, LineDomain, Point2, Point3, SolidError, SolidMesh, Tolerance,
};
use std::{cell::RefCell, mem, slice, str};

// `KJC1` encoded as an integer. JavaScript validates this before the Rust
// backend is allowed to identify itself as authoritative.
const ABI_MAGIC: u32 = 0x4b4a_4301;
const RESULT_CAPACITY: usize = 11;
const ORIENTATION_ERROR: i32 = i32::MIN;

static mut RESULT: [f64; RESULT_CAPACITY] = [0.0; RESULT_CAPACITY];
static mut RESULT_LEN: usize = 0;
static mut LAST_ERROR: i32 = 0;

thread_local! {
    static DOCUMENTS: RefCell<Vec<Option<CadDocument>>> = const { RefCell::new(Vec::new()) };
    static BYTE_RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static SOLIDS: RefCell<Vec<Option<SolidMesh>>> = const { RefCell::new(Vec::new()) };
}

fn error_code(error: GeometryError) -> i32 {
    match error {
        GeometryError::NonFiniteCoordinate => 1,
        GeometryError::DegenerateDirection => 2,
        GeometryError::InvalidRadius => 3,
        GeometryError::InvalidTolerance => 4,
        GeometryError::InvalidCoordinateBuffer => 5,
        GeometryError::InvalidCurveDefinition => 6,
    }
}

fn fail(error: GeometryError) -> i32 {
    let code = error_code(error);
    unsafe {
        LAST_ERROR = code;
        RESULT_LEN = 0;
    }
    -code
}

fn succeed() {
    unsafe {
        LAST_ERROR = 0;
    }
}

fn model_error_code(error: &CadModelError) -> i32 {
    match error {
        CadModelError::Json { .. } => 101,
        CadModelError::InvalidDocument(_) => 102,
        CadModelError::RevisionConflict { .. } => 103,
        CadModelError::DuplicateObject(_) => 104,
        CadModelError::MissingObject(_) => 105,
        CadModelError::InvalidOperation(_) => 106,
    }
}

fn fail_model(error: CadModelError) -> i32 {
    let code = model_error_code(&error);
    unsafe {
        LAST_ERROR = code;
    }
    BYTE_RESULT.with(|result| result.borrow_mut().clear());
    -code
}

fn solid_error_code(error: &SolidError) -> i32 {
    match error {
        SolidError::InvalidParameter(_) => 201,
        SolidError::InvalidMesh(_) => 202,
        SolidError::UnsupportedBoolean => 203,
        SolidError::EmptyResult => 204,
    }
}

fn fail_solid(error: SolidError) -> i32 {
    let code = solid_error_code(&error);
    unsafe {
        LAST_ERROR = code;
    }
    BYTE_RESULT.with(|result| result.borrow_mut().clear());
    -code
}

fn store_solid(solid: SolidMesh) -> i32 {
    let handle = SOLIDS.with(|solids| {
        let mut solids = solids.borrow_mut();
        if let Some((index, slot)) = solids
            .iter_mut()
            .enumerate()
            .find(|(_, slot)| slot.is_none())
        {
            *slot = Some(solid);
            index + 1
        } else {
            solids.push(Some(solid));
            solids.len()
        }
    });
    if handle > i32::MAX as usize {
        return fail_solid(SolidError::InvalidMesh(
            "solid session table is exhausted".to_owned(),
        ));
    }
    succeed();
    handle as i32
}

fn with_solid<R>(
    handle: u32,
    callback: impl FnOnce(&SolidMesh) -> Result<R, SolidError>,
) -> Result<R, SolidError> {
    if handle == 0 {
        return Err(SolidError::InvalidMesh("solid-session:0".to_owned()));
    }
    SOLIDS.with(|solids| {
        let solids = solids.borrow();
        let solid = solids
            .get(handle as usize - 1)
            .and_then(Option::as_ref)
            .ok_or_else(|| SolidError::InvalidMesh(format!("solid-session:{handle}")))?;
        callback(solid)
    })
}

unsafe fn points3_from_raw(
    pointer: *const f64,
    coordinate_count: usize,
) -> Result<Vec<Point3>, SolidError> {
    if coordinate_count % 3 != 0 || (coordinate_count > 0 && pointer.is_null()) {
        return Err(SolidError::InvalidParameter("3D coordinate buffer"));
    }
    let values = if coordinate_count == 0 {
        &[]
    } else {
        slice::from_raw_parts(pointer, coordinate_count)
    };
    let points = values
        .chunks_exact(3)
        .map(|p| Point3::new(p[0], p[1], p[2]))
        .collect::<Vec<_>>();
    if points.iter().all(|point| point.is_finite()) {
        Ok(points)
    } else {
        Err(SolidError::InvalidParameter(
            "3D coordinates must be finite",
        ))
    }
}

unsafe fn triangles_from_raw(
    pointer: *const f64,
    index_count: usize,
) -> Result<Vec<[u32; 3]>, SolidError> {
    if index_count % 3 != 0 || (index_count > 0 && pointer.is_null()) {
        return Err(SolidError::InvalidParameter("triangle index buffer"));
    }
    let values = if index_count == 0 {
        &[]
    } else {
        slice::from_raw_parts(pointer, index_count)
    };
    let mut triangles = Vec::new();
    for row in values.chunks_exact(3) {
        if !row
            .iter()
            .all(|v| v.is_finite() && *v >= 0.0 && v.fract() == 0.0 && *v <= u32::MAX as f64)
        {
            return Err(SolidError::InvalidParameter(
                "triangle indices must be unsigned integers",
            ));
        }
        triangles.push([row[0] as u32, row[1] as u32, row[2] as u32]);
    }
    Ok(triangles)
}

fn store_bytes(bytes: Vec<u8>) -> i32 {
    let length = bytes.len();
    if length > i32::MAX as usize {
        return fail_model(CadModelError::InvalidOperation(
            "KJD result exceeds the WASM ABI limit".to_owned(),
        ));
    }
    BYTE_RESULT.with(|result| *result.borrow_mut() = bytes);
    succeed();
    length as i32
}

fn with_document<R>(
    handle: u32,
    callback: impl FnOnce(&CadDocument) -> Result<R, CadModelError>,
) -> Result<R, CadModelError> {
    if handle == 0 {
        return Err(CadModelError::MissingObject(
            "document-session:0".to_owned(),
        ));
    }
    DOCUMENTS.with(|documents| {
        let documents = documents.borrow();
        let document = documents
            .get(handle as usize - 1)
            .and_then(Option::as_ref)
            .ok_or_else(|| CadModelError::MissingObject(format!("document-session:{handle}")))?;
        callback(document)
    })
}

fn with_document_mut<R>(
    handle: u32,
    callback: impl FnOnce(&mut CadDocument) -> Result<R, CadModelError>,
) -> Result<R, CadModelError> {
    if handle == 0 {
        return Err(CadModelError::MissingObject(
            "document-session:0".to_owned(),
        ));
    }
    DOCUMENTS.with(|documents| {
        let mut documents = documents.borrow_mut();
        let document = documents
            .get_mut(handle as usize - 1)
            .and_then(Option::as_mut)
            .ok_or_else(|| CadModelError::MissingObject(format!("document-session:{handle}")))?;
        callback(document)
    })
}

fn domain_from_code(value: u32) -> Result<LineDomain, GeometryError> {
    match value {
        0 => Ok(LineDomain::Line),
        1 => Ok(LineDomain::Ray),
        2 => Ok(LineDomain::Segment),
        _ => Err(GeometryError::InvalidCoordinateBuffer),
    }
}

fn tolerance(absolute: f64, relative: f64, angular: f64) -> Result<Tolerance, GeometryError> {
    Tolerance::new(absolute, relative, angular)
}

fn write_intersection(result: Intersection2) -> i32 {
    let length = 3 + result.points.len() * 4;
    debug_assert!(length <= RESULT_CAPACITY);
    unsafe {
        RESULT[0] = result.kind as u8 as f64;
        RESULT[1] = if result.infinite { 1.0 } else { 0.0 };
        RESULT[2] = result.points.len() as f64;
        for (index, point) in result.points.iter().enumerate() {
            let offset = 3 + index * 4;
            RESULT[offset] = point.x;
            RESULT[offset + 1] = point.y;
            RESULT[offset + 2] = result.parameters_a.get(index).copied().unwrap_or(f64::NAN);
            RESULT[offset + 3] = result.parameters_b.get(index).copied().unwrap_or(f64::NAN);
        }
        RESULT_LEN = length;
        LAST_ERROR = 0;
    }
    length as i32
}

unsafe fn points_from_raw(
    pointer: *const f64,
    coordinate_count: usize,
) -> Result<Vec<Point2>, GeometryError> {
    if coordinate_count % 2 != 0 || (coordinate_count > 0 && pointer.is_null()) {
        return Err(GeometryError::InvalidCoordinateBuffer);
    }
    let coordinates = if coordinate_count == 0 {
        &[]
    } else {
        slice::from_raw_parts(pointer, coordinate_count)
    };
    let points: Vec<Point2> = coordinates
        .chunks_exact(2)
        .map(|pair| Point2::new(pair[0], pair[1]))
        .collect();
    if points.iter().all(|point| point.is_finite()) {
        Ok(points)
    } else {
        Err(GeometryError::NonFiniteCoordinate)
    }
}

unsafe fn numbers_from_raw(pointer: *const f64, count: usize) -> Result<Vec<f64>, GeometryError> {
    if count > 0 && pointer.is_null() {
        return Err(GeometryError::InvalidCoordinateBuffer);
    }
    let values = if count == 0 {
        &[]
    } else {
        slice::from_raw_parts(pointer, count)
    };
    if values.iter().all(|value| value.is_finite()) {
        Ok(values.to_vec())
    } else {
        Err(GeometryError::NonFiniteCoordinate)
    }
}

unsafe fn utf8_from_raw(pointer: *const u8, length: usize) -> Result<String, CadModelError> {
    if length > 0 && pointer.is_null() {
        return Err(CadModelError::InvalidOperation(
            "KJD input pointer is null".to_owned(),
        ));
    }
    let bytes = if length == 0 {
        &[]
    } else {
        slice::from_raw_parts(pointer, length)
    };
    str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(|_| CadModelError::Json {
            offset: 0,
            message: "KJD input is not valid UTF-8".to_owned(),
        })
}

#[no_mangle]
pub extern "C" fn kjcore_abi_magic() -> u32 {
    ABI_MAGIC
}

#[no_mangle]
pub extern "C" fn kjcore_kernel_version_packed() -> u32 {
    let major = env!("CARGO_PKG_VERSION_MAJOR")
        .parse::<u32>()
        .unwrap_or(0)
        .min(0xff);
    let minor = env!("CARGO_PKG_VERSION_MINOR")
        .parse::<u32>()
        .unwrap_or(0)
        .min(0xfff);
    let patch = env!("CARGO_PKG_VERSION_PATCH")
        .parse::<u32>()
        .unwrap_or(0)
        .min(0xfff);
    (major << 24) | (minor << 12) | patch
}

#[no_mangle]
pub extern "C" fn kjcore_last_error() -> i32 {
    unsafe { LAST_ERROR }
}

#[no_mangle]
pub extern "C" fn kjcore_result_len() -> usize {
    unsafe { RESULT_LEN }
}

#[no_mangle]
pub extern "C" fn kjcore_result_value(index: usize) -> f64 {
    unsafe {
        if index < RESULT_LEN {
            RESULT[index]
        } else {
            f64::NAN
        }
    }
}

#[no_mangle]
pub extern "C" fn kjcore_document_model_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn kjcore_solid_model_version() -> u32 {
    1
}

#[no_mangle]
pub unsafe extern "C" fn kjcore_solid_open_mesh(
    vertex_pointer: *const f64,
    coordinate_count: usize,
    triangle_pointer: *const f64,
    index_count: usize,
) -> i32 {
    let result = points3_from_raw(vertex_pointer, coordinate_count).and_then(|vertices| {
        triangles_from_raw(triangle_pointer, index_count)
            .and_then(|triangles| SolidMesh::from_indexed(vertices, triangles, "indexed-mesh"))
    });
    match result {
        Ok(solid) => store_solid(solid),
        Err(error) => fail_solid(error),
    }
}

#[no_mangle]
pub extern "C" fn kjcore_solid_box(cx: f64, cy: f64, cz: f64, sx: f64, sy: f64, sz: f64) -> i32 {
    match box_solid(Point3::new(cx, cy, cz), Point3::new(sx, sy, sz)) {
        Ok(solid) => store_solid(solid),
        Err(error) => fail_solid(error),
    }
}

#[no_mangle]
pub extern "C" fn kjcore_solid_cylinder(
    cx: f64,
    cy: f64,
    cz: f64,
    radius: f64,
    height: f64,
    segments: usize,
) -> i32 {
    match cylinder_solid(Point3::new(cx, cy, cz), radius, height, segments) {
        Ok(solid) => store_solid(solid),
        Err(error) => fail_solid(error),
    }
}

#[no_mangle]
pub extern "C" fn kjcore_solid_cone(
    cx: f64,
    cy: f64,
    cz: f64,
    bottom_radius: f64,
    top_radius: f64,
    height: f64,
    segments: usize,
) -> i32 {
    match cone_solid(
        Point3::new(cx, cy, cz),
        bottom_radius,
        top_radius,
        height,
        segments,
    ) {
        Ok(solid) => store_solid(solid),
        Err(error) => fail_solid(error),
    }
}

#[no_mangle]
pub extern "C" fn kjcore_solid_sphere(
    cx: f64,
    cy: f64,
    cz: f64,
    radius: f64,
    segments: usize,
) -> i32 {
    match sphere_solid(Point3::new(cx, cy, cz), radius, segments) {
        Ok(solid) => store_solid(solid),
        Err(error) => fail_solid(error),
    }
}

#[no_mangle]
pub unsafe extern "C" fn kjcore_solid_sweep(
    profile_pointer: *const f64,
    coordinate_count: usize,
    dx: f64,
    dy: f64,
    dz: f64,
) -> i32 {
    let result = points3_from_raw(profile_pointer, coordinate_count)
        .and_then(|profile| sweep_solid(&profile, Point3::new(dx, dy, dz)));
    match result {
        Ok(solid) => store_solid(solid),
        Err(error) => fail_solid(error),
    }
}

#[no_mangle]
pub unsafe extern "C" fn kjcore_solid_loft(
    bottom_pointer: *const f64,
    bottom_coordinate_count: usize,
    top_pointer: *const f64,
    top_coordinate_count: usize,
) -> i32 {
    let result = points3_from_raw(bottom_pointer, bottom_coordinate_count).and_then(|bottom| {
        points3_from_raw(top_pointer, top_coordinate_count)
            .and_then(|top| loft_solid(&bottom, &top, "loft"))
    });
    match result {
        Ok(solid) => store_solid(solid),
        Err(error) => fail_solid(error),
    }
}

#[no_mangle]
pub unsafe extern "C" fn kjcore_solid_transform(
    handle: u32,
    matrix_pointer: *const f64,
    matrix_count: usize,
) -> i32 {
    if matrix_count != 16 || matrix_pointer.is_null() {
        return fail_solid(SolidError::InvalidParameter("4x4 transform matrix"));
    }
    let values = slice::from_raw_parts(matrix_pointer, matrix_count);
    let mut matrix = [0.0; 16];
    matrix.copy_from_slice(values);
    match with_solid(handle, |solid| solid.transformed(matrix)) {
        Ok(solid) => store_solid(solid),
        Err(error) => fail_solid(error),
    }
}

#[no_mangle]
pub extern "C" fn kjcore_solid_boolean(
    first_handle: u32,
    second_handle: u32,
    operation: u32,
) -> i32 {
    let operation = match operation {
        0 => BooleanOperation::Union,
        1 => BooleanOperation::Intersection,
        2 => BooleanOperation::Difference,
        _ => return fail_solid(SolidError::InvalidParameter("boolean operation")),
    };
    let result = with_solid(first_handle, |first| {
        with_solid(second_handle, |second| {
            boolean_boxes(first, second, operation)
        })
    });
    match result {
        Ok(solid) => store_solid(solid),
        Err(error) => fail_solid(error),
    }
}

#[no_mangle]
pub extern "C" fn kjcore_solid_validate(handle: u32) -> i32 {
    match with_solid(handle, |solid| Ok(solid.validate())) {
        Ok(validation) => {
            if validation.valid {
                succeed();
                1
            } else {
                fail_solid(SolidError::InvalidMesh(
                    "solid validation failed".to_owned(),
                ))
            }
        }
        Err(error) => fail_solid(error),
    }
}

#[no_mangle]
pub extern "C" fn kjcore_solid_volume(handle: u32) -> f64 {
    match with_solid(handle, |solid| Ok(solid.volume())) {
        Ok(volume) => {
            succeed();
            volume
        }
        Err(error) => {
            fail_solid(error);
            f64::NAN
        }
    }
}

#[no_mangle]
pub extern "C" fn kjcore_solid_serialize_json(handle: u32) -> i32 {
    match with_solid(handle, |solid| Ok(solid.to_json())) {
        Ok(json) => store_bytes(json.into_bytes()),
        Err(error) => fail_solid(error),
    }
}

#[no_mangle]
pub extern "C" fn kjcore_solid_close(handle: u32) -> i32 {
    if handle == 0 {
        return fail_solid(SolidError::InvalidMesh("solid-session:0".to_owned()));
    }
    let closed = SOLIDS.with(|solids| {
        solids
            .borrow_mut()
            .get_mut(handle.saturating_sub(1) as usize)
            .and_then(Option::take)
            .is_some()
    });
    if closed {
        succeed();
        1
    } else {
        fail_solid(SolidError::InvalidMesh(format!("solid-session:{handle}")))
    }
}

#[no_mangle]
pub extern "C" fn kjcore_alloc_u8(length: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(length);
    let pointer = buffer.as_mut_ptr();
    mem::forget(buffer);
    pointer
}

#[no_mangle]
pub unsafe extern "C" fn kjcore_free_u8(pointer: *mut u8, capacity: usize) {
    if capacity > 0 && !pointer.is_null() {
        drop(Vec::from_raw_parts(pointer, 0, capacity));
    }
}

/// Opens and validates a canonical KJD document in the Rust-owned session table.
/// Positive values are opaque session handles; negative values are stable error codes.
#[no_mangle]
pub unsafe extern "C" fn kjcore_document_open_kjd(pointer: *const u8, length: usize) -> i32 {
    let document = match utf8_from_raw(pointer, length)
        .and_then(|source| CadDocument::from_kjd_json(&source))
    {
        Ok(document) => document,
        Err(error) => return fail_model(error),
    };
    let handle = DOCUMENTS.with(|documents| {
        let mut documents = documents.borrow_mut();
        if let Some((index, slot)) = documents
            .iter_mut()
            .enumerate()
            .find(|(_, slot)| slot.is_none())
        {
            *slot = Some(document);
            index + 1
        } else {
            documents.push(Some(document));
            documents.len()
        }
    });
    if handle > i32::MAX as usize {
        return fail_model(CadModelError::InvalidOperation(
            "document session table is exhausted".to_owned(),
        ));
    }
    succeed();
    handle as i32
}

#[no_mangle]
pub extern "C" fn kjcore_document_close(handle: u32) -> i32 {
    if handle == 0 {
        return fail_model(CadModelError::MissingObject(
            "document-session:0".to_owned(),
        ));
    }
    let closed = DOCUMENTS.with(|documents| {
        let mut documents = documents.borrow_mut();
        documents
            .get_mut(handle.saturating_sub(1) as usize)
            .and_then(Option::take)
            .is_some()
    });
    if closed {
        succeed();
        1
    } else {
        fail_model(CadModelError::MissingObject(format!(
            "document-session:{handle}"
        )))
    }
}

#[no_mangle]
pub extern "C" fn kjcore_document_validate(handle: u32) -> i32 {
    match with_document(handle, CadDocument::validate) {
        Ok(()) => {
            succeed();
            1
        }
        Err(error) => fail_model(error),
    }
}

#[no_mangle]
pub extern "C" fn kjcore_document_revision(handle: u32) -> f64 {
    match with_document(handle, |document| Ok(document.revision)) {
        Ok(revision) => {
            succeed();
            revision as f64
        }
        Err(error) => {
            fail_model(error);
            f64::NAN
        }
    }
}

#[no_mangle]
pub extern "C" fn kjcore_document_serialize_kjd(handle: u32) -> i32 {
    match with_document(handle, |document| document.to_kjd_json()) {
        Ok(json) => store_bytes(json.into_bytes()),
        Err(error) => fail_model(error),
    }
}

#[no_mangle]
pub extern "C" fn kjcore_document_fingerprint(handle: u32) -> i32 {
    match with_document(handle, CadDocument::fingerprint) {
        Ok(value) => store_bytes(value.into_bytes()),
        Err(error) => fail_model(error),
    }
}

/// Commits a complete next-revision KJD candidate into a Rust-owned session.
/// A successful result means identity, revision progression, immutable history
/// and the complete object graph were accepted by KJCore.
#[no_mangle]
pub unsafe extern "C" fn kjcore_document_commit_kjd(
    handle: u32,
    pointer: *const u8,
    length: usize,
    expected_revision: f64,
) -> i32 {
    if !expected_revision.is_finite()
        || expected_revision < 0.0
        || expected_revision.fract() != 0.0
        || expected_revision > u64::MAX as f64
    {
        return fail_model(CadModelError::InvalidOperation(
            "expected revision must be a non-negative integer".to_owned(),
        ));
    }
    let candidate = match utf8_from_raw(pointer, length)
        .and_then(|source| CadDocument::from_kjd_json(&source))
    {
        Ok(document) => document,
        Err(error) => return fail_model(error),
    };
    match with_document_mut(handle, |document| {
        document.accept_candidate(expected_revision as u64, candidate)
    }) {
        Ok(()) => {
            succeed();
            1
        }
        Err(error) => fail_model(error),
    }
}

#[no_mangle]
pub extern "C" fn kjcore_byte_result_len() -> usize {
    BYTE_RESULT.with(|result| result.borrow().len())
}

#[no_mangle]
pub extern "C" fn kjcore_byte_result_value(index: usize) -> u32 {
    BYTE_RESULT.with(|result| {
        result
            .borrow()
            .get(index)
            .copied()
            .map(u32::from)
            .unwrap_or(u32::MAX)
    })
}

#[no_mangle]
pub extern "C" fn orientation_2d(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64) -> i32 {
    match orient2d(
        Point2::new(ax, ay),
        Point2::new(bx, by),
        Point2::new(cx, cy),
    ) {
        Ok(value) => {
            succeed();
            value as i8 as i32
        }
        Err(error) => {
            fail(error);
            ORIENTATION_ERROR
        }
    }
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn line_line_intersection_2d(
    a0x: f64,
    a0y: f64,
    a1x: f64,
    a1y: f64,
    b0x: f64,
    b0y: f64,
    b1x: f64,
    b1y: f64,
    domain_a: u32,
    domain_b: u32,
    absolute: f64,
    relative: f64,
    angular: f64,
) -> i32 {
    let result = domain_from_code(domain_a).and_then(|a_domain| {
        domain_from_code(domain_b).and_then(|b_domain| {
            tolerance(absolute, relative, angular).and_then(|tol| {
                intersect_line_line(
                    Point2::new(a0x, a0y),
                    Point2::new(a1x, a1y),
                    Point2::new(b0x, b0y),
                    Point2::new(b1x, b1y),
                    a_domain,
                    b_domain,
                    tol,
                )
            })
        })
    });
    match result {
        Ok(value) => write_intersection(value),
        Err(error) => fail(error),
    }
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn line_circle_intersection_2d(
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    center_x: f64,
    center_y: f64,
    radius: f64,
    domain: u32,
    absolute: f64,
    relative: f64,
    angular: f64,
) -> i32 {
    let result = domain_from_code(domain).and_then(|line_domain| {
        tolerance(absolute, relative, angular).and_then(|tol| {
            intersect_line_circle(
                Point2::new(start_x, start_y),
                Point2::new(end_x, end_y),
                Point2::new(center_x, center_y),
                radius,
                line_domain,
                tol,
            )
        })
    });
    match result {
        Ok(value) => write_intersection(value),
        Err(error) => fail(error),
    }
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn circle_circle_intersection_2d(
    center_ax: f64,
    center_ay: f64,
    radius_a: f64,
    center_bx: f64,
    center_by: f64,
    radius_b: f64,
    absolute: f64,
    relative: f64,
    angular: f64,
) -> i32 {
    let result = tolerance(absolute, relative, angular).and_then(|tol| {
        intersect_circle_circle(
            Point2::new(center_ax, center_ay),
            radius_a,
            Point2::new(center_bx, center_by),
            radius_b,
            tol,
        )
    });
    match result {
        Ok(value) => write_intersection(value),
        Err(error) => fail(error),
    }
}

#[no_mangle]
pub extern "C" fn point_segment_distance_2d(
    px: f64,
    py: f64,
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
) -> f64 {
    succeed();
    point_segment_distance(
        Point2::new(px, py),
        Point2::new(ax, ay),
        Point2::new(bx, by),
    )
}

#[no_mangle]
pub extern "C" fn kjcore_alloc_f64(length: usize) -> *mut f64 {
    let mut buffer = Vec::<f64>::with_capacity(length);
    let pointer = buffer.as_mut_ptr();
    mem::forget(buffer);
    pointer
}

#[no_mangle]
pub unsafe extern "C" fn kjcore_free_f64(pointer: *mut f64, capacity: usize) {
    if capacity > 0 && !pointer.is_null() {
        drop(Vec::from_raw_parts(pointer, 0, capacity));
    }
}

#[no_mangle]
pub unsafe extern "C" fn polyline_length_2d(
    pointer: *const f64,
    coordinate_count: usize,
    closed: u32,
) -> f64 {
    let result = points_from_raw(pointer, coordinate_count)
        .and_then(|points| polyline_length(&points, closed != 0));
    match result {
        Ok(value) => {
            succeed();
            value
        }
        Err(error) => {
            fail(error);
            f64::NAN
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn polyline_signed_area_2d(
    pointer: *const f64,
    coordinate_count: usize,
) -> f64 {
    let result =
        points_from_raw(pointer, coordinate_count).and_then(|points| polyline_signed_area(&points));
    match result {
        Ok(value) => {
            succeed();
            value
        }
        Err(error) => {
            fail(error);
            f64::NAN
        }
    }
}

#[no_mangle]
pub extern "C" fn ellipse_arc_length_2d(
    major_radius: f64,
    minor_radius: f64,
    start_parameter: f64,
    end_parameter: f64,
    tolerance: f64,
) -> f64 {
    match ellipse_arc_length(
        major_radius,
        minor_radius,
        start_parameter,
        end_parameter,
        tolerance,
    ) {
        Ok(value) => {
            succeed();
            value
        }
        Err(error) => {
            fail(error);
            f64::NAN
        }
    }
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn rational_bspline_length_2d(
    coordinate_pointer: *const f64,
    coordinate_count: usize,
    degree: usize,
    knot_pointer: *const f64,
    knot_count: usize,
    weight_pointer: *const f64,
    weight_count: usize,
    tolerance: f64,
) -> f64 {
    let result = points_from_raw(coordinate_pointer, coordinate_count).and_then(|points| {
        numbers_from_raw(knot_pointer, knot_count).and_then(|knots| {
            numbers_from_raw(weight_pointer, weight_count).and_then(|weights| {
                rational_bspline_length(&points, degree, &knots, &weights, tolerance)
            })
        })
    });
    match result {
        Ok(value) => {
            succeed();
            value
        }
        Err(error) => {
            fail(error);
            f64::NAN
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_abi_encodes_intersection_without_bindgen() {
        assert_eq!(kjcore_abi_magic(), ABI_MAGIC);
        let length = line_line_intersection_2d(
            0.0, 0.0, 10.0, 0.0, 5.0, -1.0, 5.0, 1.0, 2, 2, 1e-9, 1e-12, 1e-10,
        );
        assert_eq!(length, 7);
        assert_eq!(kjcore_result_value(0), 1.0);
        assert_eq!(kjcore_result_value(3), 5.0);
        assert_eq!(kjcore_last_error(), 0);
    }

    #[test]
    fn raw_abi_evaluates_curve_lengths() {
        let ellipse = ellipse_arc_length_2d(2.0, 2.0, 0.0, std::f64::consts::PI, 1e-11);
        assert!((ellipse - std::f64::consts::PI * 2.0).abs() <= 1e-9);
        let points = [0.0, 0.0, 1.0, 1.0, 2.0, 0.0];
        let spline = unsafe {
            rational_bspline_length_2d(
                points.as_ptr(),
                points.len(),
                2,
                std::ptr::null(),
                0,
                std::ptr::null(),
                0,
                1e-9,
            )
        };
        assert!(spline > 2.0 && spline < 3.0);
    }
}
