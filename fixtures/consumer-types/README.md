# Packed-package TypeScript consumers

These fixtures are compiled only after `@kanjieteam/kjdraw` has been packed and installed into an isolated temporary project. They intentionally exercise three public consumption styles:

- `vanilla.ts` — framework-independent TypeScript;
- `react.tsx` — a hook plus a real JSX component;
- `vue.ts` — a lifecycle-aware composable.

`framework-shims.d.ts` supplies the smallest React and Vue **type surface** needed for this offline audit. It is not a framework runtime, it is not a substitute for either framework's official types, and it is not published with KJDraw. Real applications should install React or Vue and their normal type packages.

Run `node scripts/audits/verify-packed-package.mjs` from the repository root. The audit removes its temporary package, install and compiler project by default. Set `KJDRAW_KEEP_PACK_AUDIT=1` only while diagnosing a failure.
