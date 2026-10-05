import { planBoltCircle } from './planner.mjs'

// Only a host that trusts this plugin grants registration and executes its command.
// An AI client must still use the separate proposal/review workflow.
export function activateBoltCirclePlanner(sdk, manifest) {
  const scope = sdk.createPluginScope(manifest, { grantedPermissions: ['commands.register'] })
  scope.registerCommand({
    id: 'COMMUNITY_BOLT_CIRCLE',
    title: 'Create a checked bolt-hole circle',
    execute: ({ transaction }, facts) => {
      const holes = planBoltCircle(facts)
      return holes.map((hole) => transaction.createEntity('CIRCLE', hole))
    },
  })
  return scope
}
