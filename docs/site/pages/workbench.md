---
slug: workbench
title.en: Using the workbench
title.zh: 工作台操作指南
summary.en: Open a drawing, create and modify geometry with exact coordinates, then save the result.
summary.zh: 打开图纸，用精确坐标创建和修改图形，再保存结果。
---
:::en
## Open a drawing {#open}

Open the Live Demo and choose an industry drawing, or choose **Open** to load a DXF, KJD or KJP file. You can also drag a supported file onto the canvas. The embedded editor opens DXF and KJD; the Demo project workspace also opens multi-drawing KJP packages.

The active drawing appears in the title area. Choose **Fit view** after opening a file if the geometry is outside the current view. Opening a file replaces the current Demo workspace, so save edits you want to keep first.

To start empty in the Demo, choose **+** beside the drawing tabs, give the drawing a name and select its units. The new drawing is added to the current project; existing drawings remain available.

## The drawing workflow {#drawing-workflow}

Choose a drawing tool from the Ribbon or the **Drawing tool** list. Tool-specific settings appear in the options bar or drawing dialog. Set these before picking points, then follow the prompt above the command bar.

- Click the canvas to accept the prompted point.
- Enter a coordinate in the command bar to place the same point exactly.
- Press **Backspace** or choose **Undo point** to remove the last uncommitted point.
- For a polyline, spline or hatch, press **Enter** or choose **Finish** when enough points have been accepted. Press **C** or choose **Close** when the tool offers a closed result.
- Press **Esc** to cancel the current operation and return to Select. No entity is added and no undo entry is created.

After a fixed-length object such as a line or circle is created, the same tool remains ready for the next object. Press **Esc** when you are finished drawing.

## Enter exact coordinates {#coordinates}

While a drawing or point-driven modification is active, use one of these forms in the command bar:

| Input | Meaning |
| --- | --- |
| `100,50` | Absolute point X=100, Y=50 |
| `@40,-10` | 40 units right and 10 units down from the last accepted point |
| `@25<30` | 25 units from the last point at 30 degrees |

Polar angles are measured in degrees, counter-clockwise from the positive X axis. Relative input needs an earlier point in the current operation. Typed coordinates are exact; canvas picks can use the Snap and Ortho controls.

Example: choose **Line**, enter `100,50`, then enter `@40<0`. This creates a 40-unit horizontal line from `(100,50)` to `(140,50)`.

## Create basic geometry {#draw-tools}

| Tool | Point order and finish action |
| --- | --- |
| Point | Position |
| Line | Start, endpoint |
| Rectangle | First corner, opposite corner |
| Polyline | Two or more vertices; **Enter** keeps it open, **C** closes it |
| Polygon | Center, one vertex on the circumscribed circle; set **Sides** first |
| Ray | Origin, direction point |
| Construction line | Origin, direction point; extends in both directions |

Ray and construction-line tools do not create an object when selected or when placing the origin. Moving the pointer shows a finite direction guide. The second point commits the infinite construction line (or one-way ray); **Esc** before confirmation removes the preview without changing the drawing.

Confirmed construction lines and rays export as native XLINE/RAY in DXF 2000–2024, including their space ownership and 3D direction. R12/R14 export is outside this supported subset. Rendering clips each line to the current viewport, so a distant origin does not make a line disappear when you pan or zoom.

**Fit view** frames finite geometry without including construction-line or ray origins, including guides inside blocks. If the drawing only contains guides, it centers the first visible guide origin and keeps the current zoom.

For example, to make a closed outline, choose **Polyline**, enter `0,0`, `@80,0`, `@0,50`, `@-80,0`, then press **C**. The outline is committed as one closed polyline and can be undone in one step.

## Circles, arcs and ellipses {#curves}

Choose the construction mode before placing points:

- **Circle · Center / radius:** center, then a point on the circle. In the Demo, after picking the center you may also enter a positive radius such as `25`.
- **Circle · Two points:** the two endpoints of a diameter.
- **Circle · Three points:** three different, non-collinear points on the circle.
- **Arc · Center / start / end:** center, start point, end point. The arc runs counter-clockwise from start to end.
- **Arc · Three points:** start, a point the arc must pass through, then end.
- **Ellipse:** center, major-axis endpoint, then a third point that sets the perpendicular minor-axis distance.

Coincident points, a zero radius and three collinear circle points are rejected. Correct the last point and try it again; the earlier accepted points remain available until you cancel.

## Splines and hatches {#spline-hatch}

For a **Spline**, choose the degree first. Pick at least `degree + 1` control points, then press **Enter** to finish. Use **Backspace** to revise the last control point before committing. **C** produces a closed spline when enough points are available.

For a **Hatch**, choose **SOLID**, **ANSI31** or **ANSI37** and set the scale before drawing the boundary. Pick at least three boundary vertices, then press **Enter** or **C**. KJDraw closes the boundary when it creates the hatch. ANSI31 is a single diagonal pattern; ANSI37 is a crossed diagonal pattern. In the embedded drawing dialog, clear **Solid fill** when choosing a line pattern.

Hatch creation currently uses one polygon boundary per operation. Draw separate hatches for separate regions.

Imported DXF hatches use their actual line definitions, including custom names, dashed lines, dots and staggered row origins. Polygon/bulge and LINE/ARC boundaries use even-odd hole clipping. Moving, rotating, uniformly scaling or mirroring a hatch transforms its pattern with its boundary; saving DXF retains the transformed definition. Ellipse/spline hatch boundaries and nonstandard collinear dash offsets remain unsupported. Very dense patterns draw partially within a bounded work budget; the editor prompts you to zoom in. A partial pattern is not complete plotting output.

For an application-defined pattern, supply `patternLines` in drawing coordinates: each line has an `angle` in radians, `base: [x,y]`, `offset: [dx,dy]` and signed `dashes` (positive stroke, negative gap, zero dot; `[]` is continuous). These values already include the current `patternAngle`/`patternScale`. Store those settings as `patternDefinitionAngle`/`patternDefinitionScale` if your application will later change the global settings without rewriting the definitions. The renderer's `report.hatchDiagnostics` identifies `budget`, `unsupported-pattern` or `unsupported-boundary` limitations by entity ID.

## Add dimensions {#dimensions}

Choose **Dimension**, select a type, and follow this point order:

| Type | Point order |
| --- | --- |
| Aligned | First measured point, second measured point, dimension-line position |
| Linear / rotated | First measured point, second measured point, dimension-line position; set the direction or rotation first |
| Radius | Circle center, point on the circle |
| Diameter | One diameter endpoint, opposite endpoint |

The displayed measurement is calculated from the accepted geometry. In the Demo, **Text height** controls the annotation size.

## Select, move and copy {#move}

Click the edge of an object to select it. **Shift** adds to the selection; **Ctrl** (or **Command** on macOS) removes from it. The Properties panel shows the primary object and the selection count.

Drag from empty canvas to select several objects:

| Gesture | Result |
| --- | --- |
| Left to right · blue solid frame | Select objects entirely inside the window |
| Right to left · green dashed frame | Select objects inside or intersecting the frame |
| Shift + drag | Add the result to the existing selection |
| Ctrl / Command + drag | Remove the result from the existing selection |
| Ctrl / Command + A, with the editor focused | Select editable, visible objects in the current drawing space |

The frame tests the drawing geometry, not just overlapping object bounds. A small frame inside an empty circle does not select the circle. **Esc** cancels an unfinished frame without changing the selection.

To select objects along an open path, enter **FENCE** in the command line, pick two or more points, then press **Enter**. **Backspace** removes the last point; **Esc** cancels. The path is not automatically closed.

When one editable object is selected, its blue square **grips** appear. Drag a line endpoint, a circle quadrant, or a polyline vertex to reshape it. The highlighted preview is temporary; releasing the pointer commits one edit. **Undo** restores the previous geometry. Dragging a selected object away from its grips moves it as a whole.

Hidden and frozen layers are excluded from picking. Locked layers remain visible, but cannot be selected for editing or modified by editing commands. Unlock, thaw or show the layer before editing it. If the drawing, revision or view changes during a drag, the pending drag is cancelled.

Choose **Move**, click a base point, then click the destination. You can also choose Move before selecting an object. The blue preview is temporary; the destination creates one undoable edit. **Copy** uses the same two-point workflow, keeps the originals and selects the new objects.

For an exact displacement, select the objects and enter `MOVE 10 0` or `COPY 10 0`. `M` or `COPY` without coordinates starts the interactive tool. You can also drag an already selected object to move the selection.

## Modify geometry {#modify}

Select the objects first, then choose **More editing tools**. Enter the parameters and continue on the canvas when prompted. Until the command commits, the selected IDs, drawing and revision stay fixed; **Esc** cancels the pending operation.

Selection order matters for operations that pair a target with boundaries or two lines:

| Operation | Selection and point order |
| --- | --- |
| Rotate / Scale | Select one or more objects, enter angle or factor, then pick the center |
| Mirror | Select one or more objects, choose whether to erase the source, then pick two axis points |
| Rectangular array | Select one or more objects, then enter rows, columns and their spacing |
| Polar array | Select one or more objects, enter count and fill angle, then pick the center |
| Offset | Select exactly one LINE, RAY, XLINE, CIRCLE or ARC; enter distance, then pick the offset side |
| Break | Select exactly one LINE or ARC, then pick the break point |
| Explode | Select one polyline-compatible object; no canvas point is required |
| Trim · Single edit | Select a LINE, ARC or CIRCLE first, Shift-select the cutting boundaries, choose **Single edit**, then pick the portion to remove |
| Extend · Single edit | Select a LINE or ARC first, Shift-select the limiting boundaries, choose **Single edit**, then pick near the end to extend |
| Chamfer / Fillet | Select exactly two LINE objects in order, enter distances or radius, then pick the side to keep on the first line and the second line |

To control selection order, click the first object normally, then Shift-click each additional object. If the order is wrong, click empty canvas to clear the selection and select again.

Trim keeps both remaining sides when you remove an interior interval of a line or arc. Trimming a circle produces a native arc; Undo restores the original circle. Circular editing supports boundaries made from lines, rays, infinite lines, circles and arcs in the same XY plane. A circle needs two distinct cutting points. Pick inside the portion, not exactly at an intersection or at the circle center.

To extend an arc, pick near the endpoint you want to move. The arc reaches the nearest boundary along that end's continuation without crossing its opposite endpoint. Pick again if the prompt reports an ambiguous point, or press Esc to cancel.

## Trim or extend several objects {#continuous-editing}

Use **Continuous** mode to reuse the same boundaries across several edits. This workflow is available in both the Live Demo and the embedded editor.

1. Choose **Trim** or **Extend**, then choose continuous mode. Alternatively, enter `TRIM` or `EXTEND` without arguments in the command bar.
2. Click the cutting boundaries. Further clicks add boundaries; **Ctrl / Command + click** removes one. You can also window-select them. A visible, locked boundary can be used without unlocking it.
3. Press **Enter** or choose **Confirm boundaries**. The prompt now asks for targets.
4. Hover over a line, arc or circle to preview the retained geometry, then click the portion to remove. For Extend, hover and click near the line or arc endpoint to extend. Hovering never changes the drawing or undo history.
5. Continue clicking other targets. Each successful click is a separate undo step. Invalid or ambiguous picks show a prompt; pick another portion or end to retry.
6. Press **Enter** or choose **Finish** to end the tool. **Esc** also ends the pending operation; it does not undo already completed edits.

The options bar shows the current phase and number of completed edits. Switching language keeps your boundaries. Switching drawings or layouts, undoing, or modifying the drawing through another tool ends the session so a pending pick cannot affect a different drawing state.

Single-edit mode remains available for target-first selection. When at least two objects are already selected, the tool dialog defaults to that mode; otherwise it defaults to continuous mode. Choose explicitly when the preselection is intended as boundaries rather than a target and boundaries.

For applications that supply their own UI or Agent, see [geometric previews and reviewed edits](https://kanjieteam.github.io/kjdraw/docs/latest/agent/#geometric-preview). The same public session API drives both workbenches.

## Undo, navigate and save {#save}

Use **Undo** and **Redo** to step through committed drawing and modification commands. Removing an uncommitted draft point is different: use **Backspace** or **Undo point** before the object is created.

The canvas toolbar contains Select, Pan, Fit view, Zoom in and Zoom out. With Pan selected, drag using the left mouse button. Middle-button dragging also pans, and the mouse wheel zooms. Navigation does not modify geometry or add undo history.

In the Demo, **Save KJP** downloads the whole project and **DXF** exports the active drawing. In an embedded editor, **Save KJD** preserves native drawing data and **Export DXF** creates an exchange file. Reopen the saved file when you want to verify the result. Downloading a file does not configure background cloud storage.

## Choose a layout {#layouts}

Available from **1.0.0-rc.3**:

| Layout | Best for |
| --- | --- |
| Classic | Familiar Ribbon tools and visible panels |
| Compact | More canvas space with a shorter horizontal toolbar |
| Focus | Reviewing drawings or using commands, with Ribbon and side panels hidden |

The layout selector remains available in Focus. Switching layouts preserves the editor, drawing, selection and undo history. The Demo remembers the choice in this browser. Embedded instances keep their own layout; the host application decides whether to persist it.

```ts
const editor = createKJDrawEditor('#cad', { layout: 'classic' })
await editor.ready
editor.setLayout('compact')
```

## If an operation does not work {#troubleshooting}

- Read the prompt above the command bar. The tool may still be waiting for an object, a base point or another vertex.
- If a relative coordinate is rejected, enter the first point as `x,y` before using `@dx,dy` or `@distance<angle`.
- For a variable-length tool, make sure the minimum number of points has been accepted before pressing Enter or C.
- For continuous Trim/Extend, confirm the boundaries before clicking targets. In single-edit mode, select the target first and the boundaries afterwards. For Chamfer and Fillet, select exactly two LINE objects.
- If a drawing tool rejects a point as degenerate, choose a different last point. Use Esc only when you want to discard the whole in-progress object.
- Check layer visibility and choose Fit view if a created or opened object is outside the current view.
:::
:::zh
## 打开图纸 {#open}

进入在线 Demo 后，可以选择一张行业图纸，也可以点击**打开**载入 DXF、KJD、KJP 文件；还可以把支持的文件直接拖到画布。嵌入式编辑器支持 DXF、KJD，Demo 工程工作区还支持包含多张图纸的 KJP 包。

当前图纸会显示在标题区。打开文件后如果暂时看不到图形，点击**全图**。打开文件会替换 Demo 当前工作区，因此需要保留的修改请先保存。

在 Demo 中从空白开始：点击图纸标签旁的 **+**，输入图纸名称并选择绘图单位。新图纸会加入当前工程，已有图纸仍可继续切换使用。

## 绘图的基本流程 {#drawing-workflow}

从 Ribbon 或**绘图工具**列表选择工具。工具专属参数会显示在浮动参数栏或绘图对话框中。先设置参数，再按照命令栏上方的提示依次取点。

- 在画布上单击，可接受当前提示要求的点。
- 在命令栏输入坐标，可精确输入同一个点。
- 按 **Backspace** 或点击**退回一点**，可删除最后一个尚未提交的点。
- 绘制多段线、样条曲线或填充时，达到最少点数后，按 **Enter** 或点击**完成**；工具允许闭合时，按 **C** 或点击**闭合**。
- 按 **Esc** 取消当前操作并回到选择状态；不会新增对象，也不会产生撤销记录。

直线、圆等固定点数对象创建后，同一工具会继续等待绘制下一个对象。全部画完后按 **Esc** 返回选择。

## 输入精确坐标 {#coordinates}

绘图或需要取点的修改操作进行中，可在命令栏使用以下格式：

| 输入 | 含义 |
| --- | --- |
| `100,50` | 绝对坐标点 X=100、Y=50 |
| `@40,-10` | 相对上一个已接受点，向右 40、向下 10 个单位 |
| `@25<30` | 相对上一个点，按 30° 方向前进 25 个单位 |

极坐标角度使用度数，以 X 轴正方向为 0°，逆时针增加。相对坐标必须建立在当前操作已有点的基础上。键盘输入采用精确值；画布点选可配合对象捕捉与正交开关。

例如：选择**直线**，输入 `100,50`，再输入 `@40<0`，即可从 `(100,50)` 画到 `(140,50)`，线长为 40。

## 创建基础图形 {#draw-tools}

| 工具 | 取点顺序与完成方式 |
| --- | --- |
| 点 | 位置 |
| 直线 | 起点、终点 |
| 矩形 | 第一角点、对角点 |
| 多段线 | 两个或更多顶点；按 **Enter** 保持开口，按 **C** 闭合 |
| 正多边形 | 中心、外接圆上的一个顶点；先设置**边数** |
| 射线 | 原点、方向点 |
| 构造线 | 原点、方向点；向两个方向无限延伸 |

选择射线或构造线工具、指定第一点时都不会创建对象。移动鼠标只显示原点到方向点的有限引导线，第二点确认后才生成无限构造线（或单向射线）。确认前按 **Esc** 清除预览，不改变图档。

确认后的构造线和射线可通过 DXF 2000–2024 导出为原生 XLINE/RAY，保留所属空间和三维方向；本子集不支持向 R12/R14 导出这些对象。显示按当前视口裁剪，因此原点很远也不会导致平移、缩放时经过屏幕的线消失。

**全图** 按有限图形取景，构造线和射线的原点不参与图幅计算，图块中的辅助线也一样。图中只有辅助线时，会定位到第一条可见辅助线的原点，保留当前缩放比例。

例如，要绘制一个闭合轮廓：选择**多段线**，依次输入 `0,0`、`@80,0`、`@0,50`、`@-80,0`，然后按 **C**。结果会作为一条闭合多段线提交，一次即可撤销。

## 圆、圆弧与椭圆 {#curves}

取点前先选择构造方式：

- **圆 · 圆心 / 半径：**先指定圆心，再指定圆上一点。Demo 中指定圆心后，也可直接输入正半径，例如 `25`。
- **圆 · 两点：**依次指定一条直径的两个端点。
- **圆 · 三点：**依次指定圆上三个互不重合且不共线的点。
- **圆弧 · 圆心 / 起点 / 终点：**依次指定圆心、起点、终点，圆弧从起点逆时针到终点。
- **圆弧 · 三点：**依次指定起点、圆弧必须经过的点、终点。
- **椭圆：**依次指定中心、长轴端点，再用第三点确定垂直方向上的短轴距离。

重合点、零半径，以及三点圆中的共线点会被拒绝。此时重新指定最后一点即可，按 Esc 前已经接受的前置点会保留。

## 样条曲线与填充 {#spline-hatch}

导入 DXF 填充按实际图案线定义绘制，支持自定义名称、虚线、点和交错行起点。多边形/凸度及 LINE/ARC 边界采用奇偶规则裁剪孔洞；移动、旋转、等比缩放和镜像会同时变换边界和图案，导出 DXF 保留变换后的定义。椭圆/样条填充边界及非整周期的共线虚线偏移仍不支持。过密图案受绘制预算限制，编辑器会提示放大查看；部分显示不代表完整出图。

开发者可提供 `patternLines`：每条含弧度 `angle`、`base: [x,y]`、`offset: [dx,dy]` 和有符号 `dashes`（正数为笔画、负数为空隙、零为点，`[]` 为连续线）。这些绘图坐标值已包含当前 `patternAngle`/`patternScale`；若后续只修改全局参数，应同时记录初始的 `patternDefinitionAngle`/`patternDefinitionScale`。渲染器 `report.hatchDiagnostics` 按实体 ID 返回预算、图案或边界限制。

绘制**样条曲线**前先选择次数。至少输入“次数 + 1”个控制点，再按 **Enter** 完成。提交前可用 **Backspace** 调整最后一个控制点；达到需要的点数后，按 **C** 可创建闭合样条。

绘制**填充**前，选择 **SOLID**、**ANSI31** 或 **ANSI37**，并设置比例。依次指定至少三个边界顶点，再按 **Enter** 或 **C**；KJDraw 创建填充时会自动闭合边界。ANSI31 为单向斜线，ANSI37 为交叉斜线。在嵌入式绘图对话框中使用线图案时，需要取消勾选**实体填充**。

目前每次填充操作创建一个多边形边界；互相分离的区域请分别创建填充。

## 添加尺寸标注 {#dimensions}

选择**尺寸标注**并设置类型，然后严格按以下顺序取点：

| 类型 | 取点顺序 |
| --- | --- |
| 对齐 | 第一测量点、第二测量点、尺寸线位置 |
| 线性 / 旋转 | 第一测量点、第二测量点、尺寸线位置；先设置方向或旋转角度 |
| 半径 | 圆心、圆上一点 |
| 直径 | 一个直径端点、对侧端点 |

显示值由取点后的实际几何计算。Demo 中可通过**字高**调整标注文字大小。

## 选择、移动与复制 {#move}

点击对象边缘进行选择；**Shift** 追加选择，**Ctrl**（macOS 为 **Command**）移除选择。特性面板会显示主对象和当前选择数量。

从画布空白处按住鼠标拖动，可批量选择对象：

| 手势 | 结果 |
| --- | --- |
| 从左向右拖动 · 蓝色实线框 | 只选择完全位于框内的对象 |
| 从右向左拖动 · 绿色虚线框 | 选择框内及与边框相交的对象 |
| Shift + 拖动 | 将结果加入已有选区 |
| Ctrl / Command + 拖动 | 从已有选区移除结果 |
| 编辑器获得焦点后按 Ctrl / Command + A | 全选当前绘图空间内可编辑、可见的对象 |

选择框按图形本身判断，不只比较外接矩形。例如，在圆的空心区域内画一个小框，不会误选整个圆。按 **Esc** 可取消尚未完成的框选，保留原来的选择。

需要沿开放路径选择时，在命令行输入 **FENCE**，依次指定至少两个点，再按 **Enter** 完成围栏选择。**Backspace** 撤回最后一点，**Esc** 取消；围栏不会自动闭合。

选中一个可编辑对象后，会显示蓝色方形**夹点**。拖动直线端点、圆的象限点或多段线顶点即可调整图形；高亮部分是临时预览，松开鼠标才提交一次修改。按**撤销**可完整还原。从夹点以外的位置拖动选中对象，则会整体移动它。

隐藏、冻结图层不参与拾取；锁定图层仍然可见，但不能选中编辑，也不能通过编辑命令修改。请先解锁、解冻或显示图层。拖动途中若图纸、修订或视图发生变化，本次拖动会取消。

点击**移动**，指定基点，再指定目标点。也可以先点移动，再选择对象。蓝色图形只是预览，指定目标点后才生成一次可撤销修改。**复制**采用相同的两点流程，但会保留源对象，并自动选中新对象。

需要精确位移时，先选择对象，再输入 `MOVE 10 0` 或 `COPY 10 0`。不带坐标的 `M` 或 `COPY` 会进入交互工具。还可以按住已经选中的对象，直接拖动整组选区。

## 参数化修改图形 {#modify}

先选择对象，再打开**更多修改工具**。输入参数后，如果命令需要取点，就继续按照画布提示操作。命令提交前，选中的对象、图纸和修订版本都会保持绑定；按 **Esc** 可取消尚未提交的操作。

涉及目标对象、边界或两条直线时，选择顺序很重要：

| 操作 | 选择与取点顺序 |
| --- | --- |
| 旋转 / 缩放 | 选择一个或多个对象，输入角度或比例，再指定中心 |
| 镜像 | 选择一个或多个对象，选择是否删除源对象，再依次指定镜像轴两点 |
| 矩形阵列 | 选择一个或多个对象，再输入行数、列数及其间距 |
| 环形阵列 | 选择一个或多个对象，输入项目数和填充角度，再指定中心 |
| 偏移 | 只能选择一条 LINE、RAY、XLINE、CIRCLE 或 ARC；输入距离，再指定偏移侧 |
| 打断 | 只能选择一条 LINE 或 ARC，再指定打断点 |
| 分解 | 选择一个可分解的多段线类对象，不需要继续取点 |
| 修剪 | 先选择待修剪的直线、圆弧或圆，再按住 Shift 选择切割边界，最后点选要删除的区段 |
| 延伸 | 先选择待延伸的直线或圆弧，再按住 Shift 选择边界，最后靠近要延伸的一端点选 |
| 倒角 / 圆角 | 按顺序选择两条 LINE，输入距离或半径，再依次指定第一条线和第二条线需要保留的一侧 |

需要控制顺序时，先普通单击第一个对象，再按住 Shift 依次单击其他对象。顺序不对时，可单击画布空白处清空选择后重新选择。

修剪直线或圆弧的中间一段时，两侧剩余部分都会保留。修剪圆会生成原生圆弧，撤销可恢复原圆。圆形图元的切割边界可以是同一 XY 平面内的直线、射线、构造线、圆或圆弧；修剪圆至少需要两个不同交点。请点选要删除的区段内部，不要点在交点或圆心上。

延伸圆弧时，请靠近需要延伸的端点取点，圆弧会沿该端的延续方向到达最近边界，不会越过另一端绕成整圆。取点含混时可继续重新指定，或按 Esc 取消。

## 连续修剪或延伸多个对象 {#continuous-editing}

选择**连续模式**，即可复用同一组边界处理多个对象。在线 Demo 与嵌入式编辑器都提供这一流程。

1. 选择**修剪**或**延伸**，在对话框中选择连续模式；也可在命令栏直接输入不带参数的 `TRIM` 或 `EXTEND`。
2. 点选切割边界，后续点击会继续追加；按 **Ctrl / Command + 单击**移除边界，也可框选。可见的锁定边界无须解锁即可使用。
3. 按 **Enter** 或点击**确认边界**，进入目标点选阶段。
4. 鼠标移到直线、圆弧或圆上，查看修剪后的保留图形，再点击要删除的区段。延伸时，靠近直线或圆弧需要延长的一端预览并点击。悬停不会修改图纸或增加撤销记录。
5. 继续点击其他目标。每次成功修改均可独立撤销；无效或含混的取点会显示提示，可换一个区段或端点重试。
6. 按 **Enter** 或点击**完成**结束工具。**Esc** 也会结束待执行操作，但不会撤销已经完成的修改。

浮动操作栏会显示当前阶段和完成次数。切换语言会保留边界；切换图纸、布局、撤销，或从其他工具修改图档，会结束当前会话，避免旧取点误作用到新的图纸状态。

原来的目标优先**单次模式**仍然保留。预选至少两个对象时，对话框默认单次模式；否则默认连续模式。如果预选对象都是边界，请明确选择连续模式。

需要自行提供 UI 或接入 Agent 时，参见[几何预览与审核后修改](https://kanjieteam.github.io/kjdraw/docs/latest/agent/#geometric-preview)。两个工作台使用的就是这套公开会话 API。

## 撤销、浏览与保存 {#save}

使用**撤销**和**重做**回退或恢复已经提交的绘图与修改命令。尚未提交的绘图点不进入历史记录，应使用 **Backspace** 或**退回一点**。

画布工具栏提供选择、平移、全图、放大和缩小。选择平移后，可按住鼠标左键拖动画布；鼠标中键拖动也可平移，滚轮用于缩放。这些视图操作不改变图形，也不占用撤销历史。

Demo 中的**保存 KJP**会下载整个工程，**导出 DXF**只导出当前图纸。嵌入式编辑器的**保存 KJD**保留原生图档数据，**导出 DXF**生成交换文件。需要核对结果时，可重新打开保存的文件。下载文件不代表已经配置后台云存储。

## 选择工作台布局 {#layouts}

以下布局从 **1.0.0-rc.3** 开始提供：

| 布局 | 适用情况 |
| --- | --- |
| 经典布局 | 熟悉的 Ribbon 工具区与可见侧栏 |
| 紧凑布局 | 压缩横向工具区，为图纸提供更多空间 |
| 专注布局 | 隐藏 Ribbon 与侧栏，集中查看图纸或使用命令 |

专注布局仍保留布局选择器，可以随时切回。切换布局会保留编辑器、图纸、选择和撤销历史。Demo 会在本浏览器记住选择；嵌入组件各自管理布局，是否持久化由宿主应用决定。

```ts
const editor = createKJDrawEditor('#cad', { layout: 'classic' })
await editor.ready
editor.setLayout('compact')
```

## 操作没有生效时 {#troubleshooting}

- 先看命令栏上方的提示：工具可能仍在等待对象、基点或下一个顶点。
- 相对坐标被拒绝时，先用 `x,y` 输入第一个点，再使用 `@dx,dy` 或 `@distance<angle`。
- 使用可变点数工具时，确认达到最少点数后再按 Enter 或 C。
- 连续修剪、延伸需先确认边界，再点选目标；单次模式则先选择目标，再追加边界。倒角和圆角必须恰好选择两条 LINE。
- 绘图工具提示图形退化时，请重新指定最后一点；只有准备放弃整个在绘对象时才按 Esc。
- 检查图层是否可见；新建或打开的对象不在视野内时，点击全图。
:::
