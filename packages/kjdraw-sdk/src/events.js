export class KJEventBus {
  #listeners = new Map()

  on(name, listener, { signal } = {}) {
    if (typeof listener !== 'function') throw new TypeError('Event listener must be a function')
    const listeners = this.#listeners.get(name) ?? new Set()
    listeners.add(listener)
    this.#listeners.set(name, listeners)
    const off = () => this.off(name, listener)
    if (signal) {
      if (signal.aborted) off()
      else signal.addEventListener('abort', off, { once: true })
    }
    return off
  }

  once(name, listener, options = {}) {
    let off = () => {}
    off = this.on(name, payload => { off(); listener(payload) }, options)
    return off
  }

  off(name, listener) {
    const listeners = this.#listeners.get(name)
    if (!listeners) return false
    const removed = listeners.delete(listener)
    if (!listeners.size) this.#listeners.delete(name)
    return removed
  }

  emit(name, payload) {
    for (const listener of [...(this.#listeners.get(name) ?? [])]) listener(payload)
  }

  clear() { this.#listeners.clear() }
}
