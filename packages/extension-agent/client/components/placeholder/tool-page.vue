<template>
    <div class="tool-page" v-loading="loading">
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">Tool</div>
                    <div class="page-description">
                        统一管理 tools、bash、skill、MCP 相关工具的全局权限。
                        main agent 与 sub-agent
                        的运行时可用范围会统一由权限服务合并。
                    </div>
                </div>

                <div class="actions-section">
                    <el-button :disabled="!dirty" @click="resetDraft">
                        还原
                    </el-button>
                    <el-button
                        type="primary"
                        :disabled="!dirty"
                        @click="saveDraft"
                    >
                        保存
                    </el-button>
                    <el-button circle @click="$emit('refresh')">
                        <el-icon><RefreshRight /></el-icon>
                    </el-button>
                </div>
            </div>
        </div>

        <div class="stats-row">
            <div class="stat-card">
                <div class="stat-label">总工具数</div>
                <div class="stat-value">{{ tools.length }}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Main Agent 可用</div>
                <div class="stat-value">{{ mainCount }}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Sub Agent 可用</div>
                <div class="stat-value">{{ subAgentCount }}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">已停用</div>
                <div class="stat-value">{{ disabledCount }}</div>
            </div>
        </div>

        <div class="content-grid">
            <div class="panel catalog-panel">
                <div class="panel-header catalog-header">
                    <div>
                        <div class="panel-title">Catalog</div>
                        <div class="panel-description">
                            展示当前注册到 ChatLuna
                            的全部工具，并实时反映未保存草稿。
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

                <div v-if="filteredTools.length > 0" class="card-grid">
                    <div
                        v-for="item in filteredTools"
                        :key="item.name"
                        class="tool-card"
                        :class="{
                            active: item.name === selectedName,
                            muted: !item.enabled
                        }"
                        @click="selectTool(item.name)"
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
                                    <div class="tool-name">
                                        {{ item.source || 'unknown' }}
                                        {{
                                            item.group ? ` / ${item.group}` : ''
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

                        <div class="tool-description">
                            {{ item.description || '这个工具暂时没有说明。' }}
                        </div>

                        <div class="tool-tags">
                            <el-tag size="small" effect="plain">
                                {{ item.enabled ? '启用' : '停用' }}
                            </el-tag>
                            <el-tag
                                size="small"
                                effect="plain"
                                :type="item.main ? 'success' : 'info'"
                            >
                                {{ item.main ? 'main 可用' : 'main 禁用' }}
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
                        </div>

                        <div v-if="item.tags?.length" class="tool-meta">
                            {{ item.tags.join(', ') }}
                        </div>

                        <div class="tool-actions">
                            <el-button
                                size="small"
                                @click.stop="selectTool(item.name)"
                            >
                                编辑
                            </el-button>
                        </div>
                    </div>
                </div>

                <div v-else class="empty-state">
                    <el-empty description="没有匹配的工具。" />
                </div>
            </div>

            <div class="panel editor-panel">
                <div class="panel-header">
                    <div>
                        <div class="panel-title">Editor</div>
                        <div class="panel-description">
                            这里的全局规则会先于 sub-agent
                            自身权限生效，再由权限服务统一计算最终可用范围。
                        </div>
                    </div>

                    <div v-if="selectedTool && dirty" class="editor-actions">
                        <el-button @click="resetDraft">还原</el-button>
                        <el-button type="primary" @click="saveDraft">
                            保存
                        </el-button>
                    </div>
                </div>

                <div v-if="selectedTool && draftItem" class="editor-body">
                    <div class="field-grid readonly-grid">
                        <div class="field-card">
                            <div class="field-label">工具名</div>
                            <div class="field-static">
                                {{ selectedTool.name }}
                            </div>
                        </div>
                        <div class="field-card">
                            <div class="field-label">来源</div>
                            <div class="field-static">
                                {{ selectedTool.source || 'unknown' }}
                            </div>
                        </div>
                        <div class="field-card">
                            <div class="field-label">分组</div>
                            <div class="field-static">
                                {{ selectedTool.group || '未设置' }}
                            </div>
                        </div>
                        <div class="field-card">
                            <div class="field-label">MCP Server</div>
                            <div class="field-static">
                                {{ selectedTool.serverName || '不是 MCP 工具' }}
                            </div>
                        </div>
                    </div>

                    <div class="field-card full-row">
                        <div class="field-label">说明</div>
                        <div class="tool-description detail-description">
                            {{
                                selectedTool.description ||
                                '这个工具暂时没有说明。'
                            }}
                        </div>
                    </div>

                    <div class="field-grid">
                        <div class="field-card switch-card">
                            <div>
                                <div class="field-label">全局启用</div>
                                <div class="field-help">
                                    关闭后 main agent 与所有 sub-agent
                                    都无法使用。
                                </div>
                            </div>
                            <el-switch v-model="draftItem.enabled" />
                        </div>

                        <div class="field-card switch-card">
                            <div>
                                <div class="field-label">Main Agent</div>
                                <div class="field-help">
                                    控制主会话是否能看到并调用这个工具。
                                </div>
                            </div>
                            <el-switch v-model="draftItem.main" />
                        </div>
                    </div>

                    <div class="field-card full-row">
                        <div class="field-label">Sub Agent 范围</div>
                        <div class="field-help">
                            `all` 为全部 sub-agent，`allow`
                            为仅允许指定项，`deny` 为排除指定项。
                        </div>

                        <div class="scope-grid">
                            <el-select v-model="draftItem.subAgents.mode">
                                <el-option label="all" value="all" />
                                <el-option label="allow" value="allow" />
                                <el-option label="deny" value="deny" />
                            </el-select>

                            <el-select
                                v-if="draftItem.subAgents.mode !== 'all'"
                                v-model="scopeValues"
                                multiple
                                filterable
                                clearable
                                collapse-tags
                                collapse-tags-tooltip
                                placeholder="选择 sub-agent"
                            >
                                <el-option
                                    v-for="item in agentOptions"
                                    :key="item.id"
                                    :label="agentLabel(item)"
                                    :value="item.id"
                                />
                            </el-select>
                        </div>
                    </div>

                    <div class="field-card full-row">
                        <div class="field-label">生效预览</div>
                        <div class="grant-tags">
                            <el-tag
                                size="small"
                                effect="plain"
                                :type="draftItem.main ? 'success' : 'info'"
                            >
                                {{
                                    draftItem.main
                                        ? 'main agent 可用'
                                        : 'main agent 禁用'
                                }}
                            </el-tag>
                            <el-tag
                                v-for="item in grantedAgents"
                                :key="item.id"
                                size="small"
                                effect="plain"
                            >
                                {{ item.name }}
                            </el-tag>
                            <span
                                v-if="grantedAgents.length < 1"
                                class="grant-empty"
                            >
                                当前没有 sub-agent 能使用这个工具
                            </span>
                        </div>
                    </div>

                    <div
                        v-if="selectedTool.tags?.length"
                        class="field-card full-row"
                    >
                        <div class="field-label">标签</div>
                        <div class="tool-meta">
                            {{ selectedTool.tags.join(', ') }}
                        </div>
                    </div>
                </div>

                <div v-else class="empty-editor">
                    <el-empty description="请选择一个工具查看详情。" />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RefreshRight, Search, Tools } from '@element-plus/icons-vue'
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
const selectedName = ref('')
const draft = ref<ToolConfig>(cloneConfig(props.config))

watch(
    () => props.config,
    (value) => {
        draft.value = cloneConfig(value)
    },
    { immediate: true, deep: true }
)

watch(
    () => props.status.catalog,
    () => {
        ensureSelection()
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

const draftItem = computed(() => {
    const item = selectedTool.value
    if (!item) {
        return undefined
    }

    if (!draft.value.items[item.name]) {
        draft.value.items[item.name] = createItem(item)
    }

    return draft.value.items[item.name]
})

const scopeValues = computed({
    get: () => {
        const item = draftItem.value
        if (!item) {
            return []
        }

        return item.subAgents.mode === 'deny'
            ? item.subAgents.deny
            : item.subAgents.allow
    },
    set: (value: string[]) => {
        const item = draftItem.value
        if (!item) {
            return
        }

        const next = uniqueIds(value)
        if (item.subAgents.mode === 'deny') {
            item.subAgents.deny = next
            item.subAgents.allow = []
            return
        }

        item.subAgents.allow = next
        item.subAgents.deny = []
    }
})

const grantedAgents = computed(() => {
    const item = selectedTool.value
    const current = draftItem.value
    if (!item || !current || !current.enabled) {
        return []
    }

    return agentOptions.value.filter((agent) =>
        matchRule(agent.id, current.subAgents)
    )
})

const dirty = computed(() => {
    return (
        JSON.stringify(normalizeConfig(draft.value)) !==
        JSON.stringify(normalizeConfig(props.config))
    )
})

const mainCount = computed(
    () => tools.value.filter((item) => item.enabled && item.main).length
)
const subAgentCount = computed(
    () =>
        tools.value.filter(
            (item) => item.enabled && hasSubAgentAccess(item.subAgents)
        ).length
)
const disabledCount = computed(
    () => tools.value.filter((item) => !item.enabled).length
)

watch(
    () => draftItem.value?.subAgents.mode,
    (mode) => {
        const item = draftItem.value
        if (!item || !mode) {
            return
        }

        if (mode === 'all') {
            item.subAgents.allow = []
            item.subAgents.deny = []
            return
        }

        if (mode === 'allow') {
            item.subAgents.deny = []
            return
        }

        item.subAgents.allow = []
    }
)

function ensureSelection() {
    if (
        selectedName.value &&
        tools.value.some((item) => item.name === selectedName.value)
    ) {
        return
    }

    selectedName.value = tools.value[0]?.name ?? ''
}

function selectTool(name: string) {
    selectedName.value = name
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
}

function saveDraft() {
    emit('save', normalizeConfig(draft.value))
}

function resetDraft() {
    draft.value = cloneConfig(props.config)
}

function agentLabel(item: SubAgentInfo) {
    return `${item.name} · ${item.source}${item.scope ? ` / ${item.scope}` : ''}`
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

function uniqueIds(value: string[]) {
    return value.filter(
        (item, idx, list) => item.length > 0 && list.indexOf(item) === idx
    )
}

function matchRule(name: string, rule: PermissionRule) {
    if (rule.mode === 'allow') {
        return rule.allow.includes(name)
    }

    if (rule.mode === 'deny') {
        return !rule.deny.includes(name)
    }

    return true
}

function hasSubAgentAccess(rule: PermissionRule) {
    return rule.mode !== 'allow' || rule.allow.length > 0
}
</script>

<style scoped>
.tool-page {
    min-height: 100%;
    width: min(100%, 1480px);
    margin: 0 auto;
    padding-bottom: 56px;
}

.toolbar-container {
    position: sticky;
    top: 0;
    z-index: 5;
    background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--k-page-bg), var(--k-color-surface-1) 18%) 0%,
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
    font-size: 19px;
    font-weight: 600;
    color: var(--k-color-text);
}

.page-description,
.panel-description,
.field-help,
.tool-name,
.tool-description,
.tool-meta,
.grant-empty {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
}

.actions-section,
.editor-actions,
.tool-tags,
.grant-tags {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.stats-row,
.content-grid,
.field-grid,
.scope-grid {
    display: grid;
    gap: 18px;
}

.stats-row {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-bottom: 18px;
}

.content-grid {
    grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.95fr);
}

.stat-card,
.panel,
.field-card {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(
        in srgb,
        var(--k-color-surface-1),
        var(--k-page-bg) 18%
    );
}

.stat-card {
    padding: 16px 18px;
}

.stat-label,
.field-label,
.panel-title,
.tool-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-color-text);
}

.stat-value {
    margin-top: 8px;
    font-size: 28px;
    font-weight: 700;
    color: color-mix(in srgb, var(--k-color-text), var(--k-color-primary) 24%);
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
    width: min(340px, 100%);
}

.card-grid,
.editor-body {
    padding: 16px;
}

.card-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: stretch;
}

.tool-card {
    flex: 0 1 320px;
    max-width: 360px;
    min-width: 0;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 12px;
    background: color-mix(
        in srgb,
        var(--k-color-surface-2),
        var(--k-page-bg) 16%
    );
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    cursor: pointer;
    transition:
        border-color 0.2s ease,
        transform 0.2s ease;
}

.tool-card:hover,
.tool-card.active {
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 40%);
    transform: translateY(-1px);
}

.tool-card.muted {
    opacity: 0.72;
}

.tool-top {
    align-items: flex-start;
}

.tool-brand {
    justify-content: flex-start;
    min-width: 0;
}

.tool-icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(
        in srgb,
        var(--k-color-surface-1),
        var(--k-color-primary) 8%
    );
    color: color-mix(in srgb, var(--k-color-text), var(--k-color-primary) 36%);
    flex: 0 0 auto;
}

.tool-description {
    min-height: 58px;
}

.detail-description {
    min-height: 0;
    margin-top: 8px;
}

.tool-actions {
    display: flex;
    justify-content: flex-end;
}

.field-grid,
.scope-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.readonly-grid {
    margin-bottom: 14px;
}

.field-card {
    padding: 14px;
}

.field-card.full-row {
    grid-column: 1 / -1;
}

.field-static {
    margin-top: 8px;
    font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
    color: var(--k-color-text);
}

.switch-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.empty-state,
.empty-editor {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 280px;
}

@media (max-width: 1200px) {
    .content-grid,
    .stats-row {
        grid-template-columns: 1fr;
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

    .actions-section,
    .editor-actions {
        width: 100%;
        justify-content: flex-end;
    }

    .field-grid,
    .scope-grid {
        grid-template-columns: 1fr;
    }

    .search-input {
        width: 100%;
    }

    .card-grid > .tool-card {
        flex-basis: 100%;
        max-width: none;
    }
}
</style>
