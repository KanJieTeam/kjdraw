# Independent 1.0 candidate acceptance

For a shareable Chinese tester handout, see [独立试用清单](independent-tester-checklist.zh-CN.md).

This is a release gate, not a maintainer smoke test. A tester who did not contribute to the candidate uses a clean project, the candidate package artifact, and only the published instructions. The maintainer must not guide the tester during the run. A source checkout, a preview image, or a saved file without an edit/reopen cycle does not pass.

The tester should start with a blank drawing, create and modify editable geometry, exercise undo/redo, save and reopen KJD, export DXF, and check at least one named geometric fact independently. Record the package tarball, KJD and DXF SHA-256 values, environment, task ID, and explicit pass/fail attestations in a JSON report matching `scripts/audits/external-acceptance-evidence.mjs`. Keep source drawings and personal details outside the repository; use an opaque tester ID.

After receiving the report and its three artifacts, record it against the exact candidate commit:

```sh
node scripts/audits/record-external-acceptance.mjs --input=report.json --artifact=candidate.tgz --kjd=drawing.kjd --dxf=drawing.dxf
node scripts/audits/release-readiness.mjs
```

The recorder fails if an attestation is missing or any artifact bytes differ from the reported hashes. It does not infer tester independence or geometric correctness from a checkbox: those are claims the independent tester must actually verify. Evidence is written under ignored `.cache/release-evidence/` and must be regenerated when the candidate commit changes. Do not commit private drawing artifacts or reports containing identifying information.
