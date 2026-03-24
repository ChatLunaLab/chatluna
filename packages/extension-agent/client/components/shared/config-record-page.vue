<template>
    <div class="record-page" v-loading="loading">
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">{{ title }}</div>
                    <div class="page-description">{{ description }}</div>
                </div>

                <div class="actions-section">
                    <el-tag round effect="plain" type="info">
                        {{ entries.length }} 项
                    </el-tag>
                    <el-button circle @click="$emit('refresh')">
                        <el-icon><RefreshRight /></el-icon>
                    </el-button>
                    <el-button type="primary" circle @click="handleSave">
                        <el-icon><Check /></el-icon>
                    </el-button>
                </div>
            </div>
        </div>

        <div class="stats-grid">
            <div v-for="item in stats" :key="item.label" class="stat-card">
                <div class="stat-label">{{ item.label }}</div>
                <div class="stat-value">{{ item.value }}</div>
            </div>
        </div>

        <div class="panel-grid">
            <div class="panel">
                <div class="panel-header">
                    <span class="panel-title">配置项</span>
                    <span class="panel-count">{{ entries.length }}</span>
                </div>

                <div v-if="entries.length > 0" class="record-list">
                    <div
                        v-for="item in entries"
                        :key="item.key"
                        class="record-card"
                    >
                        <div class="record-name">{{ item.key }}</div>
                        <div class="record-preview">{{ item.preview }}</div>
                    </div>
                </div>

                <div v-else class="empty-state">
                    <el-empty description="当前没有配置项" />
                </div>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <span class="panel-title">JSON 配置</span>
                    <el-button text @click="formatJson">格式化</el-button>
                </div>

                <code-editor
                    v-model="jsonText"
                    class="json-editor"
                    language="json"
                    :min-height="462"
                    placeholder="请输入 JSON 配置"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { RefreshRight, Check } from '@element-plus/icons-vue'
import CodeEditor from './code-editor.vue'

interface StatItem {
    label: string
    value: string | number
}

const props = withDefaults(
    defineProps<{
        title: string
        description: string
        value: Record<string, unknown>
        stats: StatItem[]
        loading?: boolean
    }>(),
    {
        value: () => ({}),
        loading: false
    }
)

const emit = defineEmits<{
    refresh: []
    save: [value: Record<string, unknown>]
}>()

const jsonText = ref('{}')

watch(
    () => props.value,
    (value) => {
        jsonText.value = JSON.stringify(value ?? {}, null, 2)
    },
    {
        immediate: true,
        deep: true
    }
)

const entries = computed(() =>
    Object.entries(props.value ?? {}).map(([key, value]) => ({
        key,
        preview: Array.isArray(value)
            ? value.length > 0
                ? value.slice(0, 3).join(', ')
                : '空数组'
            : value && typeof value === 'object'
              ? Object.keys(value as Record<string, unknown>).length > 0
                  ? Object.keys(value as Record<string, unknown>)
                        .slice(0, 3)
                        .join(' / ')
                  : '空对象'
              : String(value)
    }))
)

const formatJson = () => {
    try {
        jsonText.value = JSON.stringify(
            JSON.parse(jsonText.value || '{}'),
            null,
            2
        )
    } catch {
        ElMessage.error('JSON 格式不正确')
    }
}

const handleSave = () => {
    try {
        emit('save', JSON.parse(jsonText.value || '{}'))
    } catch {
        ElMessage.error('JSON 格式不正确')
    }
}
</script>

<style scoped>
.record-page {
    min-height: 100%;
    width: min(100%, 1480px);
    margin: 0 auto;
    padding-bottom: 56px;
}

.toolbar-container {
    margin-bottom: 16px;
}

.toolbar-main {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
}

.headline {
    min-width: 0;
}

.page-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--k-text-dark);
}

.page-description {
    margin-top: 4px;
    font-size: 13px;
    color: var(--k-text-light);
}

.actions-section {
    display: flex;
    gap: 8px;
    align-items: center;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin-bottom: 20px;
}

.stat-card {
    border: 1px solid var(--k-color-divider);
    border-radius: 16px;
    background: var(--k-side-bg);
    padding: 18px;
}

.stat-label {
    font-size: 12px;
    color: var(--k-text-light);
    margin-bottom: 8px;
}

.stat-value {
    font-size: 24px;
    font-weight: 700;
    color: var(--k-text-dark);
    word-break: break-word;
}

.panel-grid {
    display: grid;
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
    gap: 20px;
}

.panel {
    border: 1px solid var(--k-color-divider);
    border-radius: 18px;
    background: var(--k-side-bg);
    overflow: hidden;
    min-height: 520px;
    padding: 0 0 20px;
}

.panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px;
    border-bottom: 1px solid var(--k-color-divider);
}

.panel-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--k-text-dark);
}

.panel-count {
    min-width: 28px;
    height: 28px;
    border-radius: 999px;
    background: var(--k-activity-bg);
    color: var(--k-text-light);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    padding: 0 8px;
}

.record-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px;
}

.record-card {
    border: 1px solid var(--k-color-divider);
    border-radius: 14px;
    background: var(--k-page-bg);
    padding: 14px 16px;
}

.record-name {
    font-size: 14px;
    font-weight: 700;
    color: var(--k-text-dark);
}

.record-preview {
    margin-top: 6px;
    font-size: 12px;
    color: var(--k-text-light);
    word-break: break-word;
}

.empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 420px;
}

.json-editor {
    margin: 20px 20px 0;
}

@media (max-width: 980px) {
    .panel-grid {
        grid-template-columns: 1fr;
    }

    .panel {
        min-height: 420px;
    }
}

@media (max-width: 768px) {
    .toolbar-main {
        flex-direction: column;
        align-items: flex-start;
    }

    .actions-section {
        width: 100%;
        justify-content: flex-end;
    }

    .stats-grid {
        grid-template-columns: 1fr;
    }
}
</style>
