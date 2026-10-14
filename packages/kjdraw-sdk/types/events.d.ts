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
    /** Deliver every listener and collect synchronous exceptions for notifications
     * whose underlying operation has already succeeded. Strict emit remains unchanged. */
    emitSafely<Name extends keyof Events>(name: Name, payload: Events[Name]): unknown[];
    clear(): void;
}
