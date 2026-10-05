# 贡献行业工作流包

[English](contributing-skills.md) | 简体中文

一个行业包就是一个自包含目录 `skills/kjdraw-<industry-task>/`，其中放置 Skill 及该任务需要的资源。包内可以有模板、图层规则、参考资料、确定性辅助脚本和测试，绘图能力复用共享 CAD 运行时。任何行业都可以贡献；复用现有工具的工作流无需 fork SDK 或注册 MCP。

## 三步开始

1. **新建一个目录。** 使用少于 64 个字符的小写连字符名称，与 `SKILL.md` 中的 `name` 一致。从以下最小结构开始：

   ```text
   skills/kjdraw-<industry-task>/
     SKILL.md             任务触发场景、输入、产物和工作指引
     README.zh-CN.md      中文说明，或提供英文 README.md
     assets/              可选：有授权的模板或公开合成样本
     references/          可选：图层规则、schema 或任务详情
     scripts/             可选：确定性辅助脚本
     tests/               可选：聚焦的辅助脚本／工作流测试
   ```

   首次贡献可以只写中文或只写英文，维护者会在发行前协助补齐另一语言。不创建空的可选目录；Skill 入口保持简短，按需链接自己的资源。

   ```yaml
   ---
   name: kjdraw-<industry-task>
   description: 写清具体任务，以及何时应使用这个 Skill。
   ---
   ```

2. **验证任务。** 说明一个小型公开合成输入、预期产物、运行时／工具前提和失败条件。在仓库根目录添加 `tests/community-<industry-task>.spec.mjs`，名称对应包名去掉 `kjdraw-` 的部分；例如 `kjdraw-sheet-template` 对应 `tests/community-sheet-template.spec.mjs`。它可以调用包内的聚焦测试或辅助脚本。验证包所声明的真实行为，缺少这个测试入口时检查会失败。在仓库根目录检查单个包或全部包：

   ```sh
   npm run check:skill -- skills/kjdraw-xxx
   npm run check:skill
   ```

   将 `kjdraw-xxx` 替换为自己的目录，记录行为测试命令、结果和跳过项。结构检查不是 CAD 或模型验收；[审查边界](skill-review-boundaries.zh-CN.md)说明证据、分页、源文件保留和审批要求。

3. **提交聚焦的 PR。** 包含该目录、一份中文或英文的人读 README、所需资源和测试，并在 [skills/README.md](../skills/README.md) 添加用途与契约链接。说明授权及运行时兼容性。从[行业包认领清单](industry-skill-tasks.md)选择任务，也欢迎提出自己的任务。复用现有工具的工作流可以直接提 PR；较大主题可先开[领域贡献 Issue](https://github.com/KanJieTeam/kjdraw/issues/new?template=domain_contribution.yml)。

## 按缺少的能力选择路线

| 任务需要什么 | 贡献什么 | 起点 |
| --- | --- | --- |
| 现有 CAD 工具能表达工作流 | 一个独立 Skill 目录，附有用资源和测试 | [文字审计](../skills/kjdraw-text-audit/README.zh-CN.md)、[机械孔阵列](../skills/kjdraw-hole-pattern/README.zh-CN.md) |
| 明确的行业事实需要新的确定性 planner／编译器 | 有独立输入／输出契约的 planner 或插件 | [planner starter](../examples/domain-planner-starter/README.md)、[plugin starter](../examples/plugin-starter/README.md) |
| 缺少原生图元或操作 | 带验证与兼容契约的小型引擎 PR | [Agent 契约](agent.md)、[开发检查](../CONTRIBUTING.zh-CN.md#开发与验证) |

模板和规则由包拥有，项目观测事实作为独立输入。核对已安装运行时的实际工具 schema；文字描述不能增加不支持的操作，行业名称也不能证明缺失的工程事实。

[图纸模板包](../skills/kjdraw-sheet-template/README.zh-CN.md)是完整的资源样例：一个目录内包含原创图框／标题栏、JSON 图层和符号规则、确定性提案辅助脚本及聚焦测试。

[详细审查指南](skill-review-boundaries.zh-CN.md)保留完整编写与安全要求、本地发现／安装命令、运行时版本区别和建议行业方向。除非 PR 明确针对共享 [CAD Skill](../packages/kjdraw-sdk/skills/kjdraw-cad/SKILL.md)，否则保持该基础技能不变。
