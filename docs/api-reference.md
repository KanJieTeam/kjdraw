# API documentation

The documentation has two API layers:

- [Editor API](https://kanjieteam.github.io/kjdraw/docs/latest/api/) is the recommended application entry. It explains `createKJDrawEditor()`, options, properties, methods, events, and the React/Vue components with complete short examples.
- [Complete TypeScript reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/reference/) contains the declaration for every root and subpath export. Every symbol has a stable, searchable deep link.

The Editor API content is maintained in `docs/site/api/editor-api.json`. The generator verifies its documented options, methods, properties, and events against `packages/kjdraw-sdk/types/editor.d.ts`, so an API rename cannot silently leave the guide behind. The complete reference and search index are generated directly from the declarations shipped in the package.

## Update the reference

Run the declaration generator first, then generate the guide portal and API reference:

```sh
npm run build:types
npm run build:docs
```

The hand-edited guide source lives under `docs/site/`; the complete portal is generated into `docs/latest/`. Do not edit the generated destination directly. CI runs all generators in check mode and fails if a guide route, translation, Editor API row, package export, deep link, or search entry has drifted:

```sh
node scripts/build-declarations.mjs --check
node scripts/build-docs-site.mjs --check
node scripts/build-api-docs.mjs --check
```

Old declaration links in the form `/api/#symbol-anchor` redirect to `/api/reference/#symbol-anchor`. New links should use the canonical `/api/reference/` route.

## 添加或删除公共 API

推荐入口的内容源是 `docs/site/api/editor-api.json`，完整 API 则以 TypeScript 源码及 `package.json#exports` 为准。修改后依次运行 `npm run build:types` 与 `npm run build:docs`；不要直接编辑 `docs/latest/` 生成产物。每个 Editor API 条目、指南标题和包导出都有稳定锚点并进入搜索索引，CI 会阻止遗漏或过期页面进入发布分支。
