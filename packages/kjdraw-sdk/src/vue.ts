import {
  defineComponent,
  h,
  onMounted,
  onScopeDispose,
  shallowRef,
  watch,
  type PropType,
} from 'vue'
import {
  createKJDrawEditor,
  type KJDrawEditor,
  type KJDrawEditorOptions,
  type KJDrawEditorSaveOptions,
  type KJDrawEditorSelectionEvent,
} from './editor.js'
import type { KJDocument } from './document.js'
import type { KJDrawSDK, KJSDKCommandEnvelopeReceipt } from './sdk.js'
import type { KJCommandArguments } from './commands.js'
import type { KJDrawWorkbenchChange, KJWorkbenchLocale, KJWorkbenchOpenOptions, KJWorkbenchTheme } from './workbench.js'

export type {
  KJDrawEditor,
  KJDrawEditorEvents,
  KJDrawEditorOptions,
  KJDrawEditorSaveOptions,
  KJDrawEditorSelectionEvent,
} from './editor.js'

export interface KJDrawExposed {
  readonly instance: KJDrawEditor | null
  readonly ready: Promise<KJDrawEditor> | null
  open(source: Blob | string | ArrayBuffer | ArrayBufferView, options?: KJWorkbenchOpenOptions): Promise<KJDocument>
  save(options?: KJDrawEditorSaveOptions): Promise<string | Uint8Array>
  fit(): KJDrawEditor
  undo(): Promise<KJSDKCommandEnvelopeReceipt>
  redo(): Promise<KJSDKCommandEnvelopeReceipt>
  execute<TResult = unknown>(command: string, args?: KJCommandArguments): Promise<KJSDKCommandEnvelopeReceipt<TResult>>
  setDocument(document: KJDocument): Promise<KJDrawEditor>
  setTheme(theme: KJWorkbenchTheme): KJDrawEditor
  setLocale(locale: KJWorkbenchLocale): KJDrawEditor
  setSelection(ids: readonly string[]): Promise<readonly string[]>
  getSelection(): readonly string[]
  setOptions(options: Parameters<KJDrawEditor['setOptions']>[0]): KJDrawEditor
  setTitle(title: string): KJDrawEditor
  on: KJDrawEditor['on']
  dispose(): void
}

/** A lifecycle-safe KJDraw editor component for Vue. */
export const KJDraw = defineComponent({
  name: 'KJDraw',
  inheritAttrs: false,
  props: {
    document: { type: [Object, String] as PropType<KJDocument | 'sample' | 'blank' | null>, default: 'sample' },
    sdk: { type: Object as PropType<KJDrawSDK>, default: undefined },
    locale: { type: String as PropType<KJWorkbenchLocale>, default: 'en' },
    theme: { type: String as PropType<KJWorkbenchTheme>, default: 'dark' },
    readonly: { type: Boolean, default: false },
    grid: { type: Boolean, default: true },
    toolbar: { type: Boolean, default: true },
    layers: { type: Boolean, default: true },
    properties: { type: Boolean, default: true },
    title: { type: String, default: undefined },
    maxFileBytes: { type: Number, default: undefined },
    onReady: { type: Function as PropType<(editor: KJDrawEditor) => void>, default: undefined },
    onChange: { type: Function as PropType<(event: KJDrawWorkbenchChange) => void>, default: undefined },
    onSelectionChange: { type: Function as PropType<(event: KJDrawEditorSelectionEvent) => void>, default: undefined },
    onError: { type: Function as PropType<(error: unknown) => void>, default: undefined },
  },
  setup(props, { attrs, expose }) {
    const container = shallowRef<HTMLElement | null>(null)
    const editor = shallowRef<KJDrawEditor | null>(null)

    const requireEditor = (): KJDrawEditor => {
      if (!editor.value) throw new Error('KJDraw is not mounted yet')
      return editor.value
    }

    const dispose = (): void => {
      editor.value?.dispose()
      editor.value = null
    }

    const mount = (): void => {
      if (!container.value) return
      dispose()
      const options: KJDrawEditorOptions = {
        document: props.document,
        ...(props.sdk === undefined ? {} : { sdk: props.sdk }),
        locale: props.locale,
        theme: props.theme,
        readonly: props.readonly,
        grid: props.grid,
        toolbar: props.toolbar,
        layers: props.layers,
        properties: props.properties,
        ...(props.title === undefined ? {} : { title: props.title }),
        ...(props.maxFileBytes === undefined ? {} : { maxFileBytes: props.maxFileBytes }),
        onReady: instance => props.onReady?.(instance),
        onChange: event => props.onChange?.(event),
        onSelectionChange: event => props.onSelectionChange?.(event),
        onError: error => props.onError?.(error),
      }
      editor.value = createKJDrawEditor(container.value, options)
    }

    const exposed: KJDrawExposed = {
      get instance() { return editor.value },
      get ready() { return editor.value?.ready ?? null },
      open: (...args) => requireEditor().open(...args),
      save: (...args) => requireEditor().save(...args),
      fit: () => requireEditor().fit(),
      undo: () => requireEditor().undo(),
      redo: () => requireEditor().redo(),
      execute: ((...args: Parameters<KJDrawEditor['execute']>) => requireEditor().execute(...args)) as KJDrawEditor['execute'],
      setDocument: drawing => requireEditor().setDocument(drawing),
      setTheme: value => requireEditor().setTheme(value),
      setLocale: value => requireEditor().setLocale(value),
      setSelection: ids => requireEditor().setSelection(ids),
      getSelection: () => requireEditor().getSelection(),
      setOptions: options => requireEditor().setOptions(options),
      setTitle: value => requireEditor().setTitle(value),
      on: ((...args: Parameters<KJDrawEditor['on']>) => requireEditor().on(...args)) as KJDrawEditor['on'],
      dispose,
    }
    expose(exposed)

    onMounted(mount)
    onScopeDispose(dispose)

    watch(
      [() => props.sdk, () => props.document] as const,
      ([nextSdk, drawing], [previousSdk]) => {
        if (nextSdk !== previousSdk || !drawing || typeof drawing !== 'object') mount()
        else if (editor.value) void editor.value.setDocument(drawing).catch(() => {})
      },
    )
    watch(() => props.theme, value => editor.value?.setTheme(value))
    watch(() => props.locale, value => editor.value?.setLocale(value))
    watch(
      () => [props.readonly, props.grid, props.toolbar, props.layers, props.properties, props.title, props.maxFileBytes] as const,
      () => editor.value?.setOptions({
        readonly: props.readonly,
        grid: props.grid,
        toolbar: props.toolbar,
        layers: props.layers,
        properties: props.properties,
        ...(props.title === undefined ? {} : { title: props.title }),
        ...(props.maxFileBytes === undefined ? {} : { maxFileBytes: props.maxFileBytes }),
      }),
    )

    return () => h('div', {
      ...attrs,
      ref: container,
      class: ['kjdraw-vue', attrs.class],
      style: [{ width: '100%', minHeight: '480px' }, attrs.style],
      'data-kjdraw-vue': '',
    })
  },
})

export { createKJDrawEditor }
