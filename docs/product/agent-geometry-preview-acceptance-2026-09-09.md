# Agent geometry preview acceptance — 2026-09-09

Status: locally accepted. Git publication is separate from npm release.

## Delivered

- LINE/CIRCLE creation and MOVE proposals include immutable before/after geometry.
- Core commands preflight against a detached document, including layer edit restrictions.
- New entity IDs are allocated once; preview and approved creation use identical IDs and payloads.
- Source revision/digest binding, host-only approval, duplicate rejection and normal undo remain in place.
- Replacing a command after review prevents approval. Unexpected committed geometry reports failure without automatically replaying or undoing host edits.
- Public preview types, bilingual integration guide and installed-package example are updated.

## Verified

| Check | Result |
| --- | --- |
| Node 22 full suite, including isolated npm consumer | 333/333 passed |
| Node 24 full suite, including isolated npm consumer | 333/333 passed |
| Chromium, Firefox, WebKit actual canvas preview / clear / approve / undo | 3/3 passed |
| Strict TypeScript and generated declaration checks | Passed |
| Documentation, API generation and repository checks | Passed |

Negative cases cover locked default layer, stale revision, concurrent source modification, replaced commands, frozen returned geometry, duplicate approvals and the 4 MiB source limit. Browser checks inspect pixels, not only DOM presence.

## Boundaries

This increment covers LINE/CIRCLE creation and MOVE only, at most 64 affected entities and 256 KiB returned geometry. The helper uses built-in commands, not host plugins. It does not provide design/constraint validation or a complete live-model workbench. Provider tests remain offline fixtures; no paid model call or npm release was performed.
