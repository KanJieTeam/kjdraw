use crate::geometry::{Aabb2, Point2};
#[derive(Clone, Copy, Debug)]
pub struct Camera2D {
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub x: f64,
    pub y: f64,
    pub fit_scale: f64,
}
impl Default for Camera2D {
    fn default() -> Self {
        Self {
            width: 1.0,
            height: 1.0,
            scale: 1.0,
            x: 0.0,
            y: 0.0,
            fit_scale: 1.0,
        }
    }
}
impl Camera2D {
    pub fn resize(&mut self, w: f64, h: f64) {
        self.width = w.max(1.0);
        self.height = h.max(1.0)
    }
    pub fn fit(&mut self, b: Aabb2, pad: f64) {
        let w = b.width().max(1e-12);
        let h = b.height().max(1e-12);
        let s = ((self.width - 2.0 * pad) / w)
            .min((self.height - 2.0 * pad) / h)
            .max(1e-12);
        self.fit_scale = s;
        self.scale = s;
        self.x = (self.width - w * s) / 2.0 - b.min.x * s;
        self.y = (self.height - h * s) / 2.0 - b.min.y * s
    }
    pub fn world_to_screen(&self, p: Point2) -> Point2 {
        Point2::new(self.x + p.x * self.scale, self.y + p.y * self.scale)
    }
    pub fn screen_to_world(&self, p: Point2) -> Point2 {
        Point2::new((p.x - self.x) / self.scale, (p.y - self.y) / self.scale)
    }
    pub fn pan(&mut self, dx: f64, dy: f64) {
        self.x += dx;
        self.y += dy
    }
    pub fn zoom_at(&mut self, p: Point2, factor: f64) {
        let w = self.screen_to_world(p);
        let next = (self.scale * factor).clamp(self.fit_scale * 0.02, self.fit_scale * 250.0);
        self.scale = next;
        self.x = p.x - w.x * next;
        self.y = p.y - w.y * next
    }
}
