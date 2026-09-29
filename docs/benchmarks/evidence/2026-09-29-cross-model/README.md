# Raw cross-model evidence (2026-09-29)

Each ZIP contains the captured `report.json`, requests, sanitized responses and DXFs where generated. No Authorization header or API key is included. The `pilot` archives completed all six requests. The Qwen manufacturing attempt stopped after three of 60 dispatches, and the Zhipu first-task probe stopped on HTTP 429 after two of two dispatches. A stopped probe is **not** a completed 30-task score. Do not silently retry or discard failed responses.

| Archive | Meaning | SHA-256 |
| --- | --- | --- |
| `deepseek-pilot-3-tasks.zip` | DeepSeek full-schema pilot: 3 KJDraw and 3 direct requests, all completed | `52012f678ef6001686bc1aa88ea6a7993041a9d7d889a25305cee81b8c348e2e` |
| `qwen-pilot-3-tasks.zip` | Qwen full-schema pilot: 3 KJDraw and 3 direct requests, all completed | `0d4970fe0c60d5991200e7c83830f31a1643b5cd7493fe0ecd9217c2b0ca2369` |
| `qwen-manufacturing-stopped-timeout.zip` | Qwen manufacturing-30: stopped after 3/60 requests, 57 unexecuted | `56ce771b6c4eba40b2e2c4288e1ddaecca7ebfb30cdb80a1cf1fd547026e87fd` |
| `zhipu-manufacturing-stopped-429.zip` | Zhipu bounded first-task probe: 2/2 requests attempted, HTTP 429 on direct arm | `1cb281022f06d8d8cb3e409a860b2436c6cfb612dfbf9085c4c69a54fcb8045f` |
| `qwen-basic-pilot-3-tasks.zip` | Qwen source-candidate basic-tool pilot: 3 KJDraw and 3 direct requests, all completed | `f6d14d79d458afa629e02d4815feba10d42b5d92377f0d1fd53fd0e4c4f0dad1` |
| `deepseek-basic-pilot-3-tasks.zip` | DeepSeek source-candidate basic-tool pilot: 3 KJDraw and 3 direct requests, all completed | `644ee6c5ef02b3626e14f263816dd9d47a1bb8296294a9897ad9b3fdfc8a4066` |

Verify each digest before extracting. After extraction, use [`audit-pilot-evidence.py`](../../../../scripts/benchmarks/audit-pilot-evidence.py) for either pilot ZIP and [`audit-manufacturing-evidence.py`](../../../../scripts/benchmarks/audit-manufacturing-evidence.py) with `--allow-stopped` for either manufacturing ZIP. These are zero-model-call audits; the original model requests are not replayed. See the [study and limitations](../../cross-model-2026-09-29.md).
