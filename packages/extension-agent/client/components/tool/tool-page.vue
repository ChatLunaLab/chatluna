<template>
    <div
        class="tool-page"
        :class="{ compact: compactMode }"
    >
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
                        {{ compactMode ? '宽屏模式' : '紧凑显示' }}
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

                <div v-else key="list" class="panel catalog-panel">
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
                                        :type="item.chatlunaEnabled ? 'success' : 'info'"
                                    >
                                        {{
                                            item.chatlunaEnabled
                                                ? 'ChatLuna 启用'
                                                : 'ChatLuna 禁用'
                                        }}
                                    </el-tag>
                                    <el-tag
                                        size="small"
                                        effect="plain"
                                        :type="item.characterEnabled ? 'success' : 'info'"
                                    >
                                        {{
                                            item.characterEnabled
                                                ? 'Character 启用'
                                                : 'Character 禁用'
                                        }}
                                    </el-tag>
                                    <el-tag
                                        size="small"
                                        effect="plain"
                                        :type="item.characterGroupEnabled ? 'success' : 'info'"
                                    >
                                        {{
                                            item.characterGroupEnabled
                                                ? 'Character 群聊启用'
                                                : 'Character 群聊禁用'
                                        }}
                                    </el-tag>
                                    <el-tag
                                        size="small"
                                        effect="plain"
                                        :type="item.characterPrivateEnabled ? 'success' : 'info'"
                                    >
                                        {{
                                            item.characterPrivateEnabled
                                                ? 'Character 私聊启用'
                                                : 'Character 私聊禁用'
                                        }}
                                    </el-tag>
                                    <el-tag
                                        size="small"
                                        effect="plain"
                                        :type="subAgentModeType(item.subAgents.mode)"
                                    >
                                        {{ subAgentModeLabel(item.subAgents.mode) }}
                                    </el-tag>
                                    <el-tag size="small" effect="plain">
                                        {{
                                            item.authority > 0
                                                ? `权限 >= ${item.authority}`
                                                : '无权限限制'
                                        }}
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
const compactMode = useCompactMode('tool')
const hideDesc = useHideDesc('tool')
const selectedName = ref('')
const currentView = ref<'list' | 'detail'>('list')
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
                    chatlunaEnabled: saved?.chatluna ?? item.chatlunaEnabled,
                    characterEnabled:
                        saved?.character ?? item.characterEnabled,
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
        chatluna: item?.chatluna !== false,
        character: item?.character !== false,
        characterGroup: (item as any)?.characterGroup !== false,
        characterPrivate: (item as any)?.characterPrivate !== false,
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
    width: 100%;
    min-width: 0;
    margin: 0 auto;
    padding-bottom: 56px;
    box-sizing: border-box;
}

.toolbar-container {
    position: sticky;
    top: 0;
    z-index: 20;
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

.panel {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    overflow: hidden;
    box-sizing: border-box;
}

.catalog-panel {
    margin-top: 18px;
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
    box-sizing: border-box;
}

@media (max-width: 768px) {
    .catalog-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .search-input {
        width: 100% !important;
    }
}

.panel-title {
    font-size: 17px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-description {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.search-input {
    width: min(360px, 100%);
}

.card-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
    padding: 16px;
    box-sizing: border-box;
}

.tool-card {
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

.tool-name,
.tool-description {
    font-size: 12px;
    color: var(--k-text-light);
    line-height: 1.6;
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

.tool-footer {
    margin-top: auto;
}

.tool-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

@media (max-width: 768px) {
.card-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
    padding: 16px;
    box-sizing: border-box;
}

.tool-card {
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
    transition:
        border-color 0.2s ease,
        transform 0.2s ease;
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
