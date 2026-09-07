use std::collections::{HashMap, HashSet};

use crate::geometry::Aabb2;
use crate::scene::EntityId;

/// Mutable deterministic broad-phase index used by selection, snapping and culling.
#[derive(Default)]
pub struct UniformGridIndex {
    cell: f64,
    cells: HashMap<(i64, i64), Vec<EntityId>>,
    bounds: HashMap<EntityId, Aabb2>,
}

impl UniformGridIndex {
    pub fn new(cell: f64) -> Self {
        Self {
            cell: cell.max(1e-12),
            cells: HashMap::new(),
            bounds: HashMap::new(),
        }
    }

    fn range(&self, bounds: &Aabb2) -> (i64, i64, i64, i64) {
        (
            (bounds.min.x / self.cell).floor() as i64,
            (bounds.max.x / self.cell).floor() as i64,
            (bounds.min.y / self.cell).floor() as i64,
            (bounds.max.y / self.cell).floor() as i64,
        )
    }

    fn add_to_cells(&mut self, id: EntityId, bounds: &Aabb2) {
        let (x0, x1, y0, y1) = self.range(bounds);
        for x in x0..=x1 {
            for y in y0..=y1 {
                self.cells.entry((x, y)).or_default().push(id);
            }
        }
    }

    pub fn insert(&mut self, id: EntityId, bounds: Aabb2) {
        if self.bounds.contains_key(&id) {
            self.remove(id);
        }
        self.add_to_cells(id, &bounds);
        self.bounds.insert(id, bounds);
    }

    pub fn update(&mut self, id: EntityId, bounds: Aabb2) {
        self.insert(id, bounds);
    }

    pub fn remove(&mut self, id: EntityId) -> bool {
        let Some(bounds) = self.bounds.remove(&id) else {
            return false;
        };
        let (x0, x1, y0, y1) = self.range(&bounds);
        for x in x0..=x1 {
            for y in y0..=y1 {
                let key = (x, y);
                let remove_cell = if let Some(values) = self.cells.get_mut(&key) {
                    values.retain(|candidate| *candidate != id);
                    values.is_empty()
                } else {
                    false
                };
                if remove_cell {
                    self.cells.remove(&key);
                }
            }
        }
        true
    }

    pub fn clear(&mut self) {
        self.cells.clear();
        self.bounds.clear();
    }

    pub fn len(&self) -> usize {
        self.bounds.len()
    }
    pub fn is_empty(&self) -> bool {
        self.bounds.is_empty()
    }

    pub fn query(&self, bounds: &Aabb2) -> Vec<EntityId> {
        let (x0, x1, y0, y1) = self.range(bounds);
        let mut seen = HashSet::new();
        for x in x0..=x1 {
            for y in y0..=y1 {
                if let Some(values) = self.cells.get(&(x, y)) {
                    seen.extend(values.iter().copied());
                }
            }
        }
        let mut result: Vec<EntityId> = seen
            .into_iter()
            .filter(|id| {
                self.bounds
                    .get(id)
                    .map(|candidate| candidate.intersects(bounds))
                    .unwrap_or(false)
            })
            .collect();
        result.sort_unstable();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::Point2;

    #[test]
    fn update_does_not_leave_stale_cells_and_query_is_deterministic() {
        let mut index = UniformGridIndex::new(10.0);
        index.insert(9, Aabb2::new(Point2::new(0.0, 0.0), Point2::new(2.0, 2.0)));
        index.insert(2, Aabb2::new(Point2::new(1.0, 1.0), Point2::new(3.0, 3.0)));
        let origin = Aabb2::new(Point2::new(-1.0, -1.0), Point2::new(4.0, 4.0));
        assert_eq!(index.query(&origin), vec![2, 9]);
        index.update(
            9,
            Aabb2::new(Point2::new(100.0, 100.0), Point2::new(102.0, 102.0)),
        );
        assert_eq!(index.query(&origin), vec![2]);
        assert!(index.remove(2));
        assert!(index.query(&origin).is_empty());
    }
}
