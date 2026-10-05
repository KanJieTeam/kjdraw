import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const root = fileURLToPath(new URL('../runtime/kjcore-rs/', import.meta.url))
const repository = fileURLToPath(new URL('../', import.meta.url))
const pathRemapping = [
  [repository, '/kjdraw'],
  [process.env.CARGO_HOME ?? join(homedir(), '.cargo'), '/cargo'],
  [process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'), '/rustup'],
]
// Apply to every dependency, not only the final crate. Encoded flags preserve
// prefixes containing spaces without introducing shell quoting or host paths
// into provenance. Keep Cargo's inherited flag precedence.
const inheritedFlags = process.env.CARGO_ENCODED_RUSTFLAGS !== undefined
  ? process.env.CARGO_ENCODED_RUSTFLAGS.split('\u001f').filter(Boolean)
  : (process.env.RUSTFLAGS ?? '').split(/\s+/).filter(Boolean)
const remapFlags = pathRemapping.flatMap(([from, to]) => {
  const absolute = resolve(from)
  return [...new Set([absolute, absolute.replaceAll('\\', '/')])]
    .map(prefix => `--remap-path-prefix=${prefix}=${to}`)
})
const cargoFlags = [
  'build', '--locked', '-p', 'kjcontour-wasm', '--target', 'wasm32-unknown-unknown', '--release',
]
const result = spawnSync(process.env.KJDRAW_CARGO ?? 'cargo', cargoFlags, {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: [...inheritedFlags, ...remapFlags].join('\u001f') },
})
if (result.status !== 0) {
  console.error('Install Rust 1.88+ and run: rustup target add wasm32-unknown-unknown')
  process.exit(result.status ?? 1)
}
const output = new URL('../packages/kjdraw-sdk/src/assets/kjcontour.wasm', import.meta.url)
const compiled = new URL('../runtime/kjcore-rs/target/wasm32-unknown-unknown/release/kjcontour_wasm.wasm', import.meta.url)
const compiledBytes = await readFile(compiled)
// Panic/source strings must not disclose a contributor's absolute Windows
// directories. Inspect ASCII and both UTF-16 alignments before distribution.
const encodings = [compiledBytes.toString('latin1')]
for (const offset of [0, 1]) {
  const aligned = compiledBytes.subarray(offset, compiledBytes.length - ((compiledBytes.length - offset) % 2))
  encodings.push(aligned.toString('utf16le'), Buffer.from(aligned).swap16().toString('utf16le'))
}
if (encodings.some(text => /[A-Za-z]:[\\/](?:[^\x00-\x1f\x7f]{2,})/.test(text))) {
  throw new Error('Compiled contour WASM contains an absolute Windows path; verify Rust path remapping before distribution')
}
await mkdir(new URL('.', output), { recursive: true })
await copyFile(compiled, output)
const sha256 = createHash('sha256').update(await readFile(output)).digest('hex')
const sourcePaths = [
  'runtime/kjcore-rs/Cargo.toml',
  'runtime/kjcore-rs/Cargo.lock',
  'runtime/kjcore-rs/crates/kjcontour-wasm/Cargo.toml',
  'runtime/kjcore-rs/crates/kjcontour-wasm/src/lib.rs',
  'scripts/build-contour-wasm.mjs',
]
const sources = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [
  path, createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex'),
])))
const licensesSha256 = createHash('sha256').update(await readFile(new URL('kjcontour-LICENSES.txt', output))).digest('hex')
await writeFile(new URL('kjcontour.provenance.json', output), `${JSON.stringify({
  schema: 'com.kanjie.kjdraw.contour-wasm-provenance',
  schemaVersion: 1,
  abiVersion: 1,
  source: 'runtime/kjcore-rs/crates/kjcontour-wasm',
  algorithm: { name: 'cavalier_contours', version: '0.9.0', license: 'MIT OR Apache-2.0' },
  target: 'wasm32-unknown-unknown',
  pathRemapping: { repository: '/kjdraw', cargoHome: '/cargo', rustupHome: '/rustup' },
  buildFlags: {
    cargo: cargoFlags,
    rustcTemplates: [
      '--remap-path-prefix=<repository>=/kjdraw',
      '--remap-path-prefix=<cargoHome>=/cargo',
      '--remap-path-prefix=<rustupHome>=/rustup',
    ],
    rustcFlagsEncoding: 'CARGO_ENCODED_RUSTFLAGS',
    inheritedRustFlagCount: inheritedFlags.length,
  },
  sources,
  licensesSha256,
  sha256,
}, null, 2)}\n`)
console.log('Rebuilt KJDraw contour WASM from locked public Rust sources.')
