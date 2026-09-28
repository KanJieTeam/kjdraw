# Raw evidence index

These ZIP files preserve request bodies, sanitized provider responses, generated DXF files where available, and the original reports. They contain no Authorization header or API key. A failure is retained as a failure; archives are not a curated success gallery. The matching source and methodology are in [the study](../../deepseek-2026-09-28.md). SHA-256 digests below apply to the ZIP bytes in this directory. Nine historical ZIPs were repaired after discovery of a Windows CR-CR-LF text-write defect: only affected `.dxf` newline bytes were normalized to CR-LF; requests, responses, reports and unrelated entries were unchanged. The [repair script](../../../../scripts/benchmarks/repair-windows-dxf-evidence.py) names every affected archive and backs up originals before replacement; the original archive hashes remain in the preceding Git revision.

| Archive | Purpose | SHA-256 |
| --- | --- | --- |
| `oneshot-standard.zip` | Production full-schema one-shot paired run | `b175b2a132092f5c7f7d50a6291d1c6292861636bf3aae178b01673ef42734e2` |
| `oneshot-compact-tool.zip` | Production compact-tool one-shot paired run | `dd5a3d3c5a757b2ea193af4bccf4c8a79b33bf8768824199c389ae147373159c` |
| `oneshot-json-harness-failure.zip` | Initial compact-JSON harness failure, not part of the corrected result | `b7f42b71be73c8cf901bee4c91ce2adc1d80a6c77fd7a9b83982c9b553fb6978` |
| `oneshot-json-corrected.zip` | Fresh paired run after host adapter fix | `5a0bb4e418de829f6ff0927d1040c8d910dbff16e779d4a1901aca2aa052eae4` |
| `multiturn-compact.zip` | Experimental selected-tool 10-edit sequence | `b616d741cd75e94bbf7e4a849bdeee6ceceabb62c5db1481956c479d5ffd8a9d` |
| `multiturn-production.zip` | Unmodified SDK tool-definition 10-edit sequence | `c7d8f5cf189c4523e57ba6b946dfc959887d9acbb6915bec11b2506ae907b019` |
| `engineering-annotated.zip` | Original generic annotated engineering run, 0/5 in both arms | `840246e564dcba62864e73cc3d3536df21354df27e0caf8ae62c3bca3edd79e5` |
| `engineering-zerobased-rerun.zip` | Unchanged engineering task rerun after clarifying model-facing reference numbering; 0/5 in both arms | `08c54a46facbaadbfae2888afcfe4f2e5eb921ed6c9310e42d3632b038506fd3` |
| `engineering-layer-default-rerun.zip` | Unchanged engineering task rerun after group-style and conventional-layer improvements; 0/5 in both arms | `5c25645c8c0292cd6a7fe9fca2f753e5bd8979627e2a7f51c8d6c595baefeabf` |
| `manufacturing-sheet.zip` | Original 96-hole manufacturing paired run | `5c60b9dbdba14a8f3a24071dc60cddc57f107af9b3f406962b07644a59b45f79` |
| `manufacturing-highcap.zip` | Separate single direct-DXF 131,072-output-token sensitivity request | `bc7452a22cc3c7de84a84ff24156d98d20e185b0d9248d48503d1145aa84ad6d` |
| `local-strategy.zip` | Local deterministic, non-model drawing-strategy timings and checks | `e8c8ada4275c53da59fa04560115440b7134cd9e9a91769fb48c3d13d5cea867` |

The archives do not establish an end-to-end Skill token saving, cross-model reliability, production drawing quality, or a representative customer workload. The high-cap request consumed 131,713 total tokens and still ended with `finish_reason=length`; it is a single sensitivity check, not a sixth paired run.
