# API reference

The published [API reference](https://kanjieteam.github.io/kjdraw/docs/latest/api/) is generated from the exact TypeScript declaration files shipped by `@kanjieteam/kjdraw`. It is not a manually maintained list of selected APIs.

The reference includes the root package entry and every public subpath in `packages/kjdraw-sdk/package.json#exports`. Every exported symbol has a stable fragment identifier, and both the guide search and the API search include the generated symbol index. The page records the package version and a SHA-256 digest of its declaration inputs so a rendered reference can be tied back to its source.

## Update the reference

Run the declaration generator first, then generate the site:

```sh
npm run build:types
npm run build:docs
```

The generated files live under `docs/latest/api/`. Do not edit them directly. CI runs both generators in check mode and fails if a declaration, package export, deep link or search entry has drifted:

```sh
node scripts/build-declarations.mjs --check
node scripts/build-api-docs.mjs --check
```

`docs/latest/` always documents the package version recorded in the repository. A release tag freezes that exact source, declaration digest and documentation output; `latest` advances only when a newer release is promoted. This keeps links stable while making version provenance visible on every API page.

## 添加或删除公共 API

公共 API 以 TypeScript 源码及 `package.json#exports` 为准。修改源码后依次运行 `npm run build:types` 与 `npm run build:docs`；不要直接编辑生成的 API 页面。每个导出都会生成可复制的声明、稳定锚点和搜索索引，CI 会阻止遗漏或过期页面进入发布分支。
