<template>
    <div class="json-view">
        <div class="editor-toolbar">
            <div class="editor-copy">
                <div class="editor-title">原始配置</div>
                <div class="editor-description">直接编辑 MCP 配置 JSON</div>
            </div>

            <div class="editor-actions">
                <el-button circle @click="$emit('refresh')">
                    <el-icon><RefreshRight /></el-icon>
                </el-button>
                <el-button @click="formatJson">格式化</el-button>
                <el-button type="primary" @click="save">保存</el-button>
            </div>
        </div>

        <code-editor
            v-model="jsonContent"
            class="json-editor"
            language="json"
            :min-height="520"
            placeholder="直接粘贴或编辑 MCP JSON"
        />

        <div v-if="error" class="error">{{ error }}</div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { RefreshRight } from '@element-plus/icons-vue'
import type { McpConfig } from '../../../src/types'
import CodeEditor from '../shared/code-editor.vue'

const props = withDefaults(
    defineProps<{
        config: McpConfig
    }>(),
    {
        config: () => ({
            mcpServers: {},
            tools: {}
        })
    }
)

const emit = defineEmits<{
    refresh: []
    save: [value: McpConfig]
}>()

const jsonContent = ref('')
const error = ref('')

watch(
    () => props.config,
    (value) => {
        jsonContent.value = JSON.stringify(value ?? {}, null, 2)
    },
    {
        immediate: true,
        deep: true
    }
)

function formatJson() {
    error.value = ''

    try {
        jsonContent.value = JSON.stringify(
            JSON.parse(jsonContent.value || '{}'),
            null,
            2
        )
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
    }
}

function save() {
    error.value = ''

    try {
        emit('save', JSON.parse(jsonContent.value || '{}'))
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
    }
}
</script>

<style scoped>
.json-view {
    border: 1px solid var(--k-color-divider);
    border-radius: 18px;
    background: var(--k-color-surface-1);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding-bottom: 20px;
}

.editor-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 20px;
    border-bottom: 1px solid var(--k-color-divider);
    gap: 12px;
}

.editor-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--k-color-text);
}

.editor-description {
    margin-top: 4px;
    font-size: 12px;
    color: var(--k-text-light);
}

.editor-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

.json-editor {
    margin: 20px 20px 0;
}

.error {
    margin: 0 20px 20px;
    padding: 12px 14px;
    background: color-mix(in srgb, var(--el-color-danger), transparent 92%);
    color: var(--el-color-danger);
    border-radius: 12px;
}

@media (max-width: 768px) {
    .editor-toolbar {
        flex-direction: column;
        align-items: flex-start;
    }

    .editor-actions {
        width: 100%;
        justify-content: flex-end;
    }
}
</style>
