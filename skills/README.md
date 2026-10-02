# Community Skills

Independent workflows built on the KJDraw CAD runtime. Each Skill has its own directory, short `SKILL.md`, input/output contract, resources only when needed, and reproducible acceptance cases. Skills reuse actual CAD operations; they do not install the runtime or create missing engine capabilities.

[Create a Skill](../docs/contributing-skills.md) · [贡献技能包（中文）](../docs/contributing-skills.zh-CN.md)

| Skill | Purpose | Contract |
| --- | --- | --- |
| [kjdraw-text-audit](kjdraw-text-audit/README.md) | Read-only literal text inventory, duplicate strings and caller-required label checks. | [中文说明](kjdraw-text-audit/README.zh-CN.md), [acceptance](kjdraw-text-audit/references/acceptance.md). |

The existing [kjdraw-cad](../packages/kjdraw-sdk/skills/kjdraw-cad/SKILL.md) is the general CAD foundation, shipped with the SDK. Community directories here are distributed as Git Skills, not automatically bundled into an npm runtime release.

## First contribution

Fork the repository, create `skills/kjdraw-<topic>/`, define one useful workflow and test observable results with redistributable synthetic inputs. Open a focused PR with the Skill, human-facing English/Chinese READMEs, relevant resources and tests. Reusing installed tools normally needs no core changes; a missing primitive should be proposed as a separate SDK/plugin change.

```sh
node scripts/validate-community-skills.mjs
node --test tests/community-skills.spec.mjs tests/community-text-audit.spec.mjs
```

For local discovery without installing into a client:

```sh
npx skills add ./skills --list
```

After merge into the default source, users can select an individual Skill with `npx skills add KanJieTeam/kjdraw --skill <name>`. Before merge use your local directory or own fork. Installing a Skill is not evidence that its model workflow or every host client has passed acceptance.

## 如何贡献其他技能包

每个技能独立开发，不必把行业功能全塞进 `kjdraw-cad`。先选一个具体任务，写清输入、产物、适用范围与拒绝条件，再用公开合成样本验证实际 CAD 操作。提交一个小型 PR，收录后用户可按技能名选择安装。

文字核对样例只读，不修改图纸。其他技能若会修改图纸，仍须走原生提案与授权审核，并测试审批前不变、未修改对象保留、撤销重做及保存重开。不要放 API Key、客户原图、私有测量数据或无授权模板。
