import { spawnSync } from 'node:child_process'
import { copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../runtime/kjcore-rs/', import.meta.url))
const r = spawnSync(process.env.KJDRAW_CARGO ?? 'cargo', ['build', '--locked', '-p', 'kjcore-wasm', '--target', 'wasm32-unknown-unknown', '--release'], { cwd: root, stdio: 'inherit' })
if (r.status !== 0) { console.error('Install Rust and run: rustup target add wasm32-unknown-unknown'); process.exit(r.status ?? 1) }
await copyFile(new URL('../runtime/kjcore-rs/target/wasm32-unknown-unknown/release/kjcore_wasm.wasm', import.meta.url), new URL('../web/public/kjcore/kjcore.wasm', import.meta.url))
console.log('Rebuilt KJCore WASM from public Rust sources.')
