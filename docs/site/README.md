# KJDraw documentation source

`docs/site/pages/*.md` is the hand-edited source for the versioned developer portal. `docs/site/api/editor-api.json` supplies the task-oriented Editor API tables and examples. `docs/latest/` is generated output and must not be edited directly; the complete declaration-driven reference is generated under `docs/latest/api/reference/`.

Each page has small frontmatter and exactly two locale blocks:

```md
---
slug: example
title.en: Example
title.zh: 示例
summary.en: One-sentence English summary.
summary.zh: 一句中文摘要。
---
:::en
## Stable section title {#stable-anchor}
English Markdown.
:::
:::zh
## 稳定小节标题 {#stable-anchor}
中文 Markdown。
:::
```

Every heading must carry an explicit lowercase `{#stable-anchor}`. The generator prefixes it with the locale and page slug, producing stable, unique deep links. Keep both locale blocks structurally equivalent, but write natural language rather than line-by-line literal translations.

To add a page, add its source file and place its slug once in `navigation.json`. When the high-level editor surface changes, update `api/editor-api.json`; its documented names are validated against `types/editor.d.ts`. Then run:

```sh
npm run build:docs
npm test
```

CI runs both generators in `--check` mode, so source, navigation, search indexes, page routes and package declarations cannot drift unnoticed.
