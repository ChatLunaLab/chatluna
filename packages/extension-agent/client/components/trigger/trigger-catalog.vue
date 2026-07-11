<template>
    <div class="trigger-catalog">
        <div class="catalog-tools">
            <el-input
                v-model="search"
                clearable
                placeholder="搜索名称、条件或错误"
            >
                <template #prefix>
                    <el-icon><Search /></el-icon>
                </template>
            </el-input>
            <el-select v-model="status" clearable placeholder="全部状态">
                <el-option
                    v-for="(label, value) in statusLabels"
                    :key="value"
                    :label="label"
                    :value="value"
                />
            </el-select>
            <el-select v-model="type" clearable placeholder="全部场景">
                <el-option
                    v-for="item in scenarios"
                    :key="item.id"
                    :label="item.label"
                    :value="item.id"
                />
            </el-select>
        </div>

        <div v-if="filtered.length" class="task-list">
            <article
                v-for="task in filtered"
                :key="task.id"
                class="task-row"
                :class="{ disabled: !task.enabled }"
            >
                <div class="task-primary">
                    <div class="task-title-row">
                        <div class="condition-icon">
                            <el-icon>
                                <component :is="conditionIcon(task)" />
                            </el-icon>
                        </div>
                        <div class="task-title">
                            <button
                                type="button"
                                :disabled="busy"
                                @click="emit('select', task.id)"
                            >
                                {{ task.name }}
                            </button>
                            <div class="condition-summary">
                                {{ summarize(task) }}
                            </div>
                        </div>
                        <el-tag
                            effect="plain"
                            size="small"
                            :type="statusType(task.state.status)"
                        >
                            {{ statusLabels[task.state.status] }}
                        </el-tag>
                        <el-switch
                            :model-value="task.enabled"
                            :disabled="busy"
                            @change="emit('toggle', task.id, $event as boolean)"
                        />
                    </div>

                    <div class="task-meta">
                        <div>
                            <span>模型</span>
                            <strong>{{ modelLabel(task) }}</strong>
                        </div>
                        <div>
                            <span>下次执行</span>
                            <strong>
                                {{ formatDate(task.state.nextRunAt) }}
                            </strong>
                        </div>
                        <div>
                            <span>最后执行</span>
                            <strong>
                                {{ formatDate(task.state.lastRunAt) }}
                            </strong>
                        </div>
                        <div>
                            <span>运行次数</span>
                            <strong>{{ task.state.runCount }}</strong>
                        </div>
                        <div>
                            <span>最后决定</span>
                            <strong>{{ decisionLabel(task) }}</strong>
                        </div>
                    </div>

                    <div v-if="task.state.lastError" class="task-error">
                        {{ task.state.lastError }}
                    </div>
                </div>

                <div class="task-actions">
                    <el-tooltip content="编辑" placement="top">
                        <el-button
                            :icon="Edit"
                            circle
                            aria-label="编辑"
                            :disabled="busy"
                            @click="emit('select', task.id)"
                        />
                    </el-tooltip>
                    <el-tooltip content="立即执行" placement="top">
                        <el-button
                            :icon="VideoPlay"
                            circle
                            aria-label="立即执行"
                            :disabled="busy"
                            @click="emit('fire', task.id)"
                        />
                    </el-tooltip>
                    <el-tooltip
                        v-if="canResume(task)"
                        content="恢复任务"
                        placement="top"
                    >
                        <el-button
                            :icon="RefreshRight"
                            circle
                            aria-label="恢复任务"
                            :disabled="busy"
                            @click="emit('resume', task.id)"
                        />
                    </el-tooltip>
                    <el-tooltip content="删除" placement="top">
                        <el-button
                            :icon="Delete"
                            circle
                            type="danger"
                            plain
                            aria-label="删除"
                            :disabled="busy"
                            @click="emit('remove', task.id)"
                        />
                    </el-tooltip>
                </div>
            </article>
        </div>

        <el-empty v-else :description="emptyText" />
    </div>
</template>

<script setup lang="ts">
import {
    AlarmClock,
    Bell,
    ChatDotRound,
    Clock,
    Delete,
    Edit,
    MagicStick,
    RefreshRight,
    Search,
    TrendCharts,
    UserFilled,
    VideoPlay
} from '@element-plus/icons-vue'
import { computed, ref } from 'vue'
import type { TriggerTask, TriggerTaskStatus } from '../../../src/types'
import type { TriggerProviderMeta } from '../../../src/types'
import {
    conditionKey,
    dayOptions,
    formatDate,
    formatDecision,
    statusLabels,
    statusType,
    type ScenarioChoice
} from './types'

const props = defineProps<{
    tasks: TriggerTask[]
    scenarios: ScenarioChoice[]
    providers: TriggerProviderMeta[]
    busy?: boolean
}>()
const emit = defineEmits<{
    select: [id: number]
    toggle: [id: number, enabled: boolean]
    fire: [id: number]
    resume: [id: number]
    remove: [id: number]
}>()

const search = ref('')
const status = ref<TriggerTaskStatus | ''>('')
const type = ref<string>('')

const filtered = computed(() => {
    const text = search.value.trim().toLowerCase()
    return props.tasks.filter((task) => {
        if (status.value && task.state.status !== status.value) return false
        if (type.value && conditionKey(task.condition) !== type.value)
            return false
        if (!text) return true
        return [
            task.name,
            summarize(task),
            task.state.lastError ?? '',
            modelLabel(task)
        ]
            .join('\n')
            .toLowerCase()
            .includes(text)
    })
})

const emptyText = computed(() =>
    props.tasks.length ? '没有符合筛选条件的触发器。' : '还没有创建触发器。'
)

function conditionIcon(task: TriggerTask) {
    const key = conditionKey(task.condition)
    if (key === 'once') return Clock
    if (key === 'calendar') return AlarmClock
    if (key === 'interval') return RefreshRight
    if (key === 'cron') return AlarmClock
    if (key === 'window') return TrendCharts
    if (key === 'keyword') return ChatDotRound
    if (key === 'participation') return UserFilled
    if (key === 'inactivity') return Bell
    if (key === 'semantic') return MagicStick
    return Bell
}

function summarize(task: TriggerTask) {
    const condition = task.condition
    if (condition.type === 'once') {
        return `单次 · ${formatDate(condition.at)}`
    }
    if (condition.type === 'calendar') {
        const days =
            condition.days.length === 7
                ? '每天'
                : `每周 ${dayOptions
                      .filter((item) => condition.days.includes(item.value))
                      .map((item) => item.label)
                      .join('、')}`
        return `${days} ${condition.times.join('、')} · ${condition.timezone}`
    }
    if (condition.type === 'interval') {
        return `每 ${condition.everyMinutes} 分钟 · 锚点 ${formatDate(condition.anchorAt)}`
    }
    if (condition.type === 'cron') {
        return `Cron ${condition.expression} · ${condition.timezone}`
    }
    if (condition.type === 'window') {
        const days =
            condition.days.length === 7
                ? '每天'
                : dayOptions
                      .filter((item) => condition.days.includes(item.value))
                      .map((item) => item.label)
                      .join('、')
        return `${days} ${condition.start}-${condition.end}，每 ${condition.everyMinutes} 分钟 · ${condition.timezone}`
    }
    if (condition.type === 'keyword') {
        const suffix =
            condition.keywords.length > 4
                ? ` 等 ${condition.keywords.length} 个`
                : ''
        return `关键词 ${condition.keywords.slice(0, 4).join('、')}${suffix}`
    }
    if (condition.type === 'participation') {
        return `${condition.withinMinutes} 分钟内 ${condition.minMessages} 条消息 / ${condition.minUsers} 人`
    }
    if (condition.type === 'inactivity') {
        return `活跃 ${condition.minMessages} 条后静默 ${condition.silentMinutes} 分钟`
    }
    if (condition.type === 'semantic') {
        return `语义主题 · ${condition.topic}`
    }
    const provider = props.providers.find(
        (item) => item.id === condition.provider
    )
    return provider
        ? `${provider.label} · ${condition.provider}`
        : `扩展提供方 · ${condition.provider}`
}

function modelLabel(task: TriggerTask) {
    return task.execution.model.type === 'fixed'
        ? task.execution.model.model
        : '默认模型'
}

function decisionLabel(task: TriggerTask) {
    const decision = task.state.lastDecision
    if (!decision) return '无'
    return formatDecision(decision)
}

function canResume(task: TriggerTask) {
    return (
        task.enabled &&
        (task.state.status === 'paused' ||
            task.state.status === 'completed' ||
            task.state.status === 'error')
    )
}
</script>

<style scoped>
.trigger-catalog {
    min-width: 0;
    border-top: 1px solid var(--k-color-divider);
}

.catalog-tools {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) 180px 220px;
    gap: 10px;
    padding: 14px 0;
    border-bottom: 1px solid var(--k-color-divider);
}

.catalog-tools :deep(.el-select),
.catalog-tools :deep(.el-input) {
    width: 100%;
    min-width: 0;
}

.task-list {
    display: grid;
}

.task-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 18px;
    padding: 18px 0;
    border-bottom: 1px solid var(--k-color-divider);
    min-width: 0;
}

.task-row.disabled {
    opacity: 0.65;
}

.task-primary,
.task-title {
    min-width: 0;
}

.task-title-row {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 10px;
    min-width: 0;
}

.condition-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--k-color-primary), transparent 92%);
    color: var(--k-color-primary);
}

.task-title button {
    display: block;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--k-text-dark);
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
    letter-spacing: 0;
    text-align: left;
    cursor: pointer;
    overflow-wrap: anywhere;
}

.condition-summary {
    margin-top: 3px;
    color: var(--k-text-light);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
}

.task-meta {
    display: grid;
    grid-template-columns: repeat(5, minmax(100px, 1fr));
    gap: 12px;
    margin: 14px 0 0 44px;
}

.task-meta > div {
    min-width: 0;
}

.task-meta span,
.task-meta strong {
    display: block;
    font-size: 11px;
    line-height: 1.45;
}

.task-meta span {
    color: var(--k-text-light);
}

.task-meta strong {
    margin-top: 2px;
    color: var(--k-text-dark);
    font-weight: 500;
    overflow-wrap: anywhere;
}

.task-error {
    margin: 12px 0 0 44px;
    padding: 8px 10px;
    border-left: 3px solid var(--el-color-danger);
    background: color-mix(in srgb, var(--el-color-danger), transparent 94%);
    color: var(--el-color-danger);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
}

.task-actions {
    display: flex;
    align-items: flex-start;
    gap: 7px;
}

.task-actions :deep(.el-button) {
    margin: 0;
}

@media (max-width: 1080px) {
    .task-meta {
        grid-template-columns: repeat(3, minmax(100px, 1fr));
    }
}

@media (max-width: 760px) {
    .catalog-tools {
        grid-template-columns: minmax(0, 1fr);
    }

    .task-row {
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
    }

    .task-title-row {
        grid-template-columns: 34px minmax(0, 1fr);
        grid-template-rows: auto auto;
    }

    .task-title-row :deep(.el-tag) {
        grid-column: 2;
        grid-row: 2;
        justify-self: start;
    }

    .task-title-row :deep(.el-switch) {
        grid-column: 2;
        grid-row: 2;
        justify-self: end;
    }

    .task-meta {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-left: 0;
    }

    .task-error {
        margin-left: 0;
    }

    .task-actions {
        justify-content: flex-end;
        flex-wrap: wrap;
    }
}

@media (max-width: 390px) {
    .task-title-row {
        grid-template-columns: 32px minmax(0, 1fr) auto;
        grid-template-rows: auto auto;
    }

    .task-title {
        grid-column: 2 / -1;
    }

    .task-title-row :deep(.el-tag) {
        grid-column: 2;
        grid-row: 2;
        justify-self: start;
    }

    .task-title-row :deep(.el-switch) {
        grid-column: 3;
        grid-row: 2;
        justify-self: end;
    }

    .task-meta {
        grid-template-columns: minmax(0, 1fr);
    }

    .task-actions {
        width: 100%;
        justify-content: flex-start;
    }
}
</style>
