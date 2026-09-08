# KJDraw TypeScript plugin starter

This starter adds one transactional `KJ_MARK_CENTER` command through the same public permission and contribution contract used by every plugin.

1. Copy this directory and give the manifest a stable lowercase `id`.
2. Declare every contribution and permission before activation.
3. Import types from `@kanjieteam/kjdraw` in an external project.
4. Keep drawing changes inside commands so validation, revisions, receipts and undo remain intact.
5. Run `node scripts/audits/plugin-starter.mjs` in this repository to exercise compatibility, grants, activation, execution and disposal.

Plugin permissions are cooperative declarations. Run untrusted third-party code in a host-owned Worker, process or sandbox; the SDK does not claim process isolation.
