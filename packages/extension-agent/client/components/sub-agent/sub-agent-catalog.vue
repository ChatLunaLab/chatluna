<template>
    <div class="catalog">
        <div class="catalog-controls">
            <div class="catalog-actions">
                <slot name="actions"></slot>
            </div>

            <div class="catalog-search">
                <el-popover
                    placement="bottom-start"
                    trigger="click"
                    popper-class="sub-agent-filter-popper"
                >
                    <template #reference>
                        <el-button class="filter-trigger" plain>
                            {{
                                filters.length > 0
                                    ? `筛选 ${filters.length}`
                                    : '筛选'
                            }}
                        </el-button>
                    </template>

                    <div class="filter-panel">
                        <el-checkbox-group v-model="filters">
                            <div class="filter-list">
                                <el-checkbox
                                    v-for="item in filterOptions"
                                    :key="item.value"
                                    :label="item.value"
                                >
                                    {{ item.label }}
                                </el-checkbox>
                            </div>
                        </el-checkbox-group>

                        <div class="filter-panel-actions">
                            <el-button
                                size="small"
                                text
                                :disabled="filters.length === 0"
                                @click="filters = []"
                            >
                                清空
                            </el-button>
                        </div>
                    </div>
                </el-popover>

                <el-input
                    v-model="keyword"
                    class="search-input"
                    placeholder="搜索名称、描述、路径或诊断"
                    clearable
                >
                    <template #prefix>
                        <el-icon><Search /></el-icon>
                    </template>
                </el-input>
            </div>
        </div>

        <div
            v-if="filteredAgents.length > 0"
            class="card-list"
            :class="{ compact: props.compactMode }"
        >
            <div
                v-for="item in filteredAgents"
                :key="item.id"
                class="agent-card"
                :class="{
                    centered: props.hideDesc,
                    muted: !!item.shadowedBy,
                    invalid: item.state !== 'ready'
                }"
                @click="$emit('select', item.id)"
            >
                <div class="agent-top">
                    <div class="agent-brand">
                        <div class="agent-icon">
                            <el-icon :size="16"><UserFilled /></el-icon>
                        </div>

                        <div class="agent-copy">
                            <div class="agent-title">{{ item.name }}</div>
                            <div v-if="!props.hideDesc" class="agent-name">
                                {{ item.source
                                }}{{ item.format ? ` / ${item.format}` : '' }}
                            </div>
                        </div>
                    </div>

                    <el-switch
                        :model-value="item.enabled"
                        @change="$emit('toggle', item, $event as boolean)"
                        @click.stop
                    />
                </div>

                <div v-if="!props.hideDesc" class="agent-desc">
                    {{ item.description || '这个 agent 暂时没有说明。' }}
                </div>

                <div v-if="!props.hideDesc" class="agent-meta">
                    <div class="agent-path">
                        {{ item.path || item.preset || '内置定义' }}
                    </div>
                </div>

                <div class="agent-footer">
                    <div class="agent-tags">
                        <el-tag v-if="item.scope" size="small" effect="plain">
                            {{ item.scope }}
                        </el-tag>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="item.enabled ? 'success' : 'info'"
                        >
                            {{ item.enabled ? '启用' : '禁用' }}
                        </el-tag>
                        <el-tag
                            v-if="item.hidden"
                            size="small"
                            effect="plain"
                            type="warning"
                        >
                            已隐藏
                        </el-tag>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="
                                item.state === 'ready' &&
                                !item.hidden &&
                                !item.shadowedBy
                                    ? 'success'
                                    : 'info'
                            "
                        >
                            {{
                                item.state === 'ready' &&
                                !item.hidden &&
                                !item.shadowedBy
                                    ? '可用'
                                    : '不可用'
                            }}
                        </el-tag>
                    </div>

                    <div class="agent-actions" @click.stop>
                        <el-button
                            size="small"
                            plain
                            @click="$emit('preview', item)"
                        >
                            查看/修改内容
                        </el-button>
                        <el-button
                            size="small"
                            plain
                            :disabled="!canExport(item)"
                            @click="$emit('export', item)"
                        >
                            导出 MD
                        </el-button>
                        <el-button
                            v-if="canRemove(item)"
                            class="danger-soft"
                            size="small"
                            plain
                            type="danger"
                            @click.stop="$emit('remove', item)"
                        >
                            删除
                        </el-button>
                    </div>

                    <div
                        v-if="item.diagnostics.length > 0"
                        class="diagnostic-box"
                    >
                        <div
                            v-for="line in item.diagnostics.slice(0, 3)"
                            :key="line"
                            class="diagnostic-line"
                        >
                            {{ line }}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="empty-state">
            <el-empty description="没有匹配的 Sub Agent。" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search, UserFilled } from '@element-plus/icons-vue'
import type { SubAgentInfo } from '../../../src/types'

const props = defineProps<{
    agents: SubAgentInfo[]
    compactMode: boolean
    hideDesc: boolean
    removableIds: string[]
}>()

defineEmits<{
    select: [id: string]
    toggle: [item: SubAgentInfo, enabled: boolean]
    preview: [item: SubAgentInfo]
    export: [item: SubAgentInfo]
    remove: [item: SubAgentInfo]
}>()

const keyword = ref('')
const filters = ref<string[]>([])
const filterOptions = [
    { label: '启用', value: 'enabled:yes' },
    { label: '禁用', value: 'enabled:no' },
    { label: '可用', value: 'state:ready' },
    { label: '不可用', value: 'state:not-ready' },
    { label: '已隐藏', value: 'hidden:yes' },
    { label: '内置 Agent', value: 'source:builtin' },
    { label: 'Markdown Agent', value: 'source:markdown' },
    { label: '预设 Agent', value: 'source:preset' },
    { label: '手动 Agent', value: 'source:manual' }
]

const filteredAgents = computed(() => {
    const text = keyword.value.trim().toLowerCase()

    return props.agents.filter((item) => {
        if (
            filters.value.length > 0 &&
            !filters.value.every((value) => {
                if (value === 'enabled:yes') return item.enabled
                if (value === 'enabled:no') return !item.enabled
                if (value === 'state:ready') return item.state === 'ready'
                if (value === 'state:not-ready') return item.state !== 'ready'
                if (value === 'hidden:yes') return item.hidden
                if (value === 'source:builtin') return item.source === 'builtin'
                if (value === 'source:markdown')
                    return item.source === 'markdown'
                if (value === 'source:preset') return item.source === 'preset'
                if (value === 'source:manual') return item.source === 'manual'
                return true
            })
        ) {
            return false
        }

        if (!text) {
            return true
        }

        return [
            item.name,
            item.description,
            item.path,
            item.source,
            item.format,
            item.scope,
            item.preset,
            ...(item.diagnostics ?? [])
        ]
            .join('\n')
            .toLowerCase()
            .includes(text)
    })
})

function canRemove(item: SubAgentInfo) {
    return props.removableIds.includes(item.id)
}

function canExport(item: SubAgentInfo) {
    return item.promptContent.trim().length > 0
}
</script>

<style scoped>
.catalog {
    min-width: 0;
}

.catalog-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    min-width: 0;
    flex-wrap: wrap;
}

.catalog-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
}

.catalog-actions :deep(.el-button) {
    margin: 0;
}

.catalog-search {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
    flex: 0 1 420px;
}

.filter-trigger {
    height: 32px;
    min-width: 92px;
    padding-inline: 12px;
    flex: 0 0 auto;
}

.search-input {
    width: min(100%, 360px);
    min-width: 0;
    flex: 0 1 360px;
}

.filter-panel {
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.filter-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.filter-panel-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 8px;
    border-top: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
}

.card-list {
    --card-cols: 5;
    display: grid;
    grid-template-columns: repeat(var(--card-cols), minmax(0, 1fr));
    gap: 16px;
    box-sizing: border-box;
}

.card-list.compact {
    --card-cols: 4;
}

.agent-card {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 12px;
    background: color-mix(in srgb, var(--k-activity-bg), var(--k-page-bg) 16%);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    cursor: pointer;
    overflow: hidden;
    box-sizing: border-box;
    transition: border-color 0.2s ease;
}

.agent-card:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 40%);
}

.agent-card.muted {
    opacity: 0.72;
}

.agent-card.invalid {
    border-color: color-mix(in srgb, var(--el-color-warning), transparent 60%);
}

.agent-top {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: flex-start;
    min-width: 0;
}

.agent-card.centered .agent-top {
    align-items: center;
    min-height: 34px;
}

.agent-brand {
    display: flex;
    justify-content: flex-start;
    gap: 12px;
    min-width: 0;
    flex: 1 1 auto;
}

.agent-card.centered .agent-brand {
    align-items: center;
}

.agent-copy {
    min-width: 0;
    flex: 1 1 auto;
}

.agent-card.centered .agent-copy {
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.agent-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--k-text-dark);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.agent-name,
.agent-desc,
.agent-path,
.diagnostic-line {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
}

.agent-desc {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.card-list.compact .agent-desc {
    -webkit-line-clamp: 2;
}

.agent-icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-color-primary) 8%);
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 36%);
    flex: 0 0 auto;
}

.agent-path {
    font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
}

.agent-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.agent-footer {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.agent-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
    gap: 8px;
}

.agent-actions :deep(.el-button) {
    width: 100%;
    min-width: 0;
    margin: 0;
}

.agent-actions :deep(.danger-soft.el-button) {
    --el-button-bg-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 92%
    );
    --el-button-border-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 68%
    );
    --el-button-text-color: color-mix(
        in srgb,
        var(--el-color-danger),
        var(--k-text-dark) 22%
    );
}

.diagnostic-box {
    padding: 12px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--el-color-warning), transparent 95%);
}

.empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 280px;
}

@media (max-width: 1680px) {
    .card-list {
        --card-cols: 4;
    }

    .card-list.compact {
        --card-cols: 3;
    }
}

@media (max-width: 1320px) {
    .card-list {
        --card-cols: 3;
    }

    .card-list.compact {
        --card-cols: 2;
    }
}

@media (max-width: 980px) {
    .card-list {
        --card-cols: 2;
    }

    .card-list.compact {
        --card-cols: 1;
    }
}

@media (max-width: 768px) {
    .catalog-controls {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        align-items: stretch;
        width: 100%;
    }

    .catalog-actions {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
    }

    .catalog-actions :deep(.el-button) {
        width: 100%;
        min-width: 0;
        margin: 0;
        justify-content: center;
        white-space: normal;
        line-height: 1.3;
    }

    .catalog-search {
        width: 100%;
        min-width: 0;
        flex: none;
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        align-items: stretch;
    }

    .filter-trigger {
        min-width: 0;
        width: 100%;
        flex: none;
    }

    .search-input {
        width: 100% !important;
        min-width: 0;
        flex: none;
    }

    .search-input :deep(.el-input__wrapper) {
        min-height: 32px;
    }

    .card-list,
    .card-list.compact {
        --card-cols: 1;
        grid-template-columns: 1fr;
    }

    .agent-card {
        width: 100%;
        min-width: 0;
    }

    .agent-top {
        align-items: flex-start;
    }

    .agent-brand {
        align-items: flex-start;
    }
}
</style>
