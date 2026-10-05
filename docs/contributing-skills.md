# Contribute an industry workflow pack

English | [简体中文](contributing-skills.zh-CN.md)

An industry pack is one self-contained directory, `skills/kjdraw-<industry-task>/`, containing a Skill and the resources its task needs. It can own templates, layer rules, references, deterministic helpers and tests while reusing the shared CAD runtime. Any industry can contribute; a workflow using existing tools needs no SDK fork or MCP registration.

## Start in three steps

1. **Add one directory.** Use a lowercase, hyphenated name under 64 characters, matching the `name` in `SKILL.md`. Start with this minimum:

   ```text
   skills/kjdraw-<industry-task>/
     SKILL.md             Task trigger, inputs, output and working instructions
     README.zh-CN.md      Chinese guide, or README.md for an English guide
     assets/              Optional licensed templates or synthetic samples
     references/          Optional layer rules, schemas or task details
     scripts/             Optional deterministic helpers
     tests/               Optional focused helper/workflow tests
   ```

   Initial contributions can be Chinese-only or English-only. Maintainers help prepare the other language before release. Do not create empty optional folders. Keep the Skill entry short and link resources it needs.

   ```yaml
   ---
   name: kjdraw-<industry-task>
   description: Describe the concrete task and when this Skill should run.
   ---
   ```

2. **Verify the task.** Document a small public synthetic input, expected output, required runtime/tools and failure conditions. Add `tests/community-<industry-task>.spec.mjs` at the repository root, matching the part of your pack name after `kjdraw-` (for `kjdraw-sheet-template`, use `tests/community-sheet-template.spec.mjs`). It can run focused tests or helpers from inside the pack. Test the actual behavior the pack claims; the check fails if this entry is missing. From the repository root, check one pack or all packs:

   ```sh
   npm run check:skill -- skills/kjdraw-xxx
   npm run check:skill
   ```

   Replace `kjdraw-xxx` with your directory. Record behavioral test commands, results and skips. A structure check is not a CAD or model acceptance test; the [review boundaries](skill-review-boundaries.md) explain evidence, pagination, source preservation and approval requirements.

3. **Submit a focused PR.** Include the directory, one human README in either language, needed resources and tests, then add its purpose and contract link to [skills/README.md](../skills/README.md). State licenses and runtime compatibility. Choose from the [industry-pack claim list](industry-skill-tasks.md), or propose your own task. A workflow using existing tools can go straight to a PR; a [domain contribution issue](https://github.com/KanJieTeam/kjdraw/issues/new?template=domain_contribution.yml) is optional for a larger topic.

## Choose the route that matches the missing capability

| What the task needs | What to contribute | Starting point |
| --- | --- | --- |
| Existing CAD tools can express the workflow | One independent Skill directory, with useful resources and tests | [Text audit](../skills/kjdraw-text-audit/README.md); [mechanical hole pattern](../skills/kjdraw-hole-pattern/README.md) |
| Explicit domain facts need a new deterministic planner/compiler | A separate planner or plugin with its own input/output contract | [Planner starter](../examples/domain-planner-starter/README.md); [plugin starter](../examples/plugin-starter/README.md) |
| A native primitive or operation is missing | A scoped engine PR with validation and a compatibility contract | [Agent contract](agent.md); [development checks](../CONTRIBUTING.md#development-and-verification) |

Templates and rules belong to the pack; observed project facts remain separate inputs. Check the installed runtime's actual tool schemas. A Skill cannot add an unsupported operation by describing it, and industry labels do not establish missing engineering facts.

The [sheet-template pack](../skills/kjdraw-sheet-template/README.md) is a complete resource example: an original frame/title block, JSON layer and symbol rules, a deterministic proposal helper and focused tests in one directory.

The [detailed review guide](skill-review-boundaries.md) keeps the complete authoring and safety requirements, local discovery/install commands, runtime-version distinctions and suggested industry directions. Leave the shared [CAD Skill](../packages/kjdraw-sdk/skills/kjdraw-cad/SKILL.md) unchanged unless your PR explicitly concerns that foundation.
