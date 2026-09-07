pub mod cad;
pub mod camera;
pub mod dependency;
pub mod geometry;
pub mod scene;
pub mod solid;
pub mod spatial;

pub use cad::{
    CadDocument, CadDraft, CadModelError, CadObject, CadSpaces, CadTable, CadValue,
    ValidationIssue, KJD_SCHEMA, KJD_SCHEMA_VERSION,
};
pub use camera::Camera2D;
pub use dependency::DependencyGraph;
pub use geometry::{
    ellipse_arc_length, intersect_circle_circle, intersect_line_circle, intersect_line_line,
    orient2d, point_segment_distance, polyline_length, polyline_signed_area,
    rational_bspline_length, Aabb2, GeometryError, Intersection2, IntersectionKind, LineDomain,
    Orientation, Point2, Tolerance,
};
pub use scene::{EntityId, LineStore, Scene};
pub use solid::{
    boolean_boxes, box_solid, cone_solid, cylinder_solid, loft_solid, sphere_solid, sweep_solid,
    Aabb3, BooleanOperation, Point3, SolidError, SolidMesh, SolidValidation,
};
pub use spatial::UniformGridIndex;
