use crate::scene::EntityId;
use std::collections::{HashMap, HashSet, VecDeque};
#[derive(Default)]
pub struct DependencyGraph {
    forward: HashMap<EntityId, HashSet<EntityId>>,
}
impl DependencyGraph {
    pub fn link(&mut self, a: EntityId, b: EntityId) {
        if a != b {
            self.forward.entry(a).or_default().insert(b);
        }
    }
    pub fn affected(&self, roots: &[EntityId]) -> Vec<EntityId> {
        let mut seen: HashSet<EntityId> = roots.iter().copied().collect();
        let mut q: VecDeque<EntityId> = roots.iter().copied().collect();
        while let Some(x) = q.pop_front() {
            if let Some(next) = self.forward.get(&x) {
                for y in next {
                    if seen.insert(*y) {
                        q.push_back(*y)
                    }
                }
            }
        }
        seen.into_iter().collect()
    }
}
