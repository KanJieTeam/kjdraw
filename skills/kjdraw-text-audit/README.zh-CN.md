# 图纸文字核对

[English](README.md) | 简体中文

可独立安装的只读 KJDraw Skill。让智能体清点图纸文字、报告重复的原始字符串，或核对你明确提供的文字。它复用 CAD 运行时，不新增解析器、绘图引擎或 MCP 服务。

## 使用

前提：包含 `cad_read_drawing` 和 `cad_query_drawing` 的本地 KJDraw 运行时，以及能使用终端的智能体。当前 Skills CLI 要求 Node.js 22.20+；运行时有自己的版本要求。检查纸空间还需要 `cad_read_layouts`。先查询实际安装版本的工具，不假定某个版本一定具备。

在源码检出中，仅发现技能、不修改客户端配置：

```sh
npx skills add ./skills/kjdraw-text-audit --list
```

允许修改你自己的客户端技能配置时，从这个目录安装：

```sh
npx skills add ./skills/kjdraw-text-audit
```

Skill 与 CAD 运行时分别安装；该目录不必放在已安装的运行时中，也不依赖另一个已安装的 Skill。只有目录合并至默认来源后，才能保证通过仓库简称安装；合并前使用本地目录或自己的 Fork。

需求示例：

> 核对 `drawing.dxf` 模型空间中的 TEXT 和 MTEXT，报告完全相同的重复文字，检查是否包含 `Project: Demo` 和 `ZK01`。不要修改原图。

## 输入与产物

输入：本地 DXF/KJD、可访问工作区、检查范围，以及可选的必需完整字符串。原始文字核对可用于无单位图纸，不推断测量值或钻孔源数据。

产物：绑定实际导入文档 revision 与源文件摘要的清单，包含实际返回的原生 ID、类型、图层／owner 范围、文字及数量、重复项、未找到的调用方必需文字和导入／覆盖限制。handle 仅在工具实际返回时列出，否则标为不可用。重复标注可能合理；存储的 MTEXT 包含格式语法，本样例不声称完成渲染后的纯文字比较。

DXF 多次读取前，先一次导入为新的内部临时 KJD 工作快照：因为分别调用 CLI 导入 DXF 会重建原生 UUID 与 owner ID。原 DXF 与快照均保持不变，不要求用户管理或改用新格式。只读调用可在临时工作区建立空会话账本，它不是修改提案或审批回执。核对结果覆盖受支持的导入记录，不认证 DXF 无损解释。

本技能包不实现图纸修改、修改提案、审批、编辑后导出或外部模型请求。宿主智能体可能通过其已配置的模型理解工具输出；这是宿主选择，不是技能暗藏的 API 接入。

## 验收与贡献

验证工作流时阅读[验收案例](references/acceptance.md)。仓库测试使用公开合成输入验证真实 CLI 读取、分页、原生记录及原文件保留，不等同于模型正确率或工程认证：

```sh
node scripts/validate-community-skills.mjs
node --test tests/community-skills.spec.mjs tests/community-text-audit.spec.mjs
```

贡献其他工作流时，可复制这个小包的结构，选择新名称，定义真实输入／产物并写对应的行为测试。不要只改名字就宣称增加了 CAD 能力。代码与原创样例材料采用仓库 Apache-2.0 许可；本包不包含客户图纸或第三方模板。
