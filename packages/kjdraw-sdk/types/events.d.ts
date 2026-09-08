export type KJEventListener<Payload> = (payload: Payload) => void;
export interface KJEventSubscriptionOptions {
    signal?: AbortSignal;
}
/** A synchronous, strongly typed event bus. Listener order matches registration order. */
export declare class KJEventBus<Events extends object = Record<PropertyKey, unknown>> {
    #private;
    on<Name extends keyof Events>(name: Name, listener: KJEventListener<Events[Name]>, { signal }?: KJEventSubscriptionOptions): () => boolean;
    once<Name extends keyof Events>(name: Name, listener: KJEventListener<Events[Name]>, options?: KJEventSubscriptionOptions): () => boolean;
    off<Name extends keyof Events>(name: Name, listener: KJEventListener<Events[Name]>): boolean;
    emit<Name extends keyof Events>(name: Name, payload: Events[Name]): void;
    clear(): void;
}
