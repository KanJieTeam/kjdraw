# MCP stdio client

```sh
npm install
npm run start
```

This host-owned client starts the packaged KJDraw MCP server, initializes JSON-RPC, verifies that `cad_propose_circles` is advertised, and requests one 5 mm-radius circle. The server writes new review candidates under `workspace/results`; it never overwrites the host drawing. Set `KJDRAW_STARTER_OUTPUT` to select another workspace.

The process exits with an error if initialization, tool discovery, candidate generation, or path policy fails. Use the [MCP integration guide](https://kanjieteam.github.io/kjdraw/docs/latest/mcp/) for desktop-client configuration and security boundaries.
