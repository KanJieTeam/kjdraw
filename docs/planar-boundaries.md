# 原生多环边界提取

已有 `JOIN` 可以把一个连通的链或环合成多段线。边界提取复用这个排序能力，同时处理多个连通分量、外环、孔和孔中岛，并保留每个结果线段的原始图元身份。它不需要行业模板，也不修改选中的源对象。

## 先只读检查，再应用

```js
import { previewPlanarBoundaries } from '@kanjieteam/kjdraw/planar-boundaries'
import { applyPlanarBoundaryExtraction } from '@kanjieteam/kjdraw/planar-boundary-edit'

const request = {
  ids: selectedEntityIds,
  units: document.toJSON().header.units,
  expectedRevision: document.revision,
  tolerance: 1e-7,
}
const preview = await previewPlanarBoundaries(document, request)
// 显示 preview.contours 和 preview.diagnostics，让调用方审核。
if (preview.complete) {
  const applied = await applyPlanarBoundaryExtraction(document, {
    ...request,
    expectedGeometryDigest: preview.receipt.geometryDigest,
  })
  // applied.resultIds 是新增的闭合 LWPOLYLINE，源对象全部保留。
  await document.undo()
  await document.redo()
}
```

`previewPlanarBoundaries` 不改变图档序列化内容、revision、完整源记录或 undo history。输入单位必须与图档相同，调用前后检查 `expectedRevision`。`sourceDigest` 绑定排序后的 `sourceIds` 所指向的完整源记录；`geometryDigest` 绑定轮廓、面积、样式、逐段映射及诊断。这些摘要用于变更检测，不是签名或身份认证。

应用必须绑定完整预览的摘要，并重新检查来源、空间、样式、图层保护和 revision。它作为一个事务创建全部原生闭合多段线；不删除源对象。预览不完整时应用失败，不能默认应用“看起来正确”的部分结果。`CONTOURBOUNDARIES` 命令使用相同审核与提交路径。

## 输出与逐段来源

每个 `contours` 项包含：

- `closed: true`、原生 `vertices: [{ point: [x,y,0], bulge }]`。
- `area` 为该环的带符号面积；外环为正、孔为负；整体 `area` 为各环之和。
- `depth` 为嵌套深度，偶数为外环或孔中岛，奇数为孔；对应 `hole`。
- `sourceIds`、`ownerId`、一致的源 `style`。
- `segments[i]` 与 `vertices[i]` 到下一个顶点的线段对应，包含 `sourceId`、`sourceSegmentIndex`、`reversed`。
- `sourceBoundaryError` 为 ARC/CIRCLE 转成 bulge 边界的保守误差界。

LINE 和 ARC 的 `sourceSegmentIndex` 为 0。LWPOLYLINE 的索引指向原始顶点开始的线段。CIRCLE 使用从正 X 端点到负 X 端点、再返回的两个半圆，索引分别为 0 和 1。方向反转时同步调整 bulge、线段顺序与 `reversed`。大于半圆的 ARC 保留为原生大 bulge；原生验证器内部的精确圆弧拆分不会改变提取结果的来源映射。

请求 ID 顺序不影响同一图档的结果。输出规范化环方向、起始顶点和结果顺序，并把几何中的负零规范为零。没有通过重建或覆盖源记录实现这些规范化。

提取结果可以送给既有偏置能力，必须只传它接受的几何字段：

```js
import { computePlanarContours } from '@kanjieteam/kjdraw/planar-contours'

if (!preview.complete) throw new Error('先处理边界诊断')
const offset = await computePlanarContours({
  operation: 'offset',
  contours: preview.contours.map(({ closed, vertices }) => ({ closed, vertices })),
  distance: 2,
  tolerance: 1e-7,
})
```

这次偏置的 tolerance 描述相对于**提取后的原生边界**的运算，不自动包含提取时的源转换误差；不能把两次容差独立使用后宣传为相对于原始 ARC/CIRCLE 的同一个总误差保证。后续操作须重新选用适当的容差和几何契约。

## 支持范围与诊断

本阶段支持同一 owner/空间、Z=0、法线 `[0,0,1]` 下的 LINE、开 ARC、CIRCLE，以及零宽度的开/闭 LWPOLYLINE。每个闭环内部的源绘图样式须一致；互不连接的闭环可以来自不同图层。纯预览可以检查锁定图层；应用仍须通过图层保护规则。

端点连接要求存储/计算后的坐标**严格相等**。容差内但不同的端点报告 `near-endpoint`，不移动端点、不插入连接线。恰为 π/2 整数倍的 ARC 角度使用精确轴向 sin/cos，避免把理论轴向零坐标变成浮点尾差；其他角度沿用原始起止角计算。若真实源端点不相等，即使很接近，也保持未连接状态。

稳定的诊断代码为：

| 代码 | 含义 |
| --- | --- |
| `open-chain` | 连通分量有未匹配端点 |
| `branch` | 同一端点的连接度超过 2 |
| `near-endpoint` | 两个不同端点在容差内，连接存在歧义 |
| `self-intersection` | 闭环自交，或线段来源对应关系存在歧义 |
| `boundary-intersection` | 源路径交叉、重合、接触，或多环关系无法通过验证 |
| `incompatible-style` | 一个闭环混合了不同绘图样式 |
| `precision` | 原生验证器不能在当前数值边界内确认轮廓 |

诊断包含完整相关 `sourceIds` 和可用的问题点。独立有效分量仍可出现在 `contours` 中供检查，但 `complete` 为 false。多环整体关系验证失败时，全部候选轮廓被撤回，避免输出缺少孔或错误嵌套的区域。非法类型、非平面几何、宽度、退化源线段、单位/revision 不符、超限输入和后端不可用直接抛错。

不会自动跨交点切割面、删除重复线、修复裂缝、从文字猜边界或把圆弧替换为折线。ELLIPSE、SPLINE、带宽/厚度几何、块引用内部几何和任意 OCS 不在这一阶段。

## 数值与资源边界

请求限制为 1–256 个实体、4096 个源线段、64 个结果环，以及 131072 次原始线段对的跨源求交预算。坐标和半径限制为绝对值 `1e9`，bulge 为 `1e6`，tolerance 范围为 `[1e-9,1e-2]`，默认 `1e-7` 图纸单位。

原生 contour WASM 的零距离验证路径先检查真实圆弧、自交、退化、环间接触/交叉和嵌套方向，不做实际偏置；提取结果的顶点和逐段来源由原始路径构建。面积采用局部坐标的圆弧 Green 积分，孔岛分类采用解析直线/圆弧射线 winding，并经原生多环验证器再检查。

该模块继承原生内核的数值拒绝范围，包括精确输入坐标局部化、过浅圆弧、不可分辨派生半径和最终世界坐标误差。**一般小坐标的十进制圆弧也可能因局部化不精确而报告 precision**；默认容差并不保证所有合法轮廓都可提取。源 ARC 转换的误差使用局部中心位移及 TwoSum 残差检查，CIRCLE 使用正负 X 端点加法的 TwoSum 残差。

转换精度与边界间距使用不同方向的预算。每环的数值验证扣除该环转换误差，使用 `tolerance - sourceBoundaryError`；整体自交、接触及孔岛关系验证则使用向上舍入的 `tolerance + 2 * max(sourceBoundaryError)`。两侧边界都可能因转换移动，因此间距验证不能使用剩余精度预算，否则原始相交或接近的圆可能缩成互不相交的边界。即使只有一个环，也执行整体关系验证。扩大后的间距容差超过原生上限 `1e-2` 时返回 `precision` 诊断，不接受部分结果；转换误差为零时沿用请求容差。

后端沿用 contour 模块的默认本地 WASM；Node 和浏览器可显式传 `wasmBytes` 或 `wasmUrl`。没有隐式远程几何服务或几何降级。

## 验证

```sh
node --test tests/planar-boundaries.spec.mjs
node --test tests/planar-boundary-edit.spec.mjs
npm run typecheck
```

提取专项覆盖乱序/反向路径、多个独立环、孔中岛、大圆弧、原生逐段身份、明确的断边/分支/交叉拒绝、容差内端点歧义、数值拒绝、异步 revision 冲突、源与 history 完整保留、KJD/DXF 重开和独立 ezdxf 检查。独立 DXF 验证环境使用 `KJDRAW_PYTHON`；设置 `KJDRAW_BENCH_INTEGRATION_REQUIRED=1` 后缺少解析器会失败，不能把跳过当成通过。这些合成夹具不代表任意行业图纸全量兼容。
