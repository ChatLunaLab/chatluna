<template>
    <div class="json-view">
        <div class="catalog-controls">
            <div class="section-title">JSON 配置</div>
            <div class="catalog-actions">
                <el-button :icon="RefreshRight" @click="$emit('refresh')">
                    重新加载
                </el-button>
                <el-button :icon="Document" @click="formatJson">
                    格式化
                </el-button>
                <el-button type="primary" :icon="Check" @click="save">
                    保存
                </el-button>
            </div>
        </div>

        <code-editor
            v-model="jsonContent"
            class="json-editor"
            language="json"
            :min-height="520"
            placeholder="粘贴完整的 MCP JSON 配置"
        />

        <div v-if="error" class="error">{{ error }}</div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Check, Document, RefreshRight } from '@element-plus/icons-vue'
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
        error.value = `JSON 格式有误：${e instanceof Error ? e.message : String(e)}`
    }
}

function save() {
    error.value = ''

    try {
        emit('save', JSON.parse(jsonContent.value || '{}'))
    } catch (e) {
        error.value = `保存失败：${e instanceof Error ? e.message : String(e)}`
    }
}
</script>

<style scoped>
.json-view {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
}

.catalog-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
    flex-wrap: wrap;
}

.section-title {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--k-text-dark);
    min-width: 0;
}

.catalog-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
    margin-left: auto;
}

.catalog-actions :deep(.el-button) {
    margin: 0;
}

.json-editor {
    width: 100%;
    min-width: 0;
}

.error {
    margin: 0;
    padding: 11px 13px;
    background: color-mix(in srgb, var(--el-color-danger), transparent 94%);
    color: color-mix(in srgb, var(--el-color-danger), var(--k-text-dark) 28%);
    border-radius: 10px;
    line-height: 1.5;
    word-break: break-word;
    overflow-wrap: anywhere;
}

@media (max-width: 768px) {
    .catalog-controls {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        width: 100%;
    }

    .catalog-actions {
        width: 100%;
        margin-left: 0;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
    }

    .catalog-actions :deep(.el-button) {
        width: 100%;
        min-width: 0;
        margin: 0;
        justify-content: center;
    }
}
</style>
