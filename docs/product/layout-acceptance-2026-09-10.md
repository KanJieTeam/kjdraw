# DXF layout identity and ownership acceptance

Date: 2026-09-10. Source increment following `4ce2911`; accepted source is the commit containing this record. Package publication and stable 1.0 remain pending.

The former import inferred sheets only from populated entity hints and introduced unlinked space blocks. Import now reads LAYOUT records, their subclass-specific owners and block-record links, preserves empty sheets and sparse tab order, and resolves old/noncontinuous space blocks without OBJECTS or 410 hints. Reactor references are not treated as owners. Conflicting layout identities and ambiguous owners reject the import. Exact cross-section copies import once; the existing same-section duplicate-handle recovery remains intact.

DXF 2000+ writes the layout dictionary, LAYOUT objects and reciprocal block links. Independent testing found that putting all paper entities in ENTITIES assigns additional-sheet geometry to the primary sheet in other readers. Non-primary sheets now carry their entities in BLOCKS. R12/R14 exports reject multiple paper layouts, including empty ones, rather than silently losing their identity.

Validation:

- Node 22 and Node 24 full suites: **366/366 each**, including isolated JavaScript, TypeScript, React and Vue package consumers. The final old-version empty-layout guard also passes the 9 focused layout/handle tests.
- Chrome 152 (system executable), Firefox 155 / Playwright revision 1543, WebKit 26.6 / revision 2359: **27/27** editor and framework browser cases. The new editor case creates populated and empty sheets, moves a paper entity, undoes/redoes, saves DXF and reopens through the public editor API.
- Bidirectional ezdxf **1.4.4**: synthetic named/empty sheets, sparse tab orders, exact paper LINE endpoints and ownership; zero audit errors or fixes. Existing style, curve, dimension and hatch checks remain active.
- Six private local files: layout counts **3/3, 3/3, 2/2, 2/2, 2/2, 2/2** before/after; every output has zero audit errors/fixes, including no new code 109. Entity-type counts, model counts, units and text multisets match. All original hashes are unchanged. Five LINE-bearing files also pass Agent preview, host approval, exact move, unchanged-other-entity checks, undo and redo; the sixth has no LINE.
- Generated runtime/declaration checks, strict types, bilingual docs generation, repository release checks and whitespace checks pass.

The initial full runs exposed overbroad duplicate-handle rejection; that regression was corrected without weakening the pre-existing tests. Browser runtime download failures were resolved with the system Chrome and installed Firefox/WebKit. Earlier failed runs are not counted as passes.

This is layout identity and ownership acceptance, **not paper/plot/viewport fidelity**. Exported default limits are still 420 × 297; full PLOTSETTINGS, print scale and viewport behavior remain unfinished. Six private cases do not establish arbitrary-DXF fidelity, and their source files, coordinates, text and screenshots are not included here. No downstream private Kanjie UI acceptance or npm publication is claimed.
