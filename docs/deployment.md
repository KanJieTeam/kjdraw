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

## Connect the local editor to a model

The development server can provide a same-origin `POST /api/model` transport for the editor's AI conversation. Set `KJDRAW_MODEL_PROTOCOL`, `KJDRAW_MODEL_NAME`, `KJDRAW_MODEL_ENDPOINT` and, for a remote provider, `KJDRAW_MODEL_API_KEY` in the server environment before `npm run dev`. The endpoint is the complete provider operation URL; use your provider's supported protocol and model. Supported wire formats are `responses`, `chat-completions`, `anthropic-messages` and `gemini-generate-content`. Gemini's model belongs in the configured endpoint URL.

For example, with a locally running OpenAI-compatible model server, use PowerShell:

```powershell
$env:KJDRAW_MODEL_PROTOCOL = 'chat-completions'
$env:KJDRAW_MODEL_NAME = 'your-installed-model'
$env:KJDRAW_MODEL_ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions'
npm run dev
```

Open `http://localhost:4173`, choose the same protocol and model in the AI connection settings, and enter `/api/model` as the endpoint. For a remote provider, load the API key into the server environment through your secret manager or shell; never paste it into the editor. Sending a request shares the prompt and the task's selected drawing context with that provider. Provider compatibility still requires testing the actual model.

This optional proxy binds through the existing loopback-only development server and accepts matching browser origins only. It fixes the upstream endpoint and model at startup, keeps credentials on the server, rejects redirects and streaming requests, limits request and decoded response bodies to 1 MiB, caps each request at 16,384 output tokens, and cancels on disconnect or after 60 seconds. Provider error bodies and headers are not exposed. With no model environment configuration, the server remains a static editor server. A hosted deployment must supply its own authenticated, authorized gateway rather than expose this local development transport.
