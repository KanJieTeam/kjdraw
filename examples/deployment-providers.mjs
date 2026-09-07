import {
  KJDeploymentRegistry,
  KJ_PROVIDER_TYPES,
  createDeploymentProfile,
  validateDeploymentProfile,
} from '../packages/kjdraw-sdk/src/index.js'

const projects = new Map()
const registry = new KJDeploymentRegistry()

registry.register(KJ_PROVIDER_TYPES.PROJECT_STORE, {
  id: 'example.memory-projects',
  locality: 'process-local',
  async loadProject(id) { return projects.get(id) ?? null },
  async saveProject(id, bytes) { projects.set(id, bytes); return { id, byteLength: bytes.byteLength } },
})

const profile = validateDeploymentProfile(createDeploymentProfile({
  mode: 'hybrid',
  projectAuthority: 'example.memory-projects',
  providers: { [KJ_PROVIDER_TYPES.PROJECT_STORE]: 'example.memory-projects' },
}), registry)

console.log(JSON.stringify(profile, null, 2))
