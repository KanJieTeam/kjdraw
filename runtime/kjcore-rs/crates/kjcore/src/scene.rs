use crate::geometry::{Aabb2, Point2};
pub type EntityId = u64;

#[derive(Default)]
pub struct LineStore {
    pub ids: Vec<EntityId>,
    pub x1: Vec<f64>,
    pub y1: Vec<f64>,
    pub x2: Vec<f64>,
    pub y2: Vec<f64>,
    pub layer: Vec<u32>,
    pub style: Vec<u32>,
}
impl LineStore {
    pub fn with_capacity(n: usize) -> Self {
        Self {
            ids: Vec::with_capacity(n),
            x1: Vec::with_capacity(n),
            y1: Vec::with_capacity(n),
            x2: Vec::with_capacity(n),
            y2: Vec::with_capacity(n),
            layer: Vec::with_capacity(n),
            style: Vec::with_capacity(n),
        }
    }
    pub fn push(&mut self, id: EntityId, a: Point2, b: Point2, layer: u32, style: u32) {
        self.ids.push(id);
        self.x1.push(a.x);
        self.y1.push(a.y);
        self.x2.push(b.x);
        self.y2.push(b.y);
        self.layer.push(layer);
        self.style.push(style)
    }
    pub fn len(&self) -> usize {
        self.ids.len()
    }
    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }
    pub fn bounds(&self, i: usize) -> Aabb2 {
        Aabb2::new(
            Point2::new(self.x1[i], self.y1[i]),
            Point2::new(self.x2[i], self.y2[i]),
        )
    }
}
#[derive(Default)]
pub struct Scene {
    pub lines: LineStore,
    pub revision: u64,
}
impl Scene {
    pub fn touch(&mut self) {
        self.revision = self.revision.wrapping_add(1)
    }
}
