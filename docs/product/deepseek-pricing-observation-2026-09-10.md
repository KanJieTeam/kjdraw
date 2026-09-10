# DeepSeek usage 与价格观察（2026-09-10）

本记录用于解释实验原始用量，不是价格常量、账单或模型成功率结论。核实时间：2026-09-10 13:36 UTC（北京时间 21:36）；仅使用 DeepSeek 官方文档。价格与路由可能继续变动，后续实验须重新核实。

## API 上报字段

[官方 Context Caching 文档](https://api-docs.deepseek.com/guides/kv_cache/) 明确将 `usage.prompt_cache_hit_tokens` 定义为命中的输入 token 数，将 `usage.prompt_cache_miss_tokens` 定义为未命中的输入 token 数。

KJDraw Chat 解析器保留 `prompt_tokens` 作为完整输入数；命中数兼容标准 `prompt_tokens_details.cached_tokens` 与上述顶层命中字段。两字段同时存在时必须一致；完整 hit/miss 拆分必须与已上报的 prompt 总数一致。未命中数仅来自上报字段，不以减法推算；缺失保持 null。cache miss 不等于 cache write，不将任何缓存字段重复加到输入总数。

## 当时官方人民币价表

[官方中文模型与价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 当时列出 Flash 的下列价格，单位均为人民币／百万 token。

| 项目 | 空闲时段 | 高峰时段 |
| --- | ---: | ---: |
| 输入，缓存命中 | 0.02 元 | 0.04 元 |
| 输入，缓存未命中 | 1 元 | 2 元 |
| 输出 | 4 元 | 8 元 |

高峰时段为北京时间周一至周五 09:00–12:00、14:00–18:00，其余为空闲时段。按各类 token 数乘对应单价计费。缺少上报的缓存拆分时，本记录不补算价格；本地测量的请求耗时也不能确定实际账单所属时间点。费用由服务商账户账单核对。

## 模型路由变化

上述官方价表在核实当日已经列出 `deepseek-flash` 对应 DeepSeek-V4.1-Flash，并注明旧 `deepseek-v4-flash` 等 ID 仍可请求，但原模型已下线，由 V4.1 Flash 提供服务并按 Flash 计费。

不因此擅自替换用户指定的请求 ID。实验须分别保存 requested model 与服务端实际返回的 model 字段，并附这条官方路由说明；不能把旧 ID 的请求宣称为原 V4 Flash 权重的测评。若返回值仍是别名，也不能仅凭别名证明底层版本。检索摘要仍可能包含此前价表，本记录未采用旧缓存价格，也未做汇率换算。
