# Raw evidence index

These ZIP files preserve request bodies, sanitized provider responses, generated DXF files where available, and the original reports. They contain no Authorization header or API key. A failure is retained as a failure; archives are not a curated success gallery. The matching source and methodology are in [the study](../../deepseek-2026-09-28.md). SHA-256 digests below apply to the ZIP bytes in this directory.

| Archive | Purpose | SHA-256 |
| --- | --- | --- |
| `oneshot-standard.zip` | Production full-schema one-shot paired run | `cd37f65943d7a80b821c66b1e0d7210e593ffb16c59c7ca60d389a442350f86f` |
| `oneshot-compact-tool.zip` | Production compact-tool one-shot paired run | `6ac1fe559c25358e6a50edb9d5b2f29802107547600338622f486043da204a77` |
| `oneshot-json-harness-failure.zip` | Initial compact-JSON harness failure, not part of the corrected result | `c940aecd2b275ef0ddcb01b0f5369c63d52534046046662dbc430e9ee94c7f2f` |
| `oneshot-json-corrected.zip` | Fresh paired run after host adapter fix | `3ea1b5c342671a4b06177d452c7a8a0973dcb42852f5dddecf0a9a2682aadd1a` |
| `multiturn-compact.zip` | Experimental selected-tool 10-edit sequence | `4d44158c3970172f45c345c296458acf985302bdec8671312012f0a9388a8ab0` |
| `multiturn-production.zip` | Unmodified SDK tool-definition 10-edit sequence | `7b9826bdc8d8181e4451a69a0c4b01c9c15f7bee3c92be1e67a5ce7c98266d3f` |
| `engineering-annotated.zip` | Original generic annotated engineering run, 0/5 in both arms | `840246e564dcba62864e73cc3d3536df21354df27e0caf8ae62c3bca3edd79e5` |
| `engineering-zerobased-rerun.zip` | Unchanged engineering task rerun after clarifying model-facing reference numbering; 0/5 in both arms | `08c54a46facbaadbfae2888afcfe4f2e5eb921ed6c9310e42d3632b038506fd3` |
| `engineering-layer-default-rerun.zip` | Unchanged engineering task rerun after group-style and conventional-layer improvements; 0/5 in both arms | `5c25645c8c0292cd6a7fe9fca2f753e5bd8979627e2a7f51c8d6c595baefeabf` |
| `manufacturing-sheet.zip` | Original 96-hole manufacturing paired run | `5c60b9dbdba14a8f3a24071dc60cddc57f107af9b3f406962b07644a59b45f79` |
| `manufacturing-highcap.zip` | Separate single direct-DXF 131,072-output-token sensitivity request | `bc7452a22cc3c7de84a84ff24156d98d20e185b0d9248d48503d1145aa84ad6d` |
| `local-strategy.zip` | Local deterministic, non-model drawing-strategy timings and checks | `e8c8ada4275c53da59fa04560115440b7134cd9e9a91769fb48c3d13d5cea867` |

The archives do not establish an end-to-end Skill token saving, cross-model reliability, production drawing quality, or a representative customer workload. The high-cap request consumed 131,713 total tokens and still ended with `finish_reason=length`; it is a single sensitivity check, not a sixth paired run.
