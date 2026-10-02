# 两孔改型输入与验收

## 获取真实上下文

始终从一次导入后的不可变 KJD 快照读取。先 `kjdraw inspect <source.kjd>`，再以其实际 revision 调用 `cad_query_drawing`。完整查询示例：

`--workspace` 必须是绝对目录；`kjdraw agent call` 的 `--input` / `--args-file` 以及审核器的 `--ledger` / `--candidate` 必须是该目录内的相对路径，不能带 `.` / `..` 路径段或传绝对路径。helper 的输入输出按当前 shell 目录解析，目录不同时应为 helper 传绝对路径。

```json
{
  "expectedRevision": 0,
  "filters": { "includeHidden": true },
  "offset": 0,
  "layerOffset": 0,
  "limit": 200,
  "maxLayers": 100,
  "maxBytes": 262144
}
```

`0` 是示意 revision，必须替换为实际值。全页仅允许 `CIRCLE`、`LINE`、`ARC`、`POINT`、`LWPOLYLINE`、`POLYLINE`、`TEXT`、`MTEXT`；尺寸、引线、块插入、填充和未知类型均拒绝。将这个 JSON 保存为 `query.json`，然后运行：

```sh
kjdraw agent call cad_query_drawing --input <source.kjd> --args-file query.json --workspace <absolute-workspace>
```

保存实际成功响应 `{ "ok": true, "tool": "cad_query_drawing", "value": ... }`，不要使用只返回摘要的选项。查询不能带 IDs、types、layer、bounds 或 space 过滤；本版不能在过滤后声称没有标注依赖。必须从起始页完整读完实体和图层，`nextOffset` / `nextLayerOffset` 为空且没有字节截断。超过单页限额则拒绝此 helper 工作流。

## Helper 输入

输入 JSON 同时包含真实查询参数、完整真实查询响应，以及调用方确认。示意结构：

```json
{
  "queryArguments": { "expectedRevision": 0, "filters": { "includeHidden": true }, "offset": 0, "layerOffset": 0, "limit": 200, "maxLayers": 100, "maxBytes": 262144 },
  "queryResult": { "ok": true, "tool": "cad_query_drawing", "value": "替换为真实响应对象" },
  "name": "Two confirmed holes",
  "confirmed": {
    "documentId": "实际文档 ID",
    "revision": 0,
    "units": "millimeter",
    "modelSpaceId": "实际模型空间 ID",
    "fixedHoleId": "实际固定孔 ID",
    "movingHoleId": "实际移动孔 ID",
    "relation": "fixed-first-existing-xy-direction",
    "circlesHaveNoThickness": true,
    "noDependentAnnotations": true
  },
  "parameters": {
    "diameter": { "value": 8, "min": 1, "max": 20 },
    "spacing": { "value": 40, "min": 20, "max": 100 }
  }
}
```

范围是本例测试输入，不是从行业名称推导的设计许可。必须替换真实 ID、revision 和响应对象，并取得实际调用方确认；不能照抄这些占位值或为了通过检查将确认字段设为 true。

```sh
node <skill-directory>/scripts/prepare-bind.mjs --input confirmed.json --output bind.json
kjdraw agent call cad_propose_design_bind --input <source.kjd> --args-file bind.json --workspace <absolute-workspace>
```

helper 以独占创建方式写出参数 JSON，不覆盖已有路径。它计算当前 XY 方向的仿射表达式并绑定原圆的半径及 XY 中心，不替换对象，也不执行审批。KJDraw 原生提案会进一步校验初始几何、设计所有权和合法性。几何只是图纸数据，不构成强度、加工或装配认证。

完整提案响应的顶层 `ledger` 是账本路径，不含 `proposalSequence`。读取该账本，在 `proposals` 中找到 `result.planId` 和 `tool` 与本次提案匹配的条目，将条目的实际 `sequence` 交给审核器；不要假定它始终是 1。提案使用 `--summary` 时则可读 `hostReview.proposalSequence`，但查询 helper 的读图证据仍必须用完整响应。

## 审核与后续两轮修改

人工在独立交互终端运行：

```sh
kjdraw-review --workspace <absolute-workspace> --ledger <实际账本> --sequence <实际序号> --candidate bound.kjd --approve --flatten-design-relations
```

`bound.kjd`、`bound.dxf` 和 `bound.review.json` 必须均未存在。绑定审核预览应明确新增设计关系且不改变几何。审核者显式选择将关系展平到 DXF；KJD 仍保留关系。缺少展平选项时应在人工确认之前拒绝。`--approve` 本身不能绕过随机交互挑战。

绑定后，从 `bound.kjd` 获取实际 revision，以 `cad_read_designs` 的 `{expectedRevision,offset:0,limit:20,maxBytes:262144}` 读取设计 ID、独立参数名和漂移状态。不得复制旧 revision 或凭名字猜 design ID。完整读取需要继续分页；有漂移时停止。

第一轮 `cad_propose_design_update` 输入示意如下，替换为实际身份与 revision：

```json
{
  "expectedRevision": 1,
  "units": "millimeter",
  "id": "实际 design ID",
  "changes": [{ "name": "diameter", "value": 10 }, { "name": "spacing", "value": 60 }]
}
```

以相同 `kjdraw agent call` 方式产生新的待审账本，再由真人审核到新文件 `round-one.kjd`。从 `round-one.kjd` 重新读取后，第二轮改为 `diameter=12`、`spacing=80`，审核到另一个新候选文件。不复用旧账本、候选路径或源图 ID 映射。

## 必须核对的结果

- 每次提案前后，源文件字节与文档 revision 不变；未批准没有已改图的结论。
- 绑定时几何不变；后续每次批准只产生一次原生事务。
- 本例最终两孔半径为 6，固定孔中心 `(10,20,0)`，第二孔中心 `(90,20,0)`，独立参考线不变。
- KJD 中原圆 ID、handle、图层、Z 和无关对象保持；设计 ID、参数关系在重开后仍可发现和更新。
- 审核器验证当前会话的真实 undo/redo；重新打开普通 KJD 不恢复之前的 undo 栈。
- 重开 DXF 以原生几何核对位置和半径；不能仅以实体类型计数证明正确，也不要求导入后内部 ID 与 KJD 相同。
- 回执明确 KJD 保留关系，DXF 展平后不含关系。从最新 KJD 继续改型。
- 拒绝相同目标、尺寸不匹配、未知单位、不可编辑/隐藏圆、非默认平面、截断/过滤证据、标注或块、过期 revision、设计冲突及手动漂移；失败保留源图且不部分修改。

`npm run check:skill -- skills/kjdraw-hole-revision` 是结构和原生行为验收。测试审批回执必须是 `internal-test-fixture` / `hostConfirmed:false`；未连接模型，未完成真人交互审核，不能作相应通过声明。
