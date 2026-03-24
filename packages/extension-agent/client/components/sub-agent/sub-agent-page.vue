<template>
    <div
        class="sub-agent-page"
        :class="{ compact: compactMode }"
    >
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">子 Agent</div>
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
                    <input
                        ref="fileInput"
                        type="file"
                        accept=".md,text/markdown"
                        class="hidden-input"
                        @change="handleUpload"
                    />
                    <el-button @click="showPresetDialog = true">
                        从预设创建
                    </el-button>
                    <el-button @click="fileInput?.click()">
                        上传 Markdown
                    </el-button>
                    <el-button @click="reloadSubAgents">重新扫描</el-button>
                </div>
            </div>
        </div>

        <div class="page-content" v-loading="loading || busy">
            <Transition name="page-swap" mode="out-in">
                <div v-if="currentView === 'list'" key="list-view">
                    <div class="tabs">
                        <div
                            :class="['tab', { active: listTab === 'catalog' }]"
                            @click="listTab = 'catalog'"
                        >
                            列表
                        </div>
                        <div
                            :class="['tab', { active: listTab === 'runs' }]"
                            @click="listTab = 'runs'"
                        >
                            运行记录
                        </div>
                        <div
                            :class="['tab', { active: listTab === 'availability' }]"
                            @click="listTab = 'availability'"
                        >
                            工具可用性
                        </div>
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
                            @toggle="toggleAgent"
                            @remove="removeAgent"
                        />
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
                    key="detail-view"
                    :agent="selectedAgent"
                    :draft="draft"
                    :model-names="modelNames"
                    :skill-options="skillOptions"
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
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRaw, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useCompactMode, useHideDesc } from '../shared/use-hide-desc'
import SubAgentCatalog from './sub-agent-catalog.vue'
import SubAgentDetail from './sub-agent-detail.vue'
import SubAgentRuns from './sub-agent-runs.vue'
import SubAgentAvailability from './sub-agent-availability.vue'
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
        computer?: ComputerStatus
        tools: Record<string, ToolInfo>
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
        skills: () => ({}),
        computer: undefined,
        tools: () => ({}),
        loading: false
    }
)

defineEmits<{
    refresh: []
}>()

const fileInput = ref<HTMLInputElement>()
const busy = ref(false)
const compactMode = useCompactMode('subAgent')
const hideDesc = useHideDesc('subAgent')
const currentView = ref<'list' | 'detail'>('list')
const listTab = ref<'catalog' | 'runs' | 'availability'>('catalog')
const agents = ref<SubAgentInfo[]>([])
const runs = ref<SubAgentRunInfo[]>([])
const toolAvailability = ref<ToolAvailabilityInfo[]>([])
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

onMounted(async () => {
    await loadExtraData()
})

function openDetail(id: string) {
    selectedId.value = id
    currentView.value = 'detail'
}

async function loadExtraData() {
    try {
        busy.value = true
        const [catalog, runList, availability, presets, models] =
            await Promise.all([
                send('chatluna-agent/getSubAgents'),
                send('chatluna-agent/getSubAgentRuns'),
                send('chatluna-agent/getToolAvailability'),
                send('chatluna-agent/getPresetNames'),
                send('chatluna-agent/getModelNames')
            ])

        agents.value = [...catalog]
        runs.value = [...runList]
        toolAvailability.value = [...availability]
        presetNames.value = [...presets]
        modelNames.value = [...models]
    } catch {
        ElMessage.error('读取 sub-agent 数据失败，请稍后重试。')
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
    if (!item) return

    try {
        busy.value = true
        const next = structuredClone(toRaw(props.config))
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
        await loadExtraData()
        ElMessage.success('已删除该 sub-agent。')
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

    if (!file) return

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
    width: 100%;
    min-width: 0;
    margin: 0 auto;
    padding-bottom: 56px;
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

    .tabs {
        width: 100%;
        box-sizing: border-box;
        overflow-x: auto;
        justify-content: flex-start;
        scrollbar-width: none;
    }

    .tabs::-webkit-scrollbar {
        display: none;
    }

    .tab {
        flex-shrink: 0;
        text-align: center;
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

@media (max-width: 768px) {
    .headline {
        justify-content: space-between;
        width: 100%;
        box-sizing: border-box;
    }

    .mobile-only-desc-toggle {
        display: inline-flex;
    }

    .hidden-mobile {
        display: none;
    }

    .tabs {
        width: 100%;
        box-sizing: border-box;
        overflow-x: auto;
        justify-content: flex-start;
        scrollbar-width: none;
    }

    .tabs::-webkit-scrollbar {
        display: none;
    }

    .tab {
        flex-shrink: 0;
        text-align: center;
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
    }

    .tab {
        flex: 1 1 0;
        text-align: center;
    }
}
</style>
