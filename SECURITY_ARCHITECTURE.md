# Security architecture

KJDraw separates CAD correctness from host authorization. The SDK validates document and command invariants; the embedding application owns users, permissions, secrets and network policy.

## Trust boundaries

- Treat DXF, KJD, KJP, plugins and provider responses as untrusted input.
- An Agent command is a proposal until the host binds confirmation to its exact arguments and expected document revision.
- A registered deployment provider is callable code, not an authorization grant.
- Remote providers must authenticate requests, isolate tenants, validate sizes and enforce their own retention policy.
- KJP path, hash and required-entry checks reduce package corruption risk; they do not make arbitrary embedded assets safe to execute.
- Browser examples make no external requests. A host must clearly disclose any configured server provider.

## Reporting

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Use synthetic drawings and remove credentials, customer information and proprietary assets before sharing a reproduction.

## Non-goals of the current preview

The command confirmation metadata is not a cryptographic signature, sandbox or identity system. Plugin manifests describe requested capability; a host must still enforce the grant. The public DXF adapter and experimental solid kernel are not certified safety systems.
