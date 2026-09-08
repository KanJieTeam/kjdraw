# Security

Report vulnerabilities privately to **kanjieteam@163.com** with reproduction steps and the affected version. Do not attach confidential engineering drawings; provide a synthetic reproduction where possible. Avoid publicly disclosing exploit details until a coordinated fix or agreed disclosure date.

Maintainers target acknowledgement within three business days, severity assessment within seven calendar days and a remediation plan for confirmed critical issues within fourteen calendar days. These are open-source response targets, not a commercial SLA. If a target cannot be met, the reporter receives a status update and revised date.

Security fixes target the latest stable `1.x` patch and, while 1.0 is being evaluated, the latest release candidate. Older previews receive best-effort fixes. Advisories identify affected versions, mitigations and fixed versions; credit is offered unless the reporter prefers anonymity.

Treat imported CAD files, project packages and third-party plugins as untrusted. Enforce host-configured byte, object and expansion limits. Plugin permission declarations are host cooperation mechanisms, not process isolation. Agent plan bindings prove reviewed content only within their documented trust model; applications remain responsible for identity, authorization, durable audit storage, secret management and isolation.

See [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) for trust boundaries and [SUPPORT.md](SUPPORT.md) for supported release lines.
