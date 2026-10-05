# Token-efficiency diagnostic evidence (v2 and v3)

These are **one-repetition diagnostic pilots**, not the frozen three-repetition, independently reviewed 100-task result. The original two archives cover ten predefined task IDs. The two later archives cover the full 100-task / 180-round corpus, with two arms and 360 planned round records per model. All archives contain synthetic task responses, provider-reported usage, per-round validation metadata and generated DXF files. Proposal approval was synthetic; failures and unexecuted rounds remain visible. Model-response JSON was redacted for process API keys, and the full archives were screened for credential-shaped strings before publication. Do not treat any archive as evidence for a 99% claim.

| Archive | Model and contents | SHA-256 |
| --- | --- | --- |
| `qwen-skill-json-v2.zip` | Qwen `qwen-plus`; 23 attempted of 26 planned requests, 10 tasks | `e44f53c5ae24b60bd13936af6ed1110a5d0c268442046631dbbe882505b6d455` |
| `deepseek-skill-json-v2.zip` | DeepSeek requested with legacy `deepseek-chat` alias, returned `deepseek-flash`; 25 attempted of 26 planned requests, 10 tasks | `32c5a3fa6cccd9a5c80e137e74bbfd8ae2e755f16a885e95da2c5d91d3ac5272` |
| `qwen-100-r1-skill-json-v2.zip` | Qwen `qwen-plus`; 324 attempted of 360 planned requests, 100 tasks; 39/100 token-saving wins | `4c82e3dccef394c0459623458e8881e75088f4a75f5a1ff27cd2e70e2bf2c99e` |
| `deepseek-100-r1-skill-json-v2.zip` | DeepSeek `deepseek-flash`; 348 attempted of 360 planned requests, 100 tasks; 60/100 token-saving wins | `5742637ee9aec1aa3978469c6e040d5eff067ada4aa2e286d0d83afd938034c1` |
| `qwen-v3-spot.zip` | Qwen `qwen-plus`; six targeted tasks, 17 attempted of 18 planned requests; 2/6 strict wins | `c2e09a44d4b5b0c0c854f4bf632a6b6c8e55414460e1959e68a2efa03829d137` |
| `deepseek-v3-spot.zip` | DeepSeek `deepseek-flash`; six targeted tasks, 17 attempted of 18 planned requests; 3/6 strict wins | `21141137177ad142dc43b0f32dbae69dc88bf84165e73c0097d80ad28ab25627` |

Read the [pilot report](../../token-efficiency-pilot-2026-09-29.md) and [predeclared protocol](../../token-efficiency-protocol.md) before comparing totals. The DXF and responses let another researcher inspect the observed outputs; rerunning requires the published corpus, scripts, SDK and their own provider access. Provider nondeterminism means a replay need not produce identical text or tokens.
