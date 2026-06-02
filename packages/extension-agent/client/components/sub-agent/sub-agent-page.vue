<template>
    <div
        class="sub-agent-page"
        :class="{ compact: compactMode }"
    >
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">Sub Agent</div>
                    <el-button
                        v-if="currentView === 'list' && listTab === 'catalog'"
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
                    <template v-if="currentView === 'list' && listTab === 'catalog'">
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
                        <div class="dedupe-switch">
                            <span>主 LLM 去重重复工具</span>
                            <el-switch
                                :model-value="props.config.dedupeTools === true"
                                @change="saveDedupeTools($event as boolean)"
                            />
                        </div>
                    </template>
                </div>
            </div>
        </div>

        <div class="page-content" v-loading="loading || busy">
            <Transition name="page-swap" mode="out-in">
                <div v-if="currentView === 'list'" key="list-view">
                    <div class="tabs">
                        <button
                            type="button"
                            :class="['tab', { active: listTab === 'catalog' }]"
                            @click="listTab = 'catalog'"
                        >
                            列表
                        </button>
                        <button
                            type="button"
                            :class="['tab', { active: listTab === 'runs' }]"
                            @click="listTab = 'runs'"
                        >
                            运行记录
                        </button>
                        <button
                            type="button"
                            :class="['tab', { active: listTab === 'availability' }]"
                            @click="listTab = 'availability'"
                        >
                            工具可用性
                        </button>
                    </div>

                    <Transition name="fade-slide" mode="out-in">
                        <sub-agent-catalog
                            v-if="listTab === 'catalog'"
                            key="catalog"
                            :agents="agents"
                            :compact-mode="compactMode"
                            :hide-desc="hideDesc"
                            :removable-ids="removableIds"
                            @select="openDetail"
                            @preview="previewAgent"
                            @export="exportSubAgent"
                            @toggle="toggleAgent"
                            @remove="removeAgent"
                        >
                            <template #actions>
                                <el-button @click="showPresetDialog = true">
                                    从预设创建
                                </el-button>
                                <el-button @click="showMarkdownDialog = true">
                                    从 Markdown 创建
                                </el-button>
                            </template>
                        </sub-agent-catalog>
                        <sub-agent-runs
                            v-else-if="listTab === 'runs'"
                            key="runs"
                            :runs="runs"
                        />
                        <sub-agent-availability
                            v-else
                            key="availability"
                            :availability="toolAvailability"
                        />
                    </Transition>
                </div>

                <sub-agent-detail
                    v-else-if="selectedAgent"
                    :key="[
                        'detail-view',
                        selectedAgent.id,
                        skillOptions.length,
                        mcpOptions.length,
                        computerOptions.length,
                        Object.keys(props.tools ?? {}).length
                    ].join(':')"
                    :agent="selectedAgent"
                    :draft="draft"
                    :model-names="modelNames"
                    :skill-options="skillOptions"
                    :mcp-options="mcpOptions"
                    :computer-options="computerOptions"
                    :tools="tools"
                    :can-remove="canRemoveSelected"
                    @back="currentView = 'list'"
                    @save="saveSelected"
                    @remove="removeSelected"
                />
            </Transition>
        </div>

        <preset-dialog
            v-model:visible="showPresetDialog"
            :preset-names="presetNames"
            :model-names="modelNames"
            @create="createPresetAgent"
        />

        <sub-agent-import-markdown-dialog
            v-model:visible="showMarkdownDialog"
            @refresh="reloadSubAgents"
            @created="onAgentCreated"
        />

        <el-dialog
            v-model="showPreview"
            title="查看/修改 Sub Agent 内容"
            width="860px"
            destroy-on-close
            :close-on-click-modal="false"
            :fullscreen="mobile"
        >
            <div class="preview-meta">{{ previewTitle }}</div>
            <div class="preview-form">
                <div class="field-label">Agent 名称</div>
                <el-input
                    v-model="previewDraft.name"
                    placeholder="例如：my-agent"
                    :disabled="!canEditPreview"
                />

                <div class="field-label" style="margin-top: 12px">简介</div>
                <el-input
                    v-model="previewDraft.description"
                    placeholder="一句简短的描述"
                    :disabled="!canEditPreview"
                />

                <div class="field-label" style="margin-top: 12px">指令</div>
                <code-editor
                    v-model="previewDraft.promptContent"
                    language="markdown"
                    :min-height="320"
                    :readonly="!canEditPreview"
                />
            </div>
            <template #footer>
                <el-button @click="showPreview = false">取消</el-button>
                <el-button
                    type="primary"
                    :loading="savingPreview"
                    :disabled="!canSavePreview"
                    @click="savePreview"
                >
                    保存内容
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import {
    computed,
    onActivated,
    onBeforeUnmount,
    onDeactivated,
    onMounted,
    reactive,
    ref,
    toRaw,
    watch
} from 'vue'
import { send } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useCompactMode, useHideDesc } from '../shared/use-hide-desc'
import CodeEditor from '../shared/code-editor.vue'
import SubAgentCatalog from './sub-agent-catalog.vue'
import SubAgentDetail from './sub-agent-detail.vue'
import SubAgentRuns from './sub-agent-runs.vue'
import SubAgentAvailability from './sub-agent-availability.vue'
import SubAgentImportMarkdownDialog from './sub-agent-import-markdown-dialog.vue'
import PresetDialog from './preset-dialog.vue'
import type {
    ComputerStatus,
    PermissionRule,
    SkillInfo,
    SubAgentConfig,
    SubAgentInfo,
    SubAgentItemConfig,
    SubAgentRunInfo,
    ToolAvailabilityInfo,
    ToolInfo
} from '../../../src/types'

interface RuleDraft {
    mode: PermissionRule['mode']
    allowText: string
    denyText: string
}

const props = withDefaults(
    defineProps<{
        config: SubAgentConfig
        status: {
            enabled: boolean
            total: number
            catalog: Record<string, SubAgentInfo>
            runs: SubAgentRunInfo[]
        }
        skills?: Record<string, SkillInfo>
        mcp?: Record<string, any>
        computer?: ComputerStatus
        tools: Record<string, ToolInfo>
        loading?: boolean
    }>(),
    {
        config: () => ({
            dirs: ['~/.claude/agents', '~/.config/opencode/agents'],
            dedupeTools: false,
            items: {},
            builtin: {
                plan: {
                    enabled: false,
                    name: 'plan',
                    description: '',
                    chatluna: true,
                    character: true,
                    characterGroup: true,
                    characterPrivate: true,
                    characterGroupMode: 'all',
                    characterPrivateMode: 'all',
                    characterGroupIds: [],
                    characterPrivateIds: [],
                    authority: 0,
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
                    chatluna: true,
                    character: true,
                    characterGroup: true,
                    characterPrivate: true,
                    characterGroupMode: 'all',
                    characterPrivateMode: 'all',
                    characterGroupIds: [],
                    characterPrivateIds: [],
                    authority: 0,
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
                    chatluna: true,
                    character: true,
                    characterGroup: true,
                    characterPrivate: true,
                    characterGroupMode: 'all',
                    characterPrivateMode: 'all',
                    characterGroupIds: [],
                    characterPrivateIds: [],
                    authority: 0,
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
        skills: () => ({}),
        mcp: () => ({}),
        computer: undefined,
        tools: () => ({}),
        loading: false
    }
)

defineEmits<{
    refresh: []
}>()

const busy = ref(false)
const compactMode = useCompactMode('subAgent')
const hideDesc = useHideDesc('subAgent')
const currentView = ref<'list' | 'detail'>('list')
const listTab = ref<'catalog' | 'runs' | 'availability'>('catalog')
const active = ref(false)
const agents = ref<SubAgentInfo[]>([])
const runs = ref<SubAgentRunInfo[]>([])
const toolAvailability = ref<ToolAvailabilityInfo[]>([])
const presetNames = ref<string[]>([])
const modelNames = ref<string[]>([])
const selectedId = ref('')
const showPresetDialog = ref(false)
const showMarkdownDialog = ref(false)
const showPreview = ref(false)
const previewTitle = ref('')
const previewItem = ref<SubAgentInfo>()
const savingPreview = ref(false)
const mobile = ref(false)
const previewDraft = reactive({
    name: '',
    description: '',
    promptContent: ''
})

const draft = reactive({
    enabled: false,
    name: '',
    description: '',
    promptContent: '',
    chatluna: true,
    character: true,
    characterGroup: true,
    characterPrivate: true,
    characterGroupMode: 'all' as const,
    characterPrivateMode: 'all' as const,
    characterGroupIds: [] as string[],
    characterPrivateIds: [] as string[],
    authority: 0,
    model: '',
    maxTurns: 100,
    hidden: false,
    allowKoishiMessageTransform: false,
    skills: createRuleDraft('inherit'),
    mcp: createRuleDraft('inherit'),
    tools: createRuleDraft('inherit'),
    computer: createRuleDraft('inherit')
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
        if (!value) return

        draft.enabled = value.enabled
        draft.name = value.name ?? ''
        draft.description = value.description ?? ''
        draft.promptContent = value.promptContent ?? ''
        draft.chatluna = value.chatlunaEnabled
        draft.character = value.characterEnabled
        draft.characterGroup = value.characterGroupEnabled
        draft.characterPrivate = value.characterPrivateEnabled
        draft.characterGroupMode = value.characterGroupMode
        draft.characterPrivateMode = value.characterPrivateMode
        draft.characterGroupIds = [...value.characterGroupIds]
        draft.characterPrivateIds = [...value.characterPrivateIds]
        draft.authority = value.authority
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

const canRemoveSelected = computed(() => {
    const item = selectedAgent.value
    if (!item) return false
    return canRemoveAgent(item)
})
const canEditPreview = computed(() => {
    return previewItem.value?.source === 'markdown' && !previewItem.value.remote
})
const canSavePreview = computed(() => {
    return (
        canEditPreview.value &&
        previewDraft.name.trim().length > 0 &&
        previewDraft.description.trim().length > 0 &&
        previewDraft.promptContent.trim().length > 0
    )
})
const removableIds = computed(() => {
    return agents.value
        .filter((item) => canRemoveAgent(item))
        .map((item) => item.id)
})
const skillOptions = computed(() => {
    return Object.values(props.skills ?? {})
        .filter((item) => item.visible && item.state === 'ready')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({
            value: item.name,
            label: item.name
        }))
})
const mcpOptions = computed(() => {
    return Object.values(props.mcp ?? {})
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({
            value: item.name,
            label: item.name
        }))
})
const computerOptions = computed(() => {
    const status = props.computer?.backends
    return [
        {
            value: 'local',
            label:
                status?.local?.state === 'unsupported'
                    ? 'Local · 未启用'
                    : 'Local'
        },
        {
            value: 'e2b',
            label: status?.e2b?.state === 'unsupported' ? 'E2B · 未启用' : 'E2B'
        },
        {
            value: 'open-terminal',
            label:
                status?.['open-terminal']?.state === 'unsupported'
                    ? 'open-terminal · 未启用'
                    : 'open-terminal'
        }
    ]
})

onMounted(() => {
    mobile.value = window.innerWidth <= 768
    window.addEventListener('resize', onResize)
})

onActivated(async () => {
    active.value = true
    await loadMeta()
    if (listTab.value === 'availability') {
        await loadAvailability()
    }
})

onDeactivated(() => {
    active.value = false
})

onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize)
})

watch(
    () => listTab.value,
    async (value) => {
        if (value !== 'availability' || !active.value) {
            return
        }

        await loadAvailability()
    }
)

watch(
    [() => props.status.catalog, () => props.tools, () => props.skills],
    async () => {
        if (!active.value || listTab.value !== 'availability') {
            return
        }

        await loadAvailability()
    },
    { deep: true }
)

function openDetail(id: string) {
    selectedId.value = id
    currentView.value = 'detail'
}

function onResize() {
    mobile.value = window.innerWidth <= 768
}

function onAgentCreated(id: string) {
    openDetail(id)
}

async function loadMeta() {
    try {
        busy.value = true
        const [presets, models] = await Promise.all([
            send('chatluna-agent/getPresetNames'),
            send('chatluna-agent/getModelNames')
        ])

        presetNames.value = [...presets]
        modelNames.value = [...models]
    } catch {
        ElMessage.error('读取 Sub Agent 扩展数据失败，请稍后重试。')
    } finally {
        busy.value = false
    }
}

async function loadAvailability() {
    try {
        toolAvailability.value = await send('chatluna-agent/getToolAvailability')
    } catch {
        ElMessage.error('读取工具可用性失败，请稍后重试。')
    }
}

async function reloadSubAgents() {
    try {
        busy.value = true
        await send('chatluna-agent/reloadSubAgents')
        if (listTab.value === 'availability') {
            await loadAvailability()
        }
        await loadMeta()
        ElMessage.success('已重新扫描 Sub Agent 目录。')
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
        if (listTab.value === 'availability') {
            await loadAvailability()
        }
        ElMessage.success(enabled ? '已启用该 agent。' : '已停用该 agent。')
    } catch {
        ElMessage.error('更新 agent 状态失败，请稍后重试。')
    }
}

async function saveSelected() {
    const item = selectedAgent.value
    if (!item) return

    try {
        busy.value = true
        const next = structuredClone(toRaw(props.config))
        const saved = {
            enabled: draft.enabled,
            name: draft.name,
            description: draft.description,
            chatluna: draft.chatluna,
            character: draft.character,
            characterGroup: draft.characterGroup,
            characterPrivate: draft.characterPrivate,
            characterGroupMode: draft.characterGroupMode,
            characterPrivateMode: draft.characterPrivateMode,
            characterGroupIds: [...draft.characterGroupIds],
            characterPrivateIds: [...draft.characterPrivateIds],
            authority: draft.authority,
            source: item.source,
            format: item.format,
            model: draft.model.trim() || undefined,
            maxTurns: draft.maxTurns,
            hidden: draft.hidden,
            promptContent: draft.promptContent,
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
        if (listTab.value === 'availability') {
            await loadAvailability()
        }
        ElMessage.success('已保存 Sub Agent 配置。')
    } catch {
        ElMessage.error('保存失败，请稍后重试。')
    } finally {
        busy.value = false
    }
}

async function saveDedupeTools(enabled: boolean) {
    try {
        busy.value = true
        await send('chatluna-agent/saveSubAgentConfig', {
            ...structuredClone(toRaw(props.config)),
            dedupeTools: enabled
        })
        ElMessage.success(enabled ? '已启用工具去重。' : '已关闭工具去重。')
    } catch {
        ElMessage.error('保存工具去重配置失败，请稍后重试。')
    } finally {
        busy.value = false
    }
}

async function removeSelected() {
    const item = selectedAgent.value
    if (!item) return

    await removeAgent(item)
}

async function removeAgent(item: SubAgentInfo) {
    const selected = selectedId.value === item.id

    try {
        await ElMessageBox.confirm(
            `删除"${item.name}"后需要手动重新导入或重新创建，确定继续吗？`,
            '删除 Sub Agent',
            {
                confirmButtonText: '删除',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )

        await send('chatluna-agent/removeSubAgent', item.id)
        if (selected) {
            currentView.value = 'list'
        }
        if (listTab.value === 'availability') {
            await loadAvailability()
        }
        ElMessage.success('已删除该 Sub Agent。')
    } catch (error) {
        if (error !== 'cancel' && error !== 'close') {
            ElMessage.error('删除失败，请稍后重试。')
        }
    }
}

async function createPresetAgent(
    name: string,
    preset: string,
        options: {
            description: string
            chatluna?: boolean
            character?: boolean
            characterGroup?: boolean
            characterPrivate?: boolean
            characterGroupMode?: 'all' | 'allow' | 'deny'
            characterPrivateMode?: 'all' | 'allow' | 'deny'
            characterGroupIds?: string[]
            characterPrivateIds?: string[]
            authority?: number
            model: string | undefined
            maxTurns: number
            hidden: boolean
        allowKoishiMessageTransform: boolean
    }
) {
    if (!name.trim() || !preset.trim()) {
        ElMessage.warning('请先填写名称并选择预设。')
        return
    }

    try {
        busy.value = true
        await send('chatluna-agent/createPresetAgent', name, preset, options)
        showPresetDialog.value = false
        if (listTab.value === 'availability') {
            await loadAvailability()
        }
        await loadMeta()
        ElMessage.success('已创建 preset agent。')
    } catch {
        ElMessage.error('创建 preset agent 失败，请稍后重试。')
    } finally {
        busy.value = false
    }
}

async function exportSubAgent(item?: SubAgentInfo) {
    if (!item) return

    try {
        const result = await send('chatluna-agent/exportSubAgent', item.id)
        if (!result) {
            ElMessage.warning('这个 Sub Agent 暂时不能导出。')
            return
        }

        const blob = new Blob([result.content], {
            type: 'text/markdown;charset=utf-8'
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')

        link.href = url
        link.download = result.fileName
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
        ElMessage.success('已开始下载 Sub Agent Markdown。')
    } catch {
        ElMessage.error('导出失败，请稍后重试。')
    }
}

function previewAgent(item: SubAgentInfo) {
    previewItem.value = item
    previewTitle.value = item.name
    previewDraft.name = item.name
    previewDraft.description = item.description
    previewDraft.promptContent = item.promptContent
    showPreview.value = true
}

async function savePreview() {
    const item = previewItem.value
    if (!item || !canSavePreview.value) return

    if (item.scope !== 'data' && item.name !== previewDraft.name.trim()) {
        ElMessage.warning('外部 Markdown Agent 暂不支持在这里改名，请保持原名称后再保存。')
        return
    }

    try {
        await ElMessageBox.confirm(
            item.name !== previewDraft.name.trim()
                ? '您修改了 Agent 名称，这将会创建一个新的副本。确定要继续吗？'
                : '确定要保存修改后的内容吗？',
            '确认保存',
            {
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )
    } catch {
        return
    }

    try {
        savingPreview.value = true
        const input = {
            name: previewDraft.name.trim(),
            description: previewDraft.description.trim(),
            promptContent: previewDraft.promptContent.trim(),
            chatluna: item.chatlunaEnabled,
            character: item.characterEnabled,
            characterGroup: item.characterGroupEnabled,
            characterPrivate: item.characterPrivateEnabled,
            characterGroupMode: item.characterGroupMode,
            characterPrivateMode: item.characterPrivateMode,
            characterGroupIds: item.characterGroupIds,
            characterPrivateIds: item.characterPrivateIds,
            authority: item.authority,
            model: item.model,
            maxTurns: item.maxTurns,
            hidden: item.hidden,
            enabled: item.enabled,
            allowKoishiMessageTransform: item.allowKoishiMessageTransform,
            permissions: item.permissions
        }

        if (item.scope === 'data') {
            await send('chatluna-agent/addSubAgent', input)
        } else {
            await send('chatluna-agent/saveSubAgentContent', item.id, input)
        }
        ElMessage.success('保存内容成功。')
        showPreview.value = false
        if (listTab.value === 'availability') {
            await loadAvailability()
        }
    } catch (error) {
        ElMessage.error(
            `保存失败：${error instanceof Error ? error.message : String(error)}`
        )
    } finally {
        savingPreview.value = false
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

function canRemoveAgent(item: SubAgentInfo) {
    if (item.source === 'preset' || item.source === 'manual') {
        return true
    }

    return item.source === 'markdown' && (item.scope === 'data' || item.remote)
}
</script>

<style scoped>
.sub-agent-page {
    min-height: 100%;
    width: min(100%, 1800px);
    min-width: 0;
    margin: 0 auto;
    padding-bottom: 56px;
    box-sizing: border-box;
}

.sub-agent-page.compact {
    width: min(100%, 1440px);
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

.dedupe-switch {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--k-text-light);
}

.tabs {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 18px;
    margin-bottom: 22px;
    padding: 4px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 28%);
    border-radius: 16px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 48%);
    width: fit-content;
    max-width: 100%;
    box-sizing: border-box;
}

.tab {
    border: none;
    background: transparent;
    padding: 10px 16px;
    cursor: pointer;
    transition:
        background-color 0.2s ease,
        color 0.2s ease;
    font-weight: 500;
    color: var(--k-text-light);
    border-radius: 12px;
    white-space: nowrap;
}

.tab:hover {
    background: color-mix(in srgb, var(--k-activity-bg), transparent 18%);
}

.tab.active {
    background: var(--k-side-bg);
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 24%);
    box-shadow: inset 0 0 0 1px
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
}

.hidden-input {
    display: none;
}

.preview-meta {
    margin-bottom: 12px;
    font-size: 13px;
    color: var(--k-text-light);
}

.preview-form {
    display: flex;
    flex-direction: column;
}

.field-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--k-text-dark);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
    transition: all 0.2s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
    opacity: 0;
    transform: translateY(8px);
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

    .mobile-only-desc-toggle {
        display: inline-flex;
    }

    .tabs {
        width: 100%;
        justify-content: center;
        overflow: hidden;
    }

    .tab {
        flex: 1 1 0;
        text-align: center;
    }

    :deep(.el-dialog.is-fullscreen .el-dialog__body) {
        padding-top: 12px;
    }
}
</style>
