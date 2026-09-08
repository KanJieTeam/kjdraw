// Generated from react.ts by scripts/build-typescript.mjs. Do not edit directly.
import { createElement, forwardRef, useEffect, useRef } from 'react';
import { createKJDrawEditor } from './editor.js';
function assignEditorRef(ref, value) {
    if (typeof ref === 'function') ref(value);
    else if (ref) ref.current = value;
}
export const KJDraw = forwardRef(function KJDraw({ className, style, id, document, sdk, locale, theme, readonly, grid, toolbar, layers, properties, title, maxFileBytes, onReady, onChange, onSelectionChange, onError }, forwardedRef) {
    const containerRef = useRef(null);
    const editorRef = useRef(null);
    const remountRef = useRef(()=>{});
    const mountedDocumentRef = useRef(document);
    const forwardedRefRef = useRef(forwardedRef);
    const callbacksRef = useRef({
        onReady,
        onChange,
        onSelectionChange,
        onError
    });
    callbacksRef.current = {
        onReady,
        onChange,
        onSelectionChange,
        onError
    };
    const optionsRef = useRef({});
    optionsRef.current = {
        ...document === undefined ? {} : {
            document
        },
        ...sdk === undefined ? {} : {
            sdk
        },
        ...locale === undefined ? {} : {
            locale
        },
        ...theme === undefined ? {} : {
            theme
        },
        ...readonly === undefined ? {} : {
            readonly
        },
        ...grid === undefined ? {} : {
            grid
        },
        ...toolbar === undefined ? {} : {
            toolbar
        },
        ...layers === undefined ? {} : {
            layers
        },
        ...properties === undefined ? {} : {
            properties
        },
        ...title === undefined ? {} : {
            title
        },
        ...maxFileBytes === undefined ? {} : {
            maxFileBytes
        },
        onReady: (instance)=>callbacksRef.current.onReady?.(instance),
        onChange: (event)=>callbacksRef.current.onChange?.(event),
        onSelectionChange: (event)=>callbacksRef.current.onSelectionChange?.(event),
        onError: (error)=>callbacksRef.current.onError?.(error)
    };
    useEffect(()=>{
        const container = containerRef.current;
        if (!container) return;
        let active = true;
        const mount = ()=>{
            if (!active) return;
            const previous = editorRef.current;
            if (previous) {
                assignEditorRef(forwardedRefRef.current, null);
                editorRef.current = null;
                previous.dispose();
            }
            const editor = createKJDrawEditor(container, optionsRef.current);
            editorRef.current = editor;
            mountedDocumentRef.current = optionsRef.current.document;
            assignEditorRef(forwardedRefRef.current, editor);
        };
        remountRef.current = mount;
        mount();
        return ()=>{
            active = false;
            remountRef.current = ()=>{};
            assignEditorRef(forwardedRefRef.current, null);
            const editor = editorRef.current;
            editorRef.current = null;
            editor?.dispose();
        };
    }, [
        sdk
    ]);
    useEffect(()=>{
        const previousRef = forwardedRefRef.current;
        if (previousRef === forwardedRef) return;
        assignEditorRef(previousRef, null);
        forwardedRefRef.current = forwardedRef;
        assignEditorRef(forwardedRef, editorRef.current);
    }, [
        forwardedRef
    ]);
    useEffect(()=>{
        if (mountedDocumentRef.current === document) return;
        mountedDocumentRef.current = document;
        const editor = editorRef.current;
        if (editor && document && typeof document === 'object') {
            void editor.setDocument(document).catch(()=>{});
        } else {
            remountRef.current();
        }
    }, [
        document
    ]);
    useEffect(()=>{
        if (theme !== undefined) editorRef.current?.setTheme(theme);
    }, [
        theme
    ]);
    useEffect(()=>{
        if (locale !== undefined) editorRef.current?.setLocale(locale);
    }, [
        locale
    ]);
    useEffect(()=>{
        editorRef.current?.setOptions({
            ...readonly === undefined ? {} : {
                readonly
            },
            ...grid === undefined ? {} : {
                grid
            },
            ...toolbar === undefined ? {} : {
                toolbar
            },
            ...layers === undefined ? {} : {
                layers
            },
            ...properties === undefined ? {} : {
                properties
            },
            ...title === undefined ? {} : {
                title
            },
            ...maxFileBytes === undefined ? {} : {
                maxFileBytes
            }
        });
    }, [
        readonly,
        grid,
        toolbar,
        layers,
        properties,
        title,
        maxFileBytes
    ]);
    return createElement('div', {
        ref: containerRef,
        id,
        className,
        style: {
            width: '100%',
            minHeight: 480,
            ...style
        },
        'data-kjdraw-react': ''
    });
});
KJDraw.displayName = 'KJDraw';
export { createKJDrawEditor };
