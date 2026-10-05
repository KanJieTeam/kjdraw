# KJDraw starter projects

These small projects are maintained as executable consumers of the public package. Copy one directory, run `npm install`, then use the command in its README.

| Starter | Use it for | Verified command |
| --- | --- | --- |
| [`node-typescript`](./node-typescript/) | Headless KJD/DXF generation and reopen validation | `npm run start` |
| [`mcp-client`](./mcp-client/) | A host-owned stdio MCP client and a reviewable circle candidate | `npm run start` |
| [`vanilla-browser`](./vanilla-browser/) | A complete editor in a Vite TypeScript app | `npm run build` |
| [`react-browser`](./react-browser/) | A complete editor through the React package entry | `npm run build` |
| [`vue-browser`](./vue-browser/) | A complete editor through the Vue package entry | `npm run build` |

Node.js 22 or newer is required. The examples use the `next` release channel so that they follow the current release candidate. Replace `next` with an exact version for reproducible application builds.

The repository test `packages/kjdraw-sdk/test/starter-projects.test.mjs` type-checks every starter, bundles all browser entries, runs the headless generator, and launches the MCP server for a real JSON-RPC proposal call.
