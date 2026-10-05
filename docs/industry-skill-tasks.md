# Industry-pack tasks / 行业包认领清单

Pick one task and leave a comment on the [pinned industry-pack claim board](https://github.com/KanJieTeam/kjdraw/issues/4), then link your proposed PR. State your chosen row and a small scope before starting; the maintainer records the issue, claimant and status here. Use a separate [domain contribution issue](https://github.com/KanJieTeam/kjdraw/issues/new?template=domain_contribution.yml) for detailed technical discussion. Existing samples are references, not production-certified industry packages.

选择一个任务，在[置顶认领 Issue](https://github.com/KanJieTeam/kjdraw/issues/4)中写清认领条目和范围，再关联 PR；维护者更新认领人、Issue 和状态。详细技术讨论可以另开[领域贡献 Issue](https://github.com/KanJieTeam/kjdraw/issues/new?template=domain_contribution.yml)。同事可以先交中文需求与合成输入，不必先写引擎代码。样例可复用、可改进，不代表已经完成行业产品。

| Industry / 行业 | Task / 具体任务 | Explicit input → observable output / 输入与验收 | Status / 状态 | Claimant / 认领人 |
| --- | --- | --- | --- | --- |
| Drawing layout / 图纸排版 | Frame, title block and layer rules / 图框、标题栏与图层规则 | Page size, title fields and rules → editable DXF; verify fields, margins and layers / 页面、字段、规则→可编辑DXF，核对字段、边距、图层 | Reference sample; improvements welcome / 有样例，欢迎完善 | — |
| Mechanical / 机械 | Mounting-plate hole table / 安装板孔表成图 | Width/height, hole centers and diameters → plate + holes; preserve unrequested geometry / 板尺寸、孔位、孔径→板与孔，保留未改对象 | Open / 可认领 | — |
| Mechanical / 机械 | Diameter and center-distance audit / 孔径与孔距核对 | Explicit targets and expected dimensions → read-only mismatch report / 精确目标、预期尺寸→只读差异报告 | Open / 可认领 | — |
| Survey / 测绘 | Point table and center-linked routes / 点表与连心路线 | Coordinates, CRS/unit and explicit route order → points and lines ending at point centers / 坐标、基准、单位、路线顺序→点位与孔心连线 | Open / 可认领 | — |
| Geology / 勘察 | Borehole table to log sheets / 钻孔表生成柱状图 | Supplied strata/depth/water table and styles → one editable sheet per hole / 分层、深度、水位、样式→每孔可编辑柱状图 | Open / 可认领 | — |
| Geology / 勘察 | Reviewed strata/water revision / 分层与水位修订 | Existing source facts + exact requested changes → reviewable diff, undo and DXF reopen / 源数据与精确改动→待审差异、撤销和重开 | Open / 可认领 | — |
| Roads / 道路 | Station/elevation profile / 桩号标高剖面 | Station/elevation table, datum and scale → profile; check every supplied point / 桩号标高表、基准、比例→剖面，逐点核对 | Open / 可认领 | — |
| Municipal / 市政 | Manhole and pipeline schedule / 检查井与管线表成图 | Node coordinates, connectivity, elevations and legend → annotated 2D network / 节点、连接表、标高、图例→标注二维管网 | Open / 可认领 | — |
| Electrical / 电气 | Device/terminal tag audit / 设备与端子标签核对 | Expected identifier table + literal label scope → missing/duplicate report, no inferred topology / 预期编号表、标签范围→缺漏重复报告，不推断拓扑 | Open / 可认领 | — |
| Process / 工艺 | Tagged diagram from connection table / 连接表与带标签流程图 | Explicit equipment/edge table + licensed symbol map → 2D diagram; verify requested connectivity / 设备连接表、授权符号→二维图，核对明确连接 | Open / 可认领 | — |
| Interiors / 室内 | Room/door label schedule / 房间与门编号表 | Supplied geometry, explicit targets and label table → reviewed label changes only / 已有几何、精确目标、标签表→只改指定标签 | Open / 可认领 | — |
| Data graphics / 数据图表 | Statistical bar/line chart / 统计条形图与折线图 | Explicit numerical table, axes and units → editable 2D chart, match all values / 数值表、坐标轴、单位→可编辑二维图，逐值一致 | Open / 可认领 | — |

Start small: one public synthetic input, one successful output and one invalid-input test. If a workflow changes drawings, also test review-before-commit, preservation, undo and supported DXF reopening. A template alone is not a working package: include the actual tool/helper that consumes it. See [English guide](contributing-skills.md) / [中文指南](contributing-skills.zh-CN.md).

最适合的任务：输入是明确表格或参数，输出是规范化二维图，日常重复、结果可核验。缺少的原生能力单独讨论；不要把重度 3D/BIM、原生 DWG 或没有源数据的推断当作首个任务。状态只在真实认领或已审阅 PR 发生后更新，不虚构贡献者。
