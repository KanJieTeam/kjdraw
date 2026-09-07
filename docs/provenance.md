# Source and asset provenance

This developer preview is extracted from the KanJieTeam Kanjie workspace at the owner's request for public release.

| Included material | Source |
| --- | --- |
| JavaScript SDK and its core tests | `packages/kjdraw-sdk` in the Kanjie workspace |
| Rust kernel and WASM bridge | `runtime/kjcore-rs/crates`; no external Rust crate dependencies |
| Included WASM | KJCore artifact; public-source rebuild is checked by the release workflow |
| Playground and documentation | Written for this public extraction |
| Logo and cover illustration | Original repository-native SVG artwork |
| Sample plan and test project | Original deterministic synthetic geometry; no customer/project corpus |

The SDK has no runtime npm dependencies. The playground uses browser APIs and local ES modules. GitHub Actions uses third-party actions only for development/build automation. The full Apache-2.0 license text is an unmodified copy of the standard license text distributed with Playwright; no Playwright implementation is redistributed in this core.

Excluded: Kanjie account/organization services, reports and MDB data, historical case knowledge, vendor CAD templates, legacy YTKC/Lizheng asset libraries, private configuration, keys, caches and original git history. Compatibility family identifiers in inherited contracts do not include or license those vendors' assets.

This source inventory is not a third-party legal audit. New contributions and new dependencies must identify their provenance and retain any required notices. Contact: hanwei5512@126.com.
