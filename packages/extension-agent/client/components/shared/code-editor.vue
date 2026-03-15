<template>
    <div ref="editorRef" class="code-editor"></div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { placeholder } from '@codemirror/view'

const props = withDefaults(
    defineProps<{
        modelValue: string
        language?:
            | 'json'
            | 'plaintext'
            | 'markdown'
            | 'yaml'
            | 'javascript'
            | 'typescript'
            | 'python'
            | 'shell'
        minHeight?: number
        placeholder?: string
        readonly?: boolean
    }>(),
    {
        language: 'json',
        minHeight: 320,
        placeholder: '请输入内容',
        readonly: false
    }
)

const emit = defineEmits<{
    'update:modelValue': [value: string]
}>()

const editorRef = ref<HTMLDivElement>()
let view: EditorView | null = null

onMounted(() => {
    if (!editorRef.value) return

    const extensions = [
        basicSetup,
        placeholder(props.placeholder),
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                emit('update:modelValue', update.state.doc.toString())
            }
        }),
        EditorState.readOnly.of(props.readonly),
        EditorView.theme({
            '&': {
                minHeight: `${props.minHeight}px`,
                maxHeight: '600px',
                fontSize: '13px'
            },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-content': {
                padding: '20px',
                fontFamily:
                    "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace"
            },
            '.cm-gutters': {
                backgroundColor: 'transparent',
                borderRight: 'none'
            }
        })
    ]

    if (props.language === 'json') {
        extensions.push(json())
    } else if (props.language === 'markdown') {
        extensions.push(markdown())
    } else if (props.language === 'yaml') {
        extensions.push(yaml())
    } else if (
        props.language === 'javascript' ||
        props.language === 'typescript'
    ) {
        extensions.push(
            javascript({ typescript: props.language === 'typescript' })
        )
    } else if (props.language === 'python') {
        extensions.push(python())
    }

    view = new EditorView({
        state: EditorState.create({
            doc: props.modelValue,
            extensions
        }),
        parent: editorRef.value
    })
})

watch(
    () => props.modelValue,
    (val) => {
        if (!view || view.state.doc.toString() === val) return
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: val }
        })
    }
)

watch(
    () => props.readonly,
    (val) => {
        if (!view) return
        view.dispatch({
            effects: EditorState.readOnly.reconfigure(
                EditorState.readOnly.of(val)
            )
        })
    }
)

onUnmounted(() => {
    view?.destroy()
})
</script>

<style scoped>
.code-editor {
    border-radius: 16px;
    background:
        linear-gradient(180deg, rgba(18, 44, 76, 0.05), transparent 36%),
        var(--k-page-bg);
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 12%);
    overflow: hidden;
}

:deep(.cm-editor) {
    background: transparent;
    color: var(--k-color-text);
}

:deep(.cm-focused) {
    outline: none;
}

:deep(.cm-cursor) {
    border-left-color: var(--k-color-primary);
}

:deep(.cm-selectionBackground) {
    background: color-mix(in srgb, var(--k-color-primary), transparent 72%);
}

:deep(.cm-activeLine) {
    background: color-mix(in srgb, var(--k-color-primary), transparent 92%);
}

:deep(.cm-gutters) {
    color: color-mix(in srgb, var(--k-color-text), transparent 50%);
}

:deep(.cm-activeLineGutter) {
    background: transparent;
}
</style>
