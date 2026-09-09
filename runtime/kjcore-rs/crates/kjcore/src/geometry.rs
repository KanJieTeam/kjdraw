use core::cmp::Ordering;

/// Canonical KJCore coordinate. Engineering coordinates always remain f64 on CPU.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point2 {
    pub x: f64,
    pub y: f64,
}

impl Point2 {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
    pub fn distance_squared(self, other: Self) -> f64 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        dx * dx + dy * dy
    }
    pub fn distance(self, other: Self) -> f64 {
        self.distance_squared(other).sqrt()
    }
    pub fn lerp(self, other: Self, t: f64) -> Self {
        Self::new(
            self.x + (other.x - self.x) * t,
            self.y + (other.y - self.y) * t,
        )
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Aabb2 {
    pub min: Point2,
    pub max: Point2,
}

impl Aabb2 {
    pub fn new(a: Point2, b: Point2) -> Self {
        Self {
            min: Point2::new(a.x.min(b.x), a.y.min(b.y)),
            max: Point2::new(a.x.max(b.x), a.y.max(b.y)),
        }
    }
    pub fn from_points(points: &[Point2]) -> Option<Self> {
        let first = *points.first()?;
        if !first.is_finite() {
            return None;
        }
        let mut bounds = Self {
            min: first,
            max: first,
        };
        for point in &points[1..] {
            if !point.is_finite() {
                return None;
            }
            bounds.min.x = bounds.min.x.min(point.x);
            bounds.min.y = bounds.min.y.min(point.y);
            bounds.max.x = bounds.max.x.max(point.x);
            bounds.max.y = bounds.max.y.max(point.y);
        }
        Some(bounds)
    }
    pub fn intersects(&self, other: &Self) -> bool {
        self.max.x >= other.min.x
            && self.min.x <= other.max.x
            && self.max.y >= other.min.y
            && self.min.y <= other.max.y
    }
    pub fn contains(&self, point: Point2) -> bool {
        point.x >= self.min.x
            && point.x <= self.max.x
            && point.y >= self.min.y
            && point.y <= self.max.y
    }
    pub fn expand(&self, distance: f64) -> Self {
        Self {
            min: Point2::new(self.min.x - distance, self.min.y - distance),
            max: Point2::new(self.max.x + distance, self.max.y + distance),
        }
    }
    pub fn width(&self) -> f64 {
        self.max.x - self.min.x
    }
    pub fn height(&self) -> f64 {
        self.max.y - self.min.y
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tolerance {
    pub absolute: f64,
    pub relative: f64,
    pub angular: f64,
}

impl Default for Tolerance {
    fn default() -> Self {
        Self {
            absolute: 1e-9,
            relative: 1e-12,
            angular: 1e-10,
        }
    }
}

impl Tolerance {
    pub fn new(absolute: f64, relative: f64, angular: f64) -> Result<Self, GeometryError> {
        if [absolute, relative, angular]
            .iter()
            .all(|value| value.is_finite() && *value > 0.0)
        {
            Ok(Self {
                absolute,
                relative,
                angular,
            })
        } else {
            Err(GeometryError::InvalidTolerance)
        }
    }
    pub fn distance_for(&self, values: &[f64]) -> f64 {
        let scale = values
            .iter()
            .fold(1.0_f64, |current, value| current.max(value.abs()));
        self.absolute.max(self.relative * scale)
    }
    pub fn near_zero(&self, value: f64, scale: f64) -> bool {
        value.abs() <= self.distance_for(&[scale])
    }
    pub fn equal(&self, a: f64, b: f64) -> bool {
        (a - b).abs() <= self.distance_for(&[a, b])
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(i8)]
pub enum Orientation {
    Clockwise = -1,
    Collinear = 0,
    CounterClockwise = 1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LineDomain {
    Line,
    Ray,
    Segment,
}

impl LineDomain {
    fn contains(self, parameter: f64, tolerance: &Tolerance) -> bool {
        let epsilon = tolerance.distance_for(&[parameter]);
        match self {
            Self::Line => true,
            Self::Ray => parameter >= -epsilon,
            Self::Segment => parameter >= -epsilon && parameter <= 1.0 + epsilon,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum IntersectionKind {
    None = 0,
    Point = 1,
    Overlap = 2,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Intersection2 {
    pub kind: IntersectionKind,
    pub points: Vec<Point2>,
    pub parameters_a: Vec<f64>,
    pub parameters_b: Vec<f64>,
    pub infinite: bool,
}

impl Intersection2 {
    pub fn none() -> Self {
        Self {
            kind: IntersectionKind::None,
            points: Vec::new(),
            parameters_a: Vec::new(),
            parameters_b: Vec::new(),
            infinite: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GeometryError {
    NonFiniteCoordinate,
    DegenerateDirection,
    InvalidRadius,
    InvalidTolerance,
    InvalidCoordinateBuffer,
    InvalidCurveDefinition,
}

fn validate_points(points: &[Point2]) -> Result<(), GeometryError> {
    if points.iter().all(|point| point.is_finite()) {
        Ok(())
    } else {
        Err(GeometryError::NonFiniteCoordinate)
    }
}

#[inline]
fn cross(a: Point2, b: Point2) -> f64 {
    a.x * b.y - a.y * b.x
}

#[inline]
fn subtract(a: Point2, b: Point2) -> Point2 {
    Point2::new(a.x - b.x, a.y - b.y)
}

#[inline]
fn two_sum(a: f64, b: f64) -> (f64, f64) {
    let x = a + b;
    let bv = x - a;
    let av = x - bv;
    let br = b - bv;
    let ar = a - av;
    (ar + br, x)
}

#[inline]
fn two_product(a: f64, b: f64) -> (f64, f64) {
    let product = a * b;
    (a.mul_add(b, -product), product)
}

fn expansion_sum(left: &[f64], right: &[f64]) -> Vec<f64> {
    let mut left_index = 0usize;
    let mut right_index = 0usize;
    let mut output = Vec::with_capacity(left.len() + right.len());
    let take_left = |a: f64, b: f64| {
        a.abs().partial_cmp(&b.abs()).unwrap_or(Ordering::Equal) != Ordering::Greater
    };
    let mut accumulator = if take_left(left[0], right[0]) {
        left_index += 1;
        left[0]
    } else {
        right_index += 1;
        right[0]
    };
    while left_index < left.len() && right_index < right.len() {
        let next = if take_left(left[left_index], right[right_index]) {
            let value = left[left_index];
            left_index += 1;
            value
        } else {
            let value = right[right_index];
            right_index += 1;
            value
        };
        let (error, sum) = two_sum(accumulator, next);
        if error != 0.0 {
            output.push(error);
        }
        accumulator = sum;
    }
    for next in left[left_index..]
        .iter()
        .chain(right[right_index..].iter())
        .copied()
    {
        let (error, sum) = two_sum(accumulator, next);
        if error != 0.0 {
            output.push(error);
        }
        accumulator = sum;
    }
    if accumulator != 0.0 || output.is_empty() {
        output.push(accumulator);
    }
    output
}

/// Adaptive/exact-sign 2D orientation predicate.
/// The fast path handles ordinary CAD input; near collinearity is resolved
/// from an expansion containing the exact difference of both f64 products.
pub fn orient2d(a: Point2, b: Point2, c: Point2) -> Result<Orientation, GeometryError> {
    validate_points(&[a, b, c])?;
    let acx = a.x - c.x;
    let bcx = b.x - c.x;
    let acy = a.y - c.y;
    let bcy = b.y - c.y;
    let left = acx * bcy;
    let right = acy * bcx;
    let determinant = left - right;
    let error_bound = 3.330_669_073_875_471_6e-16 * (left.abs() + right.abs());
    if determinant.abs() > error_bound {
        return Ok(if determinant > 0.0 {
            Orientation::CounterClockwise
        } else {
            Orientation::Clockwise
        });
    }
    let (left_error, left_product) = two_product(acx, bcy);
    let (right_error, right_product) = two_product(acy, bcx);
    let expansion = expansion_sum(&[left_error, left_product], &[-right_error, -right_product]);
    let sign = expansion
        .iter()
        .rev()
        .find(|value| **value != 0.0)
        .copied()
        .unwrap_or(0.0);
    Ok(if sign > 0.0 {
        Orientation::CounterClockwise
    } else if sign < 0.0 {
        Orientation::Clockwise
    } else {
        Orientation::Collinear
    })
}

pub fn point_segment_distance(point: Point2, start: Point2, end: Point2) -> f64 {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length_squared = dx * dx + dy * dy;
    if length_squared <= 1e-30 {
        return point.distance(start);
    }
    let parameter =
        (((point.x - start.x) * dx + (point.y - start.y) * dy) / length_squared).clamp(0.0, 1.0);
    point.distance(Point2::new(
        start.x + parameter * dx,
        start.y + parameter * dy,
    ))
}

pub fn intersect_line_line(
    a0: Point2,
    a1: Point2,
    b0: Point2,
    b1: Point2,
    domain_a: LineDomain,
    domain_b: LineDomain,
    tolerance: Tolerance,
) -> Result<Intersection2, GeometryError> {
    validate_points(&[a0, a1, b0, b1])?;
    let a_direction = subtract(a1, a0);
    let b_direction = subtract(b1, b0);
    let aa = a_direction.x * a_direction.x + a_direction.y * a_direction.y;
    let bb = b_direction.x * b_direction.x + b_direction.y * b_direction.y;
    if tolerance.near_zero(aa, 1.0) || tolerance.near_zero(bb, 1.0) {
        return Err(GeometryError::DegenerateDirection);
    }
    let denominator = cross(a_direction, b_direction);
    let offset = subtract(b0, a0);
    if tolerance.near_zero(denominator, (aa * bb).sqrt()) {
        if orient2d(a0, a1, b0)? != Orientation::Collinear {
            return Ok(Intersection2::none());
        }
        if domain_a != LineDomain::Segment || domain_b != LineDomain::Segment {
            return Ok(Intersection2 {
                kind: IntersectionKind::Overlap,
                points: Vec::new(),
                parameters_a: Vec::new(),
                parameters_b: Vec::new(),
                infinite: true,
            });
        }
        let (axis_start, axis_direction, b_start, b_end) =
            if a_direction.x.abs() >= a_direction.y.abs() {
                (a0.x, a_direction.x, b0.x, b1.x)
            } else {
                (a0.y, a_direction.y, b0.y, b1.y)
            };
        let t0 = (b_start - axis_start) / axis_direction;
        let t1 = (b_end - axis_start) / axis_direction;
        let start = 0.0_f64.max(t0.min(t1));
        let end = 1.0_f64.min(t0.max(t1));
        if end < start - tolerance.distance_for(&[start, end]) {
            return Ok(Intersection2::none());
        }
        let mut points = vec![a0.lerp(a1, start)];
        let mut parameters = vec![start];
        if !tolerance.equal(start, end) {
            points.push(a0.lerp(a1, end));
            parameters.push(end);
        }
        return Ok(Intersection2 {
            kind: if points.len() == 1 {
                IntersectionKind::Point
            } else {
                IntersectionKind::Overlap
            },
            points,
            parameters_a: parameters,
            parameters_b: Vec::new(),
            infinite: false,
        });
    }
    let parameter_a = cross(offset, b_direction) / denominator;
    let parameter_b = cross(offset, a_direction) / denominator;
    if !domain_a.contains(parameter_a, &tolerance) || !domain_b.contains(parameter_b, &tolerance) {
        return Ok(Intersection2::none());
    }
    Ok(Intersection2 {
        kind: IntersectionKind::Point,
        points: vec![a0.lerp(a1, parameter_a)],
        parameters_a: vec![parameter_a],
        parameters_b: vec![parameter_b],
        infinite: false,
    })
}

pub fn intersect_line_circle(
    start: Point2,
    end: Point2,
    center: Point2,
    radius: f64,
    domain: LineDomain,
    tolerance: Tolerance,
) -> Result<Intersection2, GeometryError> {
    validate_points(&[start, end, center])?;
    if !radius.is_finite() || radius < 0.0 {
        return Err(GeometryError::InvalidRadius);
    }
    let direction = subtract(end, start);
    let a = direction.x * direction.x + direction.y * direction.y;
    if tolerance.near_zero(a, 1.0) {
        return Err(GeometryError::DegenerateDirection);
    }
    let relative = subtract(start, center);
    let b = 2.0 * (relative.x * direction.x + relative.y * direction.y);
    let c = relative.x * relative.x + relative.y * relative.y - radius * radius;
    let mut discriminant = b * b - 4.0 * a * c;
    let threshold = tolerance.distance_for(&[b * b, 4.0 * a * c]);
    if discriminant < -threshold {
        return Ok(Intersection2::none());
    }
    if discriminant.abs() <= threshold {
        discriminant = 0.0;
    }
    let candidates = if discriminant == 0.0 {
        vec![-b / (2.0 * a)]
    } else {
        let root = discriminant.sqrt();
        let q = -0.5 * (b + root.copysign(b));
        let first = q / a;
        let second = if q == 0.0 {
            (-b + root) / (2.0 * a)
        } else {
            c / q
        };
        if first <= second {
            vec![first, second]
        } else {
            vec![second, first]
        }
    };
    let parameters: Vec<f64> = candidates
        .into_iter()
        .filter(|parameter| domain.contains(*parameter, &tolerance))
        .collect();
    if parameters.is_empty() {
        return Ok(Intersection2::none());
    }
    Ok(Intersection2 {
        kind: IntersectionKind::Point,
        points: parameters
            .iter()
            .map(|parameter| start.lerp(end, *parameter))
            .collect(),
        parameters_a: parameters,
        parameters_b: Vec::new(),
        infinite: false,
    })
}

pub fn intersect_circle_circle(
    center_a: Point2,
    radius_a: f64,
    center_b: Point2,
    radius_b: f64,
    tolerance: Tolerance,
) -> Result<Intersection2, GeometryError> {
    validate_points(&[center_a, center_b])?;
    if !radius_a.is_finite() || radius_a < 0.0 || !radius_b.is_finite() || radius_b < 0.0 {
        return Err(GeometryError::InvalidRadius);
    }
    let difference = subtract(center_b, center_a);
    let distance = difference.x.hypot(difference.y);
    let epsilon = tolerance.distance_for(&[distance, radius_a, radius_b]);
    if distance <= epsilon && (radius_a - radius_b).abs() <= epsilon {
        return Ok(Intersection2 {
            kind: IntersectionKind::Overlap,
            points: Vec::new(),
            parameters_a: Vec::new(),
            parameters_b: Vec::new(),
            infinite: true,
        });
    }
    if distance > radius_a + radius_b + epsilon
        || distance < (radius_a - radius_b).abs() - epsilon
        || distance <= epsilon
    {
        return Ok(Intersection2::none());
    }
    // Solve near the smaller circle, avoiding cancellation of large squares.
    // Keep this algorithm in sync with the TypeScript reference primitive.
    let a_is_small = radius_a <= radius_b;
    let small = radius_a.min(radius_b);
    let large = radius_a.max(radius_b);
    let along = if small <= large / 2.0 {
        ((distance - large) * (1.0 + large / distance) + small * (small / distance)) / 2.0
    } else {
        (distance + (small - large) * (small / distance + large / distance)) / 2.0
    };
    // Sorted, factored Heron formula retains the small factors at internal and
    // external tangency without forming fourth powers of the radii.
    let mut sides = [radius_a, radius_b, distance];
    sides.sort_by(|a, b| b.total_cmp(a));
    let [x, y, z] = sides;
    let near = z - (x - y);
    let far = z + (x - y);
    let factor_a = x / distance + (y - z) / distance;
    let factor_b = x / distance + y / distance + z / distance;
    let mut height = (near.abs().sqrt() * factor_a.sqrt() / 2.0) * (far.sqrt() * factor_b.sqrt());
    if near < 0.0 {
        if height > epsilon {
            return Ok(Intersection2::none());
        }
        height = 0.0;
    }
    let unit = Point2::new(difference.x / distance, difference.y / distance);
    let center = if a_is_small { center_a } else { center_b };
    let offset = if a_is_small { along } else { -along };
    let base = Point2::new(center.x + unit.x * offset, center.y + unit.y * offset);
    let points = if height == 0.0 {
        vec![base]
    } else {
        vec![
            Point2::new(base.x - unit.y * height, base.y + unit.x * height),
            Point2::new(base.x + unit.y * height, base.y - unit.x * height),
        ]
    };
    Ok(Intersection2 {
        kind: IntersectionKind::Point,
        points,
        parameters_a: Vec::new(),
        parameters_b: Vec::new(),
        infinite: false,
    })
}

pub fn polyline_length(points: &[Point2], closed: bool) -> Result<f64, GeometryError> {
    validate_points(points)?;
    if points.len() < 2 {
        return Ok(0.0);
    }
    let open_length: f64 = points
        .windows(2)
        .map(|pair| pair[0].distance(pair[1]))
        .sum();
    Ok(if closed {
        open_length + points[points.len() - 1].distance(points[0])
    } else {
        open_length
    })
}

pub fn polyline_signed_area(points: &[Point2]) -> Result<f64, GeometryError> {
    validate_points(points)?;
    if points.len() < 3 {
        return Ok(0.0);
    }
    let mut twice_area = 0.0;
    for index in 0..points.len() {
        let current = points[index];
        let next = points[(index + 1) % points.len()];
        twice_area += current.x * next.y - next.x * current.y;
    }
    Ok(twice_area * 0.5)
}

fn adaptive_simpson<F: Fn(f64) -> f64>(
    function: &F,
    start: f64,
    end: f64,
    tolerance: f64,
    depth: u8,
) -> f64 {
    fn simpson(start: f64, end: f64, start_value: f64, midpoint_value: f64, end_value: f64) -> f64 {
        (end - start) * (start_value + 4.0 * midpoint_value + end_value) / 6.0
    }
    fn integrate<F: Fn(f64) -> f64>(
        function: &F,
        start: f64,
        end: f64,
        start_value: f64,
        midpoint_value: f64,
        end_value: f64,
        whole: f64,
        tolerance: f64,
        depth: u8,
    ) -> f64 {
        let midpoint = (start + end) * 0.5;
        let left_midpoint = (start + midpoint) * 0.5;
        let right_midpoint = (midpoint + end) * 0.5;
        let left_midpoint_value = function(left_midpoint);
        let right_midpoint_value = function(right_midpoint);
        let left = simpson(
            start,
            midpoint,
            start_value,
            left_midpoint_value,
            midpoint_value,
        );
        let right = simpson(
            midpoint,
            end,
            midpoint_value,
            right_midpoint_value,
            end_value,
        );
        let delta = left + right - whole;
        if depth == 0 || delta.abs() <= 15.0 * tolerance {
            return left + right + delta / 15.0;
        }
        integrate(
            function,
            start,
            midpoint,
            start_value,
            left_midpoint_value,
            midpoint_value,
            left,
            tolerance * 0.5,
            depth - 1,
        ) + integrate(
            function,
            midpoint,
            end,
            midpoint_value,
            right_midpoint_value,
            end_value,
            right,
            tolerance * 0.5,
            depth - 1,
        )
    }
    let midpoint = (start + end) * 0.5;
    let start_value = function(start);
    let midpoint_value = function(midpoint);
    let end_value = function(end);
    let whole = simpson(start, end, start_value, midpoint_value, end_value);
    integrate(
        function,
        start,
        end,
        start_value,
        midpoint_value,
        end_value,
        whole,
        tolerance,
        depth,
    )
}

/// Numerically integrates an elliptical arc with a deterministic error budget.
/// Ellipse arc length has no elementary closed form, so the kernel records a
/// controlled quadrature result instead of silently using a display polyline.
pub fn ellipse_arc_length(
    major_radius: f64,
    minor_radius: f64,
    start_parameter: f64,
    end_parameter: f64,
    tolerance: f64,
) -> Result<f64, GeometryError> {
    if !major_radius.is_finite()
        || major_radius <= 0.0
        || !minor_radius.is_finite()
        || minor_radius <= 0.0
    {
        return Err(GeometryError::InvalidRadius);
    }
    if !start_parameter.is_finite()
        || !end_parameter.is_finite()
        || !tolerance.is_finite()
        || tolerance <= 0.0
    {
        return Err(GeometryError::InvalidCurveDefinition);
    }
    if start_parameter == end_parameter {
        return Ok(0.0);
    }
    let (start, end) = if start_parameter < end_parameter {
        (start_parameter, end_parameter)
    } else {
        (end_parameter, start_parameter)
    };
    let speed = |parameter: f64| {
        let x = major_radius * parameter.sin();
        let y = minor_radius * parameter.cos();
        (x * x + y * y).sqrt()
    };
    Ok(adaptive_simpson(&speed, start, end, tolerance, 24))
}

fn clamped_uniform_knots(point_count: usize, degree: usize) -> Vec<f64> {
    let n = point_count - 1;
    let last = n + degree + 1;
    (0..=last)
        .map(|index| {
            if index <= degree {
                0.0
            } else if index >= n + 1 {
                1.0
            } else {
                (index - degree) as f64 / (n - degree + 1) as f64
            }
        })
        .collect()
}

fn validate_spline_definition(
    points: &[Point2],
    degree: usize,
    knots: &[f64],
    weights: &[f64],
) -> Result<(), GeometryError> {
    validate_points(points)?;
    if degree == 0 || points.len() < degree + 1 || knots.len() != points.len() + degree + 1 {
        return Err(GeometryError::InvalidCurveDefinition);
    }
    if !knots.iter().all(|value| value.is_finite())
        || knots.windows(2).any(|pair| pair[0] > pair[1])
    {
        return Err(GeometryError::InvalidCurveDefinition);
    }
    if !weights.is_empty()
        && (weights.len() != points.len()
            || !weights
                .iter()
                .all(|value| value.is_finite() && *value > 0.0))
    {
        return Err(GeometryError::InvalidCurveDefinition);
    }
    let start = knots[degree];
    let end = knots[points.len()];
    if !start.is_finite() || !end.is_finite() || end <= start {
        return Err(GeometryError::InvalidCurveDefinition);
    }
    Ok(())
}

fn rational_bspline_point(
    points: &[Point2],
    degree: usize,
    knots: &[f64],
    weights: &[f64],
    parameter: f64,
) -> Point2 {
    let n = points.len() - 1;
    let end = knots[n + 1];
    let span = if parameter >= end {
        n
    } else {
        (degree..=n)
            .find(|index| parameter >= knots[*index] && parameter < knots[*index + 1])
            .unwrap_or(n)
    };
    let mut values: Vec<(f64, f64, f64)> = (0..=degree)
        .map(|index| {
            let control_index = span - degree + index;
            let weight = if weights.is_empty() {
                1.0
            } else {
                weights[control_index]
            };
            (
                points[control_index].x * weight,
                points[control_index].y * weight,
                weight,
            )
        })
        .collect();
    for level in 1..=degree {
        for index in (level..=degree).rev() {
            let knot_index = span - degree + index;
            let denominator = knots[knot_index + degree + 1 - level] - knots[knot_index];
            let alpha = if denominator.abs() <= f64::EPSILON {
                0.0
            } else {
                (parameter - knots[knot_index]) / denominator
            };
            let previous = values[index - 1];
            let current = values[index];
            values[index] = (
                previous.0 * (1.0 - alpha) + current.0 * alpha,
                previous.1 * (1.0 - alpha) + current.1 * alpha,
                previous.2 * (1.0 - alpha) + current.2 * alpha,
            );
        }
    }
    let value = values[degree];
    Point2::new(value.0 / value.2, value.1 / value.2)
}

fn adaptive_curve_length(
    points: &[Point2],
    degree: usize,
    knots: &[f64],
    weights: &[f64],
    start: f64,
    end: f64,
    start_point: Point2,
    end_point: Point2,
    tolerance: f64,
    depth: u8,
) -> f64 {
    let midpoint_parameter = (start + end) * 0.5;
    let midpoint = rational_bspline_point(points, degree, knots, weights, midpoint_parameter);
    let chord = start_point.distance(end_point);
    let polygon = start_point.distance(midpoint) + midpoint.distance(end_point);
    if depth == 0 || polygon - chord <= tolerance {
        return (polygon + chord) * 0.5;
    }
    adaptive_curve_length(
        points,
        degree,
        knots,
        weights,
        start,
        midpoint_parameter,
        start_point,
        midpoint,
        tolerance * 0.5,
        depth - 1,
    ) + adaptive_curve_length(
        points,
        degree,
        knots,
        weights,
        midpoint_parameter,
        end,
        midpoint,
        end_point,
        tolerance * 0.5,
        depth - 1,
    )
}

/// Evaluates rational B-spline length independently from display tessellation.
pub fn rational_bspline_length(
    points: &[Point2],
    degree: usize,
    knots: &[f64],
    weights: &[f64],
    tolerance: f64,
) -> Result<f64, GeometryError> {
    if !tolerance.is_finite() || tolerance <= 0.0 {
        return Err(GeometryError::InvalidTolerance);
    }
    let generated;
    let knots = if knots.is_empty() {
        generated = clamped_uniform_knots(points.len(), degree);
        &generated[..]
    } else {
        knots
    };
    validate_spline_definition(points, degree, knots, weights)?;
    let start = knots[degree];
    let end = knots[points.len()];
    let start_point = rational_bspline_point(points, degree, knots, weights, start);
    let end_point = rational_bspline_point(points, degree, knots, weights, end);
    Ok(adaptive_curve_length(
        points,
        degree,
        knots,
        weights,
        start,
        end,
        start_point,
        end_point,
        tolerance,
        24,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(actual: f64, expected: f64) {
        assert!((actual - expected).abs() <= 1e-9, "{actual} != {expected}");
    }

    #[test]
    fn orientation_resolves_near_collinearity_at_large_coordinates() {
        let a = Point2::new(1.0e12, 1.0e12);
        let b = Point2::new(1.0e12 + 4.0, 1.0e12 + 4.0);
        let c = Point2::new(1.0e12 + 8.0, 1.0e12 + 8.001);
        assert_eq!(orient2d(a, b, c).unwrap(), Orientation::CounterClockwise);
        assert_eq!(
            orient2d(a, b, Point2::new(1.0e12 + 8.0, 1.0e12 + 8.0)).unwrap(),
            Orientation::Collinear
        );
    }

    #[test]
    fn segment_intersection_and_overlap_are_classified() {
        let tolerance = Tolerance::default();
        let crossing = intersect_line_line(
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            Point2::new(5.0, -2.0),
            Point2::new(5.0, 2.0),
            LineDomain::Segment,
            LineDomain::Segment,
            tolerance,
        )
        .unwrap();
        assert_eq!(crossing.kind, IntersectionKind::Point);
        close(crossing.points[0].x, 5.0);
        let overlap = intersect_line_line(
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            Point2::new(4.0, 0.0),
            Point2::new(12.0, 0.0),
            LineDomain::Segment,
            LineDomain::Segment,
            tolerance,
        )
        .unwrap();
        assert_eq!(overlap.kind, IntersectionKind::Overlap);
        assert_eq!(overlap.points.len(), 2);
        close(overlap.points[1].x, 10.0);
    }

    #[test]
    fn circle_intersections_are_stable() {
        let tolerance = Tolerance::default();
        let line = intersect_line_circle(
            Point2::new(-2.0, 0.0),
            Point2::new(2.0, 0.0),
            Point2::new(0.0, 0.0),
            1.0,
            LineDomain::Segment,
            tolerance,
        )
        .unwrap();
        assert_eq!(line.points.len(), 2);
        close(line.points[0].x, -1.0);
        close(line.points[1].x, 1.0);
        let circles = intersect_circle_circle(
            Point2::new(0.0, 0.0),
            2.0,
            Point2::new(3.0, 0.0),
            2.0,
            tolerance,
        )
        .unwrap();
        assert_eq!(circles.points.len(), 2);
        close(circles.points[0].x, 1.5);
    }

    #[test]
    fn circle_circle_preserves_tiny_chords_at_large_radius_ratios() {
        for (large, small) in [(1e6, 0.01), (1e4, 0.001), (1e8, 0.001), (13.0, 5.0)] {
            let expected_x = large - small * (small / large) / 2.0;
            let ratio: f64 = small / (2.0 * large);
            let expected_height = small * (1.0 - ratio * ratio).sqrt();
            for (angle, origin) in [
                (0.0_f64, Point2::new(0.0, 0.0)),
                (0.37, Point2::new(23567.0, -98123.0)),
                (2.8, Point2::new(1000.0, -2500.0)),
            ] {
                let transform = |x: f64, y: f64| {
                    Point2::new(
                        origin.x + x * angle.cos() - y * angle.sin(),
                        origin.y + x * angle.sin() + y * angle.cos(),
                    )
                };
                let expected = [
                    transform(expected_x, expected_height),
                    transform(expected_x, -expected_height),
                ];
                let epsilon = (16.0 * f64::EPSILON * large.max(origin.x.abs()).max(origin.y.abs()))
                    .max(1e-12);
                for swapped in [false, true] {
                    let (a, ra, b, rb) = if swapped {
                        (transform(large, 0.0), small, origin, large)
                    } else {
                        (origin, large, transform(large, 0.0), small)
                    };
                    let result =
                        intersect_circle_circle(a, ra, b, rb, Tolerance::default()).unwrap();
                    assert_eq!(result.kind, IntersectionKind::Point);
                    assert_eq!(
                        result.points.len(),
                        2,
                        "R={large}, r={small}, angle={angle}, swap={swapped}"
                    );
                    for point in expected {
                        assert!(
                            result
                                .points
                                .iter()
                                .any(|actual| actual.distance(point) <= epsilon),
                            "R={large}, r={small}, angle={angle}, swap={swapped}: {:?} vs {:?}",
                            result.points,
                            point
                        );
                    }
                    if angle == 0.0 {
                        for point in result.points {
                            assert!(
                                (point.y.abs() - expected_height).abs()
                                    <= (small * 2e-14).max(1e-14),
                                "tiny chord height: {} != {expected_height}",
                                point.y
                            );
                        }
                    }
                }
            }
        }
        let result = intersect_circle_circle(
            Point2::new(0.0, 0.0),
            1e6,
            Point2::new(0.00002, 0.0),
            1e6,
            Tolerance::default(),
        )
        .unwrap();
        assert_eq!(result.points.len(), 2);
        for point in result.points {
            close(point.x, 0.00001);
            close(point.y.abs(), 1e6);
        }
    }

    #[test]
    fn circle_circle_keeps_tangencies_and_disjoint_domains() {
        for swapped in [false, true] {
            let intersect = |ra: f64, d: f64, rb: f64| {
                let a = Point2::new(0.0, 0.0);
                let b = Point2::new(d, 0.0);
                if swapped {
                    intersect_circle_circle(b, rb, a, ra, Tolerance::default()).unwrap()
                } else {
                    intersect_circle_circle(a, ra, b, rb, Tolerance::default()).unwrap()
                }
            };
            for (ra, d, rb, x) in [
                (13.0, 18.0, 5.0, 13.0),
                (13.0, 8.0, 5.0, 13.0),
                (5.0, 5.0, 0.0, 5.0),
            ] {
                let result = intersect(ra, d, rb);
                assert_eq!(result.points, vec![Point2::new(x, 0.0)]);
            }
            let distance = 10.0 - 2.0_f64.powi(-20);
            let along = distance / 2.0;
            let height = ((5.0 - along) * (5.0 + along)).sqrt();
            let result = intersect(5.0, distance, 5.0);
            assert_eq!(result.points.len(), 2);
            for point in result.points {
                assert!((point.x - along).abs() <= 1e-12);
                assert!((point.y.abs() - height).abs() <= 1e-12);
            }
            for (ra, d, rb) in [
                (5.0, 7.0, 1.0),
                (5.0, 3.0, 1.0),
                (5.0, 0.0, 1.0),
                (5.0, 10.0 + 2.0_f64.powi(-20), 5.0),
            ] {
                assert_eq!(intersect(ra, d, rb).kind, IntersectionKind::None);
            }
            assert_eq!(intersect(5.0, 0.0, 5.0).kind, IntersectionKind::Overlap);
        }
    }

    #[test]
    fn polyline_metrics_keep_engineering_precision() {
        let points = [
            Point2::new(0.0, 0.0),
            Point2::new(3.0, 0.0),
            Point2::new(3.0, 4.0),
        ];
        close(polyline_length(&points, false).unwrap(), 7.0);
        close(polyline_signed_area(&points).unwrap(), 6.0);
        assert_eq!(
            Aabb2::from_points(&points).unwrap().max,
            Point2::new(3.0, 4.0)
        );
    }

    #[test]
    fn ellipse_and_rational_spline_lengths_use_curve_geometry() {
        close(
            ellipse_arc_length(2.0, 2.0, 0.0, core::f64::consts::PI, 1e-11).unwrap(),
            core::f64::consts::PI * 2.0,
        );
        let points = [
            Point2::new(0.0, 0.0),
            Point2::new(1.0, 1.0),
            Point2::new(2.0, 0.0),
        ];
        let length = rational_bspline_length(&points, 2, &[], &[], 1e-10).unwrap();
        assert!(length > 2.0 && length < 3.0);
    }
}
