// Compile-only framework shims for the packed-package audit.
// They prove KJDraw's public types compose with framework-shaped APIs without
// downloading React or Vue. They are not framework runtimes and are never
// included in the published @kanjieteam/kjdraw package.

declare module 'react' {
  export interface MutableRefObject<T> { current: T }
  export function useRef<T>(initialValue: T): MutableRefObject<T>
  export function useState<T>(initialValue: T): [T, (value: T) => void]
  export function useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void
}

declare module 'react/jsx-runtime' {
  export namespace JSX {
    interface Element { readonly __jsxElementBrand?: never }
    interface IntrinsicElements {
      button: {
        children?: unknown
        onClick?: () => void
        type?: 'button' | 'submit' | 'reset'
      }
    }
  }
  export function jsx(type: unknown, props: unknown, key?: unknown): JSX.Element
  export function jsxs(type: unknown, props: unknown, key?: unknown): JSX.Element
  export const Fragment: unique symbol
}

declare module 'vue' {
  export interface Ref<T> { value: T }
  export interface ShallowRef<T> extends Ref<T> {}
  export function ref<T>(value: T): Ref<T>
  export function shallowRef<T>(value: T): ShallowRef<T>
  export function onScopeDispose(cleanup: () => void): void
}
