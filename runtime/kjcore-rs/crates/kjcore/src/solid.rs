use std::collections::{BTreeMap, HashMap};
use std::fmt;

const EPS: f64 = 1.0e-10;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Point3 {
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aabb3 {
    pub min: Point3,
    pub max: Point3,
}

impl Aabb3 {
    fn volume(self) -> f64 {
        (self.max.x - self.min.x).max(0.0)
            * (self.max.y - self.min.y).max(0.0)
            * (self.max.z - self.min.z).max(0.0)
    }
    fn contains(self, point: Point3) -> bool {
        point.x >= self.min.x - EPS
            && point.x <= self.max.x + EPS
            && point.y >= self.min.y - EPS
            && point.y <= self.max.y + EPS
            && point.z >= self.min.z - EPS
            && point.z <= self.max.z + EPS
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SolidMesh {
    pub vertices: Vec<Point3>,
    pub triangles: Vec<[u32; 3]>,
    pub construction: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SolidValidation {
    pub valid: bool,
    pub finite: bool,
    pub degenerate_triangles: usize,
    pub boundary_edges: usize,
    pub non_manifold_edges: usize,
    pub inconsistent_edges: usize,
    pub orientation: &'static str,
    pub volume: f64,
    pub self_intersection_checked: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BooleanOperation {
    Union,
    Intersection,
    Difference,
}

#[derive(Clone, Debug, PartialEq)]
pub enum SolidError {
    InvalidParameter(&'static str),
    InvalidMesh(String),
    UnsupportedBoolean,
    EmptyResult,
}

impl fmt::Display for SolidError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidParameter(message) => write!(f, "invalid solid parameter: {message}"),
            Self::InvalidMesh(message) => write!(f, "invalid solid mesh: {message}"),
            Self::UnsupportedBoolean => write!(
                f,
                "exact boolean currently requires axis-aligned box solids"
            ),
            Self::EmptyResult => write!(f, "solid operation produced an empty result"),
        }
    }
}

fn sub(a: Point3, b: Point3) -> Point3 {
    Point3::new(a.x - b.x, a.y - b.y, a.z - b.z)
}
fn cross(a: Point3, b: Point3) -> Point3 {
    Point3::new(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    )
}
fn dot(a: Point3, b: Point3) -> f64 {
    a.x * b.x + a.y * b.y + a.z * b.z
}
fn magnitude(a: Point3) -> f64 {
    dot(a, a).sqrt()
}

impl SolidMesh {
    pub fn from_indexed(
        vertices: Vec<Point3>,
        triangles: Vec<[u32; 3]>,
        construction: impl Into<String>,
    ) -> Result<Self, SolidError> {
        let mut mesh = Self {
            vertices,
            triangles,
            construction: construction.into(),
        };
        let validation = mesh.validate();
        if !validation.finite
            || validation.degenerate_triangles > 0
            || validation.boundary_edges > 0
            || validation.non_manifold_edges > 0
            || validation.inconsistent_edges > 0
            || validation.volume <= EPS
        {
            if validation.orientation == "inward" {
                mesh.reverse();
            }
            let repaired = mesh.validate();
            if !repaired.valid {
                return Err(SolidError::InvalidMesh(format!(
                    "boundary={}, nonManifold={}, inconsistent={}, degenerate={}, volume={}",
                    repaired.boundary_edges,
                    repaired.non_manifold_edges,
                    repaired.inconsistent_edges,
                    repaired.degenerate_triangles,
                    repaired.volume
                )));
            }
        }
        Ok(mesh)
    }

    pub fn bounds(&self) -> Result<Aabb3, SolidError> {
        let first = *self
            .vertices
            .first()
            .ok_or_else(|| SolidError::InvalidMesh("no vertices".to_owned()))?;
        if !first.is_finite() {
            return Err(SolidError::InvalidMesh("non-finite vertex".to_owned()));
        }
        let mut min = first;
        let mut max = first;
        for point in &self.vertices {
            if !point.is_finite() {
                return Err(SolidError::InvalidMesh("non-finite vertex".to_owned()));
            }
            min.x = min.x.min(point.x);
            min.y = min.y.min(point.y);
            min.z = min.z.min(point.z);
            max.x = max.x.max(point.x);
            max.y = max.y.max(point.y);
            max.z = max.z.max(point.z);
        }
        Ok(Aabb3 { min, max })
    }

    pub fn signed_volume(&self) -> f64 {
        self.triangles
            .iter()
            .filter_map(|triangle| {
                let a = self.vertices.get(triangle[0] as usize)?;
                let b = self.vertices.get(triangle[1] as usize)?;
                let c = self.vertices.get(triangle[2] as usize)?;
                Some(dot(*a, cross(*b, *c)) / 6.0)
            })
            .sum()
    }

    pub fn volume(&self) -> f64 {
        self.signed_volume().abs()
    }
    pub fn reverse(&mut self) {
        for triangle in &mut self.triangles {
            triangle.swap(1, 2)
        }
    }

    pub fn validate(&self) -> SolidValidation {
        let finite = self.vertices.iter().all(|point| point.is_finite());
        let mut degenerate = 0usize;
        let mut invalid_index = false;
        let mut edges: BTreeMap<(u32, u32), (usize, i32)> = BTreeMap::new();
        for triangle in &self.triangles {
            let [a, b, c] = *triangle;
            let Some(pa) = self.vertices.get(a as usize) else {
                invalid_index = true;
                continue;
            };
            let Some(pb) = self.vertices.get(b as usize) else {
                invalid_index = true;
                continue;
            };
            let Some(pc) = self.vertices.get(c as usize) else {
                invalid_index = true;
                continue;
            };
            if a == b || b == c || c == a || magnitude(cross(sub(*pb, *pa), sub(*pc, *pa))) <= EPS {
                degenerate += 1
            }
            for (from, to) in [(a, b), (b, c), (c, a)] {
                let key = (from.min(to), from.max(to));
                let row = edges.entry(key).or_insert((0, 0));
                row.0 += 1;
                row.1 += if from < to { 1 } else { -1 };
            }
        }
        let boundary = edges.values().filter(|(count, _)| *count == 1).count();
        let non_manifold = edges.values().filter(|(count, _)| *count > 2).count();
        let inconsistent = edges
            .values()
            .filter(|(count, balance)| *count == 2 && *balance != 0)
            .count();
        let signed = self.signed_volume();
        let volume = signed.abs();
        let orientation = if signed > EPS {
            "outward"
        } else if signed < -EPS {
            "inward"
        } else {
            "degenerate"
        };
        let valid = finite
            && !invalid_index
            && !self.triangles.is_empty()
            && degenerate == 0
            && boundary == 0
            && non_manifold == 0
            && inconsistent == 0
            && signed > EPS;
        SolidValidation {
            valid,
            finite,
            degenerate_triangles: degenerate + usize::from(invalid_index),
            boundary_edges: boundary,
            non_manifold_edges: non_manifold,
            inconsistent_edges: inconsistent,
            orientation,
            volume,
            self_intersection_checked: false,
        }
    }

    pub fn transformed(&self, matrix: [f64; 16]) -> Result<Self, SolidError> {
        if !matrix.iter().all(|value| value.is_finite()) {
            return Err(SolidError::InvalidParameter(
                "transform matrix must be finite",
            ));
        }
        let mut vertices = Vec::with_capacity(self.vertices.len());
        for point in &self.vertices {
            let w = matrix[12] * point.x + matrix[13] * point.y + matrix[14] * point.z + matrix[15];
            if !w.is_finite() || w.abs() <= EPS {
                return Err(SolidError::InvalidParameter(
                    "transform produced an invalid homogeneous coordinate",
                ));
            }
            vertices.push(Point3::new(
                (matrix[0] * point.x + matrix[1] * point.y + matrix[2] * point.z + matrix[3]) / w,
                (matrix[4] * point.x + matrix[5] * point.y + matrix[6] * point.z + matrix[7]) / w,
                (matrix[8] * point.x + matrix[9] * point.y + matrix[10] * point.z + matrix[11]) / w,
            ));
        }
        Self::from_indexed(
            vertices,
            self.triangles.clone(),
            format!("transform({})", self.construction),
        )
    }

    pub fn to_json(&self) -> String {
        let vertices = self
            .vertices
            .iter()
            .map(|p| format!("[{},{},{}]", p.x, p.y, p.z))
            .collect::<Vec<_>>()
            .join(",");
        let triangles = self
            .triangles
            .iter()
            .map(|t| format!("[{},{},{}]", t[0], t[1], t[2]))
            .collect::<Vec<_>>()
            .join(",");
        let v = self.validate();
        format!("{{\"schema\":\"com.kanjie.kjcore.solid@1\",\"construction\":\"{}\",\"vertices\":[{}],\"triangles\":[{}],\"validation\":{{\"valid\":{},\"finite\":{},\"degenerateTriangles\":{},\"boundaryEdges\":{},\"nonManifoldEdges\":{},\"inconsistentEdges\":{},\"orientation\":\"{}\",\"volume\":{},\"selfIntersectionChecked\":false}}}}",json_string(&self.construction),vertices,triangles,v.valid,v.finite,v.degenerate_triangles,v.boundary_edges,v.non_manifold_edges,v.inconsistent_edges,v.orientation,v.volume)
    }
}

fn json_string(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| match character {
            '"' => "\\\"".chars().collect::<Vec<_>>(),
            '\\' => "\\\\".chars().collect(),
            c if c.is_control() => format!("\\u{:04x}", c as u32).chars().collect(),
            c => vec![c],
        })
        .collect()
}

pub fn box_solid(center: Point3, size: Point3) -> Result<SolidMesh, SolidError> {
    if !center.is_finite() || !size.is_finite() || size.x <= 0.0 || size.y <= 0.0 || size.z <= 0.0 {
        return Err(SolidError::InvalidParameter(
            "box size must be positive and finite",
        ));
    }
    let h = Point3::new(size.x / 2.0, size.y / 2.0, size.z / 2.0);
    box_from_bounds(
        Aabb3 {
            min: Point3::new(center.x - h.x, center.y - h.y, center.z - h.z),
            max: Point3::new(center.x + h.x, center.y + h.y, center.z + h.z),
        },
        "box",
    )
}

fn box_from_bounds(bounds: Aabb3, construction: &str) -> Result<SolidMesh, SolidError> {
    let a = bounds.min;
    let b = bounds.max;
    if bounds.volume() <= EPS {
        return Err(SolidError::InvalidParameter(
            "box bounds must enclose volume",
        ));
    }
    SolidMesh::from_indexed(
        vec![
            Point3::new(a.x, a.y, a.z),
            Point3::new(b.x, a.y, a.z),
            Point3::new(b.x, b.y, a.z),
            Point3::new(a.x, b.y, a.z),
            Point3::new(a.x, a.y, b.z),
            Point3::new(b.x, a.y, b.z),
            Point3::new(b.x, b.y, b.z),
            Point3::new(a.x, b.y, b.z),
        ],
        vec![
            [0, 2, 1],
            [0, 3, 2],
            [4, 5, 6],
            [4, 6, 7],
            [0, 1, 5],
            [0, 5, 4],
            [1, 2, 6],
            [1, 6, 5],
            [2, 3, 7],
            [2, 7, 6],
            [3, 0, 4],
            [3, 4, 7],
        ],
        construction,
    )
}

pub fn cylinder_solid(
    center: Point3,
    radius: f64,
    height: f64,
    segments: usize,
) -> Result<SolidMesh, SolidError> {
    frustum_solid(center, radius, radius, height, segments, "cylinder")
}
pub fn cone_solid(
    center: Point3,
    bottom_radius: f64,
    top_radius: f64,
    height: f64,
    segments: usize,
) -> Result<SolidMesh, SolidError> {
    frustum_solid(center, bottom_radius, top_radius, height, segments, "cone")
}

fn frustum_solid(
    center: Point3,
    bottom_radius: f64,
    top_radius: f64,
    height: f64,
    segments: usize,
    construction: &str,
) -> Result<SolidMesh, SolidError> {
    if !center.is_finite()
        || ![bottom_radius, top_radius, height]
            .iter()
            .all(|v| v.is_finite())
        || bottom_radius <= 0.0
        || top_radius < 0.0
        || height <= 0.0
        || segments < 8
        || segments > 4096
    {
        return Err(SolidError::InvalidParameter(
            "frustum radii, height or segment count are invalid",
        ));
    }
    let z0 = center.z - height / 2.0;
    let z1 = center.z + height / 2.0;
    let mut vertices = Vec::new();
    for index in 0..segments {
        let a = index as f64 * std::f64::consts::TAU / segments as f64;
        vertices.push(Point3::new(
            center.x + bottom_radius * a.cos(),
            center.y + bottom_radius * a.sin(),
            z0,
        ))
    }
    let top_start = vertices.len();
    if top_radius > EPS {
        for index in 0..segments {
            let a = index as f64 * std::f64::consts::TAU / segments as f64;
            vertices.push(Point3::new(
                center.x + top_radius * a.cos(),
                center.y + top_radius * a.sin(),
                z1,
            ))
        }
    } else {
        vertices.push(Point3::new(center.x, center.y, z1))
    }
    let bottom_center = vertices.len() as u32;
    vertices.push(Point3::new(center.x, center.y, z0));
    let top_center = if top_radius > EPS {
        let id = vertices.len() as u32;
        vertices.push(Point3::new(center.x, center.y, z1));
        Some(id)
    } else {
        None
    };
    let mut triangles = Vec::new();
    for index in 0..segments {
        let next = (index + 1) % segments;
        triangles.push([bottom_center, next as u32, index as u32]);
        if top_radius > EPS {
            triangles.push([
                top_center.unwrap(),
                (top_start + index) as u32,
                (top_start + next) as u32,
            ]);
            triangles.push([index as u32, next as u32, (top_start + next) as u32]);
            triangles.push([
                index as u32,
                (top_start + next) as u32,
                (top_start + index) as u32,
            ]);
        } else {
            let apex = top_start as u32;
            triangles.push([index as u32, next as u32, apex]);
        }
    }
    SolidMesh::from_indexed(vertices, triangles, construction)
}

pub fn sphere_solid(center: Point3, radius: f64, segments: usize) -> Result<SolidMesh, SolidError> {
    if !center.is_finite()
        || !radius.is_finite()
        || radius <= 0.0
        || segments < 8
        || segments > 2048
    {
        return Err(SolidError::InvalidParameter(
            "sphere radius or segment count is invalid",
        ));
    }
    let lat = (segments / 2).max(4);
    let mut vertices = vec![Point3::new(center.x, center.y, center.z + radius)];
    for ring in 1..lat {
        let phi = std::f64::consts::PI * ring as f64 / lat as f64;
        for index in 0..segments {
            let theta = std::f64::consts::TAU * index as f64 / segments as f64;
            vertices.push(Point3::new(
                center.x + radius * phi.sin() * theta.cos(),
                center.y + radius * phi.sin() * theta.sin(),
                center.z + radius * phi.cos(),
            ))
        }
    }
    let bottom = vertices.len() as u32;
    vertices.push(Point3::new(center.x, center.y, center.z - radius));
    let mut triangles = Vec::new();
    for index in 0..segments {
        let next = (index + 1) % segments;
        triangles.push([0, 1 + index as u32, 1 + next as u32]);
        for ring in 0..lat - 2 {
            let a = 1 + ring * segments + index;
            let b = 1 + ring * segments + next;
            let c = 1 + (ring + 1) * segments + next;
            let d = 1 + (ring + 1) * segments + index;
            triangles.push([a as u32, d as u32, c as u32]);
            triangles.push([a as u32, c as u32, b as u32]);
        }
        let last = 1 + (lat - 2) * segments;
        triangles.push([bottom, (last + next) as u32, (last + index) as u32]);
    }
    SolidMesh::from_indexed(vertices, triangles, "sphere")
}

fn convex_xy(profile: &[Point3]) -> bool {
    if profile.len() < 3 {
        return false;
    }
    let mut sign = 0.0;
    for index in 0..profile.len() {
        let a = profile[index];
        let b = profile[(index + 1) % profile.len()];
        let c = profile[(index + 2) % profile.len()];
        let value = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if value.abs() <= EPS {
            continue;
        }
        if sign == 0.0 {
            sign = value.signum()
        } else if sign * value < 0.0 {
            return false;
        }
    }
    sign != 0.0
}
fn signed_area_xy(profile: &[Point3]) -> f64 {
    profile
        .iter()
        .zip(profile.iter().cycle().skip(1))
        .take(profile.len())
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum::<f64>()
        / 2.0
}

pub fn sweep_solid(profile: &[Point3], vector: Point3) -> Result<SolidMesh, SolidError> {
    if !vector.is_finite() || magnitude(vector) <= EPS || !convex_xy(profile) {
        return Err(SolidError::InvalidParameter(
            "sweep requires a finite vector and convex XY profile",
        ));
    }
    let mut base = profile.to_vec();
    if signed_area_xy(&base) < 0.0 {
        base.reverse()
    }
    let top = base
        .iter()
        .map(|p| Point3::new(p.x + vector.x, p.y + vector.y, p.z + vector.z))
        .collect::<Vec<_>>();
    loft_solid(&base, &top, "sweep")
}

pub fn loft_solid(
    bottom: &[Point3],
    top: &[Point3],
    construction: &str,
) -> Result<SolidMesh, SolidError> {
    if bottom.len() != top.len()
        || bottom.len() < 3
        || !bottom.iter().chain(top).all(|p| p.is_finite())
        || !convex_xy(bottom)
        || !convex_xy(top)
    {
        return Err(SolidError::InvalidParameter(
            "loft profiles must be finite convex profiles with equal vertex counts",
        ));
    }
    let mut a = bottom.to_vec();
    let mut b = top.to_vec();
    if signed_area_xy(&a) < 0.0 {
        a.reverse()
    }
    if signed_area_xy(&b) < 0.0 {
        b.reverse()
    }
    let n = a.len();
    let mut vertices = a;
    vertices.extend(b);
    let mut triangles = Vec::new();
    for index in 1..n - 1 {
        triangles.push([0, (index + 1) as u32, index as u32]);
        triangles.push([n as u32, (n + index) as u32, (n + index + 1) as u32]);
    }
    for index in 0..n {
        let next = (index + 1) % n;
        triangles.push([index as u32, next as u32, (n + next) as u32]);
        triangles.push([index as u32, (n + next) as u32, (n + index) as u32]);
    }
    SolidMesh::from_indexed(vertices, triangles, construction)
}

fn axis_aligned_box(mesh: &SolidMesh) -> Option<Aabb3> {
    let bounds = mesh.bounds().ok()?;
    let tolerance = bounds.volume().max(1.0) * 1e-8;
    if (mesh.volume() - bounds.volume()).abs() > tolerance {
        return None;
    }
    if !mesh.vertices.iter().all(|p| {
        [p.x - bounds.min.x, p.x - bounds.max.x]
            .iter()
            .any(|v| v.abs() <= EPS)
            && [p.y - bounds.min.y, p.y - bounds.max.y]
                .iter()
                .any(|v| v.abs() <= EPS)
            && [p.z - bounds.min.z, p.z - bounds.max.z]
                .iter()
                .any(|v| v.abs() <= EPS)
    }) {
        return None;
    }
    Some(bounds)
}

pub fn boolean_boxes(
    a: &SolidMesh,
    b: &SolidMesh,
    operation: BooleanOperation,
) -> Result<SolidMesh, SolidError> {
    let a = axis_aligned_box(a).ok_or(SolidError::UnsupportedBoolean)?;
    let b = axis_aligned_box(b).ok_or(SolidError::UnsupportedBoolean)?;
    let mut xs = vec![a.min.x, a.max.x, b.min.x, b.max.x];
    let mut ys = vec![a.min.y, a.max.y, b.min.y, b.max.y];
    let mut zs = vec![a.min.z, a.max.z, b.min.z, b.max.z];
    for values in [&mut xs, &mut ys, &mut zs] {
        values.sort_by(f64::total_cmp);
        values.dedup_by(|x, y| (*x - *y).abs() <= EPS)
    }
    let nx = xs.len() - 1;
    let ny = ys.len() - 1;
    let nz = zs.len() - 1;
    let mut occupied = vec![false; nx * ny * nz];
    let at = |i: usize, j: usize, k: usize| i + nx * (j + ny * k);
    for k in 0..nz {
        for j in 0..ny {
            for i in 0..nx {
                let p = Point3::new(
                    (xs[i] + xs[i + 1]) / 2.0,
                    (ys[j] + ys[j + 1]) / 2.0,
                    (zs[k] + zs[k + 1]) / 2.0,
                );
                let inside_a = a.contains(p);
                let inside_b = b.contains(p);
                occupied[at(i, j, k)] = match operation {
                    BooleanOperation::Union => inside_a || inside_b,
                    BooleanOperation::Intersection => inside_a && inside_b,
                    BooleanOperation::Difference => inside_a && !inside_b,
                };
            }
        }
    }
    if !occupied.iter().any(|v| *v) {
        return Err(SolidError::EmptyResult);
    }
    let mut vertices = Vec::new();
    let mut vertex_ids: HashMap<(usize, usize, usize), u32> = HashMap::new();
    let mut triangles = Vec::new();
    let mut vertex = |i, j, k, vertices: &mut Vec<Point3>| {
        *vertex_ids.entry((i, j, k)).or_insert_with(|| {
            let id = vertices.len() as u32;
            vertices.push(Point3::new(xs[i], ys[j], zs[k]));
            id
        })
    };
    for k in 0..nz {
        for j in 0..ny {
            for i in 0..nx {
                if !occupied[at(i, j, k)] {
                    continue;
                }
                let ids = [
                    vertex(i, j, k, &mut vertices),
                    vertex(i + 1, j, k, &mut vertices),
                    vertex(i + 1, j + 1, k, &mut vertices),
                    vertex(i, j + 1, k, &mut vertices),
                    vertex(i, j, k + 1, &mut vertices),
                    vertex(i + 1, j, k + 1, &mut vertices),
                    vertex(i + 1, j + 1, k + 1, &mut vertices),
                    vertex(i, j + 1, k + 1, &mut vertices),
                ];
                let faces = [
                    (
                        k == 0 || !occupied[at(i, j, k - 1)],
                        [[ids[0], ids[2], ids[1]], [ids[0], ids[3], ids[2]]],
                    ),
                    (
                        k + 1 == nz || !occupied[at(i, j, k + 1)],
                        [[ids[4], ids[5], ids[6]], [ids[4], ids[6], ids[7]]],
                    ),
                    (
                        j == 0 || !occupied[at(i, j - 1, k)],
                        [[ids[0], ids[1], ids[5]], [ids[0], ids[5], ids[4]]],
                    ),
                    (
                        i + 1 == nx || !occupied[at(i + 1, j, k)],
                        [[ids[1], ids[2], ids[6]], [ids[1], ids[6], ids[5]]],
                    ),
                    (
                        j + 1 == ny || !occupied[at(i, j + 1, k)],
                        [[ids[2], ids[3], ids[7]], [ids[2], ids[7], ids[6]]],
                    ),
                    (
                        i == 0 || !occupied[at(i - 1, j, k)],
                        [[ids[3], ids[0], ids[4]], [ids[3], ids[4], ids[7]]],
                    ),
                ];
                for (visible, pair) in faces {
                    if visible {
                        triangles.extend(pair)
                    }
                }
            }
        }
    }
    SolidMesh::from_indexed(vertices, triangles, format!("box-boolean:{operation:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn primitives_are_closed_and_outward() {
        for mesh in [
            box_solid(Point3::new(0.0, 0.0, 0.0), Point3::new(2.0, 3.0, 4.0)).unwrap(),
            cylinder_solid(Point3::new(0.0, 0.0, 0.0), 2.0, 5.0, 32).unwrap(),
            cone_solid(Point3::new(0.0, 0.0, 0.0), 2.0, 0.0, 5.0, 32).unwrap(),
            sphere_solid(Point3::new(0.0, 0.0, 0.0), 2.0, 24).unwrap(),
        ] {
            assert!(mesh.validate().valid, "{}", mesh.to_json())
        }
    }
    #[test]
    fn sweep_loft_transform_and_box_boolean_are_valid() {
        let profile = [
            Point3::new(0.0, 0.0, 0.0),
            Point3::new(2.0, 0.0, 0.0),
            Point3::new(2.0, 1.0, 0.0),
            Point3::new(0.0, 1.0, 0.0),
        ];
        let sweep = sweep_solid(&profile, Point3::new(0.0, 0.0, 3.0)).unwrap();
        assert!((sweep.volume() - 6.0).abs() < 1e-8);
        let moved = sweep
            .transformed([
                1.0, 0.0, 0.0, 5.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ])
            .unwrap();
        assert!(moved.validate().valid);
        let a = box_solid(Point3::new(0.0, 0.0, 0.0), Point3::new(4.0, 4.0, 4.0)).unwrap();
        let b = box_solid(Point3::new(1.0, 0.0, 0.0), Point3::new(4.0, 2.0, 2.0)).unwrap();
        let intersection = boolean_boxes(&a, &b, BooleanOperation::Intersection).unwrap();
        let difference = boolean_boxes(&a, &b, BooleanOperation::Difference).unwrap();
        assert!(intersection.validate().valid);
        assert!(difference.validate().valid);
        assert!((intersection.volume() - 12.0).abs() < 1e-8);
        assert!((difference.volume() - 52.0).abs() < 1e-8)
    }
}
