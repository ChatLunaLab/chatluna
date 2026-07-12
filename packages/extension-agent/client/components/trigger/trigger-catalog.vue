<template>
    <div class="trigger-catalog">
        <div class="catalog-controls">
            <div class="catalog-search">
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

            <div class="catalog-actions">
                <el-button
                    type="primary"
                    :icon="Plus"
                    :disabled="busy"
                    @click="emit('create')"
                >
                    新建触发器
                </el-button>
            </div>
        </div>

        <div
            v-if="filtered.length"
            class="card-list"
            :class="{ compact: props.compactMode }"
        >
            <article
                v-for="task in filtered"
                :key="task.id"
                class="task-card"
                :class="{ disabled: !task.enabled }"
            >
                <div class="task-top">
                    <div class="task-brand">
                        <div class="condition-icon">
                            <el-icon :size="16">
                                <component :is="conditionIcon(task)" />
                            </el-icon>
                        </div>
                        <div class="task-copy">
                            <button
                                type="button"
                                class="task-title"
                                :disabled="busy"
                                @click="emit('select', task.id)"
                            >
                                {{ task.name }}
                            </button>
                            <div class="condition-summary">
                                {{ summarize(task) }}
                            </div>
                        </div>
                    </div>

                    <div class="task-status">
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
                </div>

                <div class="task-body">
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

                <div class="task-footer">
                    <div class="task-actions">
                        <el-button
                            size="small"
                            plain
                            :icon="Edit"
                            :disabled="busy"
                            @click="emit('select', task.id)"
                        >
                            编辑
                        </el-button>
                        <el-button
                            size="small"
                            plain
                            :icon="VideoPlay"
                            :disabled="busy"
                            @click="emit('fire', task.id)"
                        >
                            立即执行
                        </el-button>
                        <el-button
                            v-if="canResume(task)"
                            size="small"
                            plain
                            :icon="RefreshRight"
                            :disabled="busy"
                            @click="emit('resume', task.id)"
                        >
                            恢复
                        </el-button>
                        <el-button
                            class="danger-soft"
                            size="small"
                            plain
                            type="danger"
                            :icon="Delete"
                            :disabled="busy"
                            @click="emit('remove', task.id)"
                        >
                            删除
                        </el-button>
                    </div>
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
    Plus,
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
    compactMode?: boolean
    busy?: boolean
}>()
const emit = defineEmits<{
    create: []
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
}

.catalog-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    min-width: 0;
    flex-wrap: wrap;
}

.catalog-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
    margin-left: auto;
}

.catalog-actions :deep(.el-button) {
    margin: 0;
}

.catalog-search {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) 150px 180px;
    gap: 8px;
    min-width: 0;
    flex: 1 1 520px;
}

.catalog-search :deep(.el-select),
.catalog-search :deep(.el-input) {
    width: 100%;
    min-width: 0;
}

.card-list {
    --card-cols: 4;
    display: grid;
    grid-template-columns: repeat(var(--card-cols), minmax(0, 1fr));
    gap: 16px;
    box-sizing: border-box;
}

.card-list.compact {
    --card-cols: 3;
}

.task-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    padding: 14px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 12px;
    background: color-mix(in srgb, var(--k-activity-bg), var(--k-page-bg) 16%);
    box-sizing: border-box;
    overflow: hidden;
    transition: border-color 0.2s ease;
}

.task-card:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 40%);
}

.task-card.disabled {
    opacity: 0.65;
}

.task-top {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: flex-start;
    min-width: 0;
}

.task-brand {
    display: flex;
    gap: 12px;
    min-width: 0;
    flex: 1 1 auto;
}

.condition-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-color-primary) 8%);
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 36%);
    flex: 0 0 auto;
}

.task-copy {
    min-width: 0;
    flex: 1 1 auto;
}

.task-title {
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.task-title:disabled {
    cursor: not-allowed;
}

.condition-summary {
    margin-top: 3px;
    color: var(--k-text-light);
    font-size: 12px;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
}

.task-status {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    flex: 0 0 auto;
}

.task-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    flex: 1 1 auto;
}

.task-meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 12px;
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
    padding: 8px 10px;
    border-radius: 8px;
    border-left: 3px solid var(--el-color-danger);
    background: color-mix(in srgb, var(--el-color-danger), transparent 94%);
    color: var(--el-color-danger);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.task-footer {
    margin-top: auto;
}

.task-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 8px;
}

.task-actions :deep(.el-button) {
    width: 100%;
    min-width: 0;
    margin: 0;
}

.task-actions :deep(.danger-soft.el-button) {
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
}

@media (max-width: 1680px) {
    .card-list {
        --card-cols: 3;
    }

    .card-list.compact {
        --card-cols: 3;
    }
}

@media (max-width: 1320px) {
    .card-list,
    .card-list.compact {
        --card-cols: 2;
    }
}

@media (max-width: 760px) {
    .catalog-controls {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        align-items: stretch;
        width: 100%;
    }

    .catalog-actions {
        width: 100%;
        margin-left: 0;
    }

    .catalog-actions :deep(.el-button) {
        width: 100%;
        min-width: 0;
        margin: 0;
        justify-content: center;
    }

    .catalog-search {
        width: 100%;
        min-width: 0;
        flex: none;
        grid-template-columns: minmax(0, 1fr);
    }

    .card-list {
        --card-cols: 1;
        grid-template-columns: 1fr;
    }

    .task-card {
        width: 100%;
        min-width: 0;
    }
}

@media (max-width: 420px) {
    .task-top {
        flex-direction: column;
        gap: 10px;
    }

    .task-status {
        width: 100%;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
    }

    .task-meta {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
