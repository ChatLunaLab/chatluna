<template>
    <el-dialog
        :model-value="visible"
        title="编辑工具"
        width="640px"
        :close-on-click-modal="false"
        @update:model-value="$emit('update:visible', $event)"
    >
        <div v-if="tool && draft" class="editor-body">
            <div class="field-grid readonly-grid">
                <div class="field-card">
                    <div class="field-label">工具名</div>
                    <div class="field-static">{{ tool.name }}</div>
                </div>
                <div class="field-card">
                    <div class="field-label">来源</div>
                    <div class="field-static">
                        {{ tool.source || 'unknown' }}
                    </div>
                </div>
                <div class="field-card">
                    <div class="field-label">分组</div>
                    <div class="field-static">
                        {{ tool.group || '未设置' }}
                    </div>
                </div>
                <div class="field-card">
                    <div class="field-label">MCP Server</div>
                    <div class="field-static">
                        {{ tool.serverName || '不是 MCP 工具' }}
                    </div>
                </div>
            </div>

            <div class="field-card full-row">
                <div class="field-label">说明</div>
                <div class="tool-description">
                    {{ tool.description || '这个工具暂时没有说明。' }}
                </div>
            </div>

            <div class="field-grid">
                <div class="field-card switch-card">
                    <div>
                        <div class="field-label">全局启用</div>
                        <div class="field-help">
                            关闭后 main agent 与所有 sub-agent 都无法使用。
                        </div>
                    </div>
                    <el-switch v-model="draft.enabled" />
                </div>

                <div class="field-card switch-card">
                    <div>
                        <div class="field-label">主 Agent 启用</div>
                        <div class="field-help">
                            控制主 Agent 是否允许调用这个工具。
                        </div>
                    </div>
                    <el-switch v-model="draft.main" />
                </div>
            </div>

            <div class="field-card full-row">
                <div class="field-label">Sub Agent 范围</div>
                <div class="field-help">
                    `all` 为全部 sub-agent，`allow` 为仅允许指定项，`deny`
                    为排除指定项。
                </div>

                <div class="scope-grid">
                    <el-select v-model="draft.subAgents.mode">
                        <el-option label="all" value="all" />
                        <el-option label="allow" value="allow" />
                        <el-option label="deny" value="deny" />
                    </el-select>

                    <el-select
                        v-if="draft.subAgents.mode !== 'all'"
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
                        :type="draft.main ? 'success' : 'info'"
                    >
                        {{ draft.main ? '主 Agent 可用' : '主 Agent 禁用' }}
                    </el-tag>
                    <el-tag
                        v-for="item in grantedAgents"
                        :key="item.id"
                        size="small"
                        effect="plain"
                    >
                        {{ item.name }}
                    </el-tag>
                    <span v-if="grantedAgents.length < 1" class="grant-empty">
                        当前没有 sub-agent 能使用这个工具
                    </span>
                </div>
            </div>

            <div v-if="tool.tags?.length" class="field-card full-row">
                <div class="field-label">标签</div>
                <div class="tool-meta">{{ tool.tags.join(', ') }}</div>
            </div>
        </div>

        <template #footer>
            <el-button @click="$emit('update:visible', false)">取消</el-button>
            <el-button type="primary" @click="handleSave">保存</el-button>
        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
    PermissionRule,
    SubAgentInfo,
    ToolItemConfig
} from '../../../src/types'

interface ToolEntry {
    name: string
    source?: string
    group?: string
    serverName?: string
    description?: string
    tags?: string[]
    enabled: boolean
    main: boolean
    subAgents: PermissionRule
}

const props = defineProps<{
    visible: boolean
    tool: ToolEntry | undefined
    agentOptions: SubAgentInfo[]
}>()

const emit = defineEmits<{
    'update:visible': [value: boolean]
    save: [name: string, item: ToolItemConfig]
}>()

const draft = ref<ToolItemConfig | undefined>()

watch(
    () => props.tool,
    (tool) => {
        if (!tool) {
            draft.value = undefined
            return
        }

        draft.value = {
            enabled: tool.enabled,
            main: tool.main,
            subAgents: cloneRule(tool.subAgents)
        }
    },
    { immediate: true }
)

watch(
    () => draft.value?.subAgents.mode,
    (mode) => {
        if (!draft.value || !mode) return

        if (mode === 'all') {
            draft.value.subAgents.allow = []
            draft.value.subAgents.deny = []
        } else if (mode === 'allow') {
            draft.value.subAgents.deny = []
        } else {
            draft.value.subAgents.allow = []
        }
    }
)

const scopeValues = computed({
    get: () => {
        if (!draft.value) return []
        return draft.value.subAgents.mode === 'deny'
            ? draft.value.subAgents.deny
            : draft.value.subAgents.allow
    },
    set: (value: string[]) => {
        if (!draft.value) return
        const next = uniqueIds(value)
        if (draft.value.subAgents.mode === 'deny') {
            draft.value.subAgents.deny = next
            draft.value.subAgents.allow = []
        } else {
            draft.value.subAgents.allow = next
            draft.value.subAgents.deny = []
        }
    }
})

const grantedAgents = computed(() => {
    if (!props.tool || !draft.value || !draft.value.enabled) return []
    return props.agentOptions.filter((agent) =>
        matchRule(agent.id, draft.value!.subAgents)
    )
})

function handleSave() {
    if (!props.tool || !draft.value) return
    emit('save', props.tool.name, {
        enabled: draft.value.enabled,
        main: draft.value.main,
        subAgents: cloneRule(draft.value.subAgents)
    })
    emit('update:visible', false)
}

function agentLabel(item: SubAgentInfo) {
    return `${item.name} · ${item.source}${item.scope ? ` / ${item.scope}` : ''}`
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
    if (rule.mode === 'allow') return rule.allow.includes(name)
    if (rule.mode === 'deny') return !rule.deny.includes(name)
    return true
}
</script>

<style scoped>
.editor-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.field-grid,
.scope-grid {
    display: grid;
    gap: 14px;
}

.field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.scope-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 10px;
}

.readonly-grid {
    margin-bottom: 0;
}

.field-card {
    padding: 14px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
}

.field-card.full-row {
    grid-column: 1 / -1;
}

.field-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.field-static {
    margin-top: 8px;
    color: var(--k-text-dark);
    line-height: 1.6;
}

.field-help,
.tool-description,
.tool-meta,
.grant-empty {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
    overflow-wrap: anywhere;
}

.tool-description {
    max-height: 160px;
    overflow: auto;
    white-space: pre-wrap;
    padding-right: 6px;
}

.switch-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.grant-tags {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 8px;
}

@media (max-width: 768px) {
    .field-grid,
    .scope-grid {
        grid-template-columns: 1fr;
    }
}
</style>
