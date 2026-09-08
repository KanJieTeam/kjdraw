import type { KJCommandDefinition, KJDrawSDK, KJPluginManifest } from '../../../packages/kjdraw-sdk/src/index.js'

/** Minimal plugin entry: the host supplies the inspected manifest and grants. */
export function activateCenterMarker(
  sdk: KJDrawSDK,
  manifest: KJPluginManifest,
  grantedPermissions: readonly string[] = ['commands.register'],
) {
  const scope = sdk.createPluginScope(manifest, { grantedPermissions })
  const command = {
    id: 'KJ_MARK_CENTER',
    title: 'Add center marker',
    execute: ({ transaction }, args) => {
      const center = [Number(args.x ?? 0), Number(args.y ?? 0), Number(args.z ?? 0)] as const
      const radius = Number(args.radius ?? 5)
      return transaction.createEntity('CIRCLE', { center, radius })
    },
  } satisfies KJCommandDefinition
  scope.registerCommand(command)
  return scope
}
