# Multi-round CAD edit/history soak

This is a reproducible **local SDK guardrail**, not a language-model benchmark. It moves one LINE by an exact integer offset, checks its endpoints, undoes, checks the prior endpoints, redoes, and checks again on every round. At each checkpoint it checks the complete revision sequence and saves/reopens both KJD and DXF; KJD must retain the audit-log length and revision number. DXF is checked for geometry, not KJDraw history.

```sh
node scripts/benchmarks/multi-round-editor-soak.mjs --rounds 10000 --checkpoint-every 1000 --progress
```

The script needs Node.js 22+, makes no network or model calls, writes no drawing files, and prints machine-readable JSON. `--rounds` is bounded to 1–10,000. On the local Windows / Node 22.18 host used during development, the original implementation passed 1,000 rounds in about 16.4 s with a sampled RSS peak near 3,006 MiB, then ran out of V8 heap near 4 GiB during the 10,000-round attempt. Each undo entry had retained its own growing copy of the full revision trail; undo/redo also deep-cloned that trail on every round.

After keeping the audit trail only in the current document and shallow-copying its immutable records for a new revision, the strengthened 10,000-round run completed in **13.1 s**, with **30,001 sequential revisions**, ten KJD/DXF reopen checkpoints and a sampled RSS peak of **349 MiB**. These are diagnostic measurements on one host, not a cross-machine speed or memory guarantee. A standalone post-fix 1,000-round run without the additional audit checks took about 0.8 s and peaked near 128 MiB; the differing checks mean these times are not a strictly controlled public speed comparison.

This fixture deliberately contains just one line. It proves neither professional sheet quality nor that an AI model stays correct across 10,000 prompts, and says nothing about token use. The separate [DeepSeek studies](deepseek-2026-09-28.md) cover actual model calls, with both successful and negative results.
