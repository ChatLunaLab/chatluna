<template>
    <div class="sub-agent-page" v-loading="loading || busy">
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">Sub Agent</div>
                    <div class="page-description">
                        管理内置 agent、扫描到的 markdown agent、预设生成
                        agent， 并查看实时运行状态与工具授权覆盖情况。
                    </div>
                </div>

                <div class="actions-section">
                    <input
                        ref="fileInput"
                        type="file"
                        accept=".md,text/markdown"
                        class="hidden-input"
                        @change="handleUpload"
                    />
                    <el-button @click="openPresetDialog">从预设创建</el-button>
                    <el-button @click="fileInput?.click()">
                        上传 Markdown
                    </el-button>
                    <el-button @click="reloadSubAgents">重新扫描</el-button>
                    <el-button circle @click="refreshAll">
                        <el-icon><RefreshRight /></el-icon>
                    </el-button>
                </div>
            </div>
        </div>

        <div class="stats-row">
            <div class="stat-card">
                <div class="stat-label">总数</div>
                <div class="stat-value">{{ agents.length }}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">当前启用</div>
                <div class="stat-value">{{ enabledCount }}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">活跃运行</div>
                <div class="stat-value">{{ activeRuns.length }}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">可委托</div>
                <div class="stat-value">{{ runnableCount }}</div>
            </div>
        </div>

        <div class="content-grid">
            <div class="panel catalog-panel">
                <div class="panel-header catalog-header">
                    <div>
                        <div class="panel-title">Catalog</div>
                        <div class="panel-description">
                            显示 builtin、markdown 和 preset 三类
                            agent，支持启停与查看详情。
                        </div>
                    </div>

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

                <div v-if="filteredAgents.length > 0" class="card-grid">
                    <div
                        v-for="item in filteredAgents"
                        :key="item.id"
                        class="agent-card"
                        :class="{
                            active: item.id === selectedId,
                            muted: !!item.shadowedBy,
                            invalid: item.state !== 'ready'
                        }"
                        @click="selectAgent(item.id)"
                    >
                        <div class="agent-head">
                            <div class="agent-copy">
                                <div class="agent-title">{{ item.name }}</div>
                                <div class="agent-desc">
                                    {{
                                        item.description ||
                                        '这个 agent 暂时没有说明。'
                                    }}
                                </div>
                            </div>

                            <el-switch
                                :model-value="item.enabled"
                                @change="toggleAgent(item, $event as boolean)"
                                @click.stop
                            />
                        </div>

                        <div class="agent-meta">
                            <div class="agent-path">
                                {{ item.path || item.preset || '内置定义' }}
                            </div>
                        </div>

                        <div class="agent-tags">
                            <el-tag size="small" effect="plain">
                                {{ item.source }}
                            </el-tag>
                            <el-tag size="small" effect="plain">
                                {{ item.format }}
                            </el-tag>
                            <el-tag
                                v-if="item.scope"
                                size="small"
                                effect="plain"
                            >
                                {{ item.scope }}
                            </el-tag>
                            <el-tag
                                size="small"
                                effect="plain"
                                :type="stateTag(item.state)"
                            >
                                {{ stateLabel(item.state) }}
                            </el-tag>
                            <el-tag
                                size="small"
                                effect="plain"
                                :type="item.shadowedBy ? 'info' : 'success'"
                            >
                                {{
                                    item.shadowedBy
                                        ? '被高优先级同名 agent 遮蔽'
                                        : item.hidden
                                          ? '隐藏'
                                          : '可见'
                                }}
                            </el-tag>
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

                <div v-else class="empty-state">
                    <el-empty description="没有匹配的 sub-agent。" />
                </div>
            </div>

            <div class="panel editor-panel">
                <div class="panel-header">
                    <div>
                        <div class="panel-title">Editor</div>
                        <div class="panel-description">
                            调整当前 agent 的模型、轮次、可见性和权限覆盖项。
                        </div>
                    </div>

                    <div class="editor-actions" v-if="selectedAgent">
                        <el-button
                            v-if="canRemoveSelected"
                            type="danger"
                            plain
                            @click="removeSelected"
                        >
                            删除
                        </el-button>
                        <el-button type="primary" @click="saveSelected">
                            保存
                        </el-button>
                    </div>
                </div>

                <div v-if="selectedAgent" class="editor-body">
                    <div class="field-grid readonly-grid">
                        <div class="field-card">
                            <div class="field-label">名称</div>
                            <div class="field-static">
                                {{ selectedAgent.name }}
                            </div>
                        </div>
                        <div class="field-card">
                            <div class="field-label">来源</div>
                            <div class="field-static">
                                {{
                                    `${selectedAgent.source} / ${selectedAgent.format}`
                                }}
                            </div>
                        </div>
                        <div class="field-card full-row">
                            <div class="field-label">说明</div>
                            <div class="field-static">
                                {{ selectedAgent.description || '暂无说明。' }}
                            </div>
                        </div>
                    </div>

                    <div class="field-grid">
                        <div class="field-card">
                            <div class="field-label">模型覆盖</div>
                            <el-select
                                v-model="draft.model"
                                clearable
                                filterable
                                placeholder="留空则继承父会话模型"
                            >
                                <el-option label="继承当前会话模型" value="" />
                                <el-option
                                    v-for="item in draftModelOptions"
                                    :key="item"
                                    :label="item"
                                    :value="item"
                                />
                            </el-select>
                        </div>
                        <div class="field-card">
                            <div class="field-label">最大轮次</div>
                            <el-input-number
                                v-model="draft.maxTurns"
                                :min="1"
                                :max="100"
                                :step="1"
                            />
                        </div>
                        <div class="field-card switch-card">
                            <div>
                                <div class="field-label">隐藏</div>
                                <div class="field-help">
                                    隐藏后不会出现在 handoff 工具描述里。
                                </div>
                            </div>
                            <el-switch v-model="draft.hidden" />
                        </div>
                        <div class="field-card switch-card">
                            <div>
                                <div class="field-label">Koishi 消息解析</div>
                                <div class="field-help">
                                    开启后会把输入中的 Koishi
                                    元素转成多模态消息。
                                </div>
                            </div>
                            <el-switch
                                v-model="draft.allowKoishiMessageTransform"
                            />
                        </div>
                    </div>

                    <el-collapse class="permission-collapse">
                        <el-collapse-item title="Skills 权限" name="skills">
                            <permission-editor v-model="draft.skills" />
                        </el-collapse-item>
                        <el-collapse-item title="MCP 权限" name="mcp">
                            <permission-editor v-model="draft.mcp" />
                        </el-collapse-item>
                        <el-collapse-item title="Tools 权限" name="tools">
                            <permission-editor v-model="draft.tools" />
                        </el-collapse-item>
                        <el-collapse-item title="Computer 权限" name="computer">
                            <permission-editor v-model="draft.computer" />
                        </el-collapse-item>
                    </el-collapse>

                    <div
                        v-if="selectedAgent.diagnostics.length > 0"
                        class="diagnostics-panel"
                    >
                        <div class="field-label">诊断信息</div>
                        <div
                            v-for="line in selectedAgent.diagnostics"
                            :key="line"
                            class="diagnostic-line"
                        >
                            {{ line }}
                        </div>
                    </div>
                </div>

                <div v-else class="empty-editor">
                    <el-empty description="请选择一个 sub-agent 查看详情。" />
                </div>
            </div>
        </div>

        <div class="bottom-grid">
            <div class="panel runs-panel">
                <div class="panel-header">
                    <div>
                        <div class="panel-title">Runs</div>
                        <div class="panel-description">
                            展示当前运行中的委托任务和最近完成的几次运行。
                        </div>
                    </div>
                </div>

                <div v-if="runs.length > 0" class="runs-list">
                    <div v-for="item in runs" :key="item.runId" class="run-row">
                        <div class="run-main">
                            <div class="run-title">
                                {{ item.agentName }}
                            </div>
                            <div class="run-meta">
                                {{ formatTime(item.startedAt) }}
                                · 深度 {{ item.depth }} · 工具
                                {{ item.toolCount }} · 回合 {{ item.turnCount }}
                            </div>
                        </div>

                        <div class="run-side">
                            <el-tag
                                size="small"
                                effect="plain"
                                :type="runTag(item.state)"
                            >
                                {{ item.state }}
                            </el-tag>
                            <div class="run-last">
                                {{ item.lastTool || '尚未调用工具' }}
                            </div>
                        </div>
                    </div>
                </div>

                <div v-else class="empty-state compact-empty">
                    <el-empty description="目前还没有 sub-agent 运行记录。" />
                </div>
            </div>

            <div class="panel grants-panel">
                <div class="panel-header">
                    <div>
                        <div class="panel-title">Tool Grants</div>
                        <div class="panel-description">
                            反向查看每个工具当前会被哪些 sub-agent 看到与允许。
                        </div>
                    </div>
                </div>

                <div v-if="toolGrants.length > 0" class="grants-list">
                    <div
                        v-for="item in toolGrants"
                        :key="item.name"
                        class="grant-row"
                    >
                        <div class="grant-title">{{ item.name }}</div>
                        <div class="grant-meta">
                            {{ item.source || 'unknown' }}
                            {{ item.group ? ` / ${item.group}` : '' }}
                        </div>
                        <div class="grant-tags">
                            <el-tag
                                v-for="agent in item.agents"
                                :key="agent"
                                size="small"
                                effect="plain"
                            >
                                {{ agent }}
                            </el-tag>
                            <span
                                v-if="item.agents.length === 0"
                                class="grant-empty"
                            >
                                当前没有 sub-agent 获得这个工具
                            </span>
                        </div>
                    </div>
                </div>

                <div v-else class="empty-state compact-empty">
                    <el-empty description="暂时没有工具授权数据。" />
                </div>
            </div>
        </div>

        <el-dialog
            v-model="showPresetDialog"
            title="从预设创建 Agent"
            width="640px"
        >
            <div class="preset-form">
                <div class="field-card full-row">
                    <div class="field-label">名称</div>
                    <el-input
                        v-model="presetForm.name"
                        placeholder="例如 docs-writer"
                    />
                </div>
                <div class="field-card full-row">
                    <div class="field-label">说明</div>
                    <el-input
                        v-model="presetForm.description"
                        type="textarea"
                        :rows="3"
                        placeholder="这个预设 agent 适合做什么"
                    />
                </div>
                <div class="field-card full-row">
                    <div class="field-label">预设</div>
                    <el-select
                        v-model="presetForm.preset"
                        placeholder="选择预设"
                    >
                        <el-option
                            v-for="item in presetNames"
                            :key="item"
                            :label="item"
                            :value="item"
                        />
                    </el-select>
                </div>
                <div class="field-grid two-col-grid">
                    <div class="field-card">
                        <div class="field-label">模型覆盖</div>
                        <el-select
                            v-model="presetForm.model"
                            clearable
                            filterable
                            placeholder="留空则继承父会话模型"
                        >
                            <el-option label="继承当前会话模型" value="" />
                            <el-option
                                v-for="item in presetModelOptions"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                    </div>
                    <div class="field-card">
                        <div class="field-label">最大轮次</div>
                        <el-input-number
                            v-model="presetForm.maxTurns"
                            :min="1"
                            :max="100"
                        />
                    </div>
                </div>
            </div>

            <template #footer>
                <el-button @click="showPresetDialog = false">取消</el-button>
                <el-button type="primary" @click="createPresetAgent">
                    创建
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, onMounted, reactive, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { RefreshRight, Search } from '@element-plus/icons-vue'
import type {
    PermissionRule,
    SubAgentConfig,
    SubAgentInfo,
    SubAgentItemConfig,
    SubAgentRunInfo,
    SubAgentStatus,
    ToolGrantInfo
} from '../../../src/types'

const PermissionEditor = defineComponent({
    name: 'PermissionEditor',
    props: {
        modelValue: {
            type: Object,
            required: true
        }
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        const value = computed({
            get: () => props.modelValue as RuleDraft,
            set: (next: RuleDraft) => emit('update:modelValue', next)
        })

        return { value }
    },
    template: `
        <div class="rule-grid">
            <div class="field-card">
                <div class="field-label">模式</div>
                <el-select v-model="value.mode">
                    <el-option label="inherit" value="inherit" />
                    <el-option label="all" value="all" />
                    <el-option label="allow" value="allow" />
                    <el-option label="deny" value="deny" />
                </el-select>
            </div>
            <div class="field-card full-row">
                <div class="field-label">Allow 列表</div>
                <el-input
                    v-model="value.allowText"
                    type="textarea"
                    :rows="3"
                    placeholder="用逗号或换行分隔"
                />
            </div>
            <div class="field-card full-row">
                <div class="field-label">Deny 列表</div>
                <el-input
                    v-model="value.denyText"
                    type="textarea"
                    :rows="3"
                    placeholder="用逗号或换行分隔"
                />
            </div>
        </div>
    `
})

interface RuleDraft {
    mode: PermissionRule['mode']
    allowText: string
    denyText: string
}

const props = withDefaults(
    defineProps<{
        config: SubAgentConfig
        status: SubAgentStatus
        loading?: boolean
    }>(),
    {
        config: () => ({
            dirs: ['~/.claude/agents', '~/.config/opencode/agents'],
            items: {},
            builtin: {
                plan: {
                    enabled: false,
                    name: 'plan',
                    description: '',
                    source: 'builtin',
                    format: 'chatluna',
                    maxTurns: 100,
                    hidden: false,
                    promptMode: 'markdown',
                    allowKoishiMessageTransform: false,
                    permissions: {
                        skills: { mode: 'inherit', allow: [], deny: [] },
                        mcp: { mode: 'inherit', allow: [], deny: [] },
                        tools: { mode: 'inherit', allow: [], deny: [] },
                        computer: { mode: 'deny', allow: [], deny: [] }
                    }
                },
                general: {
                    enabled: false,
                    name: 'general',
                    description: '',
                    source: 'builtin',
                    format: 'chatluna',
                    maxTurns: 100,
                    hidden: false,
                    promptMode: 'markdown',
                    allowKoishiMessageTransform: false,
                    permissions: {
                        skills: { mode: 'inherit', allow: [], deny: [] },
                        mcp: { mode: 'inherit', allow: [], deny: [] },
                        tools: { mode: 'inherit', allow: [], deny: [] },
                        computer: { mode: 'deny', allow: [], deny: [] }
                    }
                },
                explore: {
                    enabled: false,
                    name: 'explore',
                    description: '',
                    source: 'builtin',
                    format: 'chatluna',
                    maxTurns: 100,
                    hidden: false,
                    promptMode: 'markdown',
                    allowKoishiMessageTransform: false,
                    permissions: {
                        skills: { mode: 'inherit', allow: [], deny: [] },
                        mcp: { mode: 'inherit', allow: [], deny: [] },
                        tools: { mode: 'inherit', allow: [], deny: [] },
                        computer: { mode: 'deny', allow: [], deny: [] }
                    }
                }
            },
            presetAgents: {},
            defaults: {
                skills: { mode: 'inherit', allow: [], deny: [] },
                mcp: { mode: 'inherit', allow: [], deny: [] },
                tools: { mode: 'inherit', allow: [], deny: [] },
                computer: { mode: 'deny', allow: [], deny: [] }
            }
        }),
        status: () => ({
            enabled: false,
            total: 0,
            catalog: {},
            runs: []
        }),
        loading: false
    }
)

defineEmits<{
    refresh: []
}>()

const fileInput = ref<HTMLInputElement>()
const busy = ref(false)
const keyword = ref('')
const agents = ref<SubAgentInfo[]>([])
const runs = ref<SubAgentRunInfo[]>([])
const toolGrants = ref<ToolGrantInfo[]>([])
const presetNames = ref<string[]>([])
const modelNames = ref<string[]>([])
const selectedId = ref('')
const showPresetDialog = ref(false)

const draft = reactive({
    model: '',
    maxTurns: 100,
    hidden: false,
    allowKoishiMessageTransform: false,
    skills: createRuleDraft(),
    mcp: createRuleDraft(),
    tools: createRuleDraft(),
    computer: createRuleDraft('deny')
})

const presetForm = reactive({
    name: '',
    description: '',
    preset: '',
    model: '',
    maxTurns: 100
})

watch(
    () => props.status.catalog,
    (value) => {
        agents.value = Object.values(value ?? {}).sort((a, b) => {
            if (a.priority !== b.priority) {
                return a.priority - b.priority
            }

            return a.name.localeCompare(b.name)
        })
        ensureSelection()
    },
    { immediate: true, deep: true }
)

watch(
    () => props.status.runs,
    (value) => {
        runs.value = [...(value ?? [])]
    },
    { immediate: true, deep: true }
)

const selectedAgent = computed(() => {
    return agents.value.find((item) => item.id === selectedId.value)
})

watch(
    selectedAgent,
    (value) => {
        if (!value) {
            return
        }

        draft.model = value.model ?? ''
        draft.maxTurns = value.maxTurns ?? 100
        draft.hidden = value.hidden
        draft.allowKoishiMessageTransform = value.allowKoishiMessageTransform
        draft.skills = toRuleDraft(value.permissions.skills)
        draft.mcp = toRuleDraft(value.permissions.mcp)
        draft.tools = toRuleDraft(value.permissions.tools)
        draft.computer = toRuleDraft(value.permissions.computer)
    },
    { immediate: true }
)

const filteredAgents = computed(() => {
    const text = keyword.value.trim().toLowerCase()
    if (!text) {
        return agents.value
    }

    return agents.value.filter((item) => {
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

const draftModelOptions = computed(() => {
    const items = new Set(modelNames.value)
    if (draft.model.trim()) {
        items.add(draft.model.trim())
    }
    return [...items]
})

const presetModelOptions = computed(() => {
    const items = new Set(modelNames.value)
    if (presetForm.model.trim()) {
        items.add(presetForm.model.trim())
    }
    return [...items]
})

const enabledCount = computed(
    () => agents.value.filter((item) => item.enabled).length
)
const activeRuns = computed(() =>
    runs.value.filter((item) => item.state === 'running')
)
const runnableCount = computed(
    () =>
        agents.value.filter(
            (item) =>
                item.enabled &&
                item.state === 'ready' &&
                !item.shadowedBy &&
                !item.hidden
        ).length
)
const canRemoveSelected = computed(() => {
    const item = selectedAgent.value
    if (!item) {
        return false
    }

    return (
        item.source === 'preset' ||
        (item.source === 'markdown' && item.scope === 'data')
    )
})

onMounted(async () => {
    await loadExtraData()
})

async function loadExtraData() {
    try {
        busy.value = true
        const [catalog, runList, grants, presets, models] = await Promise.all([
            send('chatluna-agent/getSubAgents'),
            send('chatluna-agent/getSubAgentRuns'),
            send('chatluna-agent/getToolGrants'),
            send('chatluna-agent/getPresetNames'),
            send('chatluna-agent/getModelNames')
        ])

        agents.value = [...catalog]
        runs.value = [...runList]
        toolGrants.value = [...grants]
        presetNames.value = [...presets]
        modelNames.value = [...models]
        ensureSelection()
    } catch {
        ElMessage.error('读取 sub-agent 数据失败，请稍后重试。')
    } finally {
        busy.value = false
    }
}

function ensureSelection() {
    if (
        selectedId.value &&
        agents.value.some((item) => item.id === selectedId.value)
    ) {
        return
    }

    selectedId.value = agents.value[0]?.id ?? ''
}

function selectAgent(id: string) {
    selectedId.value = id
}

async function refreshAll() {
    try {
        busy.value = true
        await send('chatluna-agent/refreshConsoleData')
        await loadExtraData()
        ElMessage.success('已刷新 sub-agent 数据。')
    } catch {
        ElMessage.error('刷新失败，请稍后重试。')
    } finally {
        busy.value = false
    }
}

async function reloadSubAgents() {
    try {
        busy.value = true
        await send('chatluna-agent/reloadSubAgents')
        await loadExtraData()
        ElMessage.success('已重新扫描 sub-agent 目录。')
    } catch {
        ElMessage.error('重新扫描失败，请稍后重试。')
    } finally {
        busy.value = false
    }
}

async function toggleAgent(item: SubAgentInfo, enabled: boolean) {
    try {
        await send('chatluna-agent/setSubAgentEnabled', item.id, enabled)
        item.enabled = enabled
        await loadExtraData()
        ElMessage.success(enabled ? '已启用该 agent。' : '已停用该 agent。')
    } catch {
        ElMessage.error('更新 agent 状态失败，请稍后重试。')
    }
}

async function saveSelected() {
    const item = selectedAgent.value
    if (!item) {
        return
    }

    try {
        busy.value = true
        const next = structuredClone(props.config)
        const saved = {
            enabled: item.enabled,
            name: item.name,
            description: item.description,
            source: item.source,
            format: item.format,
            model: draft.model.trim() || undefined,
            maxTurns: draft.maxTurns,
            hidden: draft.hidden,
            promptMode: item.promptMode,
            preset: item.preset,
            allowKoishiMessageTransform: draft.allowKoishiMessageTransform,
            permissions: {
                skills: fromRuleDraft(draft.skills),
                mcp: fromRuleDraft(draft.mcp),
                tools: fromRuleDraft(draft.tools),
                computer: fromRuleDraft(draft.computer)
            }
        } satisfies SubAgentItemConfig

        if (item.source === 'builtin') {
            const key = item.id.replace(
                'builtin:',
                ''
            ) as keyof SubAgentConfig['builtin']
            next.builtin[key] = saved
        } else if (item.source === 'preset') {
            next.presetAgents[item.id.replace('preset:', '')] = saved
        } else {
            next.items[item.id] = saved
        }

        await send('chatluna-agent/saveSubAgentConfig', next)
        await loadExtraData()
        ElMessage.success('已保存 sub-agent 配置。')
    } catch {
        ElMessage.error('保存失败，请稍后重试。')
    } finally {
        busy.value = false
    }
}

async function removeSelected() {
    const item = selectedAgent.value
    if (!item) {
        return
    }

    try {
        await ElMessageBox.confirm(
            `删除“${item.name}”后需要手动重新导入或重新创建，确定继续吗？`,
            '删除 Sub Agent',
            {
                confirmButtonText: '删除',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )

        await send('chatluna-agent/removeSubAgent', item.id)
        await loadExtraData()
        ElMessage.success('已删除该 sub-agent。')
    } catch (error) {
        if (error !== 'cancel') {
            ElMessage.error('删除失败，请稍后重试。')
        }
    }
}

function openPresetDialog() {
    presetForm.name = ''
    presetForm.description = ''
    presetForm.preset = presetNames.value[0] ?? ''
    presetForm.model = ''
    presetForm.maxTurns = 100
    showPresetDialog.value = true
}

async function createPresetAgent() {
    if (!presetForm.name.trim() || !presetForm.preset.trim()) {
        ElMessage.warning('请先填写名称并选择预设。')
        return
    }

    try {
        busy.value = true
        await send(
            'chatluna-agent/createPresetAgent',
            presetForm.name.trim(),
            presetForm.preset,
            {
                description:
                    presetForm.description.trim() || presetForm.name.trim(),
                model: presetForm.model.trim() || undefined,
                maxTurns: presetForm.maxTurns,
                hidden: false,
                allowKoishiMessageTransform: false
            }
        )
        showPresetDialog.value = false
        await loadExtraData()
        ElMessage.success('已创建 preset agent。')
    } catch {
        ElMessage.error('创建 preset agent 失败，请稍后重试。')
    } finally {
        busy.value = false
    }
}

async function handleUpload(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''

    if (!file) {
        return
    }

    try {
        busy.value = true
        await send('chatluna-agent/uploadSubAgent', {
            name: file.name,
            data: await file.text()
        })
        await loadExtraData()
        ElMessage.success('已导入 markdown agent。')
    } catch {
        ElMessage.error('上传失败，请稍后重试。')
    } finally {
        busy.value = false
    }
}

function createRule(mode: PermissionRule['mode'] = 'inherit'): PermissionRule {
    return {
        mode,
        allow: [],
        deny: []
    }
}

function createEmptyItem(
    name: string,
    source: SubAgentItemConfig['source']
): SubAgentItemConfig {
    return {
        enabled: false,
        name,
        description: '',
        source,
        format: 'chatluna',
        maxTurns: 100,
        hidden: false,
        promptMode: source === 'preset' ? 'preset' : 'markdown',
        allowKoishiMessageTransform: false,
        permissions: {
            skills: createRule(),
            mcp: createRule(),
            tools: createRule(),
            computer: createRule('deny')
        }
    }
}

function createRuleDraft(mode: PermissionRule['mode'] = 'inherit'): RuleDraft {
    return {
        mode,
        allowText: '',
        denyText: ''
    }
}

function toRuleDraft(rule: PermissionRule): RuleDraft {
    return {
        mode: rule.mode,
        allowText: rule.allow.join(', '),
        denyText: rule.deny.join(', ')
    }
}

function fromRuleDraft(rule: RuleDraft): PermissionRule {
    return {
        mode: rule.mode,
        allow: splitItems(rule.allowText),
        deny: splitItems(rule.denyText)
    }
}

function splitItems(text: string) {
    return text
        .split(/[\n,]/g)
        .map((item) => item.trim())
        .filter(
            (item, idx, list) => item.length > 0 && list.indexOf(item) === idx
        )
}

function stateLabel(state: SubAgentInfo['state']) {
    if (state === 'ready') return '可用'
    if (state === 'invalid') return '无效'
    return '缺失'
}

function stateTag(state: SubAgentInfo['state']) {
    if (state === 'ready') return 'success'
    if (state === 'invalid') return 'warning'
    return 'info'
}

function runTag(state: SubAgentRunInfo['state']) {
    if (state === 'running') return 'warning'
    if (state === 'completed') return 'success'
    if (state === 'aborted') return 'info'
    return 'danger'
}

function formatTime(value: number) {
    return new Date(value).toLocaleString()
}
</script>

<style scoped>
.sub-agent-page {
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
.panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.headline {
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
.agent-desc,
.agent-path,
.diagnostic-line,
.run-meta,
.grant-meta,
.grant-empty {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
}

.actions-section,
.editor-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.stats-row,
.bottom-grid,
.content-grid {
    display: grid;
    gap: 18px;
}

.stats-row {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-bottom: 18px;
}

.content-grid {
    grid-template-columns: minmax(0, 1.2fr) minmax(360px, 0.9fr);
    margin-bottom: 18px;
}

.bottom-grid {
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
}

.stat-card,
.panel,
.field-card,
.run-row,
.grant-row {
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
.grant-title,
.run-title {
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
}

.panel-header {
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
}

.catalog-panel,
.editor-panel,
.runs-panel,
.grants-panel {
    min-height: 420px;
}

.search-input {
    width: min(340px, 100%);
}

.card-grid,
.runs-list,
.grants-list,
.editor-body {
    padding: 16px;
}

.card-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: stretch;
}

.agent-card {
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

.agent-card:hover,
.agent-card.active {
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 40%);
    transform: translateY(-1px);
}

.agent-card.muted {
    opacity: 0.72;
}

.agent-card.invalid {
    border-color: color-mix(in srgb, var(--el-color-warning), transparent 60%);
}

.agent-head,
.run-row {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: flex-start;
}

.agent-copy,
.run-main {
    min-width: 0;
}

.agent-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--k-color-text);
}

.agent-path,
.field-static {
    font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
}

.agent-tags,
.grant-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.diagnostic-box,
.diagnostics-panel {
    padding: 12px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--el-color-warning), transparent 95%);
}

.field-grid,
.rule-grid,
.preset-form {
    display: grid;
    gap: 14px;
}

.field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.two-col-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.readonly-grid {
    margin-bottom: 14px;
}

.field-card {
    padding: 14px;
}

.field-card.full-row,
.rule-grid .full-row {
    grid-column: 1 / -1;
}

.switch-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.permission-collapse {
    margin-top: 16px;
}

.runs-list,
.grants-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.run-row,
.grant-row {
    padding: 14px;
}

.run-side {
    min-width: 120px;
    text-align: right;
}

.run-last {
    margin-top: 8px;
    font-size: 12px;
    color: var(--k-text-light);
}

.empty-state,
.empty-editor {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 280px;
}

.compact-empty {
    min-height: 220px;
}

.hidden-input {
    display: none;
}

@media (max-width: 1200px) {
    .content-grid,
    .bottom-grid,
    .stats-row {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 768px) {
    .toolbar-main,
    .catalog-header,
    .panel-header,
    .agent-head,
    .run-row {
        flex-direction: column;
        align-items: flex-start;
    }

    .actions-section,
    .editor-actions {
        width: 100%;
        justify-content: flex-end;
    }

    .field-grid,
    .two-col-grid {
        grid-template-columns: 1fr;
    }

    .search-input {
        width: 100%;
    }

    .card-grid > .agent-card {
        flex-basis: 100%;
        max-width: none;
    }

    .run-side {
        min-width: 0;
        text-align: left;
    }
}
</style>
