# Live-model unit fixes — 2026-09-09

## Changes driven by actual model calls

- Session tool schemas declare the current drawing unit as an enum. Incorrect abbreviations are rejected with the canonical name; coordinates are never silently rescaled.
- Modern DXF export writes `$INSUNITS` and `$MEASUREMENT`. Import reads them independently. Missing insertion units remain unitless; unsupported codes/names fail explicitly.
- Legacy R12/R14 export still does not carry the modern insertion-unit header. This change does not promise unit preservation for those targets.
- Public, opt-in paired benchmark helpers and raw usage records are included. The private application configuration/key bridge is excluded.
- CI runs the independent ezdxf drawing self-test without making model requests.

## Verification

- Node 24 and Node 22 complete suites: **343/343 each**, including isolated npm installation and typed consumers.
- Strict TypeScript, generated runtime/declarations/docs/API, repository checks and whitespace checks pass.
- Independent ezdxf 1.4.4 self-test: mounting profile, flange and stepped profile all have correct geometry and units, with zero audit errors/fixes.
- The earlier mixed-drawing slice passed 21 browser checks. No new full-browser acceptance is claimed for this core/unit-only increment.
- Two live exploratory rounds, six requests each, using the system-configured DeepSeek V4 Flash connection. No customer data was sent. No npm version or stable tag was published.

See the [full benchmark report](../benchmarks/deepseek-pilot-2026-09-09/README.md). The second round passed 3/3 KJDraw drawings versus 1/3 direct-DXF drawings, but used more total tokens and did not show a speed advantage. Small exploratory results are not a general superiority claim.
