# Downstream integration

The public `KanJieTeam/kjdraw` repository is the intended source of truth for shared SDK/kernel development. Kanjie is a downstream product, using the same public code and interfaces.

During extraction, source paths are retained: `packages/kjdraw-sdk/src`, `runtime/kjcore-rs/crates`, and `web/public/kjcore/kjcore.wasm`. This permits a reviewed, hash-pinned vendor snapshot without rewriting the existing application's imports or breaking offline development.

1. Implement shared changes in the public repository and pass its SDK, WASM and release checks.
2. Freeze a public commit/tag. Do not consume a floating branch in a released product.
3. Import the allowlisted source files into Kanjie using its downstream sync script. Check for local drift first; never overwrite local edits automatically.
4. Record the upstream commit and SHA-256 for every imported file.
5. Run Kanjie's focused integration tests before product release.

Vendored files are a locked dependency, not a separately maintained implementation. Product-specific adapters, enterprise configuration and private assets stay in the downstream repository. Public exports must use an explicit allowlist and must never copy a whole Kanjie checkout or its git history.

The integration tooling belongs to the private downstream repository, so it cannot accidentally become a generic public upload command. The public SDK stays independently runnable and testable.
