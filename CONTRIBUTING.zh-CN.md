# 参与 KJDraw 贡献

[English](CONTRIBUTING.md) | 简体中文

**想贡献其他可安装的 Skill？** 先看[技能包开发指南](docs/contributing-skills.zh-CN.md)和[独立样例／技能目录](skills/README.md)。复用已有 CAD 工具时，新增工作流目录与聚焦测试即可，不必修改通用 CAD Skill 或引擎。

感谢你帮助建设开放的 CAD 基础。勘察技术员、工程同事和开发者都可以参与，不必先修改 CAD 内核。一个小型合成 DXF、可复现的日常任务、一条数据规则，或输入输出明确的领域 planner，都是合适的起点。无需先找 UUID 或写代码：提供自然需求、可公开示意／范围和预期，由实施者通过原生读取绑定 ID；需求模糊时先确认，不猜你的数据。

## 从一个真实任务开始

1. 新建[领域贡献 Issue](https://github.com/KanJieTeam/kjdraw/issues/new?template=domain_contribution.yml)（[表单源码](.github/ISSUE_TEMPLATE/domain_contribution.yml)），写清日常任务、已提供的事实及单位、预期结果、不得改变的内容，以及应拒绝或询问的条件。可以先提交文字说明或合成示意图，不要求客户文件或 API Key。
2. 与维护者确认一个小范围。较大的 API、文档格式或几何权威变更应先提 Issue 或 [RFC](docs/rfcs/0000-template.md)。
3. Fork 仓库，创建如 `codex/domain-unit-fixture` 的分支，只解决一个问题。暂时没有开发环境的同事，可以先贡献任务说明和可公开的最小样本。
4. 添加可复现测试并执行下列相关检查。提交小型 PR、关联 Issue，写出实际命令、结果、跳过项与限制。不要把夹具自测写成真实模型运行，也不要把未执行检查写成通过。

可复用贡献应是边界清晰的独立模块：文档化输入、有界产物、授权来源、测试和窄宿主适配器。一个大包、自动注册所有工具，或仅新增 Skill 目录，都不能替代这些契约。

## 选择合适的贡献入口

下表列的是现有参考位置，不代表一个 PR 应同时修改所有模块。

| 贡献类型 | 现有参考／落点 | 最小提交内容 |
| --- | --- | --- |
| 日常任务或兼容性样本 | [tests/fixtures/](tests/fixtures/)、[tests/](tests/)、[SDK 测试](packages/kjdraw-sdk/test/) | 可公开的最小文件或生成器、来源说明、调用方事实与单位、预期／实际结果、正例与拒绝例。 |
| 领域 planner 或宿主插件 | [examples/domain-planner-starter/](examples/domain-planner-starter/README.md)、[examples/plugin-starter/](examples/plugin-starter/README.md) | 纯“事实→绘图意图”planner、输入输出契约与限额、权限 manifest、宿主控制的适配器、确定性测试。优先独立示例／模块或外部包，不新增第二套文档引擎。 |
| 勘察数据规则／知识包 | [geology-core.ts](packages/kjdraw-sdk/src/knowledge-packs/geology-core.ts)、[知识包指南](docs/site/pages/knowledge-packs.md)、[geology-engineering.ts](packages/kjdraw-sdk/src/geology-engineering.ts) | 有授权、有版本、有出处的规则；区分实测与合成事实；单位／连续性／非法数据测试；独立预期几何。编译器或 API 变更需要维护者审阅。 |
| 绘图版式、文字或花纹映射 | [curated-geology-sheets.mjs](examples/curated-geology-sheets.mjs)、[hatch-pattern-catalog.ts](packages/kjdraw-sdk/src/hatch-pattern-catalog.ts)、[浏览器测试](tests/browser/) | 源数据明确的合成样本、几何／比例断言、可再分发的原创花纹数据、未修改对象和资源检查；可见页面变更还需浏览器证据。截图不能单独证明几何正确。 |
| 独立 Skill 或 Agent 工作流 | [技能包开发指南](docs/contributing-skills.zh-CN.md)、[skills/](skills/README.md)、[文字核对样例](skills/kjdraw-text-audit/README.zh-CN.md) | 单独的 `skills/kjdraw-<topic>/`、支持的运行时／工具、输入产物契约、短指引、中英人读 README 与可复现验收。复用现有工具无需修改内核；新图元或安装器变更另行审阅。 |
| 文档或翻译 | [docs/](docs/)、本指南及[英文镜像](CONTRIBUTING.md) | 可用路径与命令、准确能力边界；中英文保持语义一致。 |

[planner starter](examples/domain-planner-starter/README.md) 可通过 `node --test tests/domain-planner-starter.spec.mjs` 运行。其示例输入为 `center: [0, 0]`、`pitchDiameter: 90`、`holeDiameter: 10`、`count: 6`，所有长度采用宿主明确的图纸单位；输出六个圆的绘图意图，分布半径为 45，孔半径为 5。公开插件适配器一次事务完成绘制；测试包含非法输入、对象数量、revision、真实 undo/redo 与 KJD/DXF 重开。它是贡献模式，不是经过工程认证的设计，也不会自动装进每个 Agent。

## 工程事实与安全边界

- KJDraw 通过公开 SDK 命令修改自己的图纸及导入 DXF。打开 DXF 不会自动恢复钻孔测量、原始地层、水位观测或生成图形的源 recipe。不能从文字、坐标或参考图片猜测缺失的工程事实。
- 可复用知识包保存有授权、有版本的语义和绘图规则，不保存私有项目测量数据。source recipe 保存特定生成图纸的调用方原始事实，参见 [geology-drawing-update.ts](packages/kjdraw-sdk/src/geology-drawing-update.ts)。源数据修订必须有实际保留的 recipe 或明确提供的源输入。修改显示孔号不等于修改源数据中的钻孔身份。
- 源数据单位与图纸单位不同时应分别说明，并写清比例、owner／空间、精确目标身份、可选字段语义和上下界。缺失、已确认空值与数值零不能混同。按契约保留未请求记录、ID、handle、资源和顺序。
- 禁止通过提示词关键词直接执行 CAD、编造测量、静默补值、近似执行不支持的操作或在导出时丢对象。渲染器只是投影，不是第二套文档数据库；UI、插件和 Agent 宿主应共用公开 SDK 命令。
- AI 可以读取和提案，由授权宿主／审核者查看精确预览后批准。提案不是完成修改。禁止模型自批准、宿主偷偷改写模型参数；未经支持和测试，不能宣称会话提案重启后仍可审批。
- 安装 Skill 不等于安装 CAD 运行时。新增目录不会自动注册工具，也不会自动发布可通过 `npx` 安装的包。运行时依赖、工具／profile 暴露、权限和发行渠道都应与维护者明确确认。

## 可直接复制的首次贡献

把下面任务粘贴到领域 Issue 表单，或按自己的合成日常任务调整。它不需要私有图纸或付费模型：

```text
标题：只改一个合成孔号文字，不改变工程事实
类型：任务／夹具回归
来源：原创公开合成数据；非客户项目；Apache-2.0
图纸单位：millimeter；model space；没有保留的勘察源 recipe
输入：
  TEXT id=label-a, text="ZK01", position=[10,20,0], height=3
  TEXT id=label-b, text="ZK01", position=[40,20,0], height=3
  LINE id=boundary, start=[0,0,0], end=[100,0,0]
调用方要求：只将 label-a 的原文 "ZK01" 改成 "ZK02"。
预期产物：一个经过审核的文字修改；label-b 仍为 "ZK01"。
必须保留：label-a 位置／高度／样式／身份；label-b 与 boundary
  完整记录；无关资源；若提供了源数据，其事实也不得改变。
审批之前：原图序列化、revision 和 history 均不变。
审批之后：一次已提交事务；增加一个 undo 记录。
Undo：恢复实际原文及几何；redo：恢复已批准结果。
保存／重开：另存新 KJD 和 DXF，不覆盖输入；重开后独立检查
  两处文字、位置、高度和 boundary 几何。
  ID／handle 按各格式实际支持的保留契约检查。
拒绝／询问：缺精确目标、单位未知／不支持、revision 过期，或
  expectedText 与原文不符；不得部分修改或自动批准。
未要求：修改源数据的钻孔身份、地层或水位资料。
```

代码 PR 应在上述目录添加小生成器／夹具与聚焦测试。可参考 [agent-text-edit.test.mjs](packages/kjdraw-sdk/test/agent-text-edit.test.mjs) 的原生读取／提案／批准及保留断言。检查几何和未修改对象完整记录，不只检查新文字是否出现。DXF 重开按已声明格式边界比较原生语义；不要声称 DXF 携带会话审批账本或 undo archive。

其他适合首个 Issue 的内容：米／毫米不匹配时必须拒绝且原图不变的合成样本；或一条有授权的岩性→花纹规则，明确源岩性、合法边界和不支持值的拒绝测试。不能根据标签猜岩性，也不能复制专有花纹库。首个 PR 保持一个任务或一条规则。

## 开发与验证

使用 Node.js 22 或更新版本，在仓库根目录执行：

```sh
npm ci
npm run typecheck
node --test tests/domain-planner-starter.spec.mjs
node scripts/test.mjs
node --no-warnings scripts/build-typescript.mjs --check
node scripts/build-declarations.mjs --check
node scripts/check.mjs
```

还应运行自己的聚焦回归。报告实际执行的命令、退出状态及不可用的可选检查；夹具自测不能证明真实模型正确，也不能证明功能已发行。

独立 DXF 检查需要 Python 和锁定版本的 `ezdxf`：

```sh
python -m pip install -r scripts/audits/requirements-dxf.txt
python -c "import sys, ezdxf; print(sys.executable); print(ezdxf.__version__)"
```

安装多个解释器时，测试前将 `KJDRAW_PYTHON` 指向上面可导入依赖的 Python：POSIX shell 使用 `export KJDRAW_PYTHON=/path/to/python`，PowerShell 使用 `$env:KJDRAW_PYTHON = 'C:\path\to\python.exe'`。部分 audit worker 使用 Python 隔离模式，需保证选定解释器环境确实包含依赖，而不是仅装在另一个解释器的 user site。缺依赖或跳过独立测试不能算互操作检查通过。更多兼容性检查见 [DXF corpus audit](scripts/audit-dxf-corpus.mjs)。

`packages/kjdraw-sdk/src` 下的 TypeScript 是权威源码。因为固定源码安装器直接执行相邻生成 JS，这些 JS 仍需提交；`packages/kjdraw-sdk/types` 中的声明也需提交。修改 TS 后运行 `npm run build:runtime` 和 `npm run build:types`，提交对应 JS 与 `.d.ts`，再执行上面的两项生成漂移检查。审查 diff，避免无关生成改动。删除生成 JS 需要协调安装器／包迁移，不能作为孤立清理。

页面／UI 变更应添加或更新[浏览器测试](tests/browser/)，在 Chromium、Firefox、WebKit 执行受影响用例。安装 Playwright 浏览器后，例如运行 `npm run test:browser -- tests/browser/ai-text-search.spec.mjs`；应选择对应变更的 spec 并报告每个引擎的实际结果。涉及移动布局时保留溢出检查。用 `node scripts/serve.mjs` 启动 playground。

格式化和 lint 仅逐步覆盖已有 pilot 文件。修改该范围时执行 `npm run format:pilot:write`，再执行 `npm run format:pilot:check` 与 `npm run lint:pilot`；CI 检查相同范围。这不是全仓库格式化，应以小规模可审阅步骤扩大门禁。Rust 开发需要 stable Rust 和 `wasm32-unknown-unknown` target，参见[入门指南](docs/getting-started.md)。

## 审阅、授权与发行

PR 应解释用户可见结果及验证，对几何、事务和文件保留变更加测试；限制变化时更新[能力边界](docs/capability-matrix.md)。提供运行时版本、实体／格式类型、依赖与素材许可。

只提交你有权按 Apache-2.0 公开的代码与样本。优先原创合成夹具，或已明确授权、真正去标识且可再分发的材料；改文件名不等于脱敏。不得上传私有项目文件、客户坐标／名称、专有字体／模板／符号／二进制或密钥。私有内部使用授权不是公开传播授权；需要私下审阅时另与维护者协商。欢迎 AI 辅助贡献，但贡献者应理解、审阅并测试；生成产物本身不是正确性证据。

目前由 KanJieTeam 维护发行。公开 SDK 变更先进入本仓库，下游产品验证后采用固定版本。包采用语义化版本，API 演进期间使用明确的 preview／RC 标签。破坏性变更需要发行说明和迁移解释。外部审阅者可通过持续、经过审阅的贡献成为维护者，但不会自动获得提交权限。参见 [GOVERNANCE.md](GOVERNANCE.md) 和 [SUPPORT.md](SUPPORT.md)。

参与者遵守[行为准则](CODE_OF_CONDUCT.md)。漏洞通过 [SECURITY.md](SECURITY.md) 私下报告，不在公开领域 Issue 中披露。
