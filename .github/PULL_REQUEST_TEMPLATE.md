## Change

Link the issue/RFC and describe one user-visible problem and the resulting behavior. See [contributing guidance](https://github.com/KanJieTeam/kjdraw/blob/main/CONTRIBUTING.md) / [中文贡献指南](https://github.com/KanJieTeam/kjdraw/blob/main/CONTRIBUTING.zh-CN.md).

For a domain contribution from any industry, state the users, module boundary and where it lives: task/fixture, planner/plugin, data rule/knowledge pack, drawing layout, or independent Skill. For a new Skill, follow the [Skill developer guide](https://github.com/KanJieTeam/kjdraw/blob/main/docs/contributing-skills.md) and include the package directory, actual runtime/tool requirements and acceptance tests. Domain resources need a versioned contract and an existing consumer or separately reviewed host; do not assume a universal loader. New public APIs, tool/profile exposure, installer/distribution mechanisms and large format/geometry changes need prior maintainer agreement; reusing existing tools in a Skill does not itself require a core change.

## Inputs and acceptance

Describe supplied facts, drawing/source units, scale, exact targets and source provenance. State outputs, untouched objects/resources, refusal/clarification conditions and capability/compatibility changes. Distinguish annotation edits from changes to retained engineering source data.

For mutations, explain the unchanged original before review, exact preview, authorized host approval, one transaction where required, real undo/redo and KJD/DXF reopen checks. For read-only work, require no mutation or approval. Do not use prompt-keyword execution, guessed measurements or AI self-approval.

## Verification

List exact commands, exit results and skips; include tests or a minimal public-safe reproduction. Write “not run” where appropriate. Fixture selftests are not actual model runs or independent interoperability evidence.

- [ ] Added focused positive and refusal/regression tests appropriate to the change.
- [ ] Ran relevant checks from the contribution guide, including full Node suite when applicable; reported unavailable checks rather than claiming a pass.
- [ ] For SDK TS changes, generated and included matching JS and `.d.ts`, and ran generation drift checks; otherwise marked not applicable below.
- [ ] For file/geometry changes, checked unchanged objects/resources and save/reopen; reported independent pinned-`ezdxf` results or why not run.
- [ ] For UI/page changes, reported affected Chromium, Firefox and WebKit tests, including mobile boundaries where applicable; otherwise marked not applicable below.
- [ ] No unrelated repository-wide formatting; pilot lint/format scope remains incremental.

Not applicable / not run / known limitations:

## Source

Identify new dependencies, fixtures and imported assets, their origins and licenses. Submit only code and material you may publish under Apache-2.0. Private-use authorization is not public redistribution permission. Do not attach customer drawings/coordinates, proprietary fonts/templates/symbols, credentials or keys; use small original synthetic fixtures.

- [ ] I have publication rights for submitted material and have stated provenance/licenses.
- [ ] I reviewed and understand any AI-assisted changes; generated output alone is not correctness evidence.

Breaking changes / migration notes / updated capability boundaries, if any:

Security vulnerabilities should be reported privately through [SECURITY.md](https://github.com/KanJieTeam/kjdraw/blob/main/SECURITY.md), not in this PR. Review and releases follow [GOVERNANCE.md](https://github.com/KanJieTeam/kjdraw/blob/main/GOVERNANCE.md).
