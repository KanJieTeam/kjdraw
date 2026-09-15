# Mutation acceptance

A successful MCP proposal is not an accepted drawing. Report it as **waiting for host review** unless a separate host receipt proves all required stages.

For a releasable candidate, require host evidence for:

1. the reviewed proposal was applied as one transaction at the expected source revision;
2. geometry, layers, references, and requested measurements passed deterministic checks;
3. new KJD and DXF artifacts were written without overwriting the source;
4. both formats reopened successfully, with the relevant entity and relationship checks repeated;
5. undo removed the accepted transaction and redo restored it;
6. source identity, selected knowledge-pack identity, candidate hashes, tool-call count, elapsed time, and model token evidence are retained when the workflow claims them.

If any item lacks evidence, name the missing item. Do not infer it from a preview, tool success flag, screenshot, or model statement. A visual comparison can supplement these checks but cannot replace native geometry and reopen evidence.
