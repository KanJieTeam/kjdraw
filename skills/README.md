# Community Skills

Independent, cross-industry workflows built on the same KJDraw CAD runtime. Each Skill has its own directory, short `SKILL.md`, input/output contract, resources only when needed, and reproducible acceptance cases. Skills reuse actual CAD operations; they do not install the runtime or create missing engine capabilities.

[Create a Skill](../docs/contributing-skills.md) · [贡献技能包（中文）](../docs/contributing-skills.zh-CN.md)

| Skill | Purpose | Contract |
| --- | --- | --- |
| [kjdraw-text-audit](kjdraw-text-audit/README.md) | Read-only literal text inventory, duplicate strings and caller-required label checks. | [中文说明](kjdraw-text-audit/README.zh-CN.md), [acceptance](kjdraw-text-audit/references/acceptance.md). |
| [kjdraw-hole-pattern](kjdraw-hole-pattern/README.md) | Mechanical circular hole patterns from explicit dimensions, with a native proposal and authorized review. | [中文说明](kjdraw-hole-pattern/README.zh-CN.md), [acceptance](kjdraw-hole-pattern/references/acceptance.md). |
| [kjdraw-hole-revision](kjdraw-hole-revision/README.zh-CN.md) | Bind two caller-confirmed native holes to diameter/spacing parameters and revise them through separate local host review. | [输入与验收](kjdraw-hole-revision/references/acceptance.md); requires compatible design review and explicit DXF flattening. |
| [kjdraw-sheet-template](kjdraw-sheet-template/README.md) | Original A4/parameterized frame and title-block resources with executable layer/symbol rules and native review. | [中文说明](kjdraw-sheet-template/README.zh-CN.md), [acceptance](kjdraw-sheet-template/references/acceptance.md); not a certified standard. |

The existing [kjdraw-cad](../packages/kjdraw-sdk/skills/kjdraw-cad/SKILL.md) is the general CAD foundation, shipped with the SDK. Community directories here are distributed as Git Skills, not automatically bundled into an npm runtime release.

## Any industry, explicit boundaries

Mechanical, architectural, road/municipal, electrical, process, survey/geology and drawing-layout workflows are possible contribution directions, not a catalog of completed industry products. There is no industry allowlist. The [review-boundary matrix](../docs/skill-review-boundaries.md#suggested-industry-contribution-directions) maps example tasks to required inputs and boundaries; the [industry-pack task list](../docs/industry-skill-tasks.md) records concrete scopes and how to claim one.

The shared engine owns geometry, object identity, layers, transactions, review and supported DXF exchange. A domain Skill supplies the workflow and, when needed, licensed templates, rules and versioned input schemas. It must state what the installed runtime can execute; a folder does not add BIM, circuit analysis, a universal knowledge loader or a new CAD primitive. Missing planners belong in a separate planner/plugin proposal; missing core primitives need a focused engine proposal.

## First contribution

Fork the repository, create `skills/kjdraw-<topic>/`, define one useful workflow and test observable results with redistributable synthetic inputs. Open a focused PR with the Skill, one human-facing README in **English or Chinese**, relevant resources and tests. Maintainers help prepare the other language before release; both translations are not an entry requirement. Reusing installed tools normally needs no core changes; a missing primitive should be proposed as a separate SDK/plugin change.

From the repository root, one command checks structure and runs all community packs' focused behavioral tests:

```sh
npm run check:skill
```

To check only this resource example, use `npm run check:skill -- skills/kjdraw-sheet-template`. These checks make no model calls and do not prove real-model acceptance.

For local discovery without installing into a client:

```sh
npx skills add ./skills --list
```

After merge into the default source, users can select an individual Skill with `npx skills add KanJieTeam/kjdraw --skill <name>`. Before merge use your local directory or own fork. Installing a Skill is not evidence that its model workflow or every host client has passed acceptance.

## 如何贡献其他技能包

不限勘察，也不限定行业名单：机械、建筑、市政、电气、工艺或排版等工作流都可独立贡献。共用引擎负责 CAD 执行，行业包负责流程及必要的模板／规则／数据契约；不能仅靠新增目录宣称已具备缺失能力。可从[行业包认领清单](../docs/industry-skill-tasks.md)选一个具体任务，写清输入、产物、适用范围与拒绝条件，再用公开合成样本验证实际 CAD 操作。首次 PR 只需英文 `README.md` 或中文 `README.zh-CN.md` 任一种，维护者协助在发布前补齐另一语言；不要求先写双语。仓库根目录执行 `npm run check:skill` 即检查结构并运行所有社区包的专项行为测试，也可按上述参数只检查一个包。验证不调用模型、不安装客户端，不代表真实模型验收。提交一个小型 PR，收录后用户可按技能名选择安装。

文字核对样例跨行业、只读；机械孔阵列和图框／标题栏资源样例会生成待审提案，不由模型自行批准。图框示例实际消费原创模板和图层／符号规则，未宣称行业认证。修改类技能须测试审批前不变、未修改对象保留、撤销重做及保存重开，并说明 DXF 不保留的身份、分组或历史边界。不要放 API Key、客户原图、私有测量数据或无授权模板。
