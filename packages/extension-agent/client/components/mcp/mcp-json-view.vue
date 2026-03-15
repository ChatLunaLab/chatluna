<template>
    <div class="json-view">
        <div class="editor-toolbar">
            <div class="editor-copy">
                <div class="editor-title">JSON 配置</div>
                <div class="editor-description">
                    可直接查看、粘贴或编辑完整配置。保存前会先检查 JSON 格式。
                </div>
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
            placeholder="粘贴完整的 MCP JSON 配置"
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
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 16px;
    background: color-mix(
        in srgb,
        var(--k-color-surface-1),
        var(--k-page-bg) 22%
    );
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding-bottom: 18px;
}

.editor-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
    gap: 14px;
}

.editor-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--k-color-text);
}

.editor-description {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.editor-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

.json-editor {
    margin: 18px 18px 0;
}

.error {
    margin: 0 18px 18px;
    padding: 11px 13px;
    background: color-mix(in srgb, var(--el-color-danger), transparent 94%);
    color: color-mix(in srgb, var(--el-color-danger), var(--k-color-text) 28%);
    border-radius: 10px;
    line-height: 1.5;
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
