<template>
    <div class="tool-page" :class="{ compact: compactMode }">
        <div class="toolbar-container">
            <div class="toolbar-main" v-if="currentView === 'list'">
                <div class="headline">
                    <div class="page-title">工具</div>
                    <el-button
                        size="small"
                        class="mobile-only-desc-toggle"
                        :type="hideDesc ? 'primary' : 'default'"
                        plain
                        @click="hideDesc = !hideDesc"
                    >
                        {{ hideDesc ? '显示描述' : '隐藏描述' }}
                    </el-button>
                </div>

                <div class="actions-section">
                    <el-button
                        size="small"
                        class="hidden-mobile"
                        :type="compactMode ? 'primary' : 'default'"
                        plain
                        @click="compactMode = !compactMode"
                    >
                        {{ compactMode ? '紧凑模式' : '宽屏模式' }}
                    </el-button>
                    <el-button
                        size="small"
                        class="hidden-mobile"
                        :type="hideDesc ? 'primary' : 'default'"
                        plain
                        @click="hideDesc = !hideDesc"
                    >
                        {{ hideDesc ? '显示描述' : '隐藏描述' }}
                    </el-button>
                </div>
            </div>
        </div>

        <div class="page-content" v-loading="loading">
            <Transition name="page-swap" mode="out-in">
                <tool-detail
                    v-if="currentView === 'detail' && selectedTool"
                    key="detail"
                    :tool="selectedTool"
                    :draft="draft.items[selectedTool.name]"
                    :agent-options="agentOptions"
                    @back="currentView = 'list'"
                    @save="saveSelected"
                />

                <div v-else key="list" class="catalog">
                    <div class="catalog-controls">
                        <el-popover
                            placement="bottom-start"
                            trigger="click"
                            popper-class="tools-filter-popper"
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
                            :class="{
                                centered: hideDesc,
                                muted: !item.enabled
                            }"
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
                                            {{
                                                item.group
                                                    ? ` / ${item.group}`
                                                    : ''
                                            }}
                                        </div>
                                    </div>
                                </div>

                                <el-switch
                                    :model-value="item.enabled"
                                    @change="
                                        setEnabled(item.name, $event as boolean)
                                    "
                                    @click.stop
                                />
                            </div>

                            <div v-if="!hideDesc" class="tool-description">
                                {{
                                    item.description || '这个工具暂时没有说明。'
                                }}
                            </div>
                        </div>
                    </div>

                    <div v-else class="empty-state">
                        <el-empty description="没有匹配的工具。" />
                    </div>
                </div>
            </Transition>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search, Tools } from '@element-plus/icons-vue'
import { useCompactMode, useHideDesc } from '../shared/use-hide-desc'
import ToolDetail from './tool-detail.vue'
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
const filters = ref<string[]>([])
const compactMode = useCompactMode('tool')
const hideDesc = useHideDesc('tool')
const selectedName = ref('')
const currentView = ref<'list' | 'detail'>('list')
const draft = ref<ToolConfig>(cloneConfig(props.config))
const localDirty = ref(false)
const filterOptions = [
    { label: '启用', value: 'enabled:yes' },
    { label: '禁用', value: 'enabled:no' },
    { label: '主 Agent 启用', value: 'main:yes' },
    { label: '主 Agent 禁用', value: 'main:no' },
    { label: '伪装插件启用', value: 'character:yes' },
    { label: '伪装插件禁用', value: 'character:no' },
    { label: '主插件启用', value: 'chatluna:yes' },
    { label: '主插件禁用', value: 'chatluna:no' },
    { label: 'MCP 工具', value: 'mcp:yes' }
]

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
                chatlunaEnabled: saved?.chatluna ?? item.chatlunaEnabled,
                characterEnabled: saved?.character ?? item.characterEnabled,
                characterGroupEnabled:
                    saved?.characterGroup ?? item.characterGroupEnabled,
                characterPrivateEnabled:
                    saved?.characterPrivate ?? item.characterPrivateEnabled,
                characterGroupMode:
                    saved?.characterGroupMode ?? item.characterGroupMode,
                characterPrivateMode:
                    saved?.characterPrivateMode ?? item.characterPrivateMode,
                characterGroupIds:
                    saved?.characterGroupIds ?? item.characterGroupIds,
                characterPrivateIds:
                    saved?.characterPrivateIds ?? item.characterPrivateIds,
                subAgents: cloneRule(saved?.subAgents ?? item.subAgents),
                authority: saved?.authority ?? item.authority
            }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
})

const filteredTools = computed(() => {
    const text = keyword.value.trim().toLowerCase()

    return tools.value.filter((item) => {
        if (
            filters.value.length > 0 &&
            !filters.value.every((value) => {
                if (value === 'enabled:yes') return item.enabled
                if (value === 'enabled:no') return !item.enabled
                if (value === 'main:yes') return item.main
                if (value === 'main:no') return !item.main
                if (value === 'chatluna:yes') return item.chatlunaEnabled
                if (value === 'chatluna:no') return !item.chatlunaEnabled
                if (value === 'character:yes') return item.characterEnabled
                if (value === 'character:no') return !item.characterEnabled
                if (value === 'mcp:yes') return item.isMcp
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
    if (!draft.value.items[name]) {
        const item = tools.value.find((value) => value.name === name)
        if (item) {
            draft.value.items[name] = createItem(item)
        }
    }
    currentView.value = 'detail'
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

function saveSelected() {
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

function cloneConfig(value: ToolConfig): ToolConfig {
    return normalizeConfig(value)
}

function normalizeConfig(value: ToolConfig): ToolConfig {
    return {
        registry: { ...(value.registry ?? {}) },
        items: Object.fromEntries(
            Object.entries(value.items ?? {}).map(([name, item]) => [
                name,
                createItem(item, name)
            ])
        )
    }
}

function createItem(
    item?: Partial<ToolItemConfig> | ToolInfo,
    name?: string
): ToolItemConfig {
    return {
        enabled: item?.enabled !== false,
        main: item?.main !== false,
        chatluna:
            ((item as any)?.chatluna ?? (item as any)?.chatlunaEnabled) !==
            false,
        character:
            ((item as any)?.character ?? (item as any)?.characterEnabled) !==
            false,
        characterGroup:
            ((item as any)?.characterGroup ??
                (item as any)?.characterGroupEnabled) !== false,
        characterPrivate:
            ((item as any)?.characterPrivate ??
                (item as any)?.characterPrivateEnabled) !== false,
        characterGroupMode:
            (item as any)?.characterGroupMode === 'allow' ||
            (item as any)?.characterGroupMode === 'deny'
                ? (item as any).characterGroupMode
                : 'all',
        characterPrivateMode:
            (item as any)?.characterPrivateMode === 'allow' ||
            (item as any)?.characterPrivateMode === 'deny'
                ? (item as any).characterPrivateMode
                : 'all',
        characterGroupIds: [...((item as any)?.characterGroupIds ?? [])],
        characterPrivateIds: [...((item as any)?.characterPrivateIds ?? [])],
        subAgents: cloneRule(item?.subAgents),
        authority: item?.authority ?? defaultAuthority(name)
    }
}

function defaultAuthority(name?: string) {
    if (
        name === 'bash' ||
        name === 'file_edit' ||
        name === 'file_read' ||
        name === 'file_write' ||
        name === 'glob' ||
        name === 'grep'
    ) {
        return 3
    }

    return 0
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
    min-width: 0;
    margin: 0 auto;
    padding-bottom: 56px;
    box-sizing: border-box;
}

.tool-page.compact {
    width: min(100%, 1200px);
}

.toolbar-container {
    margin-bottom: 16px;
}

.toolbar-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.headline {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
}

.mobile-only-desc-toggle {
    display: none;
}

.page-content {
    position: relative;
    min-height: 200px;
}

:deep(.el-loading-mask) {
    background-color: color-mix(in srgb, var(--k-page-bg), transparent 30%);
    z-index: 10;
}

@media (max-width: 768px) {
    .toolbar-main {
        flex-direction: column;
        align-items: flex-start;
    }

    .headline {
        justify-content: space-between;
        width: 100%;
        box-sizing: border-box;
    }

    .mobile-only-desc-toggle {
        display: inline-flex;
    }

    .actions-section {
        width: 100%;
        justify-content: flex-start;
    }

    .actions-section .el-button {
        margin-left: 0;
        margin-bottom: 4px;
    }

    .hidden-mobile {
        display: none;
    }
}

.page-title {
    font-size: 24px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.actions-section {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.catalog {
    min-width: 0;
}

.catalog-controls {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-bottom: 16px;
    min-width: 0;
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
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: max-content;
    min-width: 0;
}

.filter-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
}

.filter-list :deep(.el-checkbox) {
    margin-right: 0;
}

.filter-list :deep(.el-checkbox__label) {
    padding-left: 8px;
    white-space: nowrap;
}

.filter-panel-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 4px;
    border-top: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 28%);
}

:global(.tools-filter-popper.el-popover) {
    width: max-content !important;
    min-width: 0 !important;
    padding: 12px;
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

.tool-card {
    min-height: 160px;
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

.tool-card:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 40%);
}

.tool-card.muted {
    opacity: 0.72;
}

.tool-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
}

.tool-brand {
    display: flex;
    justify-content: flex-start;
    gap: 10px;
    min-width: 0;
    flex: 1 1 auto;
}

.tool-copy {
    min-width: 0;
    flex: 1 1 auto;
}

.tool-card.centered .tool-top {
    align-items: center;
    min-height: 34px;
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

.tool-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--k-text-dark);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tool-top :deep(.el-switch) {
    flex-shrink: 0;
}

.tool-name,
.tool-description {
    font-size: 12px;
    color: var(--k-text-light);
    line-height: 1.6;
}

.tool-description {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: calc(12px * 1.6 * 4);
    height: calc(12px * 1.6 * 4);
}

.card-list.compact .tool-description {
    -webkit-line-clamp: 4;
    min-height: calc(12px * 1.6 * 4);
    height: calc(12px * 1.6 * 4);
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

@media (max-width: 1080px) {
    .card-list {
        --card-cols: 2;
    }

    .card-list.compact {
        --card-cols: 1;
    }
}

@media (max-width: 768px) {
    .card-list,
    .card-list.compact {
        --card-cols: 1;
    }

    .catalog-controls {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        align-items: stretch;
        width: 100%;
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

    .tool-card {
        width: 100%;
    }
}

.page-swap-enter-active,
.page-swap-leave-active {
    transition: all 0.24s ease;
}

.page-swap-enter-from,
.page-swap-leave-to {
    opacity: 0;
    transform: translateX(18px) translateY(4px);
}
</style>
