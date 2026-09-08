# Deployment model

KJDraw is deployment-neutral. The SDK does not require a server, but it also does not prevent a host from adding authenticated storage, remote compute or streamed scenes.

## Supported profiles

| Profile | Typical authority | Typical use |
| --- | --- | --- |
| `browser-local` | KJP file or browser storage | Zero-install tools and offline review |
| `desktop-local` | Application-managed project file | Desktop engineering applications |
| `self-hosted` | Organization-selected providers | Private networks and regulated environments |
| `cloud-assisted` | Host-selected remote provider | Managed compute, conversion or collaboration |
| `hybrid` | Explicit local and remote providers | Local editing with selected server acceleration |

The host chooses the project authority. Registration never initiates network access; only the host decides when a provider method is called.

## Provider contracts

KJDraw exposes three small host-facing provider contracts:

- `project-store`: `loadProject()` and `saveProject()`.
- `compute`: `execute()`.
- `scene`: `openScene()` and `queryViewport()`.

```js
import {
  KJDeploymentRegistry,
  KJ_PROVIDER_TYPES,
  createDeploymentProfile,
  validateDeploymentProfile,
} from '@kanjieteam/kjdraw/deployment'

const providers = new KJDeploymentRegistry()
providers.register(KJ_PROVIDER_TYPES.PROJECT_STORE, {
  id: 'acme.projects',
  locality: 'self-hosted',
  loadProject: id => projectApi.load(id),
  saveProject: (id, bytes) => projectApi.save(id, bytes),
})

const deployment = validateDeploymentProfile(createDeploymentProfile({
  mode: 'self-hosted',
  providers: { 'project-store': 'acme.projects' },
}), providers)
```

Authentication, authorization, encryption, tenancy and billing remain host responsibilities. Provider registration is capability wiring, not a security boundary. See [Security architecture](../SECURITY_ARCHITECTURE.md) and the runnable [provider example](../examples/deployment-providers.mjs).
