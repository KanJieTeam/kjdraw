# Governance

KJDraw is maintained in public by KanJieTeam. Technical decisions are driven by reproducible evidence, stable application contracts and the needs of downstream engineering applications.

## Decision levels

- Small fixes, tests and documentation use normal pull-request review.
- New public APIs, file-format changes, geometry authority changes and deprecations require an issue or RFC before implementation.
- Stable release promotion requires every in-scope gate in the machine-readable acceptance matrix, a release candidate, packed-package verification and public Demo/Docs validation from the same commit.
- Security-sensitive changes require a second review from a maintainer who did not author the change.

Maintainers may reject silent approximation, lossy export, unverifiable compatibility claims, proprietary fixtures, hidden network behavior or changes that duplicate public and downstream implementations.

## Roles

Contributors submit issues, reproductions, documentation and pull requests. Reviewers have sustained, technically accurate contributions and may approve within their demonstrated area. Maintainers can merge, triage security work and cut releases. Release managers verify the immutable release checklist but do not waive failed gates.

Reviewer or maintainer status is earned through a history of constructive reviewed work. KanJieTeam records active ownership through repository permissions and CODEOWNERS. At least two authorized maintainers are required for a stable release so release and security response do not depend on one person.

## Compatibility and appeals

The public core is upstream. Private Kanjie products consume a pinned public revision and may add domain features without moving those private assets into this repository. General fixes land upstream first to prevent parallel implementations.

When consensus is not immediate, maintainers document the alternatives, compatibility impact and evidence in the issue or RFC. A contributor may request reconsideration with new evidence. Conduct matters are handled under [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
