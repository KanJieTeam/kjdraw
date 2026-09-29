# Cross-model CAD probes: DeepSeek, Qwen and GLM (2026-09-29)

These are **observed runs**, not a claim that KJDraw always saves tokens, always wins, or is ready for every engineering drawing. All saved requests, sanitized responses and DXFs are in the [raw evidence archives](evidence/2026-09-29-cross-model/README.md); failures and stopped runs are retained. No model answer was manually repaired or retried. The tool arm calls the real KJDraw SDK and an independent `ezdxf` scorer checks output files. The direct arm asks the same model to emit the whole ASCII DXF without a CAD library. That is a deliberately narrow baseline, **not** a comparison with another CAD SDK.

## Same three simple tasks, complete six-request runs

The exploratory `pilot` suite has a mounting plate, a bolt flange and a stepped profile. Each model made one request per task per arm, temperature 0, non-thinking mode, a 4,096-output-token cap and forced tool choice for the KJDraw arm. This uses the **full** `cad_propose_drawing` schema, not the compact benchmark adapter or the installed Skill. Both runs completed all six requests and passed offline artifact audit.

| Model | KJDraw valid | Direct DXF valid | KJDraw total tokens | Direct DXF total tokens | KJDraw summed end-to-end | Direct summed end-to-end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DeepSeek `deepseek-flash` | 3/3 | 1/3 | **7,993** | **1,569** | 8.695 s | 7.167 s |
| Qwen `qwen3.8-flash` | 2/3 | 1/3 | **9,390** | **2,009** | 20.50 s | 22.76 s |

This is the unfavorable result that matters: on these tiny one-shot drawings, the full KJDraw tool route used **5.09×** as many tokens as direct DXF with DeepSeek and **4.67×** with Qwen. Qwen's KJDraw arm also failed the bolt-flange geometry check. The direct arm passed the bolt flange with DeepSeek and the stepped profile with Qwen; its other two tasks failed for each model. Do **not** advertise token savings for the full-schema one-shot route. Absolute times across providers are not a speed ranking: the runs were made on the same non-isolated Windows host while other model sessions were active. End-to-end time includes the model request, materialization and independent validation, but not setup, report writes or a real AI-client Skill session.

## Dense manufacturing suite: one complete run, two stopped probes

The versioned `manufacturing-30` suite v1.0.1 specifies 30 different fixture-plate sheets. Under `deepseek-flash`, the complete paired 60-request run passed **30/30** with the KJDraw high-level manufacturing compiler and **0/30** with direct DXF: 81,733 versus 750,439 total tokens, and 83.384 versus 1,756.622 summed end-to-end seconds. Twenty direct outputs hit the 32,768-token output cap; another ten were invalid. Read the [full DeepSeek report](deepseek-2026-09-29.md) before quoting this number. Its high-level compiler is a different, much narrower interface from the full general-purpose drawing schema used above.

The other providers did **not** complete the 30-task suite:

| Provider and model | What actually ran | Stop reason | What can be concluded |
| --- | --- | --- | --- |
| Qwen `qwen3.8-flash` | 3 of 60 requests; first KJDraw drawing valid, first direct DXF structurally invalid, second direct request has no response | HTTP client timed out at 120 s on request 3; 57 unexecuted | The first KJDraw drawing worked. The timeout does not identify whether generation or network stalled. There is no 30-task Qwen score. |
| Zhipu `glm-4.7-flash` | Deliberately bounded first-task probe, 2 of 2 requests; KJDraw tool call rejected; direct request has no response | Direct request HTTP 429 | The model supplied an out-of-bounds bolt-circle pattern instead of the specified mounting-hole array. The engine correctly refused it; there is no GLM success or savings estimate. |

The Qwen first paired task used 2,999 provider-reported tokens for the valid KJDraw result and 7,968 for the invalid direct result; the later timed-out request has no token-usage response. GLM's rejected tool call used 2,403 tokens. These are **partial observations**, not comparable suite totals. Qwen used `enable_thinking=false` and Zhipu used `thinking.type=disabled`; both used the 32,768 output-token cap for their manufacturing probes, forced tool choice, non-streaming responses and 120 s timeout. Model and endpoint choices were checked against [Qwen's official model and compatible API documentation](https://help.aliyun.com/zh/model-studio/qwen3-8-flash) and [Zhipu's official model announcement](https://www.zhipuai.cn/zh/news/148). Provider behavior, quotas and model versions can change.

## Narrow basic-tool follow-up: better validity, still more tokens

We then added a source-candidate `cad_propose_drawing_basic` tool for lines, circles, arcs and straight polylines. Its serialized function definition is 1,512 bytes versus 5,434 bytes for `cad_propose_drawing`; **schema bytes are not model tokens**. It keeps revision and unit checks, rejects unknown fields, creates a pending proposal and still requires host approval. The same three `pilot` task prompts, providers, temperature 0, non-thinking settings, forced tool choice and 4,096-output-token cap were used, with one fresh request per task per arm and no retry. These complete six-request runs were independently audited from saved DXFs.

| Model | Basic tool valid | Direct DXF valid | Basic total tokens | Direct total tokens | Tasks where basic used fewer tokens | Basic summed end-to-end | Direct summed end-to-end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DeepSeek `deepseek-flash` | 3/3 | 1/3 | **3,330** | **1,533** | **0/3** | 6.193 s | 6.735 s |
| Qwen `qwen3.8-flash` | 3/3 | 0/3 | **3,736** | **1,933** | **0/3** | 17.280 s | 21.688 s |

Thus the smaller tool definition did **not** make these simple one-shot tasks cheaper in total provider-reported tokens. The tool arm was more often valid; that is a different claim. The direct arm's invalid results must not be converted into an invented cost-per-success number. Differences from the earlier full-schema pilot also include fresh nondeterministic model responses, so they are not a controlled causal estimate of the schema reduction alone. This candidate is in source and Skill routing, not evidence that a currently published npm package or a real client already uses it. See the [new raw archives](evidence/2026-09-29-cross-model/README.md). A representative, prespecified 100-task corpus and a library-assisted valid-output baseline are still needed before claiming that 99% of tasks use fewer tokens.

The provider breakdown localizes the overhead: on these three fresh tasks the earlier full-schema pilot reported 8,243 input / 1,147 output tokens for Qwen and 6,946 input / 1,047 output for DeepSeek. The basic-tool follow-up reported 3,098 input / 638 output and 2,755 input / 575 output respectively. This supports using the narrowest suitable tool, but the separate model calls and possible provider changes mean the difference is **not** a controlled percentage-saving claim. The remaining fixed request and tool overhead still outweighs a tiny direct DXF on all six basic-tool task pairs.

## Reproduce and challenge

The [paired runner](../../scripts/benchmarks/paired-model-benchmark.mjs), [versioned tasks](../../scripts/benchmarks/manufacturing-task-suite.mjs), [generic validator](../../scripts/benchmarks/paired-model-validator.py) and [manufacturing validator](../../scripts/benchmarks/manufacturing-model-validator.py) are public. A dry-run plan makes no model calls:

```sh
node scripts/benchmarks/paired-model-benchmark.mjs --explore --task-suite=pilot --repetitions=1 --max-requests=6 --max-output-tokens=4096
```

For a fresh paid run, select an endpoint/model, supply the API key only through a temporary process environment, and add `--live --output=<new-directory>`. Keep the same settings and an explicit request budget; never put a key in a command line, commit or issue. Offline checks need **no** key:

```sh
python scripts/benchmarks/audit-pilot-evidence.py <extracted-pilot-archive>
python scripts/benchmarks/audit-manufacturing-evidence.py <extracted-complete-manufacturing-archive>
python scripts/benchmarks/audit-manufacturing-evidence.py <extracted-stopped-manufacturing-archive> --allow-stopped
```

These auditors verify saved request/response/DXF hashes and independently recheck each saved DXF; they cannot prove what a model would do today. A library-assisted baseline, independent users, real customer drawings, model holdouts and cross-platform runs remain necessary before any general 1.0 claim.
