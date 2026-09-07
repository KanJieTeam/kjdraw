# KJCore Rust kernel

Dependency-free Rust crates for CAD document validation/revisions, primitive geometry, spatial helpers and experimental solid meshes. `kjcore-wasm` exposes a raw WebAssembly ABI consumed by KJDraw SDK.

```sh
cargo test --locked
rustup target add wasm32-unknown-unknown
cargo build --locked -p kjcore-wasm --target wasm32-unknown-unknown --release
```

Or run `node scripts/build-wasm.mjs` from the repository root to build and copy the public artifact. See `docs/status.md` for the boundaries: this is not a complete BRep engine or full authority for every SDK editing operation.
