<template>
    <div class="panel catalog-panel">
        <div class="panel-header catalog-header">
            <div class="catalog-header-content">
                <div class="catalog-header-info">
                    <div class="panel-title">触发器列表</div>
                    <div class="panel-description">
                        手动执行不会消耗下一次定时执行机会。
                    </div>
                </div>
            </div>

            <div class="search-row">
                <el-popover
                    placement="bottom-start"
                    trigger="click"
                    popper-class="trigger-filter-popper"
                >
                    <template #reference>
                        <el-button class="filter-trigger" plain>
                            {{
                                filters.length > 0
                                    ? `筛选 ${filters.length}`
                                    : '筛选'
                            }}
                        </el-button>
                    </template>

                    <div class="filter-panel">
                        <el-checkbox-group v-model="filters">
                            <div class="filter-list">
                                <el-checkbox
                                    v-for="item in filterOptions"
                                    :key="item.value"
                                    :label="item.value"
                                >
                                    {{ item.label }}
                                </el-checkbox>
                            </div>
                        </el-checkbox-group>

                        <div class="filter-panel-actions">
                            <el-button
                                size="small"
                                text
                                :disabled="filters.length === 0"
                                @click="filters = []"
                            >
                                清空
                            </el-button>
                        </div>
                    </div>
                </el-popover>

                <el-input
                    v-model="keyword"
                    class="search-input"
                    placeholder="搜索名称、绑定键、消息或触发参数"
                    clearable
                >
                    <template #prefix>
                        <el-icon><Search /></el-icon>
                    </template>
                </el-input>
            </div>
        </div>

        <div
            v-if="filteredTasks.length > 0"
            class="card-list"
            :class="{ compact: compactMode }"
        >
            <div
                v-for="item in filteredTasks"
                :key="item.id"
                class="trigger-card"
                :class="{
                    centered: hideDesc,
                    muted: !item.enabled,
                    invalid: !!item.lastError
                }"
                @click="$emit('select', item.id)"
            >
                <div class="card-top">
                    <div class="card-brand">
                        <div class="card-icon" :class="providerKind(item)">
                            <el-icon :size="16">
                                <component :is="providerIcon(item)" />
                            </el-icon>
                        </div>
                        <div class="card-copy">
                            <div class="card-title">
                                {{ formatTitle(item) }}
                            </div>
                            <div v-if="!hideDesc" class="card-subtitle">
                                {{ formatProvider(item.providerKind) }} ·
                                {{ item.bindingKey }}
                            </div>
                        </div>
                    </div>

                    <el-switch
                        :model-value="item.enabled"
                        @change="$emit('toggle', item.id, $event as boolean)"
                        @click.stop
                    />
                </div>

                <div v-if="!hideDesc" class="card-body">
                    <div class="card-line">
                        <span class="line-label">消息</span>
                        <span class="line-value">
                            {{ formatMessage(item.wakeupTemplate.message) }}
                        </span>
                    </div>
                    <div class="card-line">
                        <span class="line-label">
                            {{
                                item.providerKind === 'cron' || !item.providerKind
                                    ? '计划'
                                    : '参数'
                            }}
                        </span>
                        <span class="line-value">
                            {{ formatParams(item) }}
                        </span>
                    </div>
                    <div v-if="item.nextFireAt" class="card-line">
                        <span class="line-label">下次</span>
                        <span class="line-value">
                            {{ formatDate(item.nextFireAt) }}
                        </span>
                    </div>
                </div>

                <div class="card-footer">
                    <div class="card-chips">
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="item.enabled ? 'success' : 'info'"
                        >
                            {{ item.enabled ? '启用' : '停用' }}
                        </el-tag>
                        <el-tag size="small" effect="plain">
                            {{ formatToolMode(item) }}
                        </el-tag>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="replyType(item)"
                        >
                            {{ formatReplyTo(item) }}
                        </el-tag>
                        <el-tag
                            v-if="item.lastError"
                            size="small"
                            effect="plain"
                            type="danger"
                        >
                            异常
                        </el-tag>
                    </div>

                    <div v-if="!hideDesc" class="card-meta">
                        执行 {{ item.fireCount }} 次
                        <span v-if="item.lastFiredAt">
                            · 最近 {{ formatDate(item.lastFiredAt) }}
                        </span>
                    </div>

                    <div
                        v-if="!hideDesc && item.lastError"
                        class="error-line"
                    >
                        {{ item.lastError }}
                    </div>

                    <div class="card-actions" @click.stop>
                        <el-button size="small" plain @click="$emit('select', item.id)">
                            编辑
                        </el-button>
                        <el-button
                            size="small"
                            plain
                            @click="$emit('fire', item.id)"
                        >
                            立即执行
                        </el-button>
                        <el-button
                            class="danger-soft"
                            size="small"
                            plain
                            type="danger"
                            @click="$emit('remove', item.id)"
                        >
                            删除
                        </el-button>
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="empty-state">
            <el-empty :description="emptyText" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
    AlarmClock,
    Bell,
    ChatDotRound,
    Clock,
    Search,
    TrendCharts
} from '@element-plus/icons-vue'
import type {
    TriggerProviderDescriptor,
    TriggerTask
} from '../../../src/types'

const props = defineProps<{
    tasks: TriggerTask[]
    providers: TriggerProviderDescriptor[]
    compactMode: boolean
    hideDesc: boolean
}>()

defineEmits<{
    select: [id: number]
    toggle: [id: number, enabled: boolean]
    fire: [id: number]
    remove: [id: number]
}>()

const keyword = ref('')
const filters = ref<string[]>([])

const filterOptions = [
    { label: '启用', value: 'enabled:yes' },
    { label: '停用', value: 'enabled:no' },
    { label: 'Cron 定时', value: 'kind:cron' },
    { label: '关键词触发', value: 'kind:keyword' },
    { label: '活跃度触发', value: 'kind:activity' },
    { label: '一次性任务', value: 'kind:none' },
    { label: '最近异常', value: 'state:error' }
]

const emptyText = computed(() => {
    if (props.tasks.length < 1) {
        return '还没有创建任何触发器，点击右上角「新建触发器」开始。'
    }
    return '没有匹配的触发器，调整筛选条件再试一次。'
})

const filteredTasks = computed(() => {
    const text = keyword.value.trim().toLowerCase()
    return props.tasks.filter((item) => {
        if (
            filters.value.length > 0 &&
            !filters.value.every((value) => {
                if (value === 'enabled:yes') return item.enabled
                if (value === 'enabled:no') return !item.enabled
                if (value === 'kind:cron') return item.providerKind === 'cron'
                if (value === 'kind:keyword')
                    return item.providerKind === 'keyword'
                if (value === 'kind:activity')
                    return item.providerKind === 'activity'
                if (value === 'kind:none')
                    return !item.providerKind || item.providerKind === 'once'
                if (value === 'state:error') return !!item.lastError
                return true
            })
        ) {
            return false
        }

        if (!text) {
            return true
        }

        return [
            item.name ?? '',
            item.bindingKey,
            typeof item.wakeupTemplate.message === 'string'
                ? item.wakeupTemplate.message
                : '',
            item.providerKind ?? '',
            JSON.stringify(item.params ?? {})
        ]
            .join('\n')
            .toLowerCase()
            .includes(text)
    })
})

function providerKind(task: TriggerTask) {
    if (!task.providerKind || task.providerKind === 'once') return 'oneshot'
    return task.providerKind
}

function providerIcon(task: TriggerTask) {
    if (task.providerKind === 'cron') return AlarmClock
    if (task.providerKind === 'keyword') return ChatDotRound
    if (task.providerKind === 'activity') return TrendCharts
    if (!task.providerKind || task.providerKind === 'once') return Clock
    return Bell
}

function formatTitle(task: TriggerTask) {
    return task.name?.trim() || `任务 #${task.id}`
}

function formatProvider(kind?: string | null) {
    if (!kind || kind === 'once') return '一次性任务'
    return props.providers.find((item) => item.kind === kind)?.name || kind
}

function formatMessage(value?: TriggerTask['wakeupTemplate']['message']) {
    if (value == null) return '[沿用被动消息]'
    return typeof value === 'string' ? value : '[复杂消息内容]'
}

function formatDate(value?: Date | string | null) {
    if (!value) return '未安排'
    return new Date(value).toLocaleString()
}

function formatParams(task: TriggerTask) {
    if (task.providerKind === 'cron') {
        const policy =
            task.params?.missedRunPolicy === 'fire_once'
                ? '过期补执行一次'
                : '过期不执行'
        const expr = task.params?.expression || '无效 cron 表达式'
        return `${expr} · ${policy}`
    }

    if (task.providerKind === 'keyword') {
        const keywords = Array.isArray(task.params?.keywords)
            ? task.params.keywords
            : []
        if (keywords.length < 1) return '未配置关键词'
        const preview = keywords.slice(0, 4).join('、')
        const more = keywords.length > 4 ? ` 等 ${keywords.length} 个` : ''
        return `关键词：${preview}${more}`
    }

    if (task.providerKind === 'activity') {
        const init = task.params?.initialScore
        const threshold = task.params?.activeThreshold
        if (init == null || threshold == null) {
            return '未配置活跃度参数'
        }
        const dirParam = task.params?.direction
        const direction =
            dirParam === 'up'
                ? '越聊越活'
                : dirParam === 'down'
                  ? '越聊越冷'
                  : Number(init) < Number(threshold)
                    ? '越聊越活'
                    : '越聊越冷'
        const half = task.params?.decayHalfLifeMs
        const halfLabel =
            half != null ? ` · 半衰期 ${Math.round(Number(half) / 1000)}s` : ''
        return `${direction}：${init} → ${threshold}${halfLabel}`
    }

    return formatDate(task.nextFireAt)
}

function formatToolMode(task: TriggerTask) {
    const mask = task.wakeupTemplate.toolMask
    if (mask == null) return '工具：全部'
    if (mask.mode === 'all') return '工具：全部'
    if (mask.mode === 'allow') {
        const count = mask.allow?.length ?? 0
        return count < 1 ? '工具：无' : `工具：${count} 个`
    }
    if (mask.mode === 'deny') {
        const count = mask.deny?.length ?? 0
        return `工具：除 ${count} 个外`
    }
    return '工具：继承'
}

function formatReplyTo(task: TriggerTask) {
    const value = task.wakeupTemplate.replyTo ?? 'channel'
    if (value === 'channel') return '发送到频道'
    if (value === 'user') return '发送给用户'
    if (value === 'silent') return '静默执行'
    if (value === 'callback') return '回调返回'
    return value
}

function replyType(task: TriggerTask) {
    const value = task.wakeupTemplate.replyTo ?? 'channel'
    if (value === 'silent') return 'info'
    if (value === 'callback') return 'warning'
    return 'success'
}
</script>

<style scoped>
.panel {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    overflow: hidden;
    min-height: 420px;
    box-sizing: border-box;
}

.panel-header,
.catalog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
    box-sizing: border-box;
}

.catalog-header-content {
    display: flex;
    align-items: center;
    gap: 24px;
    flex-wrap: wrap;
    justify-content: flex-start;
    flex: 1 1 auto;
    min-width: 0;
}

.catalog-header-info {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    min-width: 0;
}


.panel-title {
    font-size: 17px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-description,
.card-subtitle,
.card-meta,
.error-line {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
}

.search-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    width: auto;
    flex-wrap: nowrap;
    flex: 0 1 420px;
    min-width: 220px;
}

.filter-trigger {
    height: 32px;
    min-width: 92px;
    padding-inline: 12px;
    flex: 0 0 auto;
}

.search-input {
    width: auto;
    min-width: 0;
    flex: 1 1 260px;
}

.filter-panel {
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.filter-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.filter-panel-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 8px;
    border-top: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
}

.card-list {
    --card-cols: 4;
    display: grid;
    grid-template-columns: repeat(var(--card-cols), minmax(0, 1fr));
    gap: 16px;
    padding: 16px;
    box-sizing: border-box;
}

.card-list.compact {
    --card-cols: 3;
}

.trigger-card {
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

.trigger-card:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 40%);
    transform: translateY(-1px);
}

.trigger-card.muted {
    opacity: 0.72;
}

.trigger-card.invalid {
    border-color: color-mix(in srgb, var(--el-color-danger), transparent 66%);
}

.card-top {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: flex-start;
    min-width: 0;
}

.trigger-card.centered .card-top {
    align-items: center;
    min-height: 34px;
}

.card-brand {
    display: flex;
    justify-content: flex-start;
    gap: 12px;
    min-width: 0;
    flex: 1 1 auto;
}

.trigger-card.centered .card-brand {
    align-items: center;
}

.card-icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-color-primary) 8%);
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 36%);
}

.card-icon.cron {
    background: color-mix(in srgb, var(--k-side-bg), var(--el-color-primary) 10%);
    color: color-mix(in srgb, var(--el-color-primary), var(--k-text-dark) 14%);
}

.card-icon.keyword {
    background: color-mix(
        in srgb,
        var(--k-side-bg),
        var(--el-color-success) 10%
    );
    color: color-mix(in srgb, var(--el-color-success), var(--k-text-dark) 14%);
}

.card-icon.activity {
    background: color-mix(
        in srgb,
        var(--k-side-bg),
        var(--el-color-warning) 10%
    );
    color: color-mix(in srgb, var(--el-color-warning), var(--k-text-dark) 14%);
}

.card-icon.oneshot {
    background: color-mix(in srgb, var(--k-side-bg), var(--k-text-light) 10%);
    color: var(--k-text-light);
}

.card-copy {
    min-width: 0;
    flex: 1 1 auto;
}

.card-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--k-text-dark);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.card-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--k-page-bg), transparent 40%);
    box-shadow: inset 0 0 0 1px
        color-mix(in srgb, var(--k-color-divider), transparent 40%);
}

.card-line {
    display: flex;
    gap: 8px;
    font-size: 12.5px;
    line-height: 1.5;
}

.line-label {
    flex: 0 0 auto;
    width: 36px;
    color: var(--k-text-light);
}

.line-value {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--k-text-dark);
    word-break: break-word;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
}

.card-footer {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.card-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.card-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
    gap: 8px;
}

.card-actions :deep(.el-button) {
    width: 100%;
    min-width: 0;
    margin: 0;
}

.card-actions :deep(.danger-soft.el-button) {
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

.error-line {
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--el-color-danger), transparent 92%);
    color: color-mix(in srgb, var(--el-color-danger), var(--k-text-dark) 20%);
    font-size: 12px;
    line-height: 1.5;
}

.empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 280px;
}

@media (max-width: 1680px) {
    .card-list {
        --card-cols: 3;
    }

    .card-list.compact {
        --card-cols: 2;
    }
}

@media (max-width: 1320px) {
    .card-list {
        --card-cols: 2;
    }

    .card-list.compact {
        --card-cols: 2;
    }
}

@media (max-width: 980px) {
    .card-list,
    .card-list.compact {
        --card-cols: 1;
    }
}

@media (max-width: 768px) {
    .catalog-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .catalog-header-content {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
    }

    .search-row {
        width: 100%;
        min-width: 0;
        flex: none;
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        align-items: stretch;
    }

    .filter-trigger {
        min-width: 0;
        width: 100%;
        flex: none;
    }

    .search-input {
        width: 100% !important;
        min-width: 0;
        flex: none;
    }

    .card-list,
    .card-list.compact {
        --card-cols: 1;
    }
}
</style>
