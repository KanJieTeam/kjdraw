# Token-efficiency Skill JSON v2 pilot evidence

These are **one-repetition diagnostic pilots**, not the frozen three-repetition, independently reviewed 100-task result. Both archives contain synthetic task responses, provider-reported usage, per-round validation metadata and generated DXF files for the same ten predefined task IDs. Proposal approval in these pilots was synthetic; failures and unexecuted rounds remain visible. The model-response JSON was redacted for process API keys and screened for credential-shaped strings before publication. Do not treat the archive as evidence for a 99% claim.

| Archive | Model and contents | SHA-256 |
| --- | --- | --- |
| `qwen-skill-json-v2.zip` | Qwen `qwen-plus`; 23 attempted of 26 planned requests, 10 tasks | `e44f53c5ae24b60bd13936af6ed1110a5d0c268442046631dbbe882505b6d455` |
| `deepseek-skill-json-v2.zip` | DeepSeek `deepseek-chat`; 25 attempted of 26 planned requests, 10 tasks | `32c5a3fa6cccd9a5c80e137e74bbfd8ae2e755f16a885e95da2c5d91d3ac5272` |

Read the [pilot report](../../token-efficiency-pilot-2026-09-29.md) and [predeclared protocol](../../token-efficiency-protocol.md) before comparing totals. The DXF and responses let another researcher inspect the observed outputs; rerunning requires the published corpus, scripts, SDK and their own provider access. Provider nondeterminism means a replay need not produce identical text or tokens.
