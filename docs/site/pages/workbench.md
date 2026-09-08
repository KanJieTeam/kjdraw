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

Click the edge of an object to select it. Hold Shift while clicking to add or remove objects. The Properties panel shows the primary object and the selection count.

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
| Trim / Extend | Select the target LINE first, Shift-select one or more boundaries, then pick the target side or end |
| Chamfer / Fillet | Select exactly two LINE objects in order, enter distances or radius, then pick the side to keep on the first line and the second line |

To control selection order, click the first object normally, then Shift-click each additional object. If the order is wrong, click empty canvas to clear the selection and select again.

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
- For Trim and Extend, make the target LINE the first selected object; for Chamfer and Fillet, select exactly two LINE objects.
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

点击对象边缘进行选择；按住 Shift 点击可追加或移除对象。特性面板会显示主对象和当前选择数量。

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
| 修剪 / 延伸 | 先选择目标 LINE，再按住 Shift 选择一个或多个边界，最后在目标线上指定修剪侧或延伸端 |
| 倒角 / 圆角 | 按顺序选择两条 LINE，输入距离或半径，再依次指定第一条线和第二条线需要保留的一侧 |

需要控制顺序时，先普通单击第一个对象，再按住 Shift 依次单击其他对象。顺序不对时，可单击画布空白处清空选择后重新选择。

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
- 修剪和延伸必须把目标 LINE 放在选择顺序第一位；倒角和圆角必须恰好选择两条 LINE。
- 绘图工具提示图形退化时，请重新指定最后一点；只有准备放弃整个在绘对象时才按 Esc。
- 检查图层是否可见；新建或打开的对象不在视野内时，点击全图。
:::
