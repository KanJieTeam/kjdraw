# Raw evidence for the 2026-09-29 DeepSeek Flash one-shot study

The three one-shot ZIPs each contain 30 saved requests and sanitized responses, plus generated DXFs, `report.json`, and independent `replay-report.json`. The complete manufacturing ZIPs contain four and eight paired requests respectively. The interrupted 30-task attempt stopped after six dispatches on HTTP 402 and records 54 unexecuted requests; it is not a complete sample. All ZIPs retain their reports and saved request/response/DXF files where available. A failed or invalid DXF remains a failure; it was not fixed before replay. The key is not stored in the archives. Verify the archive digest before inspection.

| Archive | Meaning | SHA-256 |
| --- | --- | --- |
| `oneshot-json-repeat-a.zip` | Original provider-only timing, 15 KJDraw and 15 direct requests | `59aa6012417178113b947a4afba7814d1800f982c5c6eb976da68dc87c53af29` |
| `oneshot-json-spawn-timing.zip` | Added end-to-end timing; fresh Node process per KJDraw result | `1d9d998e28478f83b33f1c3444ee49151557ea4924a7004fa441e35e629db299` |
| `oneshot-json-persistent-timing.zip` | Persistent Node host, fresh KJDraw document per result | `1abc125594122b357987064e2bbb92601f2a2edc3bd977370d4577da6b4729e2` |
| `manufacturing-two-task-v1.0.1.zip` | Two versioned manufacturing tasks, four paired requests after the prompt/scorer correction | `7929dbf664cf59de1ea79f48f8eeb1bac594227f526818bbb8acb32c3e0ef75e` |
| `manufacturing-four-task-v1.0.1.zip` | Disjoint A2, A1 and A0 tasks, eight paired requests with malformed direct-DXF cases preserved | `9f75e98f2c4e7c5955bb3fc229c2401b302a425fb463307de493a2d826a363f1` |
| `manufacturing-full-stopped-http402.zip` | Full-suite attempt stopped at request 6 by HTTP 402; 54 requests unexecuted | `17cb42d8deb977458501a3081e322a793e195fba9964cff393ab4b383683d43c` |

The second run is slower end-to-end on KJDraw and is included deliberately. The [study](../../deepseek-2026-09-29.md) explains scope, timing and limitations.
