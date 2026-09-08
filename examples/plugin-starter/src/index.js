// Generated from examples/plugin-starter/src/index.ts. Do not edit directly.
export function activateCenterMarker(sdk, manifest, grantedPermissions = [
    'commands.register'
]) {
    const scope = sdk.createPluginScope(manifest, {
        grantedPermissions
    });
    const command = {
        id: 'KJ_MARK_CENTER',
        title: 'Add center marker',
        execute: ({ transaction }, args)=>{
            const center = [
                Number(args.x ?? 0),
                Number(args.y ?? 0),
                Number(args.z ?? 0)
            ];
            const radius = Number(args.radius ?? 5);
            return transaction.createEntity('CIRCLE', {
                center,
                radius
            });
        }
    };
    scope.registerCommand(command);
    return scope;
}
