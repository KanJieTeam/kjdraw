# 圆形孔阵列

[English](README.md) | 简体中文

这是一个可独立安装的机械绘图 Skill：把用户明确给出的孔位事实转成一次可审核的 KJDraw 原生极坐标阵列提案。它与其他行业共用同一个 CAD 核心，不依赖地质源数据、其他 Skill、行业模板或新增绘图引擎。

## 使用

需要本地 KJDraw 运行时，包含支持 `polarArrays` 的 `cad_propose_drawing_pattern`、`kjdraw` 与 `kjdraw-review` 命令，以及能使用终端的智能体。验收重开后的候选几何还需要原生 `cad_read_drawing` 和 `cad_query_drawing`。应查询已安装工具的实际 schema，不能假定任意版本都有这些能力。源码运行时要求 Node.js 22+；当前 Skills CLI 要求 Node.js 22.20+。

在源码检出中先列出该包，不修改客户端配置：

```sh
npx skills add ./skills/kjdraw-hole-pattern --list
```

获得修改自己客户端 Skill 配置的授权后，从此目录安装：

```sh
npx skills add ./skills/kjdraw-hole-pattern
```

这些是可选安装说明，样例不会自行执行安装。Skill 与 CAD 运行时分别安装；此目录不依赖运行时附带的 `kjdraw-cad` Skill。仓库简写安装仅在目录合入默认源码后可用，之前使用本地路径或自己的 fork。绘图流程不包含修改客户端配置、安装运行时或接入外部模型服务。

请求示例：

> 在新的毫米单位图纸中只画八个等径圆孔。中心为 (10,20)，分度圆直径为 40，孔直径为 4。首孔方向为从 +X 轴逆时针量取 90 度。给出原生待审提案，保留源图。

在 KJDraw 源码检出中，`node packages/kjdraw-sdk/bin/kjdraw.mjs` 等价于 `kjdraw`，`node packages/kjdraw-sdk/bin/kjdraw-review.mjs` 等价于 `kjdraw-review`。[Skill 指令](SKILL.md) 给出了实际种子与阵列参数。示例种子中心是 `(10,40)`，半径为 `2`，不能把孔直径 `4` 当作半径。原生 `count: 8` 包含种子，最终恰好生成八个圆；首孔角度通过种子位置表示，`angleDegrees: 360` 表示整圈扫角。

## 输入与输出约定

输入为可访问的工作区、新图或本地 KJD/DXF、中心 XY、分度圆直径、孔直径、孔数、带明确角度约定的首孔角度或方向，以及图纸单位。所有长度使用该单位。本样例支持毫米或米，孔数为 2–512。缺失单位或首孔方向时应补齐事实，不能采用隐含默认值。非法孔数、非有限或非正尺寸、单位不一致及原生坐标范围或精度问题应明确报错，不替换成另一套几何。

审批前输出为一次原子 `CREATEBATCH` 提案、恰好包含请求孔数的原生预览、源 revision 与摘要，以及工具实际返回的待审账本和序号。不自行添加分度圆、法兰外形、表格、文字、标准螺纹孔径或材料事实。圆孔几何不等于制造、强度或装配认证。

已有 DXF 在提案前只导入一次新的内部 KJD 快照，因为多次 CLI 导入会重新生成对象身份，而独立审批会重开其源文件。原始字节与快照保持不变；用户仍可取得 DXF，不需要将 KJD 改成自己的工作格式。临时转换必须使用新路径，通用转换命令可能覆盖输出。CLI 不提供完全无损导入的证明；保留约定针对原始字节与已经导入且受支持的原生快照。

经授权宿主审核后的输出是新的 `candidate.kjd`、`candidate.dxf` 和 `candidate.review.json`。人工在独立交互终端运行 `kjdraw-review`，检查并回答其确认挑战；模型不得代答。三个输出路径都必须未被占用。宿主审核检查精确源图与提案、单次原生创建事务、KJD 重开、DXF 原生类型计数及实时撤销重做。重开 DXF 中的孔位与半径还需要验收文档中的原生几何检查。KJD 保留原生 GROUP 不代表 DXF 也保存 GROUP；当前 DXF 适配器不导出这些组。实时会话中的撤销验证不代表普通候选文件重开后保有撤销历史。

## 验证与贡献

[验收用例](references/acceptance.md) 定义了实际孔数、分度圆半径、孔半径、方向、保留、失败边界和保存重开的检查。独立运行仓库样例：

```sh
node scripts/validate-community-skills.mjs
node --test tests/community-hole-pattern.spec.mjs
```

专项测试使用公开合成输入、真实原生 CLI 提案、宿主测试审核与 KJD/DXF 重开。内部测试确认必须标为测试，不冒充人工批准。这些测试证明可执行 CAD 行为，不证明未经测试的模型已遵守 Skill；要声称模型行为通过验收，需另外记录一次真实智能体执行。

贡献其他行业流程时，定义真实输入、输出与验收边界，再组合已有 CAD 工具。源码和这些原创指令遵循仓库 Apache-2.0 许可。本样例不包含客户图纸、受许可机械标准表或第三方模板。
