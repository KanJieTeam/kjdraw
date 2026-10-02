# 两孔参数改型

将用户明确确认的两个原生圆孔绑定为“共同孔径、中心距”参数，再通过本地 CLI 提案和独立人工审核进行修改。保存 KJD 后可以继续改参数，DXF 用于交付展平后的几何。

这个包复用现有 CAD 引擎和设计关系能力。新增的使用入口是两孔绑定 helper 与本地审核工作流；不重新实现孔阵列或几何求解器。[Skill 指令](SKILL.md)、[输入与验收契约](references/acceptance.md)。

## 运行时要求

Node.js 22+，以及支持 `DESIGNCREATE`、`DESIGNUPDATE` 和 `--flatten-design-relations` 的 `kjdraw-review`。用 `kjdraw-review --help` 和 `kjdraw agent tools <工具名>` 核对实际能力。安装 Skill 不会更新 CAD 运行时。

本贡献修改源码中的审核器；未经发行验证，不应假定当前 npm `next` 或固定源码安装器已包含它。在这个候选检出里，使用 `node packages/kjdraw-sdk/bin/kjdraw.mjs` 和 `node packages/kjdraw-sdk/bin/kjdraw-review.mjs`。合并前使用本地目录或自己的 fork 发现这个 Skill。

```sh
npx skills add ./skills/kjdraw-hole-revision --list
```

仅在用户授权修改客户端配置后安装。默认仓库发行前，不能把本地可用描述成已从上游发布。

## 一个实际例子

[原创合成 DXF](assets/two-holes.dxf) 的单位是毫米：孔 A 位于 `(10,20,0)`，孔 B 位于 `(50,20,0)`，半径均为 `4`，独立参考线为 `(0,0,0)` 到 `(100,0,0)`。它不包含尺寸、引线、块或厚度，不来自客户图纸。

1. 将 DXF 一次转换到新的 KJD 快照，读取实际对象 ID。
2. 用户确认孔 A 固定、孔 B 沿当前 XY 连心方向移动，并明确孔径和中心距范围。当前值是 `diameter=8`、`spacing=40`。
3. helper 生成设计绑定参数；CAD 工具返回待审提案。由真人单独审核后生成新的 KJD/DXF/回执。
4. 从新的 KJD 提议 `diameter=10`、`spacing=60`，审核后保存。重开该 KJD，再提议 `diameter=12`、`spacing=80`。
5. 最终两孔半径应为 `6`，中心为 `(10,20,0)` 与 `(90,20,0)`，参考线不变。KJD 中参数关系保留，DXF 中不保留。

例子的数值只是合成测试事实，不是制造标准或推荐设计尺寸。详细查询 JSON、helper 输入和审核命令见[验收契约](references/acceptance.md)。

## 输入边界

第一版只接受小型、完整单页的模型空间查询，显式包含隐藏对象，目标为两只可见可编辑、同半径、同 Z、默认 +Z 的原生 `CIRCLE`。全页实体仅可为 `CIRCLE`、`LINE`、`ARC`、`POINT`、`LWPOLYLINE`、`POLYLINE`、`TEXT`、`MTEXT`；尺寸、引线、块插入、填充和未知类型均拒绝。有标注依赖的图纸不适用。

查询投影不暴露所有厚度与依赖信息。输入中的 `circlesHaveNoThickness` 和 `noDependentAnnotations` 必须来自用户/宿主实际核实，helper 不能自动证明它们。查询参数和结果也必须来自同一次真实原生读取，手写 JSON 不是独立 CAD 证据。

指定参数关系是新的调用方约定，不表示从 DXF 恢复出原设计意图。缺少单位、目标歧义、参数不匹配、过滤或截断的查询、已有绑定冲突、手动几何漂移和过期 revision 都需拒绝或补齐事实。已有直径标注、引线、公差、材料与加工注释不会自动同步。

## 验证与许可

在仓库根目录运行：

```sh
npm run check:skill -- skills/kjdraw-hole-revision
node --test tests/community-hole-revision.spec.mjs
node --test packages/kjdraw-sdk/test/kjdraw-review.test.mjs
```

专项测试使用实际 CLI、原生工具和公开合成图；审核确认只属于 `internal-test-fixture`，不冒充真人批准。测试检查源字节保留、两轮修改、未改对象、ID/handle、KJD 参数持久化、DXF 几何重开，以及非法输入和冲突拒绝。它们不调用外部模型，不能声称真实模型或独立用户验收。

本包源码、说明和合成 DXF 为原创，遵循仓库 Apache-2.0。没有引入第三方图纸、字体、标准表或新增依赖。
