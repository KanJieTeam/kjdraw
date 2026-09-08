# Packed npm consumption gate

KJDraw's consumer gate validates the artifact users actually install, not the workspace source tree.

`node scripts/audits/verify-packed-package.mjs` performs one disposable end-to-end audit:

1. runs `npm pack` for `packages/kjdraw-sdk`;
2. installs that exact tarball into an isolated project with lifecycle scripts disabled;
3. imports the package root and every declared public ESM subpath;
4. runs the quickstart shipped inside the installed package and checks the reopened geometry;
5. compiles Vanilla TypeScript, React TSX and a Vue composable against the installed artifact using the repository's pinned TypeScript compiler;
6. deletes the tarball, install and compiler project.

The React and Vue audit fixtures use deliberately minimal, compile-only framework declarations so the package gate remains offline and deterministic. Those declarations are neither framework runtimes nor replacements for the official React/Vue type packages. They only isolate whether KJDraw's declarations compose correctly at the package boundary.

Any missing entry point, empty ESM namespace, runtime dependency, type error, or quickstart regression fails the gate. This makes the check suitable for release CI and for the 1.0 acceptance evidence.
