<template>
    <div class="trigger-editor">
        <button
            type="button"
            class="back"
            :disabled="busy"
            @click="emit('back')"
        >
            <el-icon><ArrowLeft /></el-icon>
            <span>返回列表</span>
        </button>

        <div class="editor-head">
            <div class="head-copy">
                <h2>{{ task ? task.name : '新建触发器' }}</h2>
                <div v-if="task" class="state-line">
                    <el-tag
                        :type="statusType(task.state.status)"
                        effect="plain"
                    >
                        {{ statusLabels[task.state.status] }}
                    </el-tag>
                    <span>运行 {{ task.state.runCount }} 次</span>
                    <span>下次 {{ formatDate(task.state.nextRunAt) }}</span>
                </div>
            </div>
            <div class="head-actions">
                <el-button
                    v-if="task"
                    :icon="VideoPlay"
                    :disabled="busy"
                    @click="emit('fire')"
                >
                    立即执行
                </el-button>
                <el-button
                    v-if="task"
                    :icon="Delete"
                    type="danger"
                    plain
                    :disabled="busy"
                    @click="emit('remove')"
                >
                    删除
                </el-button>
            </div>
        </div>

        <el-alert
            v-if="error"
            class="backend-error"
            type="error"
            :title="error"
            :closable="false"
            show-icon
        />

        <div class="wizard-steps">
            <button
                type="button"
                :class="['step-item', { active: step === 1 }]"
                :disabled="busy"
                @click="step = 1"
            >
                <span class="step-num">1</span>
                <span class="step-copy">
                    <strong>触发条件</strong>
                    <small>场景与规则</small>
                </span>
            </button>
            <span class="step-line" />
            <button
                type="button"
                :class="['step-item', { active: step === 2 }]"
                :disabled="busy"
                @click="goNext"
            >
                <span class="step-num">2</span>
                <span class="step-copy">
                    <strong>执行与发送</strong>
                    <small>模型、会话与目标</small>
                </span>
            </button>
        </div>

        <div v-if="step === 1" class="editor-grid">
            <section class="editor-section scenario-section">
                <div class="section-head">
                    <span class="section-index">1</span>
                    <h3>触发场景</h3>
                </div>
                <div class="field full-row">
                    <label>任务名称</label>
                    <el-input
                        v-model="draft.name"
                        maxlength="100"
                        placeholder="例如：工作日晨间简报"
                    />
                </div>
                <div class="scenario-grid">
                    <button
                        v-for="item in scenarios"
                        :key="item.id"
                        type="button"
                        :class="[
                            'scenario-option',
                            { active: selectedScenarioId === item.id }
                        ]"
                        :disabled="busy"
                        @click="selectScenario(item)"
                    >
                        {{ item.label }}
                    </button>
                </div>
                <div class="enabled-row">
                    <div class="field-label">任务启用</div>
                    <el-switch v-model="draft.enabled" />
                </div>
            </section>

            <section class="editor-section condition-section">
                <div class="section-head">
                    <span class="section-index">2</span>
                    <h3>条件配置</h3>
                </div>
                <component
                    v-if="conditionEditor"
                    :is="conditionEditor"
                    v-model="draft.condition"
                    :models="models"
                    :timezones="timezones"
                />
                <schema-editor
                    v-else-if="extensionConfig != null && selectedProvider"
                    v-model="extensionConfig"
                    :schema="selectedProvider.schema"
                />
                <trigger-schedule-preview
                    v-if="showPreview"
                    :condition="draft.condition"
                />
            </section>
        </div>

        <div v-else class="editor-grid">
            <section class="editor-section execution-section">
                <div class="section-head">
                    <span class="section-index">3</span>
                    <h3>AI 执行配置</h3>
                </div>
                <div class="form-grid">
                    <div class="field full-row">
                        <label>模型</label>
                        <el-segmented
                            :model-value="draft.execution.model.type"
                            :options="[
                                { label: '默认模型', value: 'default' },
                                { label: '指定模型', value: 'fixed' }
                            ]"
                            @update:model-value="setModel"
                        />
                    </div>
                    <div
                        v-if="draft.execution.model.type === 'fixed'"
                        class="field full-row"
                    >
                        <label>指定模型</label>
                        <el-select
                            v-model="draft.execution.model.model"
                            filterable
                            placeholder="选择模型"
                        >
                            <el-option
                                v-for="item in models"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                    </div>
                    <div class="field full-row">
                        <label>Preset</label>
                        <el-segmented
                            :model-value="presetMode"
                            :options="[
                                { label: '默认 Preset', value: 'default' },
                                { label: '指定 Preset', value: 'fixed' }
                            ]"
                            @update:model-value="setPresetMode"
                        />
                    </div>
                    <div v-if="presetMode === 'fixed'" class="field full-row">
                        <label>指定 Preset</label>
                        <el-select
                            v-model="draft.execution.preset"
                            filterable
                            placeholder="选择 Preset"
                        >
                            <el-option
                                v-for="item in presets"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                    </div>
                    <div class="field full-row">
                        <label>会话</label>
                        <el-select
                            :model-value="draft.execution.conversation.type"
                            @update:model-value="setConversation"
                        >
                            <el-option label="任务专属会话" value="task" />
                            <el-option label="每次新建会话" value="fresh" />
                            <el-option label="当前路由会话" value="route" />
                            <el-option label="已有会话" value="existing" />
                        </el-select>
                    </div>
                    <div
                        v-if="draft.execution.conversation.type === 'existing'"
                        class="field full-row"
                    >
                        <label>会话 ID</label>
                        <el-input
                            v-model="
                                draft.execution.conversation.conversationId
                            "
                            placeholder="输入已有会话 ID"
                        />
                    </div>
                    <div class="field full-row">
                        <label>Prompt</label>
                        <el-input
                            v-model="draft.execution.prompt"
                            type="textarea"
                            :rows="5"
                            maxlength="12000"
                            show-word-limit
                            placeholder="输入任务执行指令"
                        />
                    </div>
                    <div class="field">
                        <label>超时</label>
                        <duration-input
                            v-model="draft.execution.timeoutSeconds"
                            base="seconds"
                        />
                    </div>
                    <div class="field">
                        <label>工具</label>
                        <el-segmented
                            :model-value="draft.execution.tools.type"
                            :options="[
                                { label: '不允许', value: 'none' },
                                { label: '白名单', value: 'allow' }
                            ]"
                            @update:model-value="setTools"
                        />
                    </div>
                    <div
                        v-if="draft.execution.tools.type === 'allow'"
                        class="field full-row"
                    >
                        <label>允许的工具</label>
                        <el-select
                            v-model="draft.execution.tools.names"
                            multiple
                            filterable
                            collapse-tags
                            collapse-tags-tooltip
                            placeholder="选择工具"
                        >
                            <el-option
                                v-for="item in toolOptions"
                                :key="item.name"
                                :label="item.name"
                                :value="item.name"
                                :disabled="!item.enabled"
                            />
                        </el-select>
                    </div>
                </div>
            </section>

            <section class="editor-section target-section">
                <div class="section-head">
                    <span class="section-index">4</span>
                    <h3>观察与发送目标</h3>
                </div>
                <div class="form-grid">
                    <div class="field full-row">
                        <label>机器人</label>
                        <el-select
                            :model-value="routeKey"
                            filterable
                            placeholder="选择机器人"
                            @update:model-value="setRoute"
                        >
                            <el-option
                                v-for="item in routes"
                                :key="`${item.platform}:${item.selfId}`"
                                :label="item.label"
                                :value="`${item.platform}:${item.selfId}`"
                            />
                        </el-select>
                    </div>
                    <div class="field full-row">
                        <label>目标类型</label>
                        <el-segmented
                            :model-value="draft.target.destination.type"
                            :options="[
                                { label: '群聊 / 频道', value: 'channel' },
                                { label: '私聊', value: 'direct' }
                            ]"
                            @update:model-value="setDestination"
                        />
                    </div>
                    <template
                        v-if="draft.target.destination.type === 'channel'"
                    >
                        <div class="field">
                            <label>群组</label>
                            <el-select
                                v-model="draft.target.destination.guildId"
                                filterable
                                clearable
                                allow-create
                                default-first-option
                                :loading="targetsLoading"
                                placeholder="选择或输入群组 ID"
                                @change="changeGuild"
                            >
                                <el-option
                                    v-for="item in guilds"
                                    :key="item.id"
                                    :label="
                                        item.name
                                            ? `${item.name} (${item.id})`
                                            : item.id
                                    "
                                    :value="item.id"
                                />
                            </el-select>
                        </div>
                        <div class="field">
                            <label>频道</label>
                            <el-select
                                v-model="draft.target.destination.channelId"
                                filterable
                                allow-create
                                default-first-option
                                :loading="channelsLoading"
                                placeholder="选择或输入频道 ID"
                            >
                                <el-option
                                    v-for="item in channels"
                                    :key="item.id"
                                    :label="
                                        item.name
                                            ? `${item.name} (${item.id})`
                                            : item.id
                                    "
                                    :value="item.id"
                                />
                            </el-select>
                        </div>
                    </template>
                    <div v-else class="field full-row">
                        <label>好友 / 用户</label>
                        <el-select
                            v-model="draft.target.destination.userId"
                            filterable
                            allow-create
                            default-first-option
                            :loading="targetsLoading"
                            placeholder="选择好友或输入用户 ID"
                        >
                            <el-option
                                v-for="item in friends"
                                :key="item.id"
                                :label="
                                    item.name
                                        ? `${item.name} (${item.id})`
                                        : item.id
                                "
                                :value="item.id"
                            />
                        </el-select>
                    </div>
                    <div class="field full-row">
                        <label>执行身份</label>
                        <el-input
                            v-model="draft.target.principalId"
                            placeholder="输入执行权限对应的用户 ID"
                        />
                    </div>
                    <div v-if="messageCondition" class="field full-row">
                        <label>观察范围</label>
                        <el-segmented
                            v-model="draft.target.observeScope"
                            :options="observeOptions"
                        />
                    </div>
                    <div class="field full-row">
                        <label>发送方式</label>
                        <el-segmented
                            v-model="draft.target.delivery"
                            :options="[
                                { label: '发送到频道', value: 'channel' },
                                { label: '发送私聊', value: 'direct' },
                                { label: '静默执行', value: 'silent' }
                            ]"
                        />
                    </div>
                </div>
            </section>
        </div>

        <div class="wizard-footer">
            <el-button
                v-if="step === 1"
                :icon="ArrowLeft"
                :disabled="busy"
                @click="emit('back')"
            >
                返回列表
            </el-button>
            <el-button
                v-else
                :icon="ArrowLeft"
                :disabled="busy"
                @click="step = 1"
            >
                上一步
            </el-button>
            <el-button
                v-if="step === 1"
                type="primary"
                :disabled="busy"
                @click="goNext"
            >
                下一步
                <el-icon class="el-icon--right"><ArrowRight /></el-icon>
            </el-button>
            <el-button
                v-else
                :icon="Check"
                type="primary"
                :loading="busy"
                @click="save"
            >
                {{ task ? '保存修改' : '创建任务' }}
            </el-button>
        </div>

        <section v-if="task" class="run-section">
            <div class="run-head">
                <h3>最近运行</h3>
                <el-button
                    size="small"
                    plain
                    :icon="RefreshRight"
                    :loading="runsLoading"
                    @click="loadRuns"
                >
                    刷新
                </el-button>
            </div>
            <div v-if="runsError" class="run-error">{{ runsError }}</div>
            <div v-else-if="runs.length" class="run-list">
                <div v-for="run in runs" :key="run.id" class="run-row">
                    <div class="run-main">
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="runType(run.status)"
                        >
                            {{ runStatus(run.status) }}
                        </el-tag>
                        <span>{{ originLabel(run.origin) }}</span>
                        <span>{{ formatDate(run.startedAt) }}</span>
                    </div>
                    <div class="run-detail">
                        <span v-if="run.decision">
                            {{ formatDecision(run.decision) }}
                        </span>
                        <span v-if="run.usage?.total_tokens">
                            {{ run.usage.total_tokens }} tokens
                        </span>
                        <span v-if="run.error" class="run-error">
                            {{ run.error }}
                        </span>
                    </div>
                </div>
            </div>
            <el-empty v-else-if="!runsLoading" description="暂无运行记录" />
        </section>
    </div>
</template>

<script setup lang="ts">
import { send } from '@koishijs/client'
import {
    ArrowLeft,
    ArrowRight,
    Check,
    Delete,
    RefreshRight,
    VideoPlay
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, reactive, ref, toRaw, watch } from 'vue'
import type {
    ToolAvailabilityInfo,
    TriggerProviderMeta,
    TriggerRun,
    TriggerRunStatus,
    TriggerTask,
    TriggerUpdateInput
} from '../../../src/types'
import DurationInput from './duration-input.vue'
import CalendarEditor from './editors/calendar-editor.vue'
import CronEditor from './editors/cron-editor.vue'
import InactivityEditor from './editors/inactivity-editor.vue'
import IntervalEditor from './editors/interval-editor.vue'
import KeywordEditor from './editors/keyword-editor.vue'
import OnceEditor from './editors/once-editor.vue'
import ParticipationEditor from './editors/participation-editor.vue'
import SemanticEditor from './editors/semantic-editor.vue'
import WindowEditor from './editors/window-editor.vue'
import SchemaEditor from './editors/schema-editor.vue'
import TriggerSchedulePreview from './trigger-schedule-preview.vue'
import {
    conditionKey,
    createCondition,
    createInput,
    formatDate,
    formatDecision,
    isMessageCondition,
    statusLabels,
    statusType,
    timezones,
    type ScenarioChoice,
    type TriggerRouteChoice
} from './types'

const props = defineProps<{
    task: TriggerTask | null
    routes: TriggerRouteChoice[]
    tools: ToolAvailabilityInfo[]
    models: string[]
    presets: string[]
    providers: TriggerProviderMeta[]
    scenarios: ScenarioChoice[]
    busy: boolean
    error: string
}>()

const emit = defineEmits<{
    back: []
    save: [input: TriggerUpdateInput]
    fire: []
    remove: []
}>()

const draft = reactive(createInput())
const guilds = ref<TargetItem[]>([])
const friends = ref<TargetItem[]>([])
const channels = ref<TargetItem[]>([])
const targetsLoading = ref(false)
const channelsLoading = ref(false)
const runs = ref<TriggerRun[]>([])
const runsLoading = ref(false)
const runsError = ref('')
const presetMode = ref<'default' | 'fixed'>('default')
const step = ref<1 | 2>(1)
let targetsSeq = 0
let channelsSeq = 0
let runsSeq = 0

const editors = {
    once: OnceEditor,
    calendar: CalendarEditor,
    interval: IntervalEditor,
    cron: CronEditor,
    window: WindowEditor,
    keyword: KeywordEditor,
    participation: ParticipationEditor,
    inactivity: InactivityEditor,
    semantic: SemanticEditor
}

const selectedScenarioId = computed(() => conditionKey(draft.condition))
const selectedProvider = computed(() =>
    props.providers.find((item) => item.id === selectedScenarioId.value)
)
const conditionEditor = computed(() => {
    if (draft.condition.type === 'extension') return null
    return editors[draft.condition.type as keyof typeof editors]
})
const extensionConfig = computed({
    get() {
        if (draft.condition.type !== 'extension') return null
        return draft.condition.config as Record<string, unknown>
    },
    set(value: Record<string, unknown> | null) {
        if (draft.condition.type !== 'extension' || value == null) return
        draft.condition.config = value
    }
})

const messageCondition = computed(() =>
    isMessageCondition(draft.condition, props.providers)
)
const showPreview = computed(() => {
    if (draft.condition.type === 'extension') {
        return selectedProvider.value?.kind === 'scheduled'
    }
    return ['once', 'calendar', 'interval', 'cron', 'window'].includes(
        draft.condition.type
    )
})
const routeKey = computed(
    () => `${draft.target.bot.platform}:${draft.target.bot.selfId}`
)
const toolOptions = computed(() =>
    [...props.tools].sort((a, b) => a.name.localeCompare(b.name))
)
const observeOptions = computed(() => {
    if (draft.target.destination.type === 'direct') {
        return [{ label: '当前私聊', value: 'direct' }]
    }
    return [
        { label: '当前频道', value: 'channel' },
        { label: '整个群组', value: 'guild' }
    ]
})

watch(
    () => props.task,
    (task) => {
        const input = task
            ? {
                  name: task.name,
                  enabled: task.enabled,
                  condition: structuredClone(toRaw(task.condition)),
                  execution: structuredClone(toRaw(task.execution)),
                  target: structuredClone(toRaw(task.target))
              }
            : createInput()
        Object.assign(draft, input)
        ensureExtensionConfig()
        presetMode.value = input.execution.preset ? 'fixed' : 'default'
        step.value = 1
        loadTargets()
        loadChannels()
        loadRuns()
    },
    { immediate: true }
)

watch(
    () => draft.condition,
    () => ensureExtensionConfig()
)

watch(messageCondition, (value) => {
    if (!value) {
        delete draft.target.observeScope
        return
    }
    if (draft.target.observeScope) return
    draft.target.observeScope =
        draft.target.destination.type === 'direct' ? 'direct' : 'channel'
})

function selectScenario(item: ScenarioChoice) {
    if (selectedScenarioId.value === item.id) return
    draft.condition = createCondition(item.id, item.provider)
    ensureExtensionConfig()
}

function setModel(value: string | number | boolean) {
    draft.execution.model =
        value === 'fixed' ? { type: 'fixed', model: '' } : { type: 'default' }
}

function setConversation(value: string | number | boolean) {
    draft.execution.conversation =
        value === 'existing'
            ? { type: 'existing', conversationId: '' }
            : { type: value as 'task' | 'fresh' | 'route' }
}

function setPresetMode(value: string | number | boolean) {
    presetMode.value = value === 'fixed' ? 'fixed' : 'default'
    draft.execution.preset = value === 'fixed' ? '' : null
}

function setTools(value: string | number | boolean) {
    draft.execution.tools =
        value === 'allow' ? { type: 'allow', names: [] } : { type: 'none' }
}

function setRoute(value: string | number | boolean) {
    const route = props.routes.find(
        (item) => `${item.platform}:${item.selfId}` === value
    )
    if (!route) return
    draft.target.bot = { platform: route.platform, selfId: route.selfId }
    guilds.value = []
    friends.value = []
    channels.value = []
    if (draft.target.destination.type === 'channel') {
        draft.target.destination.guildId = ''
        draft.target.destination.channelId = ''
    } else {
        draft.target.destination.userId = ''
    }
    loadTargets()
}

function setDestination(value: string | number | boolean) {
    draft.target.destination =
        value === 'direct'
            ? { type: 'direct', userId: '' }
            : { type: 'channel', guildId: '', channelId: '' }
    if (messageCondition.value) {
        draft.target.observeScope = value === 'direct' ? 'direct' : 'channel'
    }
}

function changeGuild() {
    if (draft.target.destination.type !== 'channel') return
    draft.target.destination.channelId = ''
    channels.value = []
    loadChannels()
}

async function loadTargets() {
    if (!draft.target.bot.platform || !draft.target.bot.selfId) return
    const current = ++targetsSeq
    targetsLoading.value = true
    try {
        const result = await send(
            'chatluna-agent/getTriggerTargets',
            draft.target.bot.platform,
            draft.target.bot.selfId
        )
        if (current !== targetsSeq) return
        guilds.value = result.guilds
        friends.value = result.friends
    } catch (err) {
        if (current !== targetsSeq) return
        ElMessage.error(err instanceof Error ? err.message : String(err))
    } finally {
        if (current === targetsSeq) targetsLoading.value = false
    }
}

async function loadChannels() {
    if (draft.target.destination.type !== 'channel') return
    if (!draft.target.destination.guildId) return
    if (!draft.target.bot.platform || !draft.target.bot.selfId) return
    const current = ++channelsSeq
    channelsLoading.value = true
    try {
        const result = await send(
            'chatluna-agent/getTriggerChannels',
            draft.target.bot.platform,
            draft.target.bot.selfId,
            draft.target.destination.guildId
        )
        if (current !== channelsSeq) return
        channels.value = result
    } catch (err) {
        if (current !== channelsSeq) return
        ElMessage.error(err instanceof Error ? err.message : String(err))
    } finally {
        if (current === channelsSeq) channelsLoading.value = false
    }
}

async function loadRuns() {
    if (!props.task) {
        runs.value = []
        return
    }
    const current = ++runsSeq
    runsLoading.value = true
    runsError.value = ''
    try {
        const result = await send(
            'chatluna-agent/listTriggerRuns',
            props.task.id,
            20
        )
        if (current !== runsSeq) return
        runs.value = result
    } catch (err) {
        if (current !== runsSeq) return
        runsError.value = err instanceof Error ? err.message : String(err)
    } finally {
        if (current === runsSeq) runsLoading.value = false
    }
}

function validateStep1() {
    draft.name = draft.name.trim()
    if (!draft.name) {
        ElMessage.warning('请输入任务名称。')
        return false
    }
    if (draft.condition.type === 'extension') {
        if (!draft.condition.provider) {
            ElMessage.warning('请选择扩展触发提供方。')
            return false
        }
        if (!selectedProvider.value) {
            ElMessage.warning(`触发提供方未注册：${draft.condition.provider}`)
            return false
        }
        const required = selectedProvider.value.schema.required
        const cfg = extensionConfig.value
        if (Array.isArray(required) && cfg != null) {
            for (const raw of required) {
                const key = String(raw)
                if (!isMissingConfigValue(cfg[key])) continue
                ElMessage.warning(`请填写扩展配置必填项：${key}`)
                return false
            }
        }
    }
    if (draft.condition.type === 'keyword') {
        draft.condition.keywords = Array.from(
            new Set(
                draft.condition.keywords
                    .map((item) => item.trim())
                    .filter(Boolean)
            )
        )
        if (!draft.condition.keywords.length) {
            ElMessage.warning('请输入至少一个关键词。')
            return false
        }
    }
    if (draft.condition.type === 'semantic' && !draft.condition.topic.trim()) {
        ElMessage.warning('请输入语义主题。')
        return false
    }
    if (draft.condition.type === 'once') {
        if (
            draft.condition.at == null ||
            draft.condition.at === '' ||
            Number.isNaN(new Date(draft.condition.at).valueOf())
        ) {
            ElMessage.warning('请选择有效的执行时间。')
            return false
        }
    }
    if (draft.condition.type === 'interval') {
        if (
            draft.condition.anchorAt == null ||
            draft.condition.anchorAt === '' ||
            Number.isNaN(new Date(draft.condition.anchorAt).valueOf())
        ) {
            ElMessage.warning('请选择有效的间隔锚点。')
            return false
        }
    }
    if (draft.condition.type === 'calendar') {
        if (draft.condition.times.length === 0) {
            ElMessage.warning('请至少添加一个执行时间。')
            return false
        }
        if (
            draft.condition.times.some(
                (item) => item == null || String(item).trim() === ''
            )
        ) {
            ElMessage.warning('请填写所有已添加的执行时间。')
            return false
        }
    }
    if (draft.condition.type === 'cron' && !draft.condition.expression.trim()) {
        ElMessage.warning('请输入 Cron 表达式。')
        return false
    }
    if (
        (draft.condition.type === 'calendar' ||
            draft.condition.type === 'window') &&
        draft.condition.days.length === 0
    ) {
        ElMessage.warning('请至少选择一天。')
        return false
    }
    if (draft.condition.type === 'window') {
        if (
            draft.condition.start == null ||
            String(draft.condition.start).trim() === ''
        ) {
            ElMessage.warning('请填写开始时间。')
            return false
        }
        if (
            draft.condition.end == null ||
            String(draft.condition.end).trim() === ''
        ) {
            ElMessage.warning('请填写结束时间。')
            return false
        }
    }
    let gate
    if (
        draft.condition.type === 'participation' ||
        draft.condition.type === 'inactivity' ||
        draft.condition.type === 'semantic'
    ) {
        gate = draft.condition.gate
    }
    if (
        gate?.type === 'model' &&
        gate.model.type === 'fixed' &&
        !gate.model.model
    ) {
        ElMessage.warning('请选择模型判断使用的指定模型。')
        return false
    }
    return true
}

function validateStep2() {
    draft.execution.prompt = draft.execution.prompt.trim()
    draft.target.principalId = draft.target.principalId.trim()
    if (!draft.execution.prompt) {
        ElMessage.warning('请输入 Prompt。')
        return false
    }
    if (
        draft.execution.model.type === 'fixed' &&
        !draft.execution.model.model
    ) {
        ElMessage.warning('请选择指定模型。')
        return false
    }
    if (
        draft.execution.conversation.type === 'existing' &&
        !draft.execution.conversation.conversationId.trim()
    ) {
        ElMessage.warning('请输入已有会话 ID。')
        return false
    }
    if (presetMode.value === 'fixed' && !draft.execution.preset) {
        ElMessage.warning('请选择指定 Preset。')
        return false
    }
    if (
        draft.execution.tools.type === 'allow' &&
        draft.execution.tools.names.length === 0
    ) {
        ElMessage.warning('请选择至少一个允许的工具。')
        return false
    }
    if (draft.execution.timeoutSeconds < 1) {
        ElMessage.warning('执行超时必须大于零。')
        return false
    }
    if (!draft.target.bot.platform || !draft.target.bot.selfId) {
        ElMessage.warning('请选择机器人。')
        return false
    }
    if (!draft.target.principalId) {
        ElMessage.warning('请输入执行身份。')
        return false
    }
    if (
        draft.target.destination.type === 'channel' &&
        !draft.target.destination.channelId.trim()
    ) {
        ElMessage.warning('请选择或输入频道 ID。')
        return false
    }
    if (
        draft.target.destination.type === 'direct' &&
        !draft.target.destination.userId.trim()
    ) {
        ElMessage.warning('请选择或输入私聊用户 ID。')
        return false
    }
    if (messageCondition.value && !draft.target.observeScope) {
        ElMessage.warning('请选择观察范围。')
        return false
    }
    return true
}

function goNext() {
    if (validateStep1()) step.value = 2
}

function save() {
    if (!validateStep1() || !validateStep2()) return
    if (!messageCondition.value) delete draft.target.observeScope

    const payload = structuredClone(toRaw(draft)) as TriggerUpdateInput
    if (
        payload.target.destination.type === 'channel' &&
        (payload.target.destination.guildId == null ||
            payload.target.destination.guildId === '')
    ) {
        delete payload.target.destination.guildId
    }
    if (
        payload.condition.type === 'participation' ||
        payload.condition.type === 'inactivity' ||
        payload.condition.type === 'semantic'
    ) {
        const g = payload.condition.gate
        if (
            g.type === 'model' &&
            (g.prompt == null || g.prompt.trim() === '')
        ) {
            delete g.prompt
        }
    }

    emit('save', payload)
}

function runType(status: TriggerRunStatus) {
    if (status === 'completed') return 'success'
    if (status === 'running') return 'warning'
    if (status === 'failed') return 'danger'
    return 'info'
}

function runStatus(status: TriggerRunStatus) {
    if (status === 'completed') return '完成'
    if (status === 'running') return '运行中'
    if (status === 'failed') return '失败'
    return '跳过'
}

function originLabel(origin: TriggerRun['origin']) {
    if (origin === 'schedule') return '计划执行'
    if (origin === 'event') return '事件触发'
    return '手动执行'
}

function ensureExtensionConfig() {
    if (draft.condition.type !== 'extension') return
    if (
        draft.condition.config != null &&
        typeof draft.condition.config === 'object' &&
        !Array.isArray(draft.condition.config)
    ) {
        return
    }
    draft.condition.config = {}
}

function isMissingConfigValue(value: unknown) {
    if (value == null) return true
    if (typeof value === 'string' && !value.trim()) return true
    if (Array.isArray(value) && value.length === 0) return true
    return false
}

interface TargetItem {
    id: string
    name?: string
}
</script>

<style scoped>
.trigger-editor {
    width: min(100%, 1280px);
    margin: 0 auto;
    min-width: 0;
    padding-bottom: 48px;
}

.back {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 0;
    padding: 0;
    margin-bottom: 18px;
    background: transparent;
    color: var(--k-text-light);
    font: inherit;
    cursor: pointer;
}

.back:hover {
    color: var(--k-text-dark);
}

.back:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}

.scenario-option:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}

.step-item:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}

.editor-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 18px;
}

.head-copy {
    min-width: 0;
}

.head-copy h2 {
    margin: 0;
    color: var(--k-text-dark);
    font-size: 22px;
    line-height: 1.35;
    letter-spacing: 0;
    overflow-wrap: anywhere;
}

.state-line,
.head-actions,
.enabled-row,
.run-head,
.run-main,
.run-detail {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}

.state-line {
    flex-wrap: wrap;
    margin-top: 8px;
    color: var(--k-text-light);
    font-size: 12px;
}

.head-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
}

.backend-error {
    margin-bottom: 16px;
}

.wizard-steps {
    display: grid;
    grid-template-columns:
        minmax(0, 1fr) minmax(32px, 0.35fr)
        minmax(0, 1fr);
    align-items: center;
    margin-bottom: 16px;
    padding: 14px 20px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    box-sizing: border-box;
}

.step-item {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--k-text-light);
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.step-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
    border: 1px solid var(--k-color-border);
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
}

.step-copy {
    display: grid;
    gap: 2px;
    min-width: 0;
}

.step-copy strong {
    color: var(--k-text-dark);
    font-size: 13px;
    letter-spacing: 0;
}

.step-copy small {
    font-size: 11px;
}

.step-item.active .step-num {
    border-color: var(--k-color-primary);
    background: var(--k-color-primary);
    color: white;
}

.step-line {
    height: 1px;
    margin: 0 16px;
    background: var(--k-color-divider);
}

.editor-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
}

.editor-section {
    min-width: 0;
    padding: 16px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 12px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    box-sizing: border-box;
}

.section-head {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 18px;
}

.section-head h3,
.run-head h3 {
    margin: 0;
    color: var(--k-text-dark);
    font-size: 16px;
    line-height: 1.4;
    letter-spacing: 0;
}

.section-index {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 8px;
    background: var(--k-color-primary);
    color: white;
    font-size: 12px;
    font-weight: 600;
    flex: 0 0 auto;
}

.scenario-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
    margin-top: 14px;
}

.scenario-option {
    min-height: 38px;
    padding: 8px 10px;
    border: 1px solid var(--k-color-border);
    border-radius: 8px;
    background: transparent;
    color: var(--k-text-dark);
    font: inherit;
    font-size: 12px;
    line-height: 1.35;
    letter-spacing: 0;
    text-align: left;
    cursor: pointer;
    overflow-wrap: anywhere;
}

.scenario-option:hover,
.scenario-option.active {
    border-color: var(--k-color-primary);
}

.scenario-option.active {
    background: color-mix(in srgb, var(--k-color-primary), transparent 92%);
    color: var(--k-color-primary);
    font-weight: 600;
}

.enabled-row {
    justify-content: space-between;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
}

.form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
}

.field label,
.field-label {
    color: var(--k-text-dark);
    font-size: 13px;
    font-weight: 500;
}

.field :deep(.el-select),
.field :deep(.el-input),
.field :deep(.el-segmented) {
    width: 100%;
    max-width: 100%;
}

.full-row {
    grid-column: 1 / -1;
}

.wizard-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 20px;
}

.wizard-footer :deep(.el-button) {
    margin: 0;
}

.run-section {
    margin-top: 32px;
    min-width: 0;
}

.run-head {
    justify-content: space-between;
    margin-bottom: 12px;
}

.run-list {
    display: grid;
    gap: 10px;
}

.run-row {
    display: grid;
    grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
    gap: 16px;
    padding: 12px 14px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 12px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    box-sizing: border-box;
    font-size: 12px;
    color: var(--k-text-light);
}

.run-main,
.run-detail {
    flex-wrap: wrap;
}

.run-error {
    color: var(--el-color-danger);
    overflow-wrap: anywhere;
}

@media (max-width: 900px) {
    .editor-grid {
        grid-template-columns: minmax(0, 1fr);
    }
}

@media (max-width: 680px) {
    .editor-head {
        flex-direction: column;
    }

    .head-actions {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
    }

    .head-actions :deep(.el-button) {
        width: 100%;
        min-width: 0;
        margin: 0;
    }

    .wizard-steps {
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
        padding: 14px 16px;
    }

    .step-line {
        display: none;
    }

    .editor-section {
        padding: 16px;
    }

    .scenario-grid,
    .form-grid {
        grid-template-columns: minmax(0, 1fr);
    }

    .full-row {
        grid-column: auto;
    }

    .wizard-footer {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
    }

    .wizard-footer :deep(.el-button) {
        width: 100%;
        min-width: 0;
    }

    .run-row {
        grid-template-columns: minmax(0, 1fr);
        gap: 6px;
    }

    :deep(.el-segmented) {
        max-width: 100%;
        overflow-x: auto;
    }
}
</style>
