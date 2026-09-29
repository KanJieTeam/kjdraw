# A first domain planner

This small, source-open example turns five explicit mechanical facts into six editable CAD circles. It is **not** a model integration, a production-certified flange generator, or an Agent tool automatically available to every client.

1. Start with [planner.mjs](planner.mjs): validate units and ranges, reject intersecting holes, and return CAD intent without reading global state.
2. In [plugin.mjs](plugin.mjs), register one command through the public SDK plugin scope. The host must inspect the [manifest](kjdraw.plugin.json) and grant `commands.register`; one command is one undoable transaction.
3. Run `node --test tests/domain-planner-starter.spec.mjs` from the repository root. It checks invalid facts, six entities, one revision, undo/redo, and KJD/DXF reopen.
4. Copy the pattern into a separate package for a new domain. Add a documented input schema, bounded output, synthetic fixtures, a failure case, and a host-controlled proposal/review adapter before exposing it to an AI agent. Do not have the model invent measurements or self-approve a command.

The example imports no private engine module. The repository test supplies the public SDK to the plugin. Existing co-shipped planners remain available; this example is the contribution seam for future separate packages, not an API-breaking extraction.
