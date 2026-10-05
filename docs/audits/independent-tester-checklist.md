# KJDraw 1.0 candidate: independent tester checklist

This checklist collects reproducible defects and independent acceptance evidence. It does **not** mean KJDraw has reached stable 1.0. The tester must not have contributed to the candidate. Use a clean project and public instructions without live maintainer guidance.

## Before starting

- Record the full candidate Git SHA, package version, installation source (npm or candidate tarball), and the package file's SHA-256.
- Record the operating system and version, Node.js version, agent client/model if used, and interface language. Never send API keys.
- Keep the original prompt and start/end time for each task. Capture the exact error and a safe screenshot if a task fails.

## Five common tasks

1. From a blank drawing, create a simple mechanical part with a hole and add a diameter or length dimension. Importing a finished drawing is not a substitute.
2. From a separate blank drawing, create a geological borehole log or section. If no measured data was supplied, the drawing itself must say that it is illustrative and not measured. Inspect the text, elevations, depth lines, and strata hatches.
3. Select an existing object in either drawing and change one explicit dimension or position. Undo and redo the edit, then check the final geometric fact.
4. Save KJD and export DXF; reopen both. Independently measure at least one named fact, such as “hole diameter 10 mm” or “borehole depth 30 m”. A screenshot alone is insufficient.
5. Record whether the interactive preview opens and supports zoom and selection, elapsed time, errors, and font problems. Retain the KJD, DXF, and screenshots privately; do not post private project drawings, reports, coordinates, or personal information.

## Reporting

For each task, report pass/fail and exact reproduction steps. Formal independent acceptance also needs the package, KJD, and DXF SHA-256 values, environment, task ID, named geometry check, and independence declaration. The maintainer verifies the report and file bytes using the [external acceptance protocol](external-acceptance.md). A public GitHub issue helps triage a defect but is not itself a stable-release pass.

The separate three-model gate requires real runs with three vendors (at least two domestic vendors) on at least two operating systems, using the versioned 30-case suite with at least five rounds per model. See the [three-model holdout protocol](three-model-holdout.md). One successful user or social-media screenshot cannot replace that evidence.
