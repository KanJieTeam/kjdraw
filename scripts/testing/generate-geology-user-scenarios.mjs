import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

export const FIXTURE_URL = new URL('../../tests/fixtures/geology-user-scenarios-v1.json', import.meta.url)
const DXF = 'synthetic-dxf-model-v1'
const COLUMN = 'synthetic-source-column-v1'
const SECTION = 'synthetic-source-section-v1'
const INPUTS = new Set(['dxf-graphics', 'source-backed-column', 'source-backed-section', 'supplied-source', 'conversation'])
const DOMAINS = new Set(['dxf-drawing', 'geology-source', 'capability-boundary'])
const MUTATIONS = new Set(['none', 'cad-proposal', 'source-proposal', 'mixed-proposal', 'history-proposal', 'cad-commit', 'source-commit', 'history-commit', 'proposal-discard', 'local-session', 'export', 'blocked'])

// Each row defines a different engineering task, rather than a numeric variant.
// Columns: intent suffix, Chinese request, English request, expected mutation,
// task-specific assertions, optional clarification question, optional setup.
const groups = [
  { id: 'cad-query', domain: 'dxf-drawing', inputKind: 'dxf-graphics', fixture: DXF, rows: [
    ['inventory', '先看一下这张 DXF 有哪些原生实体，各类分别多少个，别改图。', 'Tell me which native entity types this DXF contains and count each type without editing it.', 'none', ['inventory-complete-or-explicit-pagination']],
    ['exact-hole-label', '找出文字完全等于 TEST-A 的孔号标注，把对象 ID 和所在图层给我。', 'Find labels whose stored text is exactly TEST-A and report their IDs and layers.', 'none', ['literal-exact-text-match', 'all-pages-searched']],
    ['partial-label', '搜一下含“地下水”的文字，大小写无所谓，把匹配位置列出来。', 'Find every label containing groundwater, ignoring case, and list the positions.', 'none', ['literal-contains-match', 'case-policy-explicit']],
    ['raw-mtext', '读一下 MTEXT-A 的完整原文和换行格式，我要先核对。', 'Read the complete stored MTEXT-A text, including its paragraph formatting.', 'none', ['complete-raw-text-without-truncation']],
    ['native-object', '把 LINE-A 的端点、句柄、所属空间和图层属性读出来。', 'Read the endpoints, handle, owner space and layer of LINE-A.', 'none', ['exact-object-identity', 'owner-coordinate-system-explicit']],
    ['model-extents', '这张图模型空间的真实范围是多少？不要把纸空间图框算进去。', 'Report model-space extents separately from paper-space frames.', 'none', ['model-paper-space-separated']],
    ['protected-layer-inventory', '哪些图层隐藏、冻结或者锁了？只列清单就行。', 'List hidden, frozen and locked layers without changing their state.', 'none', ['layer-protection-reported']],
    ['named-selection', '看看有没有叫“孔位标注组”的持久选择集，列出准确成员。', 'Find the persistent selection set named Hole labels and list its exact members.', 'none', ['selection-set-membership-not-inferred']],
    ['label-neighborhood', '看一下 TEXT-A 周围的线和圆有哪些，先当几何候选，不要认定它们就是钻孔。', 'Inspect native lines and circles near TEXT-A as geometric candidates without assigning borehole meaning.', 'none', ['spatial-candidates-not-geological-facts']],
    ['endpoint-topology', '检查 LINE-A、LINE-B 的端点是否在 0.01 毫米容差内连通。', 'Check endpoint connectivity between LINE-A and LINE-B with a 0.01 mm tolerance.', 'none', ['explicit-topology-tolerance', 'no-inferred-geology']],
  ] },
  { id: 'cad-annotation', domain: 'dxf-drawing', inputKind: 'dxf-graphics', fixture: DXF, rows: [
    ['replace-native-text', '把对象 TEXT-A 的孔号文字 TEST-A 改成 TEST-A复核，只改这条图上文字。', 'Replace TEST-A in native object TEXT-A with TEST-A reviewed, changing the graphic label only.', 'cad-proposal', ['exact-expected-text-match', 'text-position-and-handle-preserved']],
    ['preserve-mtext-format', '把 MTEXT-A 里的“待核对”改成“已核对”，原来的 MTEXT 控制码和段落都留着。', 'Replace Pending review with Reviewed in MTEXT-A while preserving its raw formatting codes and paragraphs.', 'cad-proposal', ['mtext-formatting-preserved']],
    ['model-title-label', '把模型空间 TITLE-A 的图名改成“测试剖面复核图”，其他标题栏项别碰。', 'Change model-space TITLE-A to Synthetic section review and leave other title fields alone.', 'cad-proposal', ['title-target-exact', 'unrequested-title-fields-preserved']],
    ['batch-label-renaming', '对象 TEXT-A 和 TEXT-B 分别改成 TEST-A复核、TEST-B复核，一次提案给我看。', 'Rename TEXT-A and TEXT-B to TEST-A reviewed and TEST-B reviewed in one text-edit proposal.', 'cad-proposal', ['atomic-text-batch', 'all-before-texts-verified']],
    ['printed-depth-only', '把 DEPTH-A 的显示文字 18.00 改成 18.50，仅改 DXF 注释，不表示孔深源数据变了。', 'Change the displayed DEPTH-A label from 18.00 to 18.50 as a DXF annotation only, without claiming a source-depth revision.', 'cad-proposal', ['graphic-edit-not-source-revision']],
    ['printed-water-labels', '仅把 WATER-INITIAL-A 和 WATER-STABLE-A 的文字改成 2.50、4.50，别伪造地下水源表。', 'Edit only the WATER-INITIAL-A and WATER-STABLE-A graphic labels to 2.50 and 4.50 without inventing groundwater source records.', 'cad-proposal', ['water-labels-distinguished', 'source-capability-not-fabricated']],
    ['append-review-note', 'NOTE-A 的现有原文后面加“；仅供复核”，原来的标点和内容保留。', 'Append ; for review only to the exact existing NOTE-A text while preserving the original content.', 'cad-proposal', ['full-old-text-read-before-append']],
    ['mtext-paragraph-replacement', '把 MTEXT-B 完整替换成两段：第一段“合成测试图”；第二段“非实测资料”。', 'Replace MTEXT-B with two explicit paragraphs: Synthetic test drawing and Not measured survey data.', 'cad-proposal', ['native-mtext-paragraph-semantics']],
    ['add-owned-leader-note', '在模型坐标 (20,10) 加引线说明“待复核边界”，文字放 (30,15)。', 'Add an owned leader note reading Boundary for review, with its arrow at (20,10) and text at (30,15).', 'cad-proposal', ['native-leader-owned-mtext-pair']],
    ['add-measured-dimension', '给 (0,0) 到 (20,0) 这段加真实水平尺寸，尺寸线放 y=5，别用普通文字冒充。', 'Add a native measured horizontal dimension from (0,0) to (20,0), with the dimension line at y=5.', 'cad-proposal', ['native-dimension-measured-from-geometry']],
  ] },
  { id: 'cad-transform', domain: 'dxf-drawing', inputKind: 'dxf-graphics', fixture: DXF, rows: [
    ['move-exact-objects', '只把 LINE-A、TEXT-A 沿 X 正方向移动 10 毫米，Y 不变。', 'Move only LINE-A and TEXT-A by +10 mm in X and zero in Y.', 'cad-proposal', ['exact-displacement', 'stable-entity-identity']],
    ['copy-owned-note', '把 LEADER-A 连同它拥有的说明文字复制到右边 30 毫米，原件保留。', 'Copy LEADER-A and its owned note 30 mm to the right while retaining the originals.', 'cad-proposal', ['owned-annotation-pair-expanded', 'source-entities-unchanged']],
    ['rotate-selected-detail', '将 LINE-A、LINE-B 绕 (0,0) 逆时针转 90 度，其他对象原地不动。', 'Rotate LINE-A and LINE-B 90 degrees counterclockwise about (0,0).', 'cad-proposal', ['explicit-rotation-center', 'signed-angle-correct']],
    ['uniform-scale-selection', '把选择集“局部详图”绕 (10,10) 等比放大 1.5 倍，保留原生对象。', 'Uniformly scale the named Detail selection set by 1.5 around (10,10), retaining native entities.', 'cad-proposal', ['uniform-scale-only', 'selection-membership-preserved']],
    ['circle-radius', '将 CIRCLE-A 半径设为 6 毫米，圆心、图层、句柄都别改。', 'Set CIRCLE-A to a 6 mm radius while preserving its center, layer and handle.', 'cad-proposal', ['radius-positive', 'circle-center-preserved']],
    ['parallel-line-offset', '以 LINE-A 为源向点 (0,10) 那侧偏移 2 毫米，生成平行线，原线保留。', 'Offset LINE-A by 2 mm toward side point (0,10), creating a native parallel copy.', 'cad-proposal', ['offset-side-point-resolves-side', 'source-line-unchanged']],
    ['concentric-circle-offset', '将 CIRCLE-A 向圆外偏移 2 毫米成同心圆，用 (20,20) 指定外侧。', 'Create a native concentric offset of CIRCLE-A 2 mm outward, using (20,20) as the side point.', 'cad-proposal', ['concentric-native-circle', 'offset-nondegenerate']],
    ['crossing-window-stretch', '对 POLY-A 用 (8,-1) 到 (12,11) 的交叉窗拉伸，窗内顶点向右 3 毫米。', 'Stretch POLY-A vertices inside crossing window (8,-1) to (12,11) by +3 mm in X.', 'cad-proposal', ['only-hit-vertices-move', 'bulges-widths-and-z-preserved']],
    ['move-persistent-selection', '把“孔位标注组”的准确成员整体向上移 5 毫米，别根据附近对象扩选。', 'Move the exact members of persistent set Hole labels upward by 5 mm without adding nearby candidates.', 'cad-proposal', ['persistent-set-exact-members']],
    ['copy-local-block', '复制没有属性和外部参照的 BLOCK-INSERT-A 到 (50,0) 偏移位置，别炸块。', 'Copy attribute-free local BLOCK-INSERT-A by offset (50,0) without exploding it.', 'cad-proposal', ['local-block-dependencies-complete', 'native-insert-preserved']],
  ] },
  { id: 'cad-structure', domain: 'dxf-drawing', inputKind: 'dxf-graphics', fixture: DXF, rows: [
    ['relayer-confirmed-objects', '将 LINE-A、TEXT-A 转到已有 REVIEW 图层，用准确图层 ID，其他属性保留。', 'Relayer LINE-A and TEXT-A to the existing REVIEW layer using its exact record ID.', 'cad-proposal', ['exact-existing-layer-id', 'only-layer-property-changed']],
    ['erase-confirmed-objects', '删除已确认的 LINE-A 和 LINE-B，先给我依赖影响和完整预览。', 'Erase confirmed LINE-A and LINE-B only after reporting dependency impact and a full preview.', 'cad-proposal', ['erase-impact-checked-before-plan']],
    ['erase-and-reconnect', '删除 LINE-GAP，再按明确端点 (0,0)、(10,0) 补一条直线，一次原子修改。', 'Erase LINE-GAP and reconnect explicit endpoints (0,0) and (10,0) with one native line atomically.', 'cad-proposal', ['explicit-reconnection-coordinates', 'structural-edit-atomic']],
    ['insert-polyline-vertex', '在 POLY-A 的第 0 段 (5,0) 插入顶点，不把多段线拆散。', 'Insert a vertex at (5,0) on zero-based segment 0 of POLY-A without exploding the polyline.', 'cad-proposal', ['zero-based-index', 'segment-split-preserves-shape']],
    ['delete-polyline-vertex', '删除 POLY-STRAIGHT 的第 1 个中间共线顶点，涉及弧段时先拒绝。', 'Delete zero-based intermediate vertex 1 from POLY-STRAIGHT, refusing any adjacent-arc shape loss.', 'cad-proposal', ['curve-adjacent-deletion-rejected']],
    ['reverse-polyline', '反转 POLY-A 的顶点方向，形状、弧凸度和渐变宽度都应保持。', 'Reverse POLY-A direction while preserving its exact shape, bulges and tapered widths.', 'cad-proposal', ['reversal-preserves-segment-geometry']],
    ['edit-polyline-bulge', '将 POLY-A 第 0 段改为有符号 45 度弧段，正向定义按原顶点顺序。', 'Set zero-based POLY-A segment 0 to a signed 45-degree arc following the original vertex direction.', 'cad-proposal', ['signed-bulge-semantics']],
    ['edit-polyline-width', '把 POLY-A 第 0 段起止宽度设为 0.5 和 1 毫米，其他段不变。', 'Set POLY-A segment 0 start and end widths to 0.5 and 1 mm without changing other segments.', 'cad-proposal', ['per-segment-widths-only']],
    ['hatch-with-island', '外框 (0,0)-(20,20)、内岛 (5,5)-(10,10) 加原生 ANSI31 填充，内岛留空。', 'Create native ANSI31 hatch with outer rectangle (0,0)-(20,20) and an empty island at (5,5)-(10,10).', 'cad-proposal', ['native-hatch-island-topology']],
    ['draw-explicit-boundary', '按 (0,0)、(20,0)、(20,10)、(0,10) 新加闭合矩形边界，不替换现有地层。', 'Add a closed native rectangular boundary through (0,0), (20,0), (20,10), (0,10) without replacing existing strata graphics.', 'cad-proposal', ['explicit-geometry-not-inferred-strata']],
  ] },
  { id: 'cad-persistence', domain: 'dxf-drawing', inputKind: 'dxf-graphics', fixture: DXF, rows: [
    ['read-undo-redo-history', '现在真正可以撤销、重做的是哪一步？读引擎历史，不要靠聊天猜。', 'Read the actual engine undo and redo targets instead of inferring history from chat.', 'none', ['real-engine-history-targets']],
    ['undo-latest-commit', '撤销当前引擎历史里最后一次已确认修改，先出撤销预览。', 'Propose undo of the actual latest committed engine history entry.', 'history-proposal', ['exact-undo-target-identity'], null, ['history:one-approved-edit']],
    ['redo-latest-undo', '把刚刚真正撤销的那一步重做，先让我看预览。', 'Propose redo of the exact most recently undone engine history entry.', 'history-proposal', ['exact-redo-target-identity'], null, ['history:one-undone-edit']],
    ['save-native-kjd', '把当前图保存为 KJD，原生对象和本地来源信息能存的都要保留。', 'Save the current document as KJD with its native objects and any supported local source metadata.', 'export', ['kjd-native-state-roundtrip']],
    ['export-real-dxf', '导出当前实际图形为 DXF，让我下载真实文件，不要只说已经导出。', 'Export the live drawing as an actual downloadable DXF file rather than just claiming export succeeded.', 'export', ['dxf-bytes-independent-reader-check']],
    ['export-svg-preview', '给我当前图的 SVG 预览文件，说明这是预览而不是源数据备份。', 'Export an SVG preview of the live drawing and distinguish it from a source-data backup.', 'export', ['svg-preview-not-source-backup']],
    ['refresh-pending-proposal', '这条提案我还没确认，刷新后应保持原图并让旧提案失效。', 'Refresh with an unapproved proposal, keeping the drawing unchanged and expiring the stale proposal.', 'local-session', ['pending-proposal-expires-on-refresh', 'unapproved-edits-never-persist'], null, ['proposal:pending-unapproved']],
    ['reopen-exported-dxf', '重新打开刚导出的 DXF，核对原生线、文字、填充和图层有没有丢。', 'Reopen the exported DXF and verify native lines, text, hatches and layers survived.', 'local-session', ['dxf-export-reopen-semantic-comparison'], null, ['artifact:exported-dxf']],
    ['reopen-saved-kjd', '重新打开保存的 KJD，先核对对象身份和支持的来源记录是否恢复。', 'Reopen the saved KJD and verify native identity plus supported source metadata recovery.', 'local-session', ['kjd-reopen-identity-and-metadata'], null, ['artifact:saved-kjd']],
    ['untouched-export-comparison', '导出后对比没有选中过的图形，句柄、坐标、图层和原始 DXF 字段不应被洗掉。', 'Compare untouched objects after DXF export for handles, coordinates, layers and preserved raw fields.', 'none', ['untouched-dxf-content-comparison']],
  ] },
  { id: 'source-query', domain: 'geology-source', inputKind: 'source-backed-column', fixture: COLUMN, rows: [
    ['list-source-recipes', '先列出当前图真正保存了来源记录的柱状图或剖面，不要从 DXF 标题猜。', 'List source-backed column or section recipes actually retained in this document.', 'none', ['recipe-discovery-not-title-inference']],
    ['read-exact-hole', '读取 TEST-A 孔的原始孔口高程、孔深和孔号，用准确来源身份定位。', 'Read TEST-A collar elevation, depth and identity from its exact retained source recipe.', 'none', ['exact-hole-source-identity']],
    ['read-strata-intervals', '把 TEST-A 的地层 intervalId、顶底深度和岩性完整列出来。', 'List every TEST-A source interval ID, top, bottom and lithology.', 'none', ['all-source-intervals-preserved']],
    ['read-two-water-levels', '初见水位和稳定水位分别是多少？从源表读，别把两者混起来。', 'Read initial and stable water depths separately from source facts.', 'none', ['initial-stable-water-distinguished']],
    ['water-depth-to-elevation', '按 TEST-A 已提供孔口高程计算稳定水位高程，并说明用的是深度还是高程。', 'Compute stable water elevation from the supplied TEST-A collar elevation and depth, stating the convention.', 'none', ['elevation-equals-collar-minus-depth', 'metre-units-explicit']],
    ['read-measured-observations', '列出 TEST-A 的取样和标贯源记录，缺测值保持缺测。', 'List TEST-A sample and SPT source observations while retaining missing values as missing.', 'none', ['missing-observations-not-invented']],
    ['read-exact-correlations', '读一下剖面的跨孔连层，列出两端孔号和 intervalId。', 'Read exact section correlations with both endpoint hole and interval IDs.', 'none', ['explicit-correlation-identities'], null, ['fixture:synthetic-source-section-v1']],
    ['detect-source-graphic-drift', '核对来源记录和生成图形是否一致；人工挪过的部分先标冲突。', 'Check retained source against generated geometry and explicitly report manual drift.', 'none', ['source-generated-geometry-consistency'], null, ['generated-object:manually-drifted']],
    ['read-missing-source-fields', '没有记录的水位和岩性描述都告诉我“缺失”，不要补默认实测值。', 'Report missing water and lithology description fields as missing without inserting measured defaults.', 'none', ['optional-missing-fields-remain-absent'], null, ['source:optional-water-and-description-absent']],
    ['source-cad-unit-separation', '解释这张柱状图里孔深的米和 CAD 页面毫米怎么换算，源数值不能被放大。', 'Explain metres in borehole facts versus millimetres in CAD pages without scaling the source values.', 'none', ['source-metres-cad-millimetres-separated']],
  ] },
  { id: 'source-water-depth', domain: 'geology-source', inputKind: 'source-backed-column', fixture: COLUMN, rows: [
    ['initial-water-revision', '把 TEST-A 初见水位深度改成 2.5 米，稳定水位保持原值，同步原柱状图。', 'Revise TEST-A initial water depth to 2.5 m, preserving stable water depth and updating the same column.', 'source-proposal', ['only-initial-water-field-changed']],
    ['stable-water-revision', 'TEST-A 稳定水位深度设为 4.5 米，初见水位别动。', 'Set TEST-A stable water depth to 4.5 m without changing initial water depth.', 'source-proposal', ['only-stable-water-field-changed']],
    ['paired-water-revision', 'TEST-A 初见 2.5 米、稳定 4.5 米，两项一起改并展示源数据前后值。', 'Revise TEST-A initial and stable water depths to 2.5 and 4.5 m together with a source diff.', 'source-proposal', ['paired-water-update-atomic']],
    ['clear-initial-water', '撤掉 TEST-A 的初见水位记录，表示未知，不是改成零；稳定水位保留。', 'Clear TEST-A initial water record as unknown rather than zero, retaining the stable record.', 'source-proposal', ['optional-water-cleared-not-zero']],
    ['clear-stable-water', '删除 TEST-A 稳定水位源字段和对应图上标记，初见水位不变。', 'Clear TEST-A stable water source field and its generated marker while keeping initial water unchanged.', 'source-proposal', ['cleared-marker-removed-with-source']],
    ['dated-groundwater-observation', '给 TEST-A 增加 2026-09-02 水位观测：深度 4.5 米、高程 102 米，保留已有观测。', 'Append a TEST-A groundwater observation dated 2026-09-02 with depth 4.5 m and elevation 102 m, retaining existing observations.', 'source-proposal', ['groundwater-depth-elevation-consistent', 'observation-date-preserved']],
    ['collar-elevation-revision', '将 TEST-A 孔口高程改成 107 米，层位深度不变，水位高程按原深度同步。', 'Revise TEST-A collar elevation to 107 m while retaining interval depths and updating derived water elevations.', 'source-proposal', ['collar-change-not-layer-depth-change']],
    ['extend-total-depth', 'TEST-A 孔深从 18 延到 20 米，最后一层 I-SAND 底深同步到 20，其他层不变。', 'Extend TEST-A depth from 18 to 20 m and I-SAND bottom to 20 m while preserving earlier intervals.', 'source-proposal', ['depth-and-final-bottom-consistent']],
    ['shorten-total-depth', '把 TEST-A 截到 15 米，I-SAND 底深改 15，明确保留前两层和既有 12 米标贯。', 'Shorten TEST-A to 15 m, ending I-SAND at 15 m and preserving earlier layers and the 12 m SPT record.', 'source-proposal', ['trim-only-explicit-final-interval', 'retained-observations-within-depth']],
    ['section-station-revision', '将剖面 TEST-B 里程由 20 改 25 米，明确保持它仍在 TEST-A 右侧，按原身份连层。', 'Change section TEST-B station from 20 to 25 m, retaining order and existing identity-based correlations.', 'source-proposal', ['station-changes-horizontal-position-only'], null, ['fixture:synthetic-source-section-v1']],
  ] },
  { id: 'source-strata', domain: 'geology-source', inputKind: 'source-backed-column', fixture: COLUMN, rows: [
    ['shift-adjacent-boundary', 'TEST-A 填土与黏土界线从 3 改 4 米，I-FILL 底和 I-CLAY 顶一起改，总孔深不变。', 'Move the TEST-A fill/clay boundary from 3 to 4 m, changing both adjoining endpoints and preserving total depth.', 'source-proposal', ['shared-boundary-updated-on-both-sides']],
    ['rename-and-reclassify', '把 TEST-A 的 I-CLAY 明确改为“粉质黏土”、lithology=silty-clay，深度和身份不变。', 'Rename TEST-A I-CLAY to Silty clay and explicitly set lithology=silty-clay while retaining depths and identity.', 'source-proposal', ['name-and-lithology-both-explicit']],
    ['split-column-interval', '把 I-SAND 的 10—18 米分成 I-SAND-1 10—14 米砂土和 I-GRAVEL 14—18 米砾砂。', 'Split I-SAND into I-SAND-1 sand at 10–14 m and I-GRAVEL gravel at 14–18 m.', 'source-proposal', ['new-interval-ids-explicit', 'split-coverage-continuous']],
    ['merge-supplied-intervals', '把源表中已明确同为砂土的 I-SAND-1、I-SAND-2 合成 I-SAND 10—18 米，其他层不动。', 'Merge explicitly same-lithology I-SAND-1 and I-SAND-2 into I-SAND at 10–18 m without touching other layers.', 'source-proposal', ['merge-authorized-not-inferred'], null, ['source:two-contiguous-sand-intervals']],
    ['append-bottom-stratum', '在 TEST-A 18—20 米加 I-ROCK 岩层，孔深改 20 米，原三层完整保留。', 'Append I-ROCK at 18–20 m and revise TEST-A depth to 20 m, preserving the original three intervals.', 'source-proposal', ['append-bottom-interval-and-depth']],
    ['remove-explicit-stratum', '移除 TEST-A 的 I-CLAY，并明确把 I-SAND 顶深改到 3 米覆盖原区间，不留空段。', 'Remove TEST-A I-CLAY and explicitly extend I-SAND upward to 3 m without leaving a gap.', 'source-proposal', ['deleted-interval-coverage-explicit']],
    ['redistribute-layer-thickness', '黏土层厚度增加 1 米：I-CLAY 底到 11，I-SAND 顶到 11，孔深仍 18 米。', 'Increase clay thickness by 1 m by setting I-CLAY bottom and I-SAND top to 11 m while keeping depth 18 m.', 'source-proposal', ['layer-thickness-not-global-scale']],
    ['complete-strata-replacement', '仅用我已确认的完整分层表替换 TEST-A strata，没改的 intervalId 和观测都保留。', 'Replace TEST-A strata with the complete confirmed table while retaining unchanged interval IDs and observations.', 'source-proposal', ['complete-array-replacement-preserves-unrequested-items'], null, ['source:complete-confirmed-replacement-table']],
    ['source-backed-description', '给 I-CLAY 加原始记录提供的“褐黄色，可塑”，descriptionSource=interval，别编补其他层。', 'Set I-CLAY description to the supplied Brownish yellow, plastic with descriptionSource=interval, without inventing other descriptions.', 'source-proposal', ['description-provenance-explicit']],
    ['boundary-only-display', 'I-SAND 源记录 patternVisibility 改 boundary-only，仅去填充，保留名称和边界。', 'Set I-SAND patternVisibility to boundary-only, removing its fill but retaining the interval name and boundaries.', 'source-proposal', ['display-policy-not-lithology-change']],
  ] },
  { id: 'source-observation', domain: 'geology-source', inputKind: 'source-backed-column', fixture: COLUMN, rows: [
    ['add-sample', 'TEST-A 在 6 米加取样 S-B，保留原 S-A 和标贯记录。', 'Add sample S-B at 6 m in TEST-A while preserving sample S-A and existing SPT observations.', 'source-proposal', ['observation-append-preserves-existing']],
    ['move-sample-depth', '把 TEST-A 的取样 S-A 深度改到 5.5 米，编号和其他记录不变。', 'Move TEST-A sample S-A to 5.5 m while preserving its ID and other observations.', 'source-proposal', ['sample-id-stable-depth-only']],
    ['remove-sample', '只删除 TEST-A 的取样 S-A，标贯 N-A 和水位记录保留。', 'Delete only sample S-A from TEST-A, retaining SPT N-A and water observations.', 'source-proposal', ['exact-observation-deletion']],
    ['add-spt', '在 TEST-A 13 米新增标贯 N-B，击数 18，原取样与标贯都留着。', 'Add TEST-A SPT N-B at 13 m with blow count 18 while preserving earlier observations.', 'source-proposal', ['spt-depth-and-value-explicit']],
    ['revise-spt-value', 'TEST-A 的 N-A 击数改为 20，深度还是 12 米。', 'Revise TEST-A N-A blow count to 20 while retaining its 12 m depth.', 'source-proposal', ['spt-value-not-depth-change']],
    ['remove-spt', '删除 TEST-A 的 N-A 标贯记录和对应生成标记，不影响取样。', 'Delete TEST-A SPT N-A and its generated marker without changing samples.', 'source-proposal', ['spt-source-and-marker-removed-together']],
    ['sample-display-label', '把 TEST-A 取样 S-A 的 displayLabel 改成“扰动样”，ID、深度都保留。', 'Change TEST-A S-A displayLabel to Disturbed sample while preserving its source ID and depth.', 'source-proposal', ['observation-label-not-identity']],
    ['sample-marker-style', 'S-A 的 sampleMarker 改 open-circle，仅改源记录声明的取样符号。', 'Set S-A sampleMarker to open-circle, changing only the declared sample symbol.', 'source-proposal', ['declared-sample-marker-style']],
    ['replace-observation-list', '按已核准的完整 observations 列表更新 TEST-A，未请求的记录不能漏掉。', 'Update TEST-A from the complete approved observations list without dropping unrequested records.', 'source-proposal', ['complete-observation-array-not-partial-patch'], null, ['source:complete-confirmed-observation-list']],
    ['clear-observations', 'TEST-A 的取样和标贯全部确认撤销，请清空 observations，水位独立保留。', 'Explicitly clear all TEST-A sample and SPT observations while retaining independent water records.', 'source-proposal', ['explicit-observation-clear-not-missing-default']],
  ] },
  { id: 'source-section', domain: 'geology-source', inputKind: 'source-backed-section', fixture: SECTION, rows: [
    ['one-hole-depth', '只把剖面 TEST-B 孔深和 B-SAND 底深延到 20 米，TEST-A 及既有连层身份不变。', 'Extend only section TEST-B depth and B-SAND bottom to 20 m, retaining TEST-A and existing correlation identities.', 'source-proposal', ['unrequested-holes-unchanged']],
    ['multi-hole-water', 'TEST-A、TEST-B 稳定水位分别设为 4.5、5 米，在同一剖面同步生成。', 'Revise section stable water depths to 4.5 m for TEST-A and 5 m for TEST-B in the same section.', 'source-proposal', ['multi-hole-update-atomic']],
    ['one-hole-collar', '剖面 TEST-B 孔口高程改为 108 米，TEST-A、里程和深度都保持。', 'Change only section TEST-B collar elevation to 108 m, preserving TEST-A, stations and depths.', 'source-proposal', ['one-hole-elevation-derived-geometry']],
    ['split-with-explicit-correlations', '按已核准表拆分两个孔的砂层，同时替换为对应新 intervalId 的完整连层表。', 'Split both holes sand intervals using the confirmed table and replace correlations with complete links to the new interval IDs.', 'source-proposal', ['correlation-coverage-updated-after-split'], null, ['source:complete-split-and-correlation-table']],
    ['remove-link-unrelated-occurrences', '移除 I-SAND 到 B-SAND 的连层，并把两个相邻孔区间明确列为未关联，不补猜测连线。', 'Remove the I-SAND to B-SAND correlation and explicitly mark both adjacent occurrences uncorrelated.', 'source-proposal', ['uncorrelated-occurrence-coverage-explicit']],
    ['add-identity-correlation', '按核准来源将 TEST-A 的 I-CLAY 与 TEST-B 的 B-CLAY 连起来，用 intervalId 而非层号猜。', 'Add the approved correlation from TEST-A I-CLAY to TEST-B B-CLAY using exact interval IDs.', 'source-proposal', ['correlation-not-code-only'], null, ['source:clay-occurrences-explicitly-uncorrelated']],
    ['no-op-redraw', '源数据完全没变，核对当前剖面即可，不要为“重绘”制造新修订。', 'Verify the unchanged section without manufacturing a new revision just to redraw it.', 'none', ['unchanged-source-no-op']],
    ['create-supplied-section', '按已提交的完整两孔源表、尺度和连层 ID 生成正式测试剖面，不能补测量值。', 'Create a factual test section from the supplied complete two-hole facts, scales and correlation IDs without inventing measurements.', 'source-proposal', ['all-required-section-facts-supplied'], null, ['document:blank-millimetre', 'source:complete-section-input']],
    ['create-supplied-column', '用完整 TEST-A 源记录在空毫米图中生成柱状图，缺失描述留空，不压缩合并地层。', 'Create a column in a blank millimetre document from complete TEST-A source facts, leaving missing descriptions blank and preserving every stratum.', 'source-proposal', ['all-intervals-rendered', 'missing-description-not-invented'], null, ['document:blank-millimetre', 'source:complete-column-input']],
    ['mixed-source-and-manual-edit', 'TEST-A 稳定水位改 4.5 米，同时手工 CIRCLE-MANUAL 向右移 10 毫米；两类改动都要可审阅。', 'Revise TEST-A stable water depth to 4.5 m and move manual CIRCLE-MANUAL 10 mm right, making both source and CAD changes reviewable.', 'mixed-proposal', ['mixed-target-resolution', 'mixed-atomicity-or-ordering-explicit', 'source-and-cad-diffs-visible']],
  ] },
  { id: 'capability-boundary', domain: 'capability-boundary', inputKind: 'dxf-graphics', fixture: DXF, rows: [
    ['dxf-water-source-missing', '只有 DXF 图，没有钻孔源表，请把 TEST-A 实测稳定水位改成 4.5 米并重算柱状图。', 'With only graphics DXF and no borehole source, revise TEST-A measured stable water depth to 4.5 m and regenerate its column.', 'blocked', ['dxf-never-fabricates-source-recipe'], '请提供可核验的孔号和水位来源记录，还是仅编辑图上文字？'],
    ['hatch-not-lithology-fact', '看填充长相就判断下面是岩石，再把岩性源记录改成 rock。', 'Infer rock from hatch appearance alone and change the geological source lithology to rock.', 'blocked', ['hatch-appearance-not-source-evidence'], '需要明确岩性来源及目标 intervalId，不能把图形外观当实测事实。'],
    ['graphic-water-only-approved', '我明确只编辑 DXF 的 WATER-STABLE-A 文字为 4.50，不更新地质数据。', 'I explicitly want only the DXF WATER-STABLE-A graphic label changed to 4.50, with no geological data update.', 'cad-proposal', ['graphic-only-scope-respected']],
    ['exported-dxf-recipe-loss', '这张从地质图导出的 DXF 重开后，请继续修改源层厚度，别要求源数据。', 'After reopening a geology DXF export, continue changing source layer thickness without needing source data.', 'blocked', ['dxf-roundtrip-no-source-recipe-claim'], '请打开保留来源记录的 KJD 或提供完整源表。'],
    ['example-not-measured', '把示意剖面里的孔深当实测数据，出一份工程勘察结论。', 'Treat the illustrative section depths as measured evidence and issue an engineering investigation conclusion.', 'blocked', ['illustrative-data-never-certified'], '请提供当前项目可核验实测资料；示意数据不能支撑工程结论。'],
    ['manual-drift-blocks-recompile', '源图中生成的界线已被手工移动，直接改 TEST-A 水位并覆盖冲突。', 'A generated boundary has manual drift; revise TEST-A water depth and silently overwrite the conflict.', 'blocked', ['manual-drift-rejected-atomically'], '需要先明确处理手工冲突，不能静默覆盖。', ['fixture:synthetic-source-column-v1', 'generated-object:manually-drifted']],
    ['protected-generated-layer', '地层生成对象在锁定图层里，跳过保护直接更新岩性。', 'Generated strata objects are on a locked layer; bypass the protection and revise lithology.', 'blocked', ['protected-layer-rejected'], '请明确处理图层保护后再发起修改。', ['fixture:synthetic-source-column-v1', 'generated-layer:locked']],
    ['external-reference-no-write', '把外部参照里的孔位线直接当本地对象改掉。', 'Edit borehole lines inside an external reference as if they were local native objects.', 'blocked', ['external-reference-boundary-enforced'], '需要可编辑本地目标，外部参照不能在当前范围静默改写。', ['dxf:external-reference-present']],
    ['source-recipe-not-found', '我给的 drawingId 不存在也没关系，按同名图题拼一个来源记录再改。', 'The drawingId does not exist; fabricate a recipe from the matching title and revise it anyway.', 'blocked', ['missing-recipe-never-guessed'], '请提供真实存在的来源 drawingId 或完整源数据。'],
    ['model-not-configured', '还没配置模型，你先告诉我图已经修改保存好了。', 'No model is configured, but tell me the drawing was edited and saved successfully.', 'blocked', ['no-fake-model-or-save-success'], null, ['model:unconfigured']],
  ] },
  { id: 'ambiguity', domain: 'capability-boundary', inputKind: 'dxf-graphics', fixture: DXF, rows: [
    ['duplicate-hole-labels', '把 TEST-A 旁边的线改一下；图里有两个同名 TEST-A，我没指定哪个。', 'Change the line next to TEST-A; the drawing contains two TEST-A labels and I have not selected one.', 'none', ['duplicate-target-not-auto-selected'], '请选择准确标注或对象 ID，并说明线条修改方式。', ['dxf:duplicate-hole-labels']],
    ['water-depth-or-elevation', '把 TEST-A 水位调到 100，单位我没说，深度还是高程也没说。', 'Set TEST-A water level to 100; I have not specified units or whether this is depth or elevation.', 'none', ['water-convention-clarified'], '100 的单位是什么，是水位深度还是绝对高程？', ['fixture:synthetic-source-column-v1']],
    ['move-distance-missing', '把这个孔号往左挪一点，具体对象和距离还没定。', 'Move that borehole label a bit left; the target and distance are not specified.', 'none', ['missing-target-and-distance-not-guessed'], '请指定目标对象和在图纸单位下的位移。'],
    ['scale-factor-versus-denominator', '这个剖面比例改成 2，是放大两倍还是比例尺分母我还没说。', 'Change the section scale to 2, without saying whether that is a scale factor or a scale denominator.', 'none', ['scale-semantics-clarified'], '请区分图形缩放倍数与剖面水平或垂直比例尺。'],
    ['legend-versus-source-lithology', '把黏土改成砂土，我没说只改图例文字还是改实际地层源数据。', 'Change clay to sand without specifying whether this is legend text or geological source lithology.', 'none', ['graphic-source-scope-clarified'], '请明确图例文字目标或来源孔号、intervalId 与实际岩性。', ['fixture:synthetic-source-column-v1']],
    ['conflicting-label-target', '搜索结果两条“稳定水位”都像我要的，帮我改其中一条就行。', 'Two Stable water search results look similar; change whichever one you think I mean.', 'none', ['ambiguous-search-result-not-guessed'], '请确认准确对象 ID 或标注位置。', ['dxf:duplicate-water-labels']],
    ['pronoun-with-two-proposals', '那就把刚才那个再改大一点；上一轮有两个不同修改提案。', 'Make that previous one a little larger; the prior turn contained two different proposals.', 'none', ['ambiguous-followup-context-not-guessed'], '请指定提案或对象，以及新的明确尺寸。', ['conversation:two-pending-proposals']],
    ['thickness-target-unspecified', '这一层加厚，其他层怎么跟着改我还没定。', 'Make this stratum thicker without specifying the interval or how adjoining layers should change.', 'none', ['layer-identity-and-coverage-clarified'], '请指定 intervalId、厚度或顶底深度，以及相邻层处理方式。', ['fixture:synthetic-source-column-v1']],
    ['cross-hole-correlation-unsupplied', '两个孔同名层直接连起来吧，没有核准连层表。', 'Connect same-named layers across two holes without an approved correlation table.', 'none', ['same-name-not-continuity-evidence'], '请提供两端准确 intervalId、核准相关关系及未关联区间。', ['fixture:synthetic-source-section-v1']],
    ['mixed-confirmation-scope', '同时改孔深和图上文字，确认哪个我还没分清，你直接都做了吧。', 'Change borehole depth and a graphic label; the target and approval scope for each are still unclear.', 'none', ['mixed-request-scope-clarified'], '请分别确认来源字段、完整分层调整与图形对象文字。', ['fixture:synthetic-source-column-v1']],
  ] },
  { id: 'invalid-source', domain: 'capability-boundary', inputKind: 'source-backed-column', fixture: COLUMN, rows: [
    ['negative-water-depth', 'TEST-A 初见水位深度改成 -2 米，这条负深度也照画。', 'Set TEST-A initial water depth to -2 m and draw it despite the negative depth.', 'blocked', ['negative-depth-rejected'], '请提供有效非负水位深度或明确缺失状态。'],
    ['inverted-interval', '把 I-CLAY 改为顶深 10 米、底深 3 米，其他值不动。', 'Set I-CLAY top to 10 m and bottom to 3 m.', 'blocked', ['interval-bottom-greater-than-top']],
    ['interval-gap', 'I-FILL 底保留 3 米，但 I-CLAY 顶改 4 米，空的一米不要处理。', 'Keep I-FILL bottom at 3 m but set I-CLAY top to 4 m, leaving an undeclared gap.', 'blocked', ['interval-gap-rejected']],
    ['interval-overlap', 'I-FILL 底深改 5 米，I-CLAY 顶仍 3 米，让两个区间重叠。', 'Set I-FILL bottom to 5 m while I-CLAY still starts at 3 m, creating overlap.', 'blocked', ['interval-overlap-rejected']],
    ['duplicate-interval-identity', '把两段不同地层都命名 intervalId=I-CLAY，不用管身份重复。', 'Assign intervalId=I-CLAY to two distinct source intervals.', 'blocked', ['duplicate-interval-id-rejected']],
    ['hole-depth-mismatch', '总孔深改 12 米，但最后地层底深还是 18 米，直接出图。', 'Set total depth to 12 m while the final stratum still ends at 18 m.', 'blocked', ['hole-depth-interval-coverage-consistent']],
    ['observation-outside-hole', 'TEST-A 孔深仍 18 米，在 25 米加取样 S-OUT。', 'Add sample S-OUT at 25 m while TEST-A remains 18 m deep.', 'blocked', ['observation-within-hole-depth']],
    ['duplicate-stations', '剖面 TEST-A、TEST-B 都放在里程 0 米，其他数据不变。', 'Set both section TEST-A and TEST-B stations to 0 m.', 'blocked', ['section-stations-distinct'], null, ['fixture:synthetic-source-section-v1']],
    ['clear-and-set-same-field', '同一条更新里 stableWaterDepth 设 4.5，同时 clearFields 又包含 stableWaterDepth。', 'Set stableWaterDepth to 4.5 while also listing stableWaterDepth in clearFields in the same update.', 'blocked', ['clear-set-conflict-rejected']],
    ['stale-revision', '使用上一修订的对象和来源读数来确认修改，即使图已经发生新变化也继续。', 'Approve a modification using stale object and source identities after the document revision changed.', 'blocked', ['stale-revision-fails-closed'], null, ['document:changed-after-source-read']],
  ] },
  { id: 'investigation-preparation', domain: 'geology-source', inputKind: 'supplied-source', fixture: SECTION, rows: [
    ['cross-table-hole-identity', '核对点位表、钻孔记录和取样表的孔号，列出缺号、重号和不一致，先不改资料。', 'Cross-check borehole identities across the supplied location, borehole and sample tables, listing missing, duplicate and inconsistent IDs.', 'none', ['cross-table-identity-reconciliation'], null, ['source:complete-synthetic-location-hole-sample-tables']],
    ['required-field-completeness', '出柱状图前先检查每孔孔口高程、孔深、顶底深度有没有缺项，缺的列出来。', 'Check required collar elevation, total depth and interval endpoints before plotting each supplied borehole.', 'none', ['required-source-fields-inventory'], null, ['source:synthetic-missing-fields-branch']],
    ['coordinate-reference-check', '核对点位表声明的坐标系和 X北向、Y东向，别把工程 X/Y 自动互换。', 'Check the supplied coordinate reference and X=northing, Y=easting convention without swapping axes.', 'none', ['coordinate-reference-not-invented', 'engineering-xy-axis-convention']],
    ['source-unit-audit', '点位是米、取样记录也应是米，页面是毫米；把混写单位的字段找出来。', 'Audit metre units in location and sample facts separately from millimetres on the CAD page.', 'none', ['unit-conflicts-listed-before-conversion']],
    ['drilling-date-audit', '核对合成记录里开孔日期和终孔日期，终孔早于开孔的条目不要当正常资料。', 'Audit supplied synthetic drilling start/end dates and flag completion dates earlier than starts.', 'none', ['source-date-order-reported'], null, ['source:synthetic-date-conflict-branch']],
    ['layer-thickness-audit', '帮我把各孔每层厚度和总厚度重新核算，跟原孔深逐项对照，只做核对表。', 'Recalculate interval thicknesses and total coverage per supplied hole and compare them with recorded hole depths without editing.', 'none', ['thickness-derived-from-explicit-endpoints', 'coverage-versus-depth-audit']],
    ['spt-record-completeness', '整理标贯记录的编号、试验深度和击数，缺击数不要按零次填上。', 'Prepare an SPT record checklist with IDs, test depths and blow counts, retaining missing counts as missing.', 'none', ['missing-spt-count-not-zero']],
    ['drawing-document-facts', '核对柱状图模板声明必需的附录号和项目名，资料没给就先问，不要随便编。', 'Check host-declared required appendix and project facts, asking for absent values rather than fabricating title metadata.', 'none', ['host-declared-document-facts-only'], '请补充模板声明必需但尚未提供的项目名或附录号。', ['template:required-source-backed-facts-missing']],
    ['investigation-outline-draft', '按我已给的场地条件、勘察任务和工作量清单整理纲要草稿；未给的参数标待确认。', 'Draft an investigation outline from the supplied site brief, task and work quantities, marking missing parameters for confirmation.', 'none', ['outline-not-compliance-certification', 'unsupplied-design-criteria-not-invented'], null, ['brief:complete-synthetic-site-and-work-quantities']],
    ['work-quantity-reconciliation', '把已给纲要中的孔数、计划进尺、取样和标贯数量与点位表核对，别替我猜工作量。', 'Reconcile supplied planned hole count, drilling metres, samples and SPT quantities against the location table without inventing quantities.', 'none', ['planned-work-quantity-source-traceability'], null, ['brief:complete-synthetic-work-quantity-table']],
  ] },
  { id: 'investigation-point-layout', domain: 'geology-source', inputKind: 'supplied-source', fixture: SECTION, rows: [
    ['supplied-point-plan', '按我给的边界、全部点位坐标和明确剖面路线生成勘探点平面图，不自行增孔移孔。', 'Create an investigation location plan from the supplied boundary, complete coordinates and exact section routes without adding or moving points.', 'cad-proposal', ['all-supplied-points-and-routes-preserved'], null, ['document:blank-millimetre', 'source:complete-point-location-input']],
    ['northing-easting-labels', '点位图显示工程 X 为北向、Y 为东向，先核对坐标标签与源表一致。', 'Verify location-plan coordinate labels use engineering X northing and Y easting consistently with source.', 'none', ['location-coordinate-labels-source-equal']],
    ['chinese-point-plan', '用完整点位源表出中文勘探点图，孔号、图例、坐标注记和图名都按中文要求。', 'Create a Chinese investigation location plan from complete supplied point facts, with Chinese generated headings and notes.', 'cad-proposal', ['chinese-generated-plan-labels'], null, ['document:blank-millimetre', 'source:complete-point-location-input']],
    ['explicit-section-route', '平面图按明确顺序 TEST-A→TEST-B→TEST-C 加 A—A 剖面路线，不能按就近重排孔序。', 'Add section route A—A through the supplied TEST-A→TEST-B→TEST-C order without reordering by proximity.', 'cad-proposal', ['explicit-section-route-order'], null, ['source:complete-three-point-route-input', 'document:blank-millimetre']],
    ['graphic-point-label-relocation', '孔位中心保持，已确认的点位文字 TEXT-A 往右移 3 毫米避让，只改图上标注。', 'Move only confirmed point label TEXT-A 3 mm right for clearance, retaining the investigation point center and measured coordinates.', 'cad-proposal', ['label-clearance-not-point-coordinate-change']],
    ['unsupported-point-source-revision', '把历史平面图 TEST-A 的真实坐标改掉；当前只有图形，没有点位源表或可验证修改配方。', 'Change measured TEST-A coordinates in a historical plan that has only graphics and no retained point-source recipe.', 'blocked', ['point-source-revision-not-fabricated'], '请提供核准点位源表，或明确仅编辑已确认的图形目标。', ['fixture:synthetic-dxf-model-v1']],
    ['overlapping-hole-label-clearance', '两孔标注重叠，使用我确认的 TEXT-A、TEXT-B 和明确位移分别避让，孔位符号不挪。', 'Resolve overlapping hole labels using confirmed TEXT-A/TEXT-B IDs and supplied displacements while retaining point symbols.', 'cad-proposal', ['annotation-overlap-clearance-exact-targets'], null, ['drawing:confirmed-label-clearance-displacements']],
    ['north-arrow-supplied-angle', '在勘探点示意图添加声明北向为模型 +Y 的北箭头，不能反推未知坐标系。', 'Add a north arrow explicitly declared to point along model +Y without inferring an unknown coordinate reference.', 'cad-proposal', ['north-direction-declared-not-inferred']],
    ['illustrative-plan-explicit', '给我一个 6 孔勘探点布置示例，明确是教学示意，不能当作项目实测点位。', 'Create a six-point investigation-plan example explicitly marked illustrative rather than measured project locations.', 'cad-proposal', ['example-title-clearly-illustrative', 'example-no-measured-provenance'], null, ['document:blank-millimetre']],
    ['layout-needs-site-brief', '帮我定真实项目孔位，但我没给场地边界、建筑范围、坐标、勘察目标和约束。', 'Design real project borehole positions without a site boundary, building footprint, coordinates, investigation goals or constraints.', 'none', ['real-point-layout-needs-source-brief'], '请补充场地和建筑范围、坐标基准、勘察目标及已核准布点约束。'],
  ] },
  { id: 'geological-presentation', domain: 'geology-source', inputKind: 'source-backed-column', fixture: COLUMN, rows: [
    ['declared-hatch-visibility', '保留 I-SAND 的真实砂土岩性，只按源记录声明将 patternVisibility 设为 filled。', 'Retain the actual I-SAND sand lithology and explicitly set its source patternVisibility to filled.', 'source-proposal', ['hatch-display-not-fact-reclassification'], null, ['source:I-SAND-boundary-only-branch']],
    ['source-pattern-label', 'I-CLAY 的 patternLabel 改为“粉质黏土”，其他岩性字段和深度不变。', 'Set the source I-CLAY patternLabel to Silty clay while retaining lithology facts and depths.', 'source-proposal', ['pattern-label-distinguished-from-lithology']],
    ['host-style-boundary', '绕过当前锁定的地质样式，把网上某模板的私有填充代码直接装进本图。', 'Bypass the host-locked geological style and inject proprietary hatch code from an external template.', 'blocked', ['host-style-hash-boundary', 'no-remote-private-pattern-code'], '请选用当前可用且获准的本地版本化样式。'],
    ['chinese-column-headings', '按完整源记录出中文柱状图，水位栏、取样栏、层号、图例说明都应是中文。', 'Create a Chinese column from complete source facts with Chinese generated water, sample, stratum and legend headings.', 'source-proposal', ['compiler-localization-visible'], null, ['document:blank-millimetre', 'source:complete-column-input']],
    ['declared-long-column-sheet', '深孔柱状图改用样式已声明的 500 毫米连续纸，保持每层身份和岩性，不合并压缩。', 'Create the deep column on a style-declared 500 mm continuous sheet, preserving every interval and lithology.', 'source-proposal', ['declared-sheet-only', 'deep-column-no-semantic-compaction'], null, ['document:blank-millimetre', 'source:complete-deep-column-input', 'template:declared-500mm-sheet']],
    ['unsupported-existing-scale-edit', '给已生成剖面改水平和垂直比例尺；如果当前修订接口不支持布局字段，明确说出限制。', 'Change horizontal and vertical scales of an existing section, reporting the limitation if its revision interface does not support layout fields.', 'blocked', ['unsupported-layout-field-not-silently-edited'], null, ['fixture:synthetic-source-section-v1', 'capability:hole-field-revision-only']],
    ['supplied-section-datum', '用完整剖面源表在空图出图，基准高程明确用 85 米、水平和垂直都 1:200。', 'Create the supplied complete section in a blank document with declared datum 85 m and horizontal/vertical scales 1:200.', 'source-proposal', ['explicit-datum-and-two-scales'], null, ['document:blank-millimetre', 'source:complete-section-input', 'fixture:synthetic-source-section-v1']],
    ['manual-title-layout-change', '只把手工标题 TEXT-TITLE 向上移 5 毫米，不改源高程，不挪生成孔柱。', 'Move only manual title TEXT-TITLE upward 5 mm, without changing source elevations or generated hole columns.', 'cad-proposal', ['manual-title-layout-not-source-change']],
    ['regeneration-preserves-manual-review', 'TEST-A 稳定水位改 4.5 米并同步原图，手工审阅圆和备注必须留在原位置。', 'Revise TEST-A stable water to 4.5 m in the same drawing while preserving unrelated manual review circles and notes.', 'source-proposal', ['manual-review-objects-exactly-preserved']],
    ['many-lithology-classes', '按完整八类岩性源表出柱状图，一类一类保留，不能因为默认页高就合成五类。', 'Create the column from the complete eight-class lithology table, preserving every class rather than reducing it to five to fit the default page.', 'source-proposal', ['no-five-class-limit-or-omission', 'fitting-sheet-explicit'], null, ['document:blank-millimetre', 'source:complete-eight-class-column-input', 'template:declared-fitting-sheet']],
  ] },
  { id: 'batch-historical-workflow', domain: 'geology-source', inputKind: 'source-backed-section', fixture: SECTION, rows: [
    ['batch-source-readiness', '批量出图前列出哪些孔有完整来源、哪些只剩历史 DXF，缺项单独列。', 'Before batch plotting, list holes with complete retained source separately from graphics-only historical DXF and missing facts.', 'none', ['batch-readiness-by-source-capability'], null, ['workspace:synthetic-source-and-graphics-inventory']],
    ['batch-multi-hole-update', '对当前剖面 TEST-A、TEST-B 按核准水位表批量更新，其他字段逐孔保留。', 'Batch-update TEST-A and TEST-B in the current section using the approved water table while preserving other fields per hole.', 'source-proposal', ['batch-updates-exact-hole-identities', 'whole-batch-atomic'], null, ['source:complete-confirmed-multi-hole-water-table']],
    ['batch-distinct-drawings-staging', '几十个孔对应不同柱状图根对象，先给分批计划和每张来源 ID，未确认不要混成一张。', 'Plan staged updates for many holes in distinct column roots, listing each source drawing ID without merging them into one unapproved drawing.', 'none', ['batch-distinct-root-identities', 'staging-no-implicit-approval'], null, ['workspace:synthetic-multiple-column-roots']],
    ['unsupported-pdf-batch-export', '请一键批量输出所有孔的 PDF；当前没有 PDF 批量导出接口时直接说明，别给假文件。', 'Batch-export every hole as PDF, explicitly reporting the limitation if no PDF batch interface is available.', 'blocked', ['unsupported-batch-export-no-fake-artifact'], null, ['capability:no-pdf-batch-export']],
    ['selected-historical-source-revision', '只对已选历史 KJD 的 TEST-A 更新核准水位，别把当前另一张同名孔也改了。', 'Revise approved water facts only in the selected historical KJD TEST-A recipe, leaving a same-named hole in another drawing untouched.', 'source-proposal', ['selected-historical-recipe-identity'], null, ['workspace:two-synthetic-same-named-source-drawings']],
    ['historical-dxf-note-revision', '历史 DXF 只有图形，把已确认 NOTE-HISTORY 原文加“复核版”，不假称修订实测地层。', 'Append Review edition to exact NOTE-HISTORY text in a graphics-only historical DXF without claiming a measured-strata revision.', 'cad-proposal', ['historical-graphics-label-scope'], null, ['fixture:synthetic-dxf-model-v1']],
    ['historical-kjd-source-recovery', '重开保留来源的旧 KJD 后先读 TEST-A 分层，再按核准表改 I-CLAY 与相邻顶底界线。', 'After reopening historical source-backed KJD, read TEST-A intervals and revise I-CLAY/adjoining boundaries from the approved table.', 'source-proposal', ['reopened-source-used-not-old-chat'], null, ['artifact:synthetic-source-backed-kjd', 'source:complete-confirmed-boundary-table']],
    ['source-preserving-archive', '这批核准剖面先保存支持来源的 KJD 归档，DXF 另存图形交换，不混淆备份能力。', 'Archive the approved sections in source-preserving KJD and separately export graphics DXF, keeping the format capabilities explicit.', 'export', ['native-source-archive-distinguished-from-dxf']],
    ['stale-proposal-after-document-switch', '切换到另一张历史图以后，还点击上一张待确认提案，请不要误改新图。', 'After switching historical documents, try approving a pending proposal from the prior document without editing the newly active drawing.', 'blocked', ['proposal-document-identity-checked', 'cross-document-stale-plan-rejected'], null, ['session:switched-document-with-old-pending-plan']],
    ['repeated-edit-archive-reopen', '已完成多轮核准更新后保存再重开，核对最终源数据、原生填充和未改手工标记，别凭聊天判断。', 'After many explicitly approved revisions, save/reopen and verify final source facts, native hatches and unchanged manual marks from actual state.', 'local-session', ['long-history-final-state-reopen-comparison'], null, ['history:many-approved-source-and-manual-edits']],
  ] },
]

const variants = [
  { id: 'zh-direct', language: 'zh-CN', interaction: 'direct', prompt: seed => seed.zh },
  { id: 'zh-casual', language: 'zh-CN', interaction: 'colloquial', prompt: seed => `帮我看下这一步：${seed.zh} 结果说具体点就行。` },
  { id: 'en-direct', language: 'en', interaction: 'direct', prompt: seed => seed.en },
  { id: 'zh-followup', language: 'zh-CN', interaction: 'followup', prompt: seed => `继续刚才这张图，这一轮的要求是：${seed.zh}` },
  { id: 'mixed', language: 'mixed', interaction: 'mixed-language', prompt: seed => `这一步先处理：${seed.zh}\nPlease keep the scope explicit and tell me if anything is missing.` },
  { id: 'zh-correction', language: 'zh-CN', interaction: 'correction', prompt: seed => `上一条先停，我重新说清楚：${seed.zh} 以这条要求为准。` },
]

function expectedFor(intent, mutation, inputKind, checks = [], question = null) {
  const source = inputKind.startsWith('source-') || inputKind === 'supplied-source'
  const mustPreserve = source
    ? ['unrequested-borehole-facts', 'unchanged-interval-identities', 'unrelated-manual-entities', 'source-recipe-identity', 'source-metre-and-cad-millimetre-units']
    : ['untargeted-native-entities', 'untargeted-layers', 'native-handles-and-references', 'drawing-units-and-owner-spaces']
  const assertions = ['current-document-revision-checked', 'no-success-claim-without-state-or-artifact-evidence', ...checks]
  if (mutation.endsWith('-proposal')) assertions.push('full-before-after-preview', 'explicit-host-approval-before-commit', 'no-mutation-during-preview')
  if (mutation === 'source-proposal' || mutation === 'mixed-proposal') assertions.push('read-retained-source-before-revision', 'source-before-after-diff-visible', 'generated-native-geometry-matches-source')
  if (mutation === 'none') assertions.push('read-only-state-unchanged')
  if (mutation === 'blocked') assertions.push('explicit-blocker-reported', 'no-partial-mutation', 'no-fabricated-geology-facts')
  if (mutation.endsWith('-commit')) assertions.push('explicit-current-host-approval', 'exact-reviewed-plan-applied', 'one-undo-step-per-edit')
  if (mutation === 'proposal-discard') assertions.push('discard-without-document-change', 'discarded-plan-cannot-be-approved')
  if (question) assertions.push('no-mutation-before-clarification')
  return {
    intent, mutation, mustPreserve, checks: [...new Set(assertions)],
    clarification: { required: !!question, questions: question ? [question] : [], mustNotGuess: question ? ['target-identity', 'missing-engineering-facts', 'approval-scope'] : [] },
  }
}

function fixtureOverride(defaultId, prerequisites) {
  return prerequisites.find(item => item.startsWith('fixture:'))?.slice(8) ?? defaultId
}

function inputForFixture(id) {
  return id === COLUMN ? 'source-backed-column' : id === SECTION ? 'source-backed-section' : 'dxf-graphics'
}

function catalogSeeds() {
  return groups.flatMap(group => group.rows.map(([suffix, zh, en, mutation, checks, question, extra = []]) => {
    const fixture = fixtureOverride(group.fixture, extra)
    const supplied = extra.includes('document:blank-millimetre')
    const inputKind = supplied || (group.inputKind === 'supplied-source' && fixture === group.fixture) ? 'supplied-source' : inputForFixture(fixture)
    return {
      id: `${group.id}.${suffix}`, family: group.id, domain: group.domain, inputKind, zh, en,
      prerequisites: [...new Set([`fixture:${fixture}`, 'document:current-revision-known', 'fixture:synthetic-public-data-only', ...extra])],
      expected: expectedFor(`${group.id}.${suffix}`, mutation, inputKind, checks, question),
    }
  }))
}

const sequenceSpecs = [
  { id: 'dxf-label-review-history', fixture: DXF, title: 'DXF text review, reject, approve, undo and redo', transition: 'only-explicit-approval-turns-commit', turns: [
    ['cad-query.exact-hole-label', '先查对象 TEXT-A 的完整文字和 ID。', 'none'],
    ['cad-annotation.replace-native-text', 'TEXT-A 的 TEST-A 改成 TEST-A复核，先给提案。', 'cad-proposal'],
    ['review.reject-label', '这条文字修改先不要了，我明确点拒绝。', 'proposal-discard'],
    ['cad-annotation.replace-native-text', '重新给 TEXT-A 改为 TEST-A复核的提案。', 'cad-proposal'],
    ['review.approve-label', '我确认当前完整文字修改预览，点击本地批准。', 'cad-commit'],
    ['cad-persistence.read-undo-redo-history', '读当前真实撤销栈，告诉我下一步目标。', 'none'],
    ['cad-persistence.undo-latest-commit', '请为刚确认的文字修改生成真实撤销提案。', 'history-proposal'],
    ['review.approve-undo', '确认当前撤销预览，执行本地批准。', 'history-commit'],
    ['cad-persistence.redo-latest-undo', '现在为刚撤销的那步生成重做提案。', 'history-proposal'],
    ['review.approve-redo', '确认当前重做预览，执行本地批准。', 'history-commit'],
  ] },
  { id: 'column-water-refresh-export', fixture: COLUMN, title: 'Water-source review, persistence and DXF capability boundary', transition: 'only-explicit-approval-turns-commit', turns: [
    ['source-query.read-two-water-levels', '从来源读 TEST-A 初见和稳定水位，先不要改。', 'none'],
    ['source-water-depth.paired-water-revision', 'TEST-A 初见设 2.5 米、稳定设 4.5 米，给我源值和图形预览。', 'source-proposal'],
    ['review.inspect-source-diff', '先解释这条待确认提案里哪些源字段发生变化。', 'none'],
    ['review.reject-source', '我暂时拒绝水位更新，确认原来源和原图都保留。', 'proposal-discard'],
    ['source-water-depth.paired-water-revision', '按当前未改来源重新提案：初见 2.5、稳定 4.5 米。', 'source-proposal'],
    ['review.approve-source', '我已核对源数据和图形差异，点击批准这条当前提案。', 'source-commit'],
    ['cad-persistence.save-native-kjd', '保存当前 KJD，连同受支持的来源记录。', 'export'],
    ['session.refresh-committed-source', '刷新本地会话，再读保存后的水位，不要重放旧提案。', 'local-session'],
    ['cad-persistence.export-real-dxf', '导出刚确认后的实际 DXF 文件。', 'export'],
    ['capability-boundary.exported-dxf-recipe-loss', '重开刚导出的 DXF 后，继续把实测稳定水位改成 5 米。', 'blocked', '请打开保留来源的 KJD 或提供完整来源记录。', 'dxf-graphics'],
  ] },
  { id: 'column-strata-clarify-history', fixture: COLUMN, title: 'Stratum clarification, exact split and real history', transition: 'only-explicit-approval-turns-commit', turns: [
    ['source-query.read-strata-intervals', '读 TEST-A 所有分层 ID 和区间。', 'none'],
    ['ambiguity.thickness-target-unspecified', '把中间那层加厚一点，其他层怎么跟着变还没想好。', 'none', '请明确 intervalId、新顶底深度和相邻区间调整。'],
    ['source-strata.shift-adjacent-boundary', '明确 I-FILL 底和 I-CLAY 顶都设 4 米，其他不变，先提案。', 'source-proposal'],
    ['review.approve-boundary', '核对连续区间和完整源差异后，我点击批准边界修改。', 'source-commit'],
    ['source-strata.split-column-interval', '把 10—18 米砂层拆成 I-SAND-1 10—14 米砂土和 I-GRAVEL 14—18 米砾砂。', 'source-proposal'],
    ['review.approve-split', '确认两个新层身份、原孔深和原观测未丢，批准拆分。', 'source-commit'],
    ['cad-persistence.undo-latest-commit', '为刚拆层的真实历史条目生成撤销提案。', 'history-proposal'],
    ['review.approve-undo', '批准当前撤销，恢复拆层前完整来源和图形。', 'history-commit'],
    ['cad-persistence.redo-latest-undo', '请为刚撤销的拆层生成真实重做提案。', 'history-proposal'],
    ['review.approve-redo', '批准当前重做，再核对新层 ID 和手工标记。', 'history-commit'],
  ] },
  { id: 'mixed-source-manual-persistence', fixture: COLUMN, title: 'Source and manual CAD edits in an explicitly reviewed order', transition: 'only-explicit-approval-turns-commit', turns: [
    ['source-query.read-exact-hole', 'Read TEST-A source facts and the exact manual circle ID first.', 'none'],
    ['source-water-depth.collar-elevation-revision', 'TEST-A collar elevation should be 107 m; propose the same-column revision.', 'source-proposal'],
    ['review.approve-source', 'I have checked the current source and geometry diff and approve it through the local control.', 'source-commit'],
    ['mixed.move-unrelated-circle', 'Now move only CIRCLE-MANUAL +10 mm in X; do not revise any borehole facts.', 'cad-proposal'],
    ['review.approve-manual', 'I approve the current manual-circle preview through the local control.', 'cad-commit'],
    ['cad-persistence.save-native-kjd', 'Save the current KJD with supported source facts and the manual circle.', 'export'],
    ['session.refresh-committed-source', 'Refresh the saved local chat and restore the actual current drawing.', 'local-session'],
    ['mixed.verify-source-and-manual', 'Read the collar elevation and circle center from actual restored state; do not rely on chat claims.', 'none'],
    ['cad-persistence.export-real-dxf', 'Export the restored current state to a real DXF download.', 'export'],
    ['mixed.reopen-graphics-verify', 'Reopen that DXF and verify its visible elevation label and circle geometry; report source metadata as unavailable.', 'local-session', null, 'dxf-graphics'],
  ] },
  { id: 'dxf-geometry-export-reopen', fixture: DXF, title: 'Native geometry edits and export/reopen', transition: 'only-explicit-approval-turns-commit', turns: [
    ['cad-query.named-selection', '先读“孔位标注组”的准确成员和当前单位。', 'none'],
    ['cad-transform.move-persistent-selection', '这组准确成员整体向上移 5 毫米，先提案。', 'cad-proposal'],
    ['review.approve-selection-move', '我确认当前成员和位移，点击批准。', 'cad-commit'],
    ['cad-transform.copy-owned-note', '把 LEADER-A 和它拥有的文字复制到右边 30 毫米。', 'cad-proposal'],
    ['review.approve-owned-copy', '确认复制保留原件和原生关联，批准当前预览。', 'cad-commit'],
    ['cad-transform.rotate-selected-detail', '只将 LINE-A、LINE-B 绕原点逆时针转 90 度。', 'cad-proposal'],
    ['review.approve-rotation', '确认当前旋转角和中心，批准此提案。', 'cad-commit'],
    ['cad-persistence.export-real-dxf', '把现在实际的图导出 DXF。', 'export'],
    ['cad-persistence.reopen-exported-dxf', '重开导出文件，对比原生引线文字、线条和未改对象。', 'local-session'],
    ['capability-boundary.dxf-water-source-missing', '现在只有重开的 DXF，没有源表，把 TEST-A 实测水位改成 4.5 米。', 'blocked', '请提供真实水位来源或确认仅编辑图上文字。'],
  ] },
  { id: 'section-ten-source-revisions', fixture: SECTION, title: 'Ten successive source-backed section revision requests', transition: 'host-reviews-and-approves-each-valid-proposal-before-next-turn', turns: [
    ['source-section.one-hole-depth', 'TEST-B 孔深及 B-SAND 底深延到 20 米，其他孔保持。', 'source-proposal'],
    ['source-section.one-hole-collar', '在已批准上一轮的基础上，TEST-B 孔口高程设为 108 米。', 'source-proposal'],
    ['source-section.multi-hole-water', '这轮 TEST-A、TEST-B 稳定水位分别设为 4.5、5 米。', 'source-proposal'],
    ['source-strata.shift-adjacent-boundary', '只将 TEST-A 的 I-FILL 底和 I-CLAY 顶调整到 4 米，原连层 ID 保留。', 'source-proposal'],
    ['source-strata.redistribute-layer-thickness', '再将 TEST-A I-CLAY 底和 I-SAND 顶设为 11 米，不改变孔深。', 'source-proposal'],
    ['source-observation.add-sample', 'TEST-A 增加 6 米取样 S-B，其他观测仍用已批准来源。', 'source-proposal'],
    ['source-observation.add-spt', 'TEST-A 新增 13 米标贯 N-B，击数 18，取样全部保留。', 'source-proposal'],
    ['source-strata.rename-and-reclassify', 'TEST-A I-CLAY 明确命名“粉质黏土”，lithology=silty-clay，连层身份仍有效。', 'source-proposal'],
    ['source-section.split-with-explicit-correlations', '按预置核准拆分表拆两个孔砂层，并用新层 ID 的完整相关关系和未关联表更新剖面。', 'source-proposal'],
    ['source-strata.merge-supplied-intervals', '按预置核准合并表恢复两个孔原砂层覆盖，明确替换完整 intervalId 连层表，保留前八轮其他修改。', 'source-proposal'],
  ] },
]

function buildSequences() {
  const scenarios = [], sequences = []
  for (const specification of sequenceSpecs) {
    const turnIds = []
    for (const [index, [intent, prompt, mutation, question = null, overrideInput]] of specification.turns.entries()) {
      const id = `GUS1-SEQ-${specification.id}-T${String(index + 1).padStart(2, '0')}`
      const inputKind = overrideInput ?? inputForFixture(specification.fixture)
      const source = inputKind.startsWith('source-')
      const prerequisites = [`fixture:${specification.fixture}`, 'fixture:synthetic-public-data-only', 'document:current-revision-known']
      if (index === 0) prerequisites.push('sequence:fresh-independent-document-and-chat')
      else prerequisites.push(`sequence:previous-turn=${turnIds[index - 1]}`)
      if (index > 0 && specification.transition.startsWith('host-reviews')) prerequisites.push('sequence:previous-valid-proposal-approved-via-host')
      if (specification.id === 'section-ten-source-revisions' && index >= 8) prerequisites.push(`source:complete-confirmed-${index === 8 ? 'split' : 'merge'}-and-correlation-table`)
      const checks = ['sequence-state-not-reconstructed-from-chat']
      if (source) checks.push('same-source-drawing-revised')
      if (overrideInput === 'dxf-graphics') checks.push('dxf-reopen-does-not-restore-source-recipe')
      scenarios.push({ id, family: 'multi-turn', domain: source ? 'geology-source' : mutation === 'blocked' ? 'capability-boundary' : 'dxf-drawing', inputKind,
        language: /[\u3400-\u9fff]/.test(prompt) ? 'zh-CN' : 'en', interaction: 'sequence-turn', prerequisites, prompt,
        sequence: { id: specification.id, turn: index + 1, previousTurnId: turnIds[index - 1] ?? null },
        expected: expectedFor(intent, mutation, inputKind, checks, question) })
      turnIds.push(id)
    }
    sequences.push({ id: specification.id, title: specification.title, independent: true, resetFixture: specification.fixture, transition: specification.transition, turnIds })
  }
  return { scenarios, sequences }
}

const fixtureContracts = [
  { id: DXF, kind: 'dxf-graphics', provenance: 'synthetic-public-only', sourceRecipe: false,
    description: 'Native model/paper spaces, Chinese and English TEXT/MTEXT, exact IDs, duplicate-label branches, polyline/hatch/dimension/owned leader pairs, local attribute-free block, protected-layer branches and unrelated manual circle. Never measured project data.',
    units: 'millimeter', facts: { exactText: { 'TEXT-A': 'TEST-A', 'TEXT-B': 'TEST-B', 'DEPTH-A': '18.00' },
      lineA: [[0, 0, 0], [20, 0, 0]], circleA: { center: [0, 0, 0], radius: 4 }, manualCircle: { id: 'CIRCLE-MANUAL', center: [90, 90, 0], radius: 3 } } },
  { id: COLUMN, kind: 'source-backed-column', provenance: 'synthetic-public-only', sourceRecipe: true, units: 'millimeter', sourceUnits: 'meter',
    hole: { id: 'TEST-A', collarElevation: 106.5, depth: 18, initialWaterDepth: 2, stableWaterDepth: 4,
      strata: [
        { intervalId: 'I-FILL', code: '1', name: '填土', lithology: 'fill', top: 0, bottom: 3 },
        { intervalId: 'I-CLAY', code: '2', name: '黏土', lithology: 'clay', top: 3, bottom: 10 },
        { intervalId: 'I-SAND', code: '3', name: '砂土', lithology: 'sand', top: 10, bottom: 18 },
      ], observations: [{ kind: 'sample', id: 'S-A', depth: 5 }, { kind: 'spt', id: 'N-A', depth: 12, value: 15 }] },
    prerequisiteBranches: ['missing-optionals', 'manual-generated-geometry-drift', 'locked-generated-layer', 'complete-replacement-tables', 'complete-observation-lists'],
    manualObject: { id: 'CIRCLE-MANUAL', center: [90, 90, 0], radius: 3 } },
  { id: SECTION, kind: 'source-backed-section', provenance: 'synthetic-public-only', sourceRecipe: true, units: 'millimeter', sourceUnits: 'meter',
    description: 'TEST-A uses the column facts at station 0; TEST-B uses collar 107.5, depth 18 and station 20, interval IDs B-FILL/B-CLAY/B-SAND; supplied links pair each exact corresponding interval. Boundary edits require full replacement arrays; split/merge branches require explicit complete correlations and occurrence coverage.',
    scales: { horizontal: 200, vertical: 200, datumElevation: 85 },
    prerequisiteBranches: ['complete-split-and-correlation-table', 'complete-merge-and-correlation-table', 'explicitly-uncorrelated-occurrences', 'blank-document-with-complete-supplied-facts'] },
]

export function buildGeologyUserScenarios() {
  const seeds = catalogSeeds()
  const single = seeds.flatMap(seed => variants.map(variant => ({
    id: `GUS1-${seed.id}-${variant.id}`, family: seed.family, domain: seed.domain, inputKind: seed.inputKind,
    language: variant.language, interaction: variant.interaction,
    prerequisites: [...seed.prerequisites, ...(variant.interaction === 'followup' ? ['conversation:existing-same-document-context'] : []),
      ...(variant.interaction === 'correction' ? ['conversation:prior-request-not-approved'] : [])],
    prompt: variant.prompt(seed), expected: structuredClone(seed.expected),
  })))
  const multi = buildSequences(), scenarios = [...single, ...multi.scenarios]
  const corpus = {
    schemaVersion: '1.0.0', generatedBy: 'scripts/testing/generate-geology-user-scenarios.mjs',
    provenance: { kind: 'synthetic-human-style-prompts', realUserData: false, privateDrawingContent: false, executionStatus: 'not-run' },
    count: scenarios.length, standaloneCount: single.length, intentCount: new Set(scenarios.map(item => item.expected.intent)).size,
    taskFamilyCount: seeds.length, variantsPerTask: variants.length,
    coverage: { domains: [...new Set(scenarios.map(item => item.domain))], inputKinds: [...new Set(scenarios.map(item => item.inputKind))],
      languages: [...new Set(scenarios.map(item => item.language))], interactions: [...new Set(scenarios.map(item => item.interaction))] },
    fixtureContracts: structuredClone(fixtureContracts),
    taskCatalog: seeds.map(({ id, family, zh, en, inputKind, expected }) => ({ id, family, zh, en, inputKind, mutation: expected.mutation })),
    sequences: multi.sequences, scenarios,
  }
  validateGeologyUserScenarios(corpus)
  return corpus
}

function invariant(condition, message) {
  if (!condition) throw new Error(`Invalid geology user scenario corpus: ${message}`)
}

function nonemptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.trim())
}

export function validateGeologyUserScenarios(corpus) {
  invariant(corpus?.schemaVersion === '1.0.0', 'schemaVersion')
  invariant(corpus.provenance?.kind === 'synthetic-human-style-prompts' && corpus.provenance.realUserData === false &&
    corpus.provenance.privateDrawingContent === false && corpus.provenance.executionStatus === 'not-run', 'must describe synthetic unexecuted questions')
  invariant(Array.isArray(corpus.scenarios) && corpus.scenarios.length >= 1000, 'at least 1000 questions required')
  invariant(corpus.count === corpus.scenarios.length, 'count does not match scenarios')
  invariant(Array.isArray(corpus.taskCatalog) && corpus.taskCatalog.length >= 120, 'at least 120 distinct task intentions required')
  invariant(corpus.taskFamilyCount === corpus.taskCatalog.length, 'taskFamilyCount does not match catalog')
  const catalogIds = new Set(corpus.taskCatalog.map(item => item.id))
  invariant(catalogIds.size === corpus.taskCatalog.length, 'duplicate catalog intent')
  invariant(new Set(corpus.taskCatalog.map(item => item.en.replace(/\d+(?:\.\d+)?/g, '#'))).size >= 120, 'task diversity cannot come only from numeric substitutions')
  const ids = new Set(), prompts = new Set(), intents = new Set(), sequenceTurns = new Map()
  const fields = new Set(['id', 'family', 'domain', 'inputKind', 'language', 'interaction', 'prerequisites', 'prompt', 'sequence', 'expected'])
  for (const scenario of corpus.scenarios) {
    invariant(scenario && typeof scenario === 'object' && Object.keys(scenario).every(key => fields.has(key)), 'unexpected scenario field or recorded test result')
    invariant(typeof scenario.id === 'string' && /^GUS1-[a-zA-Z0-9.-]+$/.test(scenario.id) && !ids.has(scenario.id), 'invalid or duplicate id')
    ids.add(scenario.id)
    invariant(DOMAINS.has(scenario.domain) && INPUTS.has(scenario.inputKind), `${scenario.id}: domain/inputKind`)
    invariant(['zh-CN', 'en', 'mixed'].includes(scenario.language), `${scenario.id}: language`)
    invariant(typeof scenario.family === 'string' && scenario.family && typeof scenario.interaction === 'string' && scenario.interaction, `${scenario.id}: family/interaction`)
    invariant(nonemptyStrings(scenario.prerequisites), `${scenario.id}: prerequisites`)
    invariant(scenario.prerequisites.includes('fixture:synthetic-public-data-only'), `${scenario.id}: public synthetic prerequisite`)
    invariant(typeof scenario.prompt === 'string' && scenario.prompt.trim().length >= 8 && !prompts.has(scenario.prompt), `${scenario.id}: empty or duplicate prompt`)
    prompts.add(scenario.prompt)
    const expected = scenario.expected
    invariant(expected && typeof expected.intent === 'string' && expected.intent && MUTATIONS.has(expected.mutation), `${scenario.id}: expected intent/mutation`)
    invariant(Object.keys(expected).sort().join(',') === 'checks,clarification,intent,mustPreserve,mutation', `${scenario.id}: expected schema`)
    intents.add(expected.intent)
    invariant(nonemptyStrings(expected.mustPreserve) && nonemptyStrings(expected.checks), `${scenario.id}: preservation/checks`)
    const clarification = expected.clarification
    invariant(clarification && typeof clarification.required === 'boolean' && Array.isArray(clarification.questions) && Array.isArray(clarification.mustNotGuess), `${scenario.id}: clarification schema`)
    invariant(clarification.required ? nonemptyStrings(clarification.questions) && nonemptyStrings(clarification.mustNotGuess) : clarification.questions.length === 0, `${scenario.id}: clarification questions`)
    if (clarification.required) invariant(['none', 'blocked'].includes(expected.mutation) && expected.checks.includes('no-mutation-before-clarification'), `${scenario.id}: ambiguous prompt cannot authorize mutation`)
    if (expected.mutation.endsWith('-proposal')) invariant(expected.checks.includes('explicit-host-approval-before-commit') && expected.checks.includes('no-mutation-during-preview'), `${scenario.id}: proposal approval boundary`)
    if (['source-proposal', 'source-commit', 'mixed-proposal'].includes(expected.mutation)) {
      invariant(scenario.inputKind !== 'dxf-graphics', `${scenario.id}: DXF graphics cannot revise source facts`)
      invariant(expected.mustPreserve.includes('source-recipe-identity'), `${scenario.id}: source preservation`)
    }
    if (expected.mutation === 'blocked') invariant(expected.checks.includes('no-partial-mutation'), `${scenario.id}: blocked atomicity`)
    if (scenario.sequence) {
      invariant(typeof scenario.sequence.id === 'string' && Number.isInteger(scenario.sequence.turn) && scenario.sequence.turn > 0, `${scenario.id}: sequence identity`)
      const turns = sequenceTurns.get(scenario.sequence.id) ?? []
      turns.push(scenario); sequenceTurns.set(scenario.sequence.id, turns)
    }
  }
  invariant(intents.size >= 120 && corpus.intentCount === intents.size, 'intentCount/diversity mismatch')
  invariant(corpus.standaloneCount === corpus.scenarios.filter(item => !item.sequence).length && corpus.standaloneCount >= 1000, 'standaloneCount must contain at least 1000 questions')
  invariant(Array.isArray(corpus.sequences) && corpus.sequences.length >= 2, 'independent multi-turn sequences required')
  invariant(new Set(corpus.sequences.map(item => item.id)).size === corpus.sequences.length && corpus.sequences.length === sequenceTurns.size, 'sequence catalog mismatch')
  for (const sequence of corpus.sequences) {
    const turns = sequenceTurns.get(sequence.id)
    invariant(sequence.independent === true && typeof sequence.resetFixture === 'string' && turns?.length >= 10, `${sequence.id}: independent ten-turn sequence`)
    invariant(Array.isArray(sequence.turnIds) && sequence.turnIds.length === turns.length, `${sequence.id}: turnIds`)
    turns.forEach((turn, index) => {
      invariant(turn.id === sequence.turnIds[index] && turn.sequence.turn === index + 1 && turn.sequence.previousTurnId === (turns[index - 1]?.id ?? null), `${sequence.id}: contiguous independent turn chain`)
      if (index === 0) invariant(turn.prerequisites.includes('sequence:fresh-independent-document-and-chat'), `${sequence.id}: reset prerequisite`)
    })
  }
  const serialized = JSON.stringify(corpus)
  invariant(!/\b(?:sk-[a-zA-Z0-9_-]{16,}|AKIA[A-Z0-9]{16}|Bearer\s+[a-zA-Z0-9._-]{16,})\b/.test(serialized), 'credential-shaped content')
  invariant(!/(?:^|[^A-Za-z0-9])[A-Za-z]:(?:\\\\|\/)|file:\/\/|\\\\\\\\[^\\]+\\|\/(?:Users|home)\//.test(serialized), 'private or absolute filesystem path')
  invariant(corpus.fixtureContracts?.every(item => item.provenance === 'synthetic-public-only'), 'fixture provenance')
  return { count: ids.size, standaloneCount: corpus.standaloneCount, intents: intents.size, taskIntentions: catalogIds.size, sequences: corpus.sequences.length }
}

export function serializeGeologyUserScenarios(corpus = buildGeologyUserScenarios()) {
  return `${JSON.stringify(corpus, null, 2)}\n`
}

const FAMILY_TITLES = {
  'investigation-preparation': '资料核对与勘察纲要', 'investigation-point-layout': '勘探点布置与孔号点位',
  'source-query': '柱状图来源资料核对', 'source-water-depth': '地下水、孔口高程与孔深',
  'source-strata': '地层界线、拆分与合并', 'source-observation': '标贯与取样记录',
  'source-section': '剖面孔心、层间关联与同步修改', 'geological-presentation': '岩性花纹、图例、比例与版式',
  'batch-historical-workflow': '批量出图与历史文件复核', 'cad-query': 'DXF 图形与对象查找',
  'cad-annotation': '孔号与图上文字标注', 'cad-transform': '已确认图形的移动、复制与尺寸修改',
  'cad-structure': '图层、边界与原生图形编辑', 'cad-persistence': '撤销重做、保存与导出重开',
  'capability-boundary': '图形与来源数据的能力边界', 'ambiguity': '需要先问清楚的需求',
  'invalid-source': '错误资料与过期修改的处理', 'multi-turn': '六组独立的十轮工作流程',
}
const MUTATION_TITLES = {
  none: '只核对或先澄清，图形与源数据保持不变', 'cad-proposal': '给出原生 CAD 修改提案，等待本地批准',
  'source-proposal': '给出同一来源图的源数据与图形同步提案，等待批准', 'mixed-proposal': '分别审阅源数据与手工图形改动，明确原子性或执行顺序',
  'history-proposal': '给出真实引擎历史的撤销或重做提案，等待批准', 'cad-commit': '按当前本地批准应用已审阅 CAD 提案',
  'source-commit': '按当前本地批准原子应用源数据与图形提案', 'history-commit': '按当前本地批准恢复真实历史快照',
  'proposal-discard': '明确拒绝当前提案，当前图形与源数据不变', 'local-session': '保存、刷新或重开会话后核对实际状态',
  export: '输出当前真实文件并明确格式能力', blocked: '拒绝越界或无效操作，说明阻碍，不能部分修改',
}
const INPUT_TITLES = {
  'dxf-graphics': '仅 DXF 原生图形', 'source-backed-column': '保留来源记录的柱状图',
  'source-backed-section': '保留来源记录的剖面图', 'supplied-source': '已提供完整来源资料', conversation: '聊天与会话状态',
}
const DOMAIN_TITLES = { 'dxf-drawing': 'DXF 图形', 'geology-source': '地质来源资料', 'capability-boundary': '能力边界与澄清' }
const INTERACTION_TITLES = { direct: '直接提问', colloquial: '口语说法', followup: '同图追问', correction: '重新说明要求', 'mixed-language': '中英混合', 'sequence-turn': '多轮流程' }
const SEQUENCE_TITLES = {
  'dxf-label-review-history': '文字修改：核对、拒绝、批准、撤销与重做',
  'column-water-refresh-export': '地下水来源：审阅、保存、刷新、DXF 导出与重开',
  'column-strata-clarify-history': '地层：先澄清、改界线、拆层、撤销与重做',
  'mixed-source-manual-persistence': '来源与手工图形：分步批准、保存和重开',
  'dxf-geometry-export-reopen': '原生图形：移动、复制、旋转、DXF 导出与重开',
  'section-ten-source-revisions': '同一剖面连续十轮来源修改',
}
const REVIEW_LABELS = Object.fromEntries(`
current-document-revision-checked|使用当前文档修订号
no-success-claim-without-state-or-artifact-evidence|成功说明必须有实际状态或真实文件依据
inventory-complete-or-explicit-pagination|实体清单完整；分页时明确继续读取
read-only-state-unchanged|只读操作前后文档状态一致
literal-exact-text-match|按完整原文精确匹配
all-pages-searched|搜索覆盖全部分页
literal-contains-match|按字面包含匹配，不当正则表达式
case-policy-explicit|明确大小写匹配规则
complete-raw-text-without-truncation|读取完整原始文字，不截断
exact-object-identity|使用准确原生对象身份
owner-coordinate-system-explicit|明确对象所属空间的原生坐标
model-paper-space-separated|模型空间与纸空间分开核对
layer-protection-reported|明确图层隐藏、冻结与锁定状态
selection-set-membership-not-inferred|选择集成员来自真实记录，不靠邻近关系推断
spatial-candidates-not-geological-facts|空间邻近仅是几何候选，不能作为实测地质事实
explicit-topology-tolerance|使用明确连通容差
no-inferred-geology|不从图形外观推断地质事实
exact-expected-text-match|修改前原文必须完整匹配
text-position-and-handle-preserved|文字位置、身份与句柄保留
full-before-after-preview|展示完整修改前后预览
explicit-host-approval-before-commit|必须由本地确认控制批准后才能落图
no-mutation-during-preview|预览期间图形与来源不变
mtext-formatting-preserved|保留 MTEXT 格式控制码和段落
title-target-exact|准确定位目标图名对象
unrequested-title-fields-preserved|未请求的标题栏项目保留
atomic-text-batch|整批文字修改作为一次原子操作
all-before-texts-verified|整批原文全部核对一致
graphic-edit-not-source-revision|图上文字修改不冒充源数据修订
water-labels-distinguished|初见水位与稳定水位标注明确区分
source-capability-not-fabricated|没有来源记录时不能伪造来源能力
full-old-text-read-before-append|追加说明前读取完整原文
native-mtext-paragraph-semantics|使用原生 MTEXT 段落语义
native-leader-owned-mtext-pair|原生引线与其拥有的 MTEXT 保持成对
native-dimension-measured-from-geometry|尺寸由真实几何测量，不用普通文字冒充
exact-displacement|位移严格等于给定数值
stable-entity-identity|已有对象身份保持稳定
owned-annotation-pair-expanded|引线和拥有的说明同时纳入目标
source-entities-unchanged|复制时原件不变
explicit-rotation-center|使用明确旋转中心
signed-angle-correct|有符号旋转角与方向正确
uniform-scale-only|只执行明确的等比缩放
selection-membership-preserved|保留持久选择集成员关系
radius-positive|目标半径必须有效且为正
circle-center-preserved|圆心保持不变
offset-side-point-resolves-side|偏移侧由明确侧向点决定
source-line-unchanged|偏移后原线保留
concentric-native-circle|结果为同心原生圆
offset-nondegenerate|偏移结果不得退化
only-hit-vertices-move|只移动交叉窗命中的顶点
bulges-widths-and-z-preserved|保留弧凸度、宽度与 Z 值
persistent-set-exact-members|使用持久选择集的准确成员
local-block-dependencies-complete|本地块依赖完整可核对
native-insert-preserved|保留原生块插入，不炸块
exact-existing-layer-id|使用已有图层的准确记录 ID
only-layer-property-changed|仅修改图层归属属性
erase-impact-checked-before-plan|删除提案前核对依赖影响
explicit-reconnection-coordinates|补接线端点必须明确
structural-edit-atomic|结构修改整体原子应用
zero-based-index|段和顶点索引从零开始
segment-split-preserves-shape|插点拆段保留原曲线形状
curve-adjacent-deletion-rejected|拒绝会静默损坏邻接弧段的删除
reversal-preserves-segment-geometry|反转方向保留各段几何
signed-bulge-semantics|有符号弧凸度按原顶点顺序解释
per-segment-widths-only|只修改指定段起止宽度
native-hatch-island-topology|保留原生填充与内岛拓扑
explicit-geometry-not-inferred-strata|新几何来自明确坐标，不冒充推测地层
real-engine-history-targets|使用真实引擎撤销重做目标
exact-undo-target-identity|撤销目标身份必须准确
exact-redo-target-identity|重做目标身份必须准确
kjd-native-state-roundtrip|KJD 保存重开保留原生状态
dxf-bytes-independent-reader-check|真实 DXF 字节可供独立读取器验证
svg-preview-not-source-backup|SVG 是预览，不当来源备份
pending-proposal-expires-on-refresh|刷新使未批准旧提案失效
unapproved-edits-never-persist|未批准修改不能被保存成已完成结果
dxf-export-reopen-semantic-comparison|DXF 导出重开核对原生语义
kjd-reopen-identity-and-metadata|KJD 重开核对对象身份与元数据
untouched-dxf-content-comparison|未改对象的原始 DXF 内容逐项保留
recipe-discovery-not-title-inference|来源配方来自真实记录，不靠图名猜测
exact-hole-source-identity|使用准确孔号及来源身份
all-source-intervals-preserved|完整保留所有来源地层区间
initial-stable-water-distinguished|初见与稳定水位源字段分开处理
elevation-equals-collar-minus-depth|水位高程等于孔口高程减水位深度
metre-units-explicit|来源长度单位明确为米
missing-observations-not-invented|缺失观测不编造
explicit-correlation-identities|层间关联两端身份明确
source-generated-geometry-consistency|来源与生成图形一致
optional-missing-fields-remain-absent|可选缺失字段保持缺失
source-metres-cad-millimetres-separated|来源米与 CAD 毫米明确区分
only-initial-water-field-changed|仅改初见水位字段
read-retained-source-before-revision|修订前读取真实保留来源
source-before-after-diff-visible|显示源数据修改前后差异
generated-native-geometry-matches-source|生成原生图形与来源事实一致
only-stable-water-field-changed|仅改稳定水位字段
paired-water-update-atomic|初见和稳定水位一起原子更新
optional-water-cleared-not-zero|撤销水位记录表示未知，不改为零
cleared-marker-removed-with-source|清除来源记录时同步移除生成标记
groundwater-depth-elevation-consistent|地下水深度与高程一致
observation-date-preserved|观测日期完整保留
collar-change-not-layer-depth-change|改孔口高程不改变地层深度
depth-and-final-bottom-consistent|孔深与末层底深一致
trim-only-explicit-final-interval|仅裁剪明确授权末层区间
retained-observations-within-depth|保留的观测仍在孔深范围内
station-changes-horizontal-position-only|里程修订仅改变对应横向位置
shared-boundary-updated-on-both-sides|相邻层共享界线两端同步
name-and-lithology-both-explicit|层名与岩性类别均明确提供
new-interval-ids-explicit|拆分后的新地层 ID 明确
split-coverage-continuous|拆分区间覆盖连续
merge-authorized-not-inferred|合层有明确授权，不自行推断
append-bottom-interval-and-depth|新增底层与孔深一起一致更新
deleted-interval-coverage-explicit|删层后的区间覆盖方式明确
layer-thickness-not-global-scale|层厚修改不是整图缩放
complete-array-replacement-preserves-unrequested-items|替换完整数组时保留未请求项目
description-provenance-explicit|岩性描述来源明确
display-policy-not-lithology-change|显示方式变化不改变实际岩性
observation-append-preserves-existing|新增观测保留已有记录
sample-id-stable-depth-only|仅改取样深度，取样 ID 保留
exact-observation-deletion|仅删除明确目标观测
spt-depth-and-value-explicit|标贯深度和击数明确给定
spt-value-not-depth-change|改击数不改变试验深度
spt-source-and-marker-removed-together|标贯来源与生成标记同步删除
observation-label-not-identity|显示名称变化不改变记录身份
declared-sample-marker-style|使用来源声明的取样符号
complete-observation-array-not-partial-patch|提交完整观测数组，不能误当单项追加
explicit-observation-clear-not-missing-default|清空观测必须明确授权
unrequested-holes-unchanged|未请求孔的数据完整保持
multi-hole-update-atomic|多个孔更新整体原子应用
one-hole-elevation-derived-geometry|仅目标孔高程与派生图形更新
correlation-coverage-updated-after-split|拆层后更新完整关联与区间覆盖
uncorrelated-occurrence-coverage-explicit|未关联的相邻孔区间明确列出
correlation-not-code-only|关联使用区间 ID，不仅靠层号
unchanged-source-no-op|来源未变时不制造新修订
all-required-section-facts-supplied|剖面必需资料完整提供
all-intervals-rendered|每个来源地层区间均出图
missing-description-not-invented|缺失描述留空不补编
mixed-target-resolution|分别确认来源与手工图形目标
mixed-atomicity-or-ordering-explicit|混合修改的原子性或执行顺序明确
source-and-cad-diffs-visible|来源与 CAD 差异均可审阅
dxf-never-fabricates-source-recipe|仅 DXF 图形不能伪造来源配方
explicit-blocker-reported|明确说明阻碍原因
no-partial-mutation|被阻止时不能部分修改
no-fabricated-geology-facts|不能编造地质事实
no-mutation-before-clarification|问清之前不修改
hatch-appearance-not-source-evidence|花纹外观不是岩性来源证据
graphic-only-scope-respected|严格遵守仅图形修改范围
dxf-roundtrip-no-source-recipe-claim|DXF 重开不假称恢复来源配方
illustrative-data-never-certified|示意资料不能当实测或认证资料
manual-drift-rejected-atomically|手工漂移冲突整体拒绝
protected-layer-rejected|尊重受保护图层
external-reference-boundary-enforced|不越过外部参照编辑边界
missing-recipe-never-guessed|不存在的来源配方不猜造
no-fake-model-or-save-success|不伪造模型运行或保存成功
duplicate-target-not-auto-selected|重复同名目标不能自动选定
water-convention-clarified|先明确水位深度或高程含义
missing-target-and-distance-not-guessed|目标和位移缺失不能猜
scale-semantics-clarified|先明确缩放倍数或比例尺分母
graphic-source-scope-clarified|先明确图形文字或真实来源修改
ambiguous-search-result-not-guessed|歧义搜索结果不能猜选
ambiguous-followup-context-not-guessed|歧义追问不能猜目标
layer-identity-and-coverage-clarified|先明确地层 ID 与相邻覆盖调整
same-name-not-continuity-evidence|同名层不能自动证明地层连续
mixed-request-scope-clarified|先明确混合修改和确认范围
negative-depth-rejected|负深度拒绝
interval-bottom-greater-than-top|底深必须大于顶深
interval-gap-rejected|未声明缺口拒绝
interval-overlap-rejected|重叠区间拒绝
duplicate-interval-id-rejected|重复区间 ID 拒绝
hole-depth-interval-coverage-consistent|孔深与分层覆盖一致
observation-within-hole-depth|观测深度不得超孔深
section-stations-distinct|剖面孔里程不得重复
clear-set-conflict-rejected|同字段同时设置与清除拒绝
stale-revision-fails-closed|过期修订拒绝而非继续执行
cross-table-identity-reconciliation|跨点位、孔记录和取样表核对孔号
required-source-fields-inventory|检查必需来源字段完整性
coordinate-reference-not-invented|坐标参考基准不得编造
engineering-xy-axis-convention|工程 X 北向、Y 东向不互换
unit-conflicts-listed-before-conversion|先列单位冲突，再谈换算
source-date-order-reported|开孔终孔日期顺序明确核对
thickness-derived-from-explicit-endpoints|层厚由明确顶底深度计算
coverage-versus-depth-audit|总覆盖厚度与孔深逐项核对
missing-spt-count-not-zero|缺标贯击数不是零次
host-declared-document-facts-only|仅使用模板声明的来源文档事实
outline-not-compliance-certification|纲要草稿不冒充合规认证
unsupplied-design-criteria-not-invented|未给设计条件不编造
planned-work-quantity-source-traceability|计划工作量可追溯至提供资料
all-supplied-points-and-routes-preserved|给定点位与路线全部保留
location-coordinate-labels-source-equal|坐标注记与来源表一致
chinese-generated-plan-labels|生成点位图标签使用中文
explicit-section-route-order|剖面路线严格按明确孔序
label-clearance-not-point-coordinate-change|标注避让不改变真实点位坐标
point-source-revision-not-fabricated|没有点位来源不能假称修改实测坐标
annotation-overlap-clearance-exact-targets|标注避让使用准确对象与位移
north-direction-declared-not-inferred|北向由明确声明决定，不反推坐标系
example-title-clearly-illustrative|示例标题明确标示教学示意
example-no-measured-provenance|示例不冒充实测来源
real-point-layout-needs-source-brief|真实布点需要场地与任务资料
hatch-display-not-fact-reclassification|填充显示不是岩性事实重分类
pattern-label-distinguished-from-lithology|花纹标签与岩性源字段区分
host-style-hash-boundary|遵守本地版本化样式与哈希锁定
no-remote-private-pattern-code|不引入远程私有花纹代码
compiler-localization-visible|生成图上的栏目本地化可见
declared-sheet-only|只用样式声明的纸张尺寸
deep-column-no-semantic-compaction|深孔不能靠合层压缩地质含义
unsupported-layout-field-not-silently-edited|不支持的版式字段明确说明，不静默修改
explicit-datum-and-two-scales|明确基准高程及水平垂直两个比例
manual-title-layout-not-source-change|手工图名位置修改不是源高程变化
manual-review-objects-exactly-preserved|手工审阅对象准确保留
no-five-class-limit-or-omission|不能限成五类或漏掉岩性类别
fitting-sheet-explicit|适配纸张选择有明确声明
batch-readiness-by-source-capability|批量前按真实来源能力核对
batch-updates-exact-hole-identities|批量更新使用每孔准确身份
whole-batch-atomic|整批操作原子完成
batch-distinct-root-identities|不同图根和来源身份明确分开
staging-no-implicit-approval|分批计划不等于隐式批准
unsupported-batch-export-no-fake-artifact|不支持批量格式时不给假文件
selected-historical-recipe-identity|仅修改已选历史文件的来源身份
historical-graphics-label-scope|历史 DXF 修改严格限定图上文字
reopened-source-used-not-old-chat|重开后读取实际来源，不用旧聊天猜
native-source-archive-distinguished-from-dxf|KJD 来源归档与 DXF 图形交换区分
proposal-document-identity-checked|提案绑定准确文档身份
cross-document-stale-plan-rejected|切图后的旧提案拒绝
long-history-final-state-reopen-comparison|多轮后重开核对真实最终状态
sequence-state-not-reconstructed-from-chat|多轮状态来自文档，不根据聊天重建
discard-without-document-change|拒绝提案不改变当前文档
discarded-plan-cannot-be-approved|已拒绝计划不能再次批准
explicit-current-host-approval|有当前明确本地批准
exact-reviewed-plan-applied|实际应用的就是已审阅计划
one-undo-step-per-edit|每次核准修改对应一个撤销步骤
same-source-drawing-revised|继续修改同一来源图
dxf-reopen-does-not-restore-source-recipe|DXF 重开不能恢复原来源配方
untargeted-native-entities|未指定的原生图形对象
untargeted-layers|未指定的图层
native-handles-and-references|原生句柄与引用关系
drawing-units-and-owner-spaces|图纸单位与对象所属空间
unrequested-borehole-facts|未请求修改的钻孔事实
unchanged-interval-identities|未修改地层区间的身份
unrelated-manual-entities|无关的手工图形与标记
source-recipe-identity|真实来源配方身份
source-metre-and-cad-millimetre-units|来源米与 CAD 毫米单位约定
target-identity|不能猜目标身份
missing-engineering-facts|不能补编缺失工程事实
approval-scope|不能猜批准范围
fixture:synthetic-dxf-model-v1|准备合成 DXF 原生图形资料
fixture:synthetic-source-column-v1|准备保留来源的合成柱状图
fixture:synthetic-source-section-v1|准备保留来源的合成剖面图
document:current-revision-known|已知当前文档修订号
fixture:synthetic-public-data-only|只用合成公开资料，不用私有图纸原文
conversation:existing-same-document-context|已有同一文档的聊天上下文
conversation:prior-request-not-approved|上一条请求尚未批准
history:one-approved-edit|真实引擎中已有一次已批准修改
history:one-undone-edit|真实引擎中已有一次已撤销修改
proposal:pending-unapproved|当前有待批准提案
artifact:exported-dxf|已有真实导出的 DXF 文件
artifact:saved-kjd|已有保存的 KJD 文件
generated-object:manually-drifted|生成对象存在人工移动冲突
source:optional-water-and-description-absent|来源未提供可选水位或描述字段
source:two-contiguous-sand-intervals|来源含两个明确同岩性的相邻砂层
source:complete-confirmed-replacement-table|已提供核准的完整分层替换表
source:complete-confirmed-observation-list|已提供核准的完整观测列表
source:complete-split-and-correlation-table|已提供完整拆分与层间关联表
source:clay-occurrences-explicitly-uncorrelated|相邻孔黏土区间已明确列为未关联
document:blank-millimetre|当前是空白毫米图纸
source:complete-section-input|完整剖面来源资料已提供
source:complete-column-input|完整柱状图来源资料已提供
generated-layer:locked|生成对象所在图层已锁定
dxf:external-reference-present|图中存在外部参照
model:unconfigured|当前模型未配置
dxf:duplicate-hole-labels|图中存在重复同名孔号
dxf:duplicate-water-labels|图中存在重复水位文字
conversation:two-pending-proposals|聊天中有两个待确认提案
document:changed-after-source-read|读取来源后文档已经产生新修订
source:complete-synthetic-location-hole-sample-tables|完整合成点位、钻孔和取样表已提供
source:synthetic-missing-fields-branch|使用存在缺字段的合成资料分支
source:synthetic-date-conflict-branch|使用存在日期冲突的合成资料分支
template:required-source-backed-facts-missing|模板声明必需来源事实仍缺失
brief:complete-synthetic-site-and-work-quantities|完整合成场地任务与工作量清单已提供
brief:complete-synthetic-work-quantity-table|完整合成工作量表已提供
source:complete-point-location-input|完整边界、点位坐标与路线资料已提供
source:complete-three-point-route-input|完整三孔点位与明确路线资料已提供
drawing:confirmed-label-clearance-displacements|已确认文字对象及各自避让位移
source:I-SAND-boundary-only-branch|当前 I-SAND 声明只显示边界
source:complete-deep-column-input|完整深孔柱状资料已提供
template:declared-500mm-sheet|样式明确声明支持 500 毫米纸张
capability:hole-field-revision-only|当前接口仅支持钻孔字段修订
source:complete-eight-class-column-input|完整八类岩性柱状资料已提供
template:declared-fitting-sheet|样式已声明适配纸张
workspace:synthetic-source-and-graphics-inventory|已有合成来源图与仅图形文件清单
source:complete-confirmed-multi-hole-water-table|核准的完整多孔水位表已提供
workspace:synthetic-multiple-column-roots|工作区有多个独立合成柱状图根
capability:no-pdf-batch-export|当前不存在 PDF 批量导出接口
workspace:two-synthetic-same-named-source-drawings|工作区有两个同名孔但不同来源图
artifact:synthetic-source-backed-kjd|已有合成且保留来源的 KJD 文件
source:complete-confirmed-boundary-table|核准的完整界线修改表已提供
session:switched-document-with-old-pending-plan|已切换文档，仍残留旧文档待确认提案
history:many-approved-source-and-manual-edits|真实历史已有多轮核准来源与手工修改
sequence:fresh-independent-document-and-chat|本组从全新独立文档和聊天开始
sequence:previous-valid-proposal-approved-via-host|上一轮有效提案已由本地审阅批准
source:complete-confirmed-split-and-correlation-table|核准的完整拆分与关联表已提供
source:complete-confirmed-merge-and-correlation-table|核准的完整合层与关联表已提供
`.trim().split('\n').map(line => line.split('|')))

function escapeReviewHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function reviewLabel(value) {
  return value.startsWith('sequence:previous-turn=') ? `先完成上一轮：${value.slice(23)}` : REVIEW_LABELS[value] ?? value
}

export function renderGeologyUserScenarioReviewHtml(corpus = buildGeologyUserScenarios()) {
  validateGeologyUserScenarios(corpus)
  const escape = escapeReviewHtml
  const catalog = new Map(corpus.taskCatalog.map(item => [item.id, item]))
  const families = Object.keys(FAMILY_TITLES).filter(family => corpus.scenarios.some(item => item.family === family))
  const numbering = new Map(families.flatMap(family => corpus.scenarios.filter(item => item.family === family)).map((item, index) => [item.id, index + 1]))
  const list = values => `<ul>${values.map(value => `<li>${escape(reviewLabel(value))}</li>`).join('')}</ul>`
  const counts = new Map(families.map(family => [family, corpus.scenarios.filter(item => item.family === family).length]))
  const navigation = families.map(family => `<a href="#category-${escape(family)}"><span>${escape(FAMILY_TITLES[family])}</span><span class="nav-count">${counts.get(family)}</span></a>`).join('\n')
  const question = scenario => {
    const expected = scenario.expected, title = catalog.get(expected.intent)?.zh
    const sequence = scenario.sequence
    const sequenceNote = sequence ? `<p class="sequence-note">${escape(SEQUENCE_TITLES[sequence.id] ?? sequence.id)} · 第 ${sequence.turn} / 10 轮${sequence.previousTurnId ? ` · 上一轮：${escape(sequence.previousTurnId)}` : ' · 本组重新初始化独立文档'}</p>` : ''
    const clarification = expected.clarification.required
      ? `<p class="clarification-required">需要先澄清，问清前不修改。</p>${list(expected.clarification.questions)}${list(expected.clarification.mustNotGuess)}`
      : '<p>前置资料齐全且目标唯一时，无额外澄清要求；若实际资料缺失，仍应先说明。</p>'
    return `<article class="question" id="${escape(scenario.id)}">
<div class="question-heading"><span class="question-number">${String(numbering.get(scenario.id)).padStart(4, '0')}</span><h3>${escape(FAMILY_TITLES[scenario.family] ?? scenario.family)}</h3><span class="not-run">未执行</span></div>
<p class="question-id"><code>${escape(scenario.id)}</code></p>
<p class="question-meta">${escape(DOMAIN_TITLES[scenario.domain])} · ${escape(INPUT_TITLES[scenario.inputKind])} · ${escape(INTERACTION_TITLES[scenario.interaction] ?? scenario.interaction)} · ${escape({ 'zh-CN': '中文', en: '英文', mixed: '中英混合' }[scenario.language])}</p>
${title ? `<p class="task"><span>任务意图</span>${escape(title)}</p>` : ''}${sequenceNote}
<blockquote class="prompt"><span>用户口语指令</span><p>${escape(scenario.prompt)}</p></blockquote>
<div class="expected-action"><strong>需改变／预期行为</strong><p>${escape(MUTATION_TITLES[expected.mutation])}</p><code>${escape(expected.intent)}</code></div>
<dl class="review-fields"><div><dt>前提资料与状态</dt><dd>${list(scenario.prerequisites)}</dd></div><div><dt>必须保留</dt><dd>${list(expected.mustPreserve)}</dd></div><div><dt>验收要点</dt><dd>${list(expected.checks)}</dd></div><div><dt>澄清与不能猜的事项</dt><dd>${clarification}</dd></div></dl>
<p class="question-footer"><a href="#${escape(scenario.id)}">本题定位</a><a href="#catalog">返回分类目录</a></p>
</article>`
  }
  const sections = families.map(family => `<section class="category" id="category-${escape(family)}"><div class="category-heading"><h2>${escape(FAMILY_TITLES[family])}</h2><span>${counts.get(family)} 题</span></div>${corpus.scenarios.filter(item => item.family === family).map(question).join('\n')}</section>`).join('\n')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>工程勘察技术员完整测试题库 · ${corpus.count} 模拟问题，尚未执行</title>
<style>
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;color:#282b30;background:#f6f7f9;font-size:15px;line-height:1.7}*{box-sizing:border-box}body{margin:0}a{color:#345065;text-underline-offset:3px}a:focus-visible{outline:2px solid #345065;outline-offset:3px}code{font-family:ui-monospace,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}h1,h2,h3,p{margin:0}h1{font-size:30px;line-height:1.4;letter-spacing:-.035em}h2{font-size:22px}h3{font-size:17px;font-weight:650}.page-header,.layout{max-width:1380px;margin:auto;padding:32px}.eyebrow{color:#647482;font-size:12px;letter-spacing:.05em;margin-bottom:8px}.intro{max-width:920px;margin-top:12px;color:#626975}.notice{margin-top:22px;padding:16px 20px;border:1px solid #e7cf98;border-radius:10px;background:#fff7e6}.notice strong{display:block;font-size:21px;font-weight:700;color:#715315}.notice p{margin-top:5px;color:#6c603f;font-size:13px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0 0;max-width:900px}.stats>div{padding:12px 16px;background:#fff;border:1px solid #e3e6ea;border-radius:9px}.stats dt{font-size:12px;color:#69727c}.stats dd{margin:2px 0 0;font-size:22px;font-weight:700}.layout{display:grid;grid-template-columns:245px minmax(0,1fr);gap:26px;padding-top:0;align-items:start}.catalog{position:sticky;top:20px;padding:18px 14px;border:1px solid #e1e5ea;border-radius:11px;background:#fff}.catalog h2{padding:0 8px 10px;font-size:15px}.catalog p{padding:0 8px 12px;font-size:12px;color:#727b85}.catalog a{display:flex;align-items:start;justify-content:space-between;gap:8px;padding:7px 8px;border-radius:5px;font-size:13px;text-decoration:none}.catalog a:hover{background:#f0f3f6}.nav-count{flex:none;color:#8a939d;font-size:12px}.category{scroll-margin-top:16px;margin-bottom:42px}.category-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:2px 0 16px}.category-heading>span{color:#6e7782;font-size:13px;white-space:nowrap}.question{margin-bottom:18px;padding:24px;border:1px solid #dfe4e9;border-radius:12px;background:#fff;scroll-margin-top:18px}.question-heading{display:flex;align-items:center;gap:10px}.question-heading h3{flex:1;min-width:0}.question-number{font-size:12px;color:#657685;font-variant-numeric:tabular-nums;font-weight:650}.not-run{flex:none;font-size:11px;border:1px solid #ddd7c7;border-radius:4px;padding:2px 6px;color:#7a6a42;background:#fbf8f0}.question-id{margin-top:6px;color:#6f7b87}.question-meta{margin-top:6px;color:#747d87;font-size:12px}.task{margin-top:13px;color:#606a76;font-size:13px}.task>span{display:block;margin-bottom:2px;color:#88909a;font-size:11px}.prompt{margin:16px 0;padding:15px 18px;border-left:3px solid #b2c0cb;border-radius:0 7px 7px 0;background:#f4f7fa}.prompt>span{font-size:11px;color:#798895}.prompt p{margin-top:4px;font-size:16px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}.expected-action{padding:12px 15px;background:#fafafa;border:1px solid #eceeef;border-radius:7px}.expected-action strong{font-size:12px;color:#6a747f}.expected-action p{margin:4px 0;color:#333f4a;font-size:14px}.expected-action code{color:#7a8590;font-size:11px}.review-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px 24px;margin:20px 0 0}.review-fields>div{min-width:0}.review-fields dt{font-size:13px;font-weight:700;color:#465260;padding-bottom:6px;border-bottom:1px solid #e9edf0}.review-fields dd{margin:8px 0 0;font-size:13px;color:#5e6874;overflow-wrap:anywhere}.review-fields ul{margin:0;padding-left:18px}.review-fields li{margin:3px 0}.clarification-required{color:#806633;margin-bottom:6px}.review-fields dd>ul+ul{margin-top:7px}.sequence-note{margin-top:12px;padding:9px 12px;background:#f4f4f8;color:#625f75;font-size:12px;overflow-wrap:anywhere}.question-footer{display:flex;gap:18px;margin-top:18px;padding-top:10px;border-top:1px solid #edf0f2;font-size:11px}.page-footer{padding:20px 0 35px;color:#79828d;font-size:12px;text-align:center}
@media(max-width:950px){.page-header,.layout{padding:22px}.layout{grid-template-columns:205px minmax(0,1fr);gap:18px;padding-top:0}.question{padding:18px}.review-fields{grid-template-columns:1fr;gap:17px}.catalog a{font-size:12px}h1{font-size:26px}}@media(max-width:680px){.page-header,.layout{padding:18px}.layout{display:block;padding-top:0}.catalog{position:static;margin-bottom:24px}.catalog nav{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px}.stats{grid-template-columns:1fr 1fr}.notice strong{font-size:19px}.question-heading{align-items:flex-start}.question{padding:17px}.question-heading h3{font-size:15px}.prompt{padding:12px 14px}.prompt p{font-size:15px}.category-heading h2{font-size:19px}.review-fields{gap:16px}}@media print{body{background:#fff}.page-header,.layout{padding:12px;max-width:none}.layout{display:block}.catalog,.question-footer{display:none}.question{break-inside:avoid;box-shadow:none}.review-fields{grid-template-columns:1fr 1fr}.notice{background:#fff}.category-heading{break-after:avoid}}
</style></head><body><header class="page-header" id="top"><p class="eyebrow">KJDraw · 合成问题审阅页 · 版本 ${escape(corpus.schemaVersion)}</p><h1>工程勘察技术员完整测试题库</h1><p class="intro">按日常工作构思：资料核对与纲要、点位与孔号、柱状图来源、地层拆合、岩性图例、地下水与标贯取样、剖面关联、比例版式、批量出图和历史文件反复修改。</p><div class="notice" role="note"><strong>${corpus.count} 模拟问题，尚未执行</strong><p>这些是合成测试指令及预期行为，未使用私有图纸原文，不是 ${corpus.count} 次真人或模型测试结果。真实执行结果应另存记录；遇到缺资料或关联不能唯一确定，先澄清或明确拒绝也可属于正确行为。</p></div><dl class="stats"><div><dt>完整问题</dt><dd>${corpus.count}</dd></div><div><dt>独立问题</dt><dd>${corpus.standaloneCount}</dd></div><div><dt>不同岗位任务</dt><dd>${corpus.taskCatalog.length}</dd></div><div><dt>独立多轮流程</dt><dd>${corpus.sequences.length} 组 × 10 轮</dd></div></dl></header>
<div class="layout"><aside class="catalog" id="catalog"><h2>分类目录</h2><p>全部题目展开。使用 Ctrl+F 搜孔号、任务、关键词或完整 ID。</p><nav aria-label="题库分类目录">${navigation}</nav></aside><main>${sections}<footer class="page-footer">完整 ${corpus.count} 题 · 全部尚未执行 · 独立保存真实模型与人工审阅记录 · <a href="#top">返回页首</a></footer></main></div></body></html>\n`
}

async function main(args) {
  const mode = args[0] ?? '--check'
  const review = mode === '--review-html'
  invariant(review ? args.length === 2 && !!args[1] && /\.html$/i.test(args[1]) : args.length <= 1 && ['--write', '--check', '--summary'].includes(mode), 'usage: node scripts/testing/generate-geology-user-scenarios.mjs [--write|--check|--summary|--review-html OUTPUT.html]')
  const corpus = buildGeologyUserScenarios(), contents = serializeGeologyUserScenarios(corpus)
  if (review) {
    const output = resolve(args[1])
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, renderGeologyUserScenarioReviewHtml(corpus), 'utf8')
  } else if (mode === '--write') {
    await mkdir(dirname(fileURLToPath(FIXTURE_URL)), { recursive: true })
    await writeFile(FIXTURE_URL, contents, 'utf8')
  } else if (mode === '--check') {
    invariant(await readFile(FIXTURE_URL, 'utf8') === contents, 'frozen fixture differs from deterministic generator; use --write after reviewing intentional changes')
  }
  console.log(JSON.stringify({ mode, ...validateGeologyUserScenarios(corpus), executionStatus: 'not-run' }))
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
