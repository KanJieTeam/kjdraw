// Generated from vue.ts by scripts/build-typescript.mjs. Do not edit directly.
import { defineComponent, h, onMounted, onScopeDispose, shallowRef, watch } from 'vue';
import { createKJDrawEditor } from './editor.js';
export const KJDraw = defineComponent({
    name: 'KJDraw',
    inheritAttrs: false,
    props: {
        document: {
            type: [
                Object,
                String
            ],
            default: 'sample'
        },
        sdk: {
            type: Object,
            default: undefined
        },
        locale: {
            type: String,
            default: 'en'
        },
        theme: {
            type: String,
            default: 'dark'
        },
        layout: {
            type: String,
            default: 'classic'
        },
        readonly: {
            type: Boolean,
            default: false
        },
        grid: {
            type: Boolean,
            default: true
        },
        toolbar: {
            type: Boolean,
            default: true
        },
        layers: {
            type: Boolean,
            default: true
        },
        properties: {
            type: Boolean,
            default: true
        },
        title: {
            type: String,
            default: undefined
        },
        maxFileBytes: {
            type: Number,
            default: undefined
        },
        onReady: {
            type: Function,
            default: undefined
        },
        onChange: {
            type: Function,
            default: undefined
        },
        onSelectionChange: {
            type: Function,
            default: undefined
        },
        onError: {
            type: Function,
            default: undefined
        }
    },
    setup (props, { attrs, expose }) {
        const container = shallowRef(null);
        const editor = shallowRef(null);
        const requireEditor = ()=>{
            if (!editor.value) throw new Error('KJDraw is not mounted yet');
            return editor.value;
        };
        const dispose = ()=>{
            editor.value?.dispose();
            editor.value = null;
        };
        const mount = ()=>{
            if (!container.value) return;
            dispose();
            const options = {
                document: props.document,
                ...props.sdk === undefined ? {} : {
                    sdk: props.sdk
                },
                locale: props.locale,
                theme: props.theme,
                layout: props.layout,
                readonly: props.readonly,
                grid: props.grid,
                toolbar: props.toolbar,
                layers: props.layers,
                properties: props.properties,
                ...props.title === undefined ? {} : {
                    title: props.title
                },
                ...props.maxFileBytes === undefined ? {} : {
                    maxFileBytes: props.maxFileBytes
                },
                onReady: (instance)=>props.onReady?.(instance),
                onChange: (event)=>props.onChange?.(event),
                onSelectionChange: (event)=>props.onSelectionChange?.(event),
                onError: (error)=>props.onError?.(error)
            };
            editor.value = createKJDrawEditor(container.value, options);
        };
        const exposed = {
            get instance () {
                return editor.value;
            },
            get ready () {
                return editor.value?.ready ?? null;
            },
            open: (...args)=>requireEditor().open(...args),
            save: (...args)=>requireEditor().save(...args),
            fit: ()=>requireEditor().fit(),
            undo: ()=>requireEditor().undo(),
            redo: ()=>requireEditor().redo(),
            execute: (...args)=>requireEditor().execute(...args),
            setDocument: (drawing)=>requireEditor().setDocument(drawing),
            setTheme: (value)=>requireEditor().setTheme(value),
            setLayout: (value)=>requireEditor().setLayout(value),
            setLocale: (value)=>requireEditor().setLocale(value),
            setSelection: (ids)=>requireEditor().setSelection(ids),
            getSelection: ()=>requireEditor().getSelection(),
            setOptions: (options)=>requireEditor().setOptions(options),
            setTitle: (value)=>requireEditor().setTitle(value),
            on: (...args)=>requireEditor().on(...args),
            dispose
        };
        expose(exposed);
        onMounted(mount);
        onScopeDispose(dispose);
        watch([
            ()=>props.sdk,
            ()=>props.document
        ], ([nextSdk, drawing], [previousSdk])=>{
            if (nextSdk !== previousSdk || !drawing || typeof drawing !== 'object') mount();
            else if (editor.value) void editor.value.setDocument(drawing).catch(()=>{});
        });
        watch(()=>props.theme, (value)=>editor.value?.setTheme(value));
        watch(()=>props.locale, (value)=>editor.value?.setLocale(value));
        watch(()=>[
                props.layout,
                props.readonly,
                props.grid,
                props.toolbar,
                props.layers,
                props.properties,
                props.title,
                props.maxFileBytes
            ], ()=>editor.value?.setOptions({
                layout: props.layout,
                readonly: props.readonly,
                grid: props.grid,
                toolbar: props.toolbar,
                layers: props.layers,
                properties: props.properties,
                ...props.title === undefined ? {} : {
                    title: props.title
                },
                ...props.maxFileBytes === undefined ? {} : {
                    maxFileBytes: props.maxFileBytes
                }
            }));
        return ()=>h('div', {
                ...attrs,
                ref: container,
                class: [
                    'kjdraw-vue',
                    attrs.class
                ],
                style: [
                    {
                        width: '100%',
                        minHeight: '480px'
                    },
                    attrs.style
                ],
                'data-kjdraw-vue': ''
            });
    }
});
export { createKJDrawEditor };
