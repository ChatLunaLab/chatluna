<template>
    <div class="detail-view">
        <div class="back-link-wrapper">
            <button type="button" class="back-link" @click="$emit('back')">
                <el-icon><ArrowLeft /></el-icon>
                <span>返回列表</span>
            </button>
        </div>

        <div class="page-header">
            <div class="headline">
                <div class="page-title">{{ headerTitle }}</div>
                <div class="page-description">{{ headerDescription }}</div>
            </div>

            <div class="editor-actions">
                <el-button
                    v-if="!isCreating"
                    @click="$emit('fire')"
                >
                    立即执行
                </el-button>
                <el-button
                    v-if="!isCreating"
                    class="danger-soft"
                    type="danger"
                    plain
                    @click="$emit('remove')"
                >
                    删除
                </el-button>
                <el-button type="primary" @click="handleSave">
                    {{ isCreating ? '创建任务' : '保存修改' }}
                </el-button>
            </div>
        </div>

        <div class="tabs-underline">
            <button
                v-for="item in tabs"
                :key="item.value"
                type="button"
                :class="['tab-item', { active: tab === item.value }]"
                @click="tab = item.value"
            >
                {{ item.label }}
            </button>
        </div>

        <div class="editor-body">
            <div v-if="tab === 'basic'" class="page-grid">
                <div class="section-title">基础信息</div>

                <div class="field-grid">
                    <div class="field-card option-card">
                        <div class="field-label">触发方式</div>
                        <el-select v-model="draft.providerKind">
                            <el-option label="一次性任务" value="" />
                            <el-option
                                v-for="provider in providers"
                                :key="provider.kind"
                                :label="
                                    provider.enabled === false
                                        ? `${provider.name} (已禁用)`
                                        : provider.name
                                "
                                :value="provider.kind"
                                :disabled="
                                    provider.enabled === false &&
                                    draft.providerKind !== provider.kind
                                "
                            />
                        </el-select>
                        <div v-if="selectedProvider" class="field-help">
                            {{ selectedProvider.description }}
                        </div>
                        <div v-else class="field-help">
                            不绑定 provider，单次到指定时间后执行一次。
                        </div>
                    </div>

                    <div class="field-card option-card">
                        <div class="field-label">任务名称</div>
                        <el-input
                            v-model="draft.name"
                            placeholder="例如：每日总结（可选）"
                        />
                        <div class="field-help">
                            留空时，列表会以任务 ID 展示。
                        </div>
                    </div>
                </div>

                <div class="field-card switch-card">
                    <div class="scope-row">
                        <div>
                            <div class="field-label">启用</div>
                            <div class="field-help">
                                关闭后触发器保留但不会被调度或匹配。
                            </div>
                        </div>
                        <el-switch v-model="draft.enabled" />
                    </div>
                </div>
            </div>

            <div v-else-if="tab === 'routing'" class="page-grid">
                <div class="section-title">目标会话</div>

                <div class="field-grid">
                    <div class="field-card option-card">
                        <div class="field-label">机器人</div>
                        <el-select
                            v-model="draft.routeKey"
                            placeholder="从已注册的机器人选择"
                            clearable
                            filterable
                            :loading="targetsLoading"
                        >
                            <el-option
                                v-for="item in routes"
                                :key="item.label"
                                :label="item.label"
                                :value="item.label"
                            />
                        </el-select>
                        <div class="field-help">
                            选择机器人后会自动从 koishi 拉取群组与好友列表。
                        </div>
                    </div>

                    <div class="field-card option-card">
                        <div class="field-label">会话类型</div>
                        <el-radio-group v-model="targetMode">
                            <el-radio-button label="group">
                                群聊
                            </el-radio-button>
                            <el-radio-button label="direct">
                                私聊
                            </el-radio-button>
                        </el-radio-group>
                    </div>
                </div>

                <template v-if="targetMode === 'group'">
                    <div class="field-grid">
                        <div class="field-card option-card">
                            <div class="field-label">群组</div>
                            <el-select
                                v-model="draft.guildId"
                                placeholder="从机器人加入的群组中选择"
                                filterable
                                clearable
                                :disabled="!draft.routeKey"
                                :loading="targetsLoading"
                            >
                                <el-option
                                    v-for="g in guilds"
                                    :key="g.id"
                                    :label="
                                        g.name
                                            ? `${g.name} (${g.id})`
                                            : g.id
                                    "
                                    :value="g.id"
                                />
                            </el-select>
                        </div>

                        <div class="field-card option-card">
                            <div class="field-label">频道</div>
                            <el-select
                                v-model="draft.channelId"
                                placeholder="默认与群组同 ID"
                                filterable
                                clearable
                                :disabled="!draft.guildId"
                                :loading="channelLoading"
                                @visible-change="ensureChannels"
                            >
                                <el-option
                                    v-for="c in channels"
                                    :key="c.id"
                                    :label="
                                        c.name
                                            ? `${c.name} (${c.id})`
                                            : c.id
                                    "
                                    :value="c.id"
                                />
                            </el-select>
                        </div>
                    </div>

                    <div class="field-card option-card">
                        <div class="field-label">作用范围</div>
                        <el-radio-group v-model="scopeMode">
                            <el-radio-button label="shared">
                                整个群
                            </el-radio-button>
                            <el-radio-button label="personal">
                                指定用户
                            </el-radio-button>
                        </el-radio-group>
                        <div class="field-help">
                            选择 “整个群” 时绑定键面向群内任意发言；
                            选择 “指定用户” 时仅对指定用户生效。
                        </div>
                    </div>

                    <div
                        v-if="scopeMode === 'personal'"
                        class="field-card option-card"
                    >
                        <div class="field-label">用户 ID</div>
                        <el-input
                            v-model="draft.userId"
                            placeholder="必填，例如 1234567"
                        />
                    </div>
                </template>

                <template v-else>
                    <div class="field-card option-card">
                        <div class="field-label">好友</div>
                        <el-select
                            v-model="draft.userId"
                            placeholder="从好友列表中选择"
                            filterable
                            clearable
                            :disabled="!draft.routeKey"
                            :loading="targetsLoading"
                        >
                            <el-option
                                v-for="u in friends"
                                :key="u.id"
                                :label="u.name ? `${u.name} (${u.id})` : u.id"
                                :value="u.id"
                            />
                        </el-select>
                    </div>
                </template>

                <div v-if="autoBindingKey" class="field-card binding-preview">
                    <span class="binding-label">绑定键</span>
                    <code>{{ autoBindingKey }}</code>
                </div>
            </div>

            <div v-else-if="tab === 'trigger'" class="page-grid">
                <template v-if="selectedProvider">
                    <div class="section-title">
                        {{ selectedProvider.name }} 参数
                    </div>
                    <div class="panel-description" style="margin-bottom: 12px">
                        {{ selectedProvider.description }}
                    </div>

                    <div v-if="providerFields.length > 0" class="field-grid">
                        <div
                            v-for="field in providerFields"
                            :key="field.name"
                            class="field-card option-card"
                            :class="{ 'full-row': field.kind === 'array' }"
                        >
                            <div class="field-label">{{ field.label }}</div>

                            <el-select
                                v-if="field.enumValues"
                                v-model="providerValues[field.name]"
                            >
                                <el-option
                                    v-for="value in field.enumValues"
                                    :key="value"
                                    :label="formatEnumLabel(field.name, value)"
                                    :value="value"
                                />
                            </el-select>
                            <el-switch
                                v-else-if="field.kind === 'boolean'"
                                v-model="providerValues[field.name]"
                            />
                            <el-input
                                v-else-if="field.kind === 'array'"
                                v-model="providerValues[field.name]"
                                type="textarea"
                                :rows="3"
                                placeholder="每行一项"
                            />
                            <el-input-number
                                v-else-if="field.kind === 'number'"
                                v-model="providerValues[field.name]"
                                :controls-position="'right'"
                                style="width: 100%"
                            />
                            <el-input
                                v-else
                                v-model="providerValues[field.name]"
                                :placeholder="field.placeholder"
                            />

                            <div v-if="field.description" class="field-help">
                                {{ field.description }}
                            </div>
                        </div>
                    </div>
                    <div v-else class="field-card">
                        <div class="field-help">
                            当前 provider 不需要额外参数。
                        </div>
                    </div>
                </template>

                <template v-else>
                    <div class="section-title">一次性执行</div>
                    <div class="field-card option-card">
                        <div class="field-label">下次执行时间</div>
                        <el-input
                            v-model="draft.nextFireAt"
                            type="datetime-local"
                        />
                        <div class="field-help">
                            到达该时间后执行一次，执行完毕后不会重复。
                        </div>
                    </div>
                </template>
            </div>

            <div v-else class="page-grid">
                <div class="section-title">唤醒消息</div>

                <div class="field-card">
                    <div class="field-label">消息内容</div>
                    <el-input
                        v-model="draft.message"
                        type="textarea"
                        :rows="5"
                        :placeholder="messagePlaceholder"
                    />
                    <div v-if="editingHasComplexMessage" class="field-help">
                        当前任务消息不是纯文本，留空时会保留原有结构。
                    </div>
                    <div v-else class="field-help">
                        Agent 被唤醒后使用的消息。被动触发器可以留空沿用原始输入。
                    </div>
                </div>

                <el-divider style="margin: 4px 0" />

                <div class="section-title">执行选项</div>

                <div class="field-grid">
                    <div class="field-card option-card">
                        <div class="field-label">回复方式</div>
                        <el-select v-model="draft.replyTo">
                            <el-option label="发送到频道" value="channel" />
                            <el-option label="发送给用户" value="user" />
                            <el-option label="静默执行" value="silent" />
                        </el-select>
                    </div>

                    <div class="field-card option-card">
                        <div class="field-label">执行模式</div>
                        <el-select v-model="draft.execMode">
                            <el-option label="链式（走 chatluna 完整链路）" value="chain" />
                            <el-option label="直接（跳过 chatluna 中间件）" value="direct" />
                        </el-select>
                    </div>
                </div>

                <el-divider style="margin: 4px 0" />

                <div class="section-title">工具注入</div>
                <div class="panel-description" style="margin-bottom: 12px">
                    控制此任务唤醒时哪些工具对 Agent 可见。
                </div>

                <div class="field-card option-card">
                    <div class="field-label">注入策略</div>
                    <el-select v-model="draft.toolMode">
                        <el-option label="不注入工具" value="none" />
                        <el-option label="注入全部可用工具" value="all" />
                        <el-option label="仅注入指定工具" value="custom" />
                    </el-select>
                </div>

                <div
                    v-if="draft.toolMode === 'custom'"
                    class="field-card"
                >
                    <div class="field-label" style="margin-bottom: 8px">
                        指定工具
                    </div>
                    <el-select
                        v-model="draft.toolNames"
                        multiple
                        filterable
                        clearable
                        collapse-tags
                        collapse-tags-tooltip
                        placeholder="选择要注入的工具"
                        style="width: 100%"
                    >
                        <el-option
                            v-for="item in toolOptions"
                            :key="item.name"
                            :label="item.name"
                            :value="item.name"
                        />
                    </el-select>
                </div>
            </div>
        </div>

        <div v-if="!isCreating && summary.length > 0" class="status-strip">
            <div
                v-for="item in summary"
                :key="item.label"
                class="status-item"
            >
                <div class="status-label">{{ item.label }}</div>
                <div class="status-value">{{ item.value }}</div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ArrowLeft } from '@element-plus/icons-vue'
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { send } from '@koishijs/client'
import type {
    ToolAvailabilityInfo,
    TriggerCreateTaskInput,
    TriggerProviderDescriptor,
    TriggerRoutingChoice,
    TriggerTask
} from '../../../src/types'

interface JsonField {
    name: string
    label: string
    description: string
    placeholder: string
    kind: 'string' | 'number' | 'boolean' | 'array'
    enumValues?: string[]
    defaultValue?: unknown
}

type TriggerDraftPayload = Omit<TriggerCreateTaskInput, 'createdBy' | 'source'>

const props = defineProps<{
    task?: TriggerTask | null
    providers: TriggerProviderDescriptor[]
    routes: TriggerRoutingChoice[]
    tools: ToolAvailabilityInfo[]
}>()

const emit = defineEmits<{
    back: []
    save: [payload: TriggerDraftPayload]
    remove: []
    fire: []
}>()

const tabs = [
    { value: 'basic', label: '基础' },
    { value: 'routing', label: '会话目标' },
    { value: 'trigger', label: '触发条件' },
    { value: 'message', label: '执行选项' }
] as const

const tab = ref<'basic' | 'routing' | 'trigger' | 'message'>('basic')

const draft = reactive({
    providerKind: 'cron',
    enabled: true,
    routeKey: '',
    name: '',
    message: '',
    platform: '',
    selfId: '',
    userId: '',
    guildId: '',
    channelId: '',
    nextFireAt: '',
    replyTo: 'channel' as 'channel' | 'user' | 'silent',
    execMode: 'chain' as 'chain' | 'direct',
    toolMode: 'none' as 'none' | 'all' | 'custom',
    toolNames: [] as string[]
})

const targetMode = ref<'group' | 'direct'>('group')
const scopeMode = ref<'shared' | 'personal'>('shared')
const guilds = ref<{ id: string; name?: string }[]>([])
const channels = ref<{ id: string; name?: string }[]>([])
const friends = ref<{ id: string; name?: string }[]>([])
const targetsLoading = ref(false)
const channelLoading = ref(false)
const targetsCacheKey = ref('')
const channelCacheKey = ref('')

const providerValues = reactive<Record<string, unknown>>({})

const isCreating = computed(() => props.task == null)

const selectedProvider = computed(() =>
    props.providers.find((item) => item.kind === draft.providerKind)
)

const toolOptions = computed(() =>
    [...props.tools].sort((a, b) => a.name.localeCompare(b.name))
)

const autoBindingKey = computed(() => {
    if (!draft.platform || !draft.selfId) return ''
    if (targetMode.value === 'direct') {
        if (!draft.userId) return ''
        return `personal:${draft.platform}:${draft.selfId}:direct:${draft.userId}`
    }
    const guild = draft.guildId || draft.channelId
    if (!guild) return ''
    if (scopeMode.value === 'shared') {
        return `shared:${draft.platform}:${draft.selfId}:${guild}`
    }
    if (!draft.userId) return ''
    return `personal:${draft.platform}:${draft.selfId}:${guild}:${draft.userId}`
})

const providerFields = computed<JsonField[]>(() => {
    const raw = selectedProvider.value?.schema as {
        properties?: Record<
            string,
            {
                type?: string
                description?: string
                title?: string
                enum?: string[]
                default?: unknown
                items?: { type?: string }
            }
        >
    }
    if (!raw?.properties) return []

    return Object.entries(raw.properties).map(([name, item]) => ({
        name,
        label: formatFieldLabel(name, item.title || name),
        description: item.description || '',
        placeholder: item.description || '',
        kind:
            item.type === 'integer' || item.type === 'number'
                ? 'number'
                : item.type === 'boolean'
                  ? 'boolean'
                  : item.type === 'array'
                    ? 'array'
                    : 'string',
        enumValues: item.enum,
        defaultValue: item.default
    }))
})

const editingHasComplexMessage = computed(
    () =>
        props.task?.wakeupTemplate.message != null &&
        typeof props.task.wakeupTemplate.message !== 'string'
)

const messagePlaceholder = computed(() => {
    if (selectedProvider.value?.needsMessage === false) {
        return '可选。不填时会沿用被动触发收到的消息。'
    }
    return '例如：提醒我检查项目状态。'
})

const headerTitle = computed(() => {
    if (isCreating.value) return '新建触发器'
    return `${props.task?.name?.trim() || `任务 #${props.task?.id}`} 配置`
})

const headerDescription = computed(() => {
    if (isCreating.value) {
        return '配置完整的触发条件与执行选项后创建新的触发器。'
    }
    return '修改当前触发器的触发条件、目标会话和执行选项。'
})

const summary = computed(() => {
    if (isCreating.value || !props.task) return []

    return [
        { label: '执行次数', value: String(props.task.fireCount ?? 0) },
        { label: '最近执行', value: formatDate(props.task.lastFiredAt) },
        { label: '下次执行', value: formatDate(props.task.nextFireAt) },
        { label: '创建者', value: props.task.createdBy || '-' }
    ]
})

watch(
    () => props.task?.id,
    () => syncFromTask(),
    { immediate: true }
)

watch(providerFields, () => {
    if (props.task != null) {
        applyProviderValues(props.task)
        return
    }

    resetProviderValues()
})

watch(
    () => draft.routeKey,
    (value) => {
        const route = props.routes.find((item) => item.label === value)
        if (route == null) {
            draft.platform = ''
            draft.selfId = ''
            guilds.value = []
            friends.value = []
            channels.value = []
            return
        }

        if (
            draft.platform !== route.platform ||
            draft.selfId !== route.selfId
        ) {
            draft.platform = route.platform
            draft.selfId = route.selfId
            draft.guildId = ''
            draft.channelId = ''
            channels.value = []
            channelCacheKey.value = ''
            if (targetMode.value === 'direct') {
                draft.userId = ''
            }
        }
        loadTargets()
    }
)

watch(
    () => draft.guildId,
    () => {
        draft.channelId = ''
        channels.value = []
        channelCacheKey.value = ''
    }
)

function syncFromTask() {
    if (props.task == null) {
        resetDraft()
        return
    }

    const task = props.task
    draft.providerKind = task.providerKind || ''
    draft.enabled = task.enabled
    draft.routeKey = findRouteKey(task.platform, task.selfId)
    draft.name = task.name || ''
    draft.message =
        typeof task.wakeupTemplate.message === 'string'
            ? task.wakeupTemplate.message
            : ''
    draft.platform = task.platform
    draft.selfId = task.selfId
    draft.userId = task.userId
    draft.guildId = task.guildId || ''
    draft.channelId = task.channelId || ''
    draft.nextFireAt = toLocalDateTime(task.nextFireAt)
    draft.replyTo = task.wakeupTemplate.replyTo ?? 'channel'
    draft.execMode = task.wakeupTemplate.execMode ?? 'chain'
    targetMode.value = task.isDirect ? 'direct' : 'group'
    scopeMode.value = task.bindingKey.startsWith('shared:')
        ? 'shared'
        : 'personal'
    applyToolForm(task)
    applyProviderValues(task)
    if (task.platform && task.selfId) loadTargets()
}

function resetDraft() {
    draft.providerKind = 'cron'
    draft.enabled = true
    draft.routeKey = ''
    draft.name = ''
    draft.message = ''
    draft.platform = ''
    draft.selfId = ''
    draft.userId = ''
    draft.guildId = ''
    draft.channelId = ''
    draft.nextFireAt = ''
    draft.replyTo = 'channel'
    draft.execMode = 'chain'
    draft.toolMode = 'none'
    draft.toolNames = []
    targetMode.value = 'group'
    scopeMode.value = 'shared'
    guilds.value = []
    friends.value = []
    channels.value = []
    targetsCacheKey.value = ''
    channelCacheKey.value = ''
    resetProviderValues()
}

async function loadTargets() {
    if (!draft.platform || !draft.selfId) return
    const key = `${draft.platform}:${draft.selfId}`
    if (key === targetsCacheKey.value) return
    targetsLoading.value = true
    try {
        const bundle = await send(
            'chatluna-agent/getTriggerTargets',
            draft.platform,
            draft.selfId
        )
        guilds.value = bundle.guilds
        friends.value = bundle.friends
        targetsCacheKey.value = key
    } catch {
        guilds.value = []
        friends.value = []
    } finally {
        targetsLoading.value = false
    }
}

async function ensureChannels(visible: boolean) {
    if (!visible) return
    if (!draft.platform || !draft.selfId || !draft.guildId) return
    const key = `${draft.platform}:${draft.selfId}:${draft.guildId}`
    if (key === channelCacheKey.value && channels.value.length > 0) return
    channelLoading.value = true
    try {
        channels.value = await send(
            'chatluna-agent/getTriggerChannels',
            draft.platform,
            draft.selfId,
            draft.guildId
        )
        channelCacheKey.value = key
    } catch {
        channels.value = []
    } finally {
        channelLoading.value = false
    }
}

function applyProviderValues(task: TriggerTask) {
    resetProviderValues()
    for (const field of providerFields.value) {
        const value = task.params?.[field.name]
        if (value == null) continue

        providerValues[field.name] =
            field.kind === 'array' && Array.isArray(value)
                ? value.join('\n')
                : value
    }
}

function resetProviderValues() {
    for (const key of Object.keys(providerValues)) {
        delete providerValues[key]
    }

    for (const field of providerFields.value) {
        providerValues[field.name] =
            field.kind === 'boolean'
                ? Boolean(field.defaultValue)
                : field.kind === 'array'
                  ? Array.isArray(field.defaultValue)
                      ? field.defaultValue.join('\n')
                      : ''
                  : field.kind === 'number'
                    ? Number(field.defaultValue ?? 0)
                    : (field.defaultValue ?? '')
    }
}

function applyToolForm(task: TriggerTask) {
    const mask = task.wakeupTemplate.toolMask
    const allNames = props.tools.map((item) => item.name)
    if (mask == null || mask.mode === 'all') {
        draft.toolMode = 'all'
        draft.toolNames = []
        return
    }

    const allow = allNames.filter((name) => matchMask(name, mask))
    if (allow.length < 1) {
        draft.toolMode = 'none'
        draft.toolNames = []
        return
    }

    if (allow.length >= allNames.length) {
        draft.toolMode = 'all'
        draft.toolNames = []
        return
    }

    draft.toolMode = 'custom'
    draft.toolNames = allow
}

function matchMask(
    name: string,
    mask: NonNullable<TriggerTask['wakeupTemplate']['toolMask']>
) {
    if (mask.mode === 'all') return true
    if (mask.tools && !mask.tools.includes(name)) return true
    if (mask.mode === 'allow') return mask.allow.includes(name)
    return !mask.deny.includes(name)
}

function buildToolMask(allNames: string[], allow: string[]) {
    if (allow.length >= allNames.length) {
        return { mode: 'all' as const, tools: allNames, allow: [], deny: [] }
    }

    const deny = allNames.filter((name) => !allow.includes(name))
    if (allow.length <= deny.length) {
        return {
            mode: 'allow' as const,
            tools: allNames,
            allow,
            deny: []
        }
    }

    return { mode: 'deny' as const, tools: allNames, allow: [], deny }
}

function buildToolMaskValue() {
    if (draft.toolMode === 'all') return undefined

    const allNames = props.tools.map((item) => item.name)
    const allow =
        draft.toolMode === 'custom'
            ? draft.toolNames.filter((name) => allNames.includes(name))
            : []
    return buildToolMask(allNames, allow)
}

function buildProviderParams() {
    if (!selectedProvider.value) return null
    const result: Record<string, unknown> = {}
    for (const field of providerFields.value) {
        const value = providerValues[field.name]
        if (field.kind === 'array') {
            result[field.name] = String(value ?? '')
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
            continue
        }

        if (field.kind === 'number') {
            result[field.name] = Number(value)
            continue
        }

        result[field.name] = value
    }

    return result
}

function buildWakeupTemplate(): TriggerTask['wakeupTemplate'] {
    const text = draft.message.trim()
    const origin = props.task?.wakeupTemplate.message
    let message: TriggerTask['wakeupTemplate']['message'] | undefined
    if (text.length > 0) {
        message = text
    } else if (origin != null && typeof origin !== 'string') {
        message = origin
    }

    return {
        message,
        replyTo: draft.replyTo,
        execMode: draft.execMode,
        toolMask: buildToolMaskValue()
    }
}

function handleSave() {
    if (!draft.platform.trim() || !draft.selfId.trim()) {
        ElMessage.warning('请先选择机器人。')
        tab.value = 'routing'
        return
    }

    const isDirect = targetMode.value === 'direct'
    if (isDirect && !draft.userId.trim()) {
        ElMessage.warning('私聊任务需要选择好友或填写用户 ID。')
        tab.value = 'routing'
        return
    }

    if (!isDirect && !draft.guildId.trim() && !draft.channelId.trim()) {
        ElMessage.warning('群聊任务需要选择群组或频道。')
        tab.value = 'routing'
        return
    }

    if (!isDirect && scopeMode.value === 'personal' && !draft.userId.trim()) {
        ElMessage.warning('指定用户范围需要填写用户 ID。')
        tab.value = 'routing'
        return
    }

    const bindingKey = autoBindingKey.value
    if (!bindingKey) {
        ElMessage.warning('无法生成绑定键，请补全必要字段。')
        tab.value = 'routing'
        return
    }

    if (
        selectedProvider.value?.needsMessage !== false &&
        !draft.message.trim() &&
        !editingHasComplexMessage.value
    ) {
        ElMessage.warning('唤醒消息不能为空。')
        tab.value = 'message'
        return
    }

    if (!selectedProvider.value && !draft.nextFireAt) {
        ElMessage.warning('请填写下次执行时间。')
        tab.value = 'trigger'
        return
    }

    const guildId = isDirect
        ? null
        : draft.guildId.trim() || draft.channelId.trim() || null
    const channelId = isDirect
        ? draft.userId.trim() || null
        : draft.channelId.trim() || guildId
    const userId =
        isDirect || scopeMode.value === 'personal'
            ? draft.userId.trim()
            : (draft.userId.trim() ?? '')

    emit('save', {
        providerKind: draft.providerKind || null,
        name: draft.name.trim() || undefined,
        bindingKey,
        platform: draft.platform.trim(),
        selfId: draft.selfId.trim(),
        userId,
        guildId,
        channelId,
        isDirect,
        nextFireAt: draft.nextFireAt
            ? new Date(draft.nextFireAt).toISOString()
            : undefined,
        params: buildProviderParams(),
        wakeupTemplate: buildWakeupTemplate(),
        enabled: draft.enabled
    })
}

function formatFieldLabel(name: string, fallback: string) {
    if (name === 'expression') return 'Cron 表达式'
    if (name === 'missedRunPolicy') return '过期策略'
    if (name === 'threshold') return '触发阈值'
    if (name === 'windowMs') return '统计窗口（毫秒）'
    if (name === 'cooldownMs') return '冷却时间（毫秒）'
    if (name === 'keywords') return '关键词'
    if (name === 'caseSensitive') return '区分大小写'
    return fallback
}

function formatEnumLabel(name: string, value: string) {
    if (name === 'missedRunPolicy') {
        if (value === 'skip') return '过期不执行'
        if (value === 'fire_once') return '过期补执行一次'
    }
    return value
}

function findRouteKey(platform: string, selfId: string) {
    return (
        props.routes.find(
            (item) => item.platform === platform && item.selfId === selfId
        )?.label || ''
    )
}

function toLocalDateTime(value?: Date | string | null) {
    if (!value) return ''
    const date = new Date(value)
    const offset = date.getTimezoneOffset() * 60 * 1000
    return new Date(date.valueOf() - offset).toISOString().slice(0, 16)
}

function formatDate(value?: Date | string | null) {
    if (!value) return '—'
    return new Date(value).toLocaleString()
}
</script>

<style scoped>
.detail-view {
    display: flex;
    flex-direction: column;
    max-width: 920px;
    margin: 0 auto;
    width: 100%;
    padding: 24px;
    box-sizing: border-box;
}

.back-link-wrapper {
    margin-bottom: 24px;
}

.back-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-light);
    padding: 0;
}

.back-link:hover {
    color: var(--k-text-dark);
}

.page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 32px;
}

.headline {
    min-width: 0;
}

.page-title {
    font-size: 24px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.page-description {
    margin-top: 8px;
    font-size: 13px;
    color: var(--k-text-light);
}

.tabs-underline {
    display: flex;
    gap: 32px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 60%);
    margin-top: 0;
    margin-bottom: 32px;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    white-space: nowrap;
}

.tabs-underline::-webkit-scrollbar {
    display: none;
}

.tab-item {
    background: transparent;
    border: none;
    padding: 12px 0;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    color: var(--k-text-light);
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
    margin-bottom: -1px;
    flex-shrink: 0;
}

.tab-item:hover {
    color: var(--k-text-dark);
}

.tab-item.active {
    color: var(--k-color-primary);
    border-bottom-color: var(--k-color-primary);
}

.editor-body {
    padding-bottom: 40px;
}

.section-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--k-text-dark);
    margin-bottom: 12px;
}

.panel-description {
    font-size: 13px;
    line-height: 1.5;
    color: var(--k-text-light);
}

.page-grid,
.field-grid {
    display: grid;
    gap: 16px;
}

.field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.field-card {
    padding: 0;
    background: transparent;
    border: none;
    box-sizing: border-box;
}

.option-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.option-card :deep(.el-select),
.option-card :deep(.el-input-number),
.option-card :deep(.el-input) {
    width: 100%;
}

.full-row {
    grid-column: 1 / -1;
}

.switch-card {
    padding: 4px 0;
}

.field-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--k-text-dark);
}

.field-help {
    margin-top: 4px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--k-text-light);
}

.scope-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.binding-preview {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-color-primary), transparent 92%);
    border: 1px solid
        color-mix(in srgb, var(--k-color-primary), transparent 70%);
    font-size: 12px;
    color: var(--k-text-light);
    flex-wrap: wrap;
}

.binding-preview code {
    font-family: var(--k-font-mono, ui-monospace, monospace);
    font-size: 12px;
    color: var(--k-text-dark);
    word-break: break-all;
}

.binding-label {
    font-weight: 600;
    color: var(--k-text-dark);
}

.editor-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.editor-actions :deep(.danger-soft.el-button) {
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
    --el-button-hover-bg-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 86%
    );
    --el-button-hover-border-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 52%
    );
    --el-button-hover-text-color: var(--el-color-danger);
}

.status-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    padding: 16px 18px;
    margin-top: 8px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 22%);
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
}

.status-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.status-label {
    font-size: 12px;
    color: var(--k-text-light);
}

.status-value {
    font-size: 14px;
    font-weight: 500;
    color: var(--k-text-dark);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

@media (max-width: 768px) {
    .page-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .editor-actions {
        width: 100%;
        justify-content: flex-start;
    }

    .field-grid {
        grid-template-columns: 1fr;
    }

    .scope-row {
        flex-direction: column;
        align-items: flex-start;
    }

    .detail-view {
        padding: 0;
    }
}
</style>
