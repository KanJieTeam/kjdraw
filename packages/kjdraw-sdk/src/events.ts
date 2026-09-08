export type KJEventListener<Payload> = (payload: Payload) => void
export interface KJEventSubscriptionOptions { signal?: AbortSignal }

type StoredEventListener = (payload: never) => void

/** A synchronous, strongly typed event bus. Listener order matches registration order. */
export class KJEventBus<Events extends object = Record<PropertyKey, unknown>> {
  #listeners = new Map<keyof Events, Set<StoredEventListener>>()

  on<Name extends keyof Events>(
    name: Name,
    listener: KJEventListener<Events[Name]>,
    { signal }: KJEventSubscriptionOptions = {},
  ): () => boolean {
    if (typeof listener !== 'function') throw new TypeError('Event listener must be a function')
    const listeners = this.#listeners.get(name) ?? new Set<StoredEventListener>()
    listeners.add(listener as StoredEventListener)
    this.#listeners.set(name, listeners)
    const off = (): boolean => this.off(name, listener)
    if (signal) {
      if (signal.aborted) off()
      else signal.addEventListener('abort', off, { once: true })
    }
    return off
  }

  once<Name extends keyof Events>(
    name: Name,
    listener: KJEventListener<Events[Name]>,
    options: KJEventSubscriptionOptions = {},
  ): () => boolean {
    let off = (): boolean => false
    off = this.on(name, payload => {
      off()
      listener(payload)
    }, options)
    return off
  }

  off<Name extends keyof Events>(name: Name, listener: KJEventListener<Events[Name]>): boolean {
    const listeners = this.#listeners.get(name)
    if (!listeners) return false
    const removed = listeners.delete(listener as StoredEventListener)
    if (!listeners.size) this.#listeners.delete(name)
    return removed
  }

  emit<Name extends keyof Events>(name: Name, payload: Events[Name]): void {
    for (const listener of [...(this.#listeners.get(name) ?? [])]) {
      ;(listener as KJEventListener<Events[Name]>)(payload)
    }
  }

  clear(): void {
    this.#listeners.clear()
  }
}

