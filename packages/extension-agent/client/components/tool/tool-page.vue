<template>
    <div
        class="tool-page"
        :class="{ compact: compactMode }"
        v-loading="loading"
    >
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">工具</div>
                </div>

                <div class="actions-section">
                    <el-button
                        size="small"
                        :type="compactMode ? 'primary' : 'default'"
                        plain
                        @click="compactMode = !compactMode"
                    >
                        {{ compactMode ? '宽屏模式' : '紧凑显示' }}
                    </el-button>
                    <el-button
                        size="small"
                        :type="hideDesc ? 'primary' : 'default'"
                        plain
                        @click="hideDesc = !hideDesc"
                    >
                        {{ hideDesc ? '显示描述' : '隐藏描述' }}
                    </el-button>
                </div>
            </div>
        </div>

        <div class="panel catalog-panel">
            <div class="panel-header catalog-header">
                <div>
                    <div class="panel-title">工具列表</div>
                    <div class="panel-description">
                        ChatLuna 目前可用的全部工具。
                    </div>
                </div>

                <el-input
                    v-model="keyword"
                    class="search-input"
                    placeholder="搜索工具名、说明、来源、分组、MCP server"
                    clearable
                >
                    <template #prefix>
                        <el-icon><Search /></el-icon>
                    </template>
                </el-input>
            </div>

            <div
                v-if="filteredTools.length > 0"
                class="card-list"
                :class="{ compact: compactMode }"
            >
                <div
                    v-for="item in filteredTools"
                    :key="item.name"
                    class="tool-card"
                    :class="{ centered: hideDesc, muted: !item.enabled }"
                    @click="openEditor(item.name)"
                >
                    <div class="tool-top">
                        <div class="tool-brand">
                            <div class="tool-icon">
                                <el-icon :size="16"><Tools /></el-icon>
                            </div>

                            <div class="tool-copy">
                                <div class="tool-title">
                                    {{ item.name }}
                                </div>
                                <div v-if="!hideDesc" class="tool-name">
                                    {{ item.source || 'unknown' }}
                                    {{ item.group ? ` / ${item.group}` : '' }}
                                </div>
                            </div>
                        </div>

                        <el-switch
                            :model-value="item.enabled"
                            @change="setEnabled(item.name, $event as boolean)"
                            @click.stop
                        />
                    </div>

                    <div v-if="!hideDesc" class="tool-description">
                        {{ item.description || '这个工具暂时没有说明。' }}
                    </div>

                    <div class="tool-footer">
                        <div class="tool-tags">
                            <el-tag
                                v-if="item.name === 'handoff'"
                                size="small"
                                effect="plain"
                            >
                                {{ item.name }}
                            </el-tag>
                            <el-tag size="small" effect="plain">
                                {{ item.enabled ? '启用' : '停用' }}
                            </el-tag>
                            <el-tag
                                size="small"
                                effect="plain"
                                :type="item.main ? 'success' : 'info'"
                            >
                                {{
                                    item.main
                                        ? '主 Agent 可用'
                                        : '主 Agent 禁用'
                                }}
                            </el-tag>
                            <el-tag
                                size="small"
                                effect="plain"
                                :type="subAgentModeType(item.subAgents.mode)"
                            >
                                {{ subAgentModeLabel(item.subAgents.mode) }}
                            </el-tag>
                            <el-tag
                                v-if="item.isMcp"
                                size="small"
                                effect="plain"
                            >
                                MCP
                            </el-tag>
                            <el-tag
                                v-if="item.serverName"
                                size="small"
                                effect="plain"
                            >
                                {{ item.serverName }}
                            </el-tag>
                            <el-tag
                                v-for="tag in item.tags ?? []"
                                :key="tag"
                                size="small"
                                effect="plain"
                            >
                                {{ tag }}
                            </el-tag>
                        </div>
                    </div>
                </div>
            </div>

            <div v-else class="empty-state">
                <el-empty description="没有匹配的工具。" />
            </div>
        </div>

        <tool-edit-dialog
            v-model:visible="dialogVisible"
            :tool="selectedTool"
            :agent-options="agentOptions"
            @save="handleDialogSave"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search, Tools } from '@element-plus/icons-vue'
import { useCompactMode, useHideDesc } from '../shared/use-hide-desc'
import ToolEditDialog from './tool-edit-dialog.vue'
import type {
    PermissionRule,
    SubAgentInfo,
    ToolConfig,
    ToolInfo,
    ToolItemConfig,
    ToolStatus
} from '../../../src/types'

const props = withDefaults(
    defineProps<{
        config: ToolConfig
        status: ToolStatus
        agents: Record<string, SubAgentInfo>
        loading?: boolean
    }>(),
    {
        config: () => ({
            items: {},
            registry: {}
        }),
        status: () => ({
            enabled: false,
            total: 0,
            mainEnabled: 0,
            subAgentEnabled: 0,
            catalog: {}
        }),
        agents: () => ({}),
        loading: false
    }
)

const emit = defineEmits<{
    refresh: []
    save: [value: ToolConfig]
}>()

const keyword = ref('')
const compactMode = useCompactMode('tool')
const hideDesc = useHideDesc('tool')
const selectedName = ref('')
const dialogVisible = ref(false)
const draft = ref<ToolConfig>(cloneConfig(props.config))
const localDirty = ref(false)

watch(
    () => props.config,
    (value) => {
        const next = cloneConfig(value)
        if (JSON.stringify(draft.value) === JSON.stringify(next)) {
            localDirty.value = false
            draft.value = next
            return
        }

        if (localDirty.value) {
            return
        }

        draft.value = next
    },
    { immediate: true, deep: true }
)

const agentOptions = computed(() => {
    return Object.values(props.agents).sort((a, b) => {
        if (a.priority !== b.priority) {
            return a.priority - b.priority
        }

        return a.name.localeCompare(b.name)
    })
})

const tools = computed(() => {
    return Object.values(props.status.catalog)
        .map((item) => {
            const saved = draft.value.items[item.name]
            return {
                ...item,
                enabled: saved?.enabled ?? item.enabled,
                main: saved?.main ?? item.main,
                subAgents: cloneRule(saved?.subAgents ?? item.subAgents)
            }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
})

const filteredTools = computed(() => {
    const text = keyword.value.trim().toLowerCase()
    if (!text) {
        return tools.value
    }

    return tools.value.filter((item) => {
        return [
            item.name,
            item.description,
            item.source,
            item.group,
            item.serverName,
            ...(item.tags ?? [])
        ]
            .join('\n')
            .toLowerCase()
            .includes(text)
    })
})

const selectedTool = computed(() => {
    return tools.value.find((item) => item.name === selectedName.value)
})

const dirty = computed(() => {
    return (
        JSON.stringify(normalizeConfig(draft.value)) !==
        JSON.stringify(normalizeConfig(props.config))
    )
})

function openEditor(name: string) {
    selectedName.value = name
    dialogVisible.value = true
}

function setEnabled(name: string, enabled: boolean) {
    const item = tools.value.find((value) => value.name === name)
    if (!item) {
        return
    }

    if (!draft.value.items[name]) {
        draft.value.items[name] = createItem(item)
    }

    draft.value.items[name].enabled = enabled
    scheduleToolSave()
}

function handleDialogSave(name: string, item: ToolItemConfig) {
    draft.value.items[name] = item
    scheduleToolSave()
}

function saveDraft() {
    emit('save', normalizeConfig(draft.value))
}

function scheduleToolSave() {
    if (!dirty.value) return
    localDirty.value = true
    saveDraft()
}

function subAgentModeLabel(mode: PermissionRule['mode']) {
    if (mode === 'allow') return '仅指定 sub-agent'
    if (mode === 'deny') return '排除指定 sub-agent'
    return '全部 sub-agent'
}

function subAgentModeType(mode: PermissionRule['mode']) {
    if (mode === 'allow') return 'success'
    if (mode === 'deny') return 'warning'
    return 'info'
}

function cloneConfig(value: ToolConfig): ToolConfig {
    return normalizeConfig(value)
}

function normalizeConfig(value: ToolConfig): ToolConfig {
    return {
        registry: { ...(value.registry ?? {}) },
        items: Object.fromEntries(
            Object.entries(value.items ?? {}).map(([name, item]) => [
                name,
                createItem(item)
            ])
        )
    }
}

function createItem(item?: Partial<ToolItemConfig> | ToolInfo): ToolItemConfig {
    return {
        enabled: item?.enabled !== false,
        main: item?.main !== false,
        subAgents: cloneRule(item?.subAgents)
    }
}

function cloneRule(rule?: PermissionRule): PermissionRule {
    return {
        mode:
            rule?.mode === 'allow' || rule?.mode === 'deny' ? rule.mode : 'all',
        allow: [...(rule?.allow ?? [])],
        deny: [...(rule?.deny ?? [])]
    }
}
</script>

<style scoped>
.tool-page {
    min-height: 100%;
    width: min(100%, 1800px);
    margin: 0 auto;
    padding-bottom: 56px;
}

.tool-page.compact {
    width: min(100%, 1440px);
}

.toolbar-container {
    position: sticky;
    top: 0;
    z-index: 5;
    background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 18%) 0%,
        color-mix(in srgb, var(--k-page-bg), transparent 12%) 76%,
        transparent 100%
    );
    padding: 10px 0 14px;
    margin-bottom: 10px;
    backdrop-filter: blur(8px);
}

.toolbar-main,
.catalog-header,
.panel-header,
.tool-top,
.tool-brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.headline,
.tool-copy {
    min-width: 0;
}

.page-title {
    font-size: 24px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-description,
.tool-name,
.tool-description {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
}

.actions-section,
.tool-tags {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.tool-footer {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.catalog-panel {
    margin-top: 18px;
}

.panel {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
}

.panel-title,
.tool-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--k-text-dark);
    line-height: 1.4;
}

.tool-name {
    font-size: 14px;
}

.panel {
    overflow: hidden;
    min-height: 420px;
}

.panel-header {
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
}

.search-input {
    width: min(360px, 100%);
}

.card-list {
    --card-cols: 5;
    --card-gap: 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 14px var(--card-gap);
    padding: 16px;
}

.card-list.compact {
    --card-cols: 4;
}

.tool-card {
    flex: 0 1
        calc(
            (100% - (var(--card-cols) - 1) * var(--card-gap)) / var(--card-cols)
        );
    max-width: calc(
        (100% - (var(--card-cols) - 1) * var(--card-gap)) / var(--card-cols)
    );
    min-width: 0;
    box-sizing: border-box;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 12px;
    background: color-mix(in srgb, var(--k-activity-bg), var(--k-page-bg) 16%);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    cursor: pointer;
    transition:
        border-color 0.2s ease,
        transform 0.2s ease;
}

.tool-card:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 40%);
    transform: translateY(-1px);
}

.tool-card.muted {
    opacity: 0.72;
}

.tool-top {
    align-items: flex-start;
}

.tool-card.centered .tool-top {
    align-items: center;
    min-height: 34px;
}

.tool-brand {
    justify-content: flex-start;
    min-width: 0;
}

.tool-card.centered .tool-brand {
    align-items: center;
}

.tool-card.centered .tool-copy {
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.tool-icon {
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

.tool-description {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.card-list.compact .tool-description {
    -webkit-line-clamp: 2;
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
        --card-cols: 4;
    }
}

@media (max-width: 1320px) {
    .card-list {
        --card-cols: 3;
    }

    .card-list.compact {
        --card-cols: 4;
    }
}

@media (max-width: 1080px) {
    .card-list {
        --card-cols: 2;
    }

    .card-list.compact {
        --card-cols: 3;
    }
}

@media (max-width: 768px) {
    .toolbar-main,
    .catalog-header,
    .panel-header,
    .tool-top,
    .tool-brand {
        flex-direction: column;
        align-items: flex-start;
    }

    .actions-section {
        width: 100%;
        justify-content: flex-end;
    }

    .search-input {
        width: 100%;
    }

    .card-list {
        --card-cols: 1;
        flex-direction: column;
        align-items: stretch;
    }

    .card-list.compact {
        --card-cols: 1;
    }

    .tool-card {
        flex-basis: 100%;
        max-width: none;
    }
}
</style>
