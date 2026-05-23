<template>
    <div class="chatluna-usage-dashboard">
        <section class="dashboard-shell">
            <header class="dashboard-head">
                <h2>Chatluna 数据看板</h2>
                <span
                    class="segment dashboard-segment"
                    :style="{
                        '--segment-index': scopes.findIndex(
                            (item) => item.value === scope
                        )
                    }"
                >
                    <span class="segment-thumb"></span>
                    <button
                        v-for="item in scopes"
                        :key="item.value"
                        :class="{ active: scope === item.value }"
                        type="button"
                        @click="setScope(item.value)"
                    >
                        {{ item.label }}
                    </button>
                </span>
            </header>

            <number-grid />

            <section class="dashboard-main">
                <div class="chart-panel">
                    <k-slot name="chatluna-usage-chart"></k-slot>
                </div>
                <source-list />
            </section>

            <k-card class="frameless chatluna-usage-table">
                <template #header>
                    <span class="table-title">
                        <svg
                            class="filter-title-icon"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                        >
                            <circle
                                cx="11"
                                cy="11"
                                r="7"
                                stroke="currentColor"
                                stroke-width="2"
                            />
                            <path
                                d="M16.5 16.5 21 21"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                            />
                        </svg>
                        调用明细
                    </span>
                    <span class="actions">
                        <el-button
                            :loading="listLoading"
                            type="primary"
                            @click="refreshList"
                        >
                            刷新
                        </el-button>
                        <el-button :loading="listLoading" @click="resetFilters">
                            重置
                        </el-button>
                        <el-button
                            :loading="loading || listLoading"
                            type="danger"
                            @click="clearHistory"
                        >
                            清除历史
                        </el-button>
                    </span>
                </template>

                <div class="filter-body">
                    <el-date-picker
                        v-model="listRange"
                        class="date-filter"
                        popper-class="chatluna-usage-date-popper"
                        :prefix-icon="Calendar"
                        type="datetimerange"
                        start-placeholder="开始时间"
                        end-placeholder="结束时间"
                        value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
                        @change="changeListRange"
                    />

                    <div class="model-filter-row">
                        <el-select
                            v-model="listQuery.platform"
                            filterable
                            allow-create
                            default-first-option
                            clearable
                            placeholder="模型平台"
                        >
                            <el-option
                                v-for="item in platformOptions"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                        <el-select
                            v-model="listQuery.model"
                            filterable
                            allow-create
                            default-first-option
                            clearable
                            placeholder="模型名称"
                        >
                            <el-option
                                v-for="item in modelOptions"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                        <el-select
                            v-model="listQuery.callType"
                            filterable
                            default-first-option
                            clearable
                            placeholder="模型类型"
                        >
                            <el-option
                                v-for="item in typeOptions"
                                :key="item"
                                :label="typeText(item)"
                                :value="item"
                            />
                        </el-select>
                        <el-select
                            v-model="listQuery.success"
                            clearable
                            placeholder="成功状态"
                        >
                            <el-option label="成功" :value="true" />
                            <el-option label="失败" :value="false" />
                        </el-select>
                        <el-select
                            v-model="listQuery.source"
                            filterable
                            allow-create
                            default-first-option
                            clearable
                            placeholder="插件来源"
                        >
                            <el-option
                                v-for="item in sourceOptions"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                    </div>
                </div>

                <el-table
                    ref="table"
                    :data="list?.rows ?? []"
                    :default-sort="{ prop: 'createdAt', order: 'descending' }"
                    table-layout="auto"
                    stripe
                    @sort-change="changeSort"
                >
                    <el-table-column
                        prop="createdAt"
                        label="时间"
                        width="180"
                        sortable
                    >
                        <template #default="scope">
                            {{ time(scope.row.createdAt) }}
                        </template>
                    </el-table-column>
                    <el-table-column
                        prop="model"
                        label="模型"
                        :width="modelWidth"
                        sortable
                    >
                        <template #default="scope">
                            <el-tooltip
                                :content="
                                    scope.row.platform
                                        ? `${scope.row.platform}/${scope.row.model}`
                                        : scope.row.model
                                "
                                placement="top"
                                effect="dark"
                            >
                                <span class="nowrap-cell">
                                    {{ scope.row.model }}
                                </span>
                            </el-tooltip>
                        </template>
                    </el-table-column>
                    <el-table-column
                        prop="platform"
                        label="渠道"
                        :width="platformWidth"
                        show-overflow-tooltip
                        sortable
                    />
                    <el-table-column
                        prop="source"
                        label="插件来源"
                        :min-width="sourceWidth"
                        sortable
                    />
                    <el-table-column
                        prop="callType"
                        label="类型"
                        width="128"
                        sortable
                    >
                        <template #default="scope">
                            {{ typeText(scope.row.callType) }}
                        </template>
                    </el-table-column>
                    <el-table-column
                        prop="totalTokens"
                        label="Tokens"
                        width="290"
                        align="right"
                        header-align="left"
                        sortable="custom"
                    >
                        <template #header>
                            <span class="token-header">Tokens</span>
                        </template>
                        <template #default="scope">
                            <el-tooltip
                                placement="right"
                                effect="dark"
                                popper-class="chatluna-usage-token-popper"
                            >
                                <template #content>
                                    <div class="token-detail">
                                        <p class="token-detail-title">
                                            Token 明细
                                        </p>
                                        <div class="token-detail-row">
                                            <span>输入 Token</span>
                                            <strong>
                                                {{ fmt(scope.row.inputTokens) }}
                                            </strong>
                                        </div>
                                        <div class="token-detail-row">
                                            <span>输出 Token</span>
                                            <strong>
                                                {{
                                                    fmt(scope.row.outputTokens)
                                                }}
                                            </strong>
                                        </div>
                                        <div
                                            class="token-detail-row"
                                            v-if="scope.row.reasoningTokens > 0"
                                        >
                                            <span>思考 Token</span>
                                            <strong>
                                                {{
                                                    fmt(
                                                        scope.row
                                                            .reasoningTokens
                                                    )
                                                }}
                                            </strong>
                                        </div>
                                        <div class="token-detail-row">
                                            <span>缓存读取 Token</span>
                                            <strong>
                                                {{
                                                    fmt(scope.row.cachedTokens)
                                                }}
                                            </strong>
                                        </div>
                                        <div class="token-detail-divider"></div>
                                        <div class="token-detail-row total">
                                            <span>总 Token</span>
                                            <strong>
                                                {{ fmt(scope.row.totalTokens) }}
                                            </strong>
                                        </div>
                                    </div>
                                </template>
                                <div class="token-cell">
                                    <span class="token-item token-input">
                                        <svg
                                            class="token-item-icon"
                                            xmlns="http://www.w3.org/2000/svg"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            aria-hidden="true"
                                        >
                                            <path
                                                d="M12 20V8"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                            />
                                            <path
                                                d="m7 13 5-5 5 5"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                            />
                                            <path
                                                d="M5 4h14"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                            />
                                        </svg>
                                        <strong>
                                            {{ fmt(scope.row.inputTokens) }}
                                        </strong>
                                    </span>
                                    <span class="token-item token-output">
                                        <svg
                                            class="token-item-icon"
                                            xmlns="http://www.w3.org/2000/svg"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            aria-hidden="true"
                                        >
                                            <path
                                                d="M12 4v12"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                            />
                                            <path
                                                d="m7 11 5 5 5-5"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                            />
                                            <path
                                                d="M5 20h14"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                            />
                                        </svg>
                                        <strong>
                                            {{ fmt(scope.row.outputTokens) }}
                                        </strong>
                                    </span>
                                    <span class="token-item token-cache">
                                        <svg
                                            class="token-item-icon"
                                            xmlns="http://www.w3.org/2000/svg"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            aria-hidden="true"
                                        >
                                            <rect
                                                x="9"
                                                y="18"
                                                width="6"
                                                height="3"
                                                rx="1"
                                                stroke="currentColor"
                                                stroke-width="2"
                                            />
                                            <path
                                                d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3Z"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linejoin="round"
                                            />
                                        </svg>
                                        <strong>
                                            {{ fmt(scope.row.cachedTokens) }}
                                        </strong>
                                    </span>
                                </div>
                            </el-tooltip>
                        </template>
                    </el-table-column>
                    <el-table-column label="状态" width="92">
                        <template #default="scope">
                            <el-tag
                                :type="scope.row.success ? 'success' : 'danger'"
                            >
                                {{ scope.row.success ? '成功' : '失败' }}
                            </el-tag>
                        </template>
                    </el-table-column>
                </el-table>
                <el-pagination
                    class="pager"
                    layout="prev, pager, next, sizes, total"
                    :total="list?.total ?? 0"
                    :current-page="listQuery.page"
                    :page-size="listQuery.pageSize"
                    :page-sizes="[20, 50, 100, 200]"
                    @current-change="changePage"
                    @size-change="changeSize"
                />
            </k-card>
        </section>
    </div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import type { TableInstance } from 'element-plus'
import { Calendar } from '@element-plus/icons-vue'
import NumberGrid from './numbers/index.vue'
import SourceList from './sources/index.vue'
import {
    changeListRange,
    clearHistory,
    fmt,
    list,
    listLoading,
    listQuery,
    listRange,
    loading,
    refreshList,
    resetFilters as resetQuery,
    scope,
    scopes,
    setScope,
    time,
    usage
} from './state'

const table = ref<TableInstance>()

function size(text: string) {
    return Array.from(text).reduce(
        (sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 2 : 1),
        0
    )
}

const platformOptions = computed(
    () =>
        [
            ...new Set([
                listQuery.platform,
                ...(list.value?.rows ?? []).map((row) => row.platform)
            ])
        ].filter(Boolean) as string[]
)

const modelOptions = computed(
    () =>
        [
            ...new Set([
                listQuery.model,
                ...(usage.value?.models ?? []).map((row) => row.label)
            ])
        ].filter(Boolean) as string[]
)

const sourceOptions = computed(
    () =>
        [
            ...new Set([
                listQuery.source,
                ...(usage.value?.sources ?? []).map((row) => row.label)
            ])
        ].filter(Boolean) as string[]
)

const modelWidth = computed(
    () => Math.max(8, ...modelOptions.value.map((item) => size(item))) * 8 + 52
)

const platformWidth = computed(
    () =>
        Math.max(4, ...platformOptions.value.map((item) => size(item))) * 8 + 52
)

const sourceWidth = computed(
    () => Math.max(8, ...sourceOptions.value.map((item) => size(item))) * 8 + 52
)

const typeOptions = computed(
    () =>
        [
            ...new Set([
                listQuery.callType,
                ...(list.value?.rows ?? []).map((row) => row.callType),
                'llm',
                'embeddings',
                'reranker'
            ])
        ].filter(Boolean) as string[]
)

function typeText(type: string) {
    if (type === 'llm') return '大语言模型'
    if (type === 'embeddings') return '嵌入模型'
    if (type === 'reranker') return '重排序模型'
    return type
}

function resetFilters() {
    table.value?.sort('createdAt', 'descending')
    resetQuery()
}

function changePage(page: number) {
    listQuery.page = page
}

function changeSize(size: number) {
    listQuery.page = 1
    listQuery.pageSize = size
}

function changeSort(data: {
    prop: string
    order: 'ascending' | 'descending' | null
}) {
    listQuery.listSortBy = data.order ? data.prop : 'createdAt'
    listQuery.listDesc = data.order !== 'ascending'
    listQuery.page = 1
}
</script>

<style lang="scss">
.chatluna-usage-dashboard {
    color: var(--k-text-dark);
    min-height: 100%;
    padding: var(--card-margin);

    .k-card,
    .usage-metric-card,
    .chatluna-usage-source-panel {
        background: var(--k-card-bg);
        border: 1px solid var(--k-card-border);
        border-radius: 12px;
        box-shadow: var(--k-card-shadow);
        color: var(--k-text-dark);
    }
}

.dashboard-shell {
    min-width: 0;
    padding: 1rem;
    border: 1px solid var(--k-card-border);
    border-radius: 12px;
    background: var(--k-card-bg);
    box-shadow: var(--k-card-shadow);
}

.dashboard-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;

    h2 {
        margin: 0;
        color: var(--k-text-dark);
        font-size: 1.35rem;
        font-weight: 600;
        line-height: 1.3;
    }

    .dashboard-segment {
        flex: 0 0 auto;
    }
}

.dashboard-main {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(280px, 0.8fr);
    gap: 1rem;
    margin-top: 1rem;
}

.chart-panel {
    min-width: 0;

    .k-card {
        height: 100%;
    }

    .echarts {
        width: 100%;
        height: 460px;
    }
}

.usage-metric-card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 138px;
    padding: 0.9rem;

    > strong {
        align-self: center;
        color: var(--k-text-dark);
        font-size: 2rem;
        line-height: 1.1;
    }

    p {
        margin: 0;
    }
}

.request-card,
.success-card {
    position: relative;
    overflow: hidden;
    padding: 1.2rem 1.4rem;
}

.request-card > .metric-value,
.success-card > .metric-value {
    align-self: flex-start;
    color: var(--k-text-dark);
    font-size: 2rem;
    font-weight: 500;
    letter-spacing: 0;
    line-height: 1;

    small {
        margin-left: 0.12rem;
        font-size: 0.72em;
        font-weight: 400;
    }
}

.metric-compare {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--k-text-light);
    font-size: 0.85rem;
    line-height: 1;
}

.metric-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    background: color-mix(in srgb, var(--k-color-primary), transparent 88%);
    color: var(--k-color-primary);
    font-weight: 600;
    padding: 0.25rem 0.48rem;

    &.up {
        background: color-mix(
            in srgb,
            var(--el-color-success),
            transparent 88%
        );
        color: var(--el-color-success);
    }

    &.down {
        background: color-mix(in srgb, var(--el-color-danger), transparent 88%);
        color: var(--el-color-danger);
    }
}

.metric-title {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--k-text-dark);
    font-size: 1.05rem;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
}

.metric-title-icon {
    display: block;
    width: 1.35rem;
    height: 1.35rem;
    box-sizing: border-box;
    flex: 0 0 auto;
    border-radius: 999px;
    background: color-mix(in srgb, var(--k-color-primary), transparent 88%);
    color: var(--k-color-primary);
    padding: 0.28rem;
}

.metric-label {
    color: inherit;
    font-size: inherit;
    font-weight: inherit;
}

.metric-progress {
    height: 0.5rem;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, var(--k-color-divider), transparent 48%);

    span {
        display: block;
        height: 100%;
        max-width: 100%;
        border-radius: inherit;
        background: var(--k-color-primary);
    }
}

.metric-note {
    color: var(--k-text-light);
    font-size: 0.875rem;
}

.success-note {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    line-height: 1;

    span:last-child {
        color: var(--k-color-primary);
    }
}

.token-card header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
}

.token-card {
    --token-columns-shift: -0.35rem;

    min-height: 150px;
    padding: 1.2rem 1.4rem;
}

.token-title {
    min-width: 0;
}

.token-icon {
    position: relative;
    width: 1.35rem;
    height: 1.35rem;
    box-sizing: border-box;
    flex: 0 0 auto;
    border-radius: 999px;
    background: color-mix(in srgb, var(--k-color-primary), transparent 88%);
    color: var(--k-color-primary);

    &::before,
    &::after {
        content: '';
        position: absolute;
        left: 0.34rem;
        bottom: 0.34rem;
        border-radius: 999px;
        background: currentColor;
    }

    &::before {
        width: 0.1rem;
        height: 0.72rem;
    }

    &::after {
        width: 0.76rem;
        height: 0.1rem;
    }

    i {
        position: absolute;
        bottom: 0.43rem;
        width: 0.1rem;
        border-radius: 999px 999px 0 0;
        background: currentColor;

        &:nth-child(1) {
            left: 0.52rem;
            height: 0.28rem;
        }

        &:nth-child(2) {
            left: 0.7rem;
            height: 0.45rem;
        }

        &:nth-child(3) {
            left: 0.88rem;
            height: 0.6rem;
        }
    }
}

.accent-card {
    gap: 0.7rem;

    .accent-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
    }

    > strong {
        align-self: flex-start;
        color: var(--k-color-primary);
    }
}

.accent-line {
    display: block;
    height: 1px;
    background: var(--k-card-border);
}

.accent-summary {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    color: var(--k-text-light);
    font-size: 0.85rem;
    line-height: 1;
}

.segment {
    position: relative;
    display: inline-grid;
    grid-template-columns: repeat(4, minmax(2rem, 1fr));
    overflow: hidden;
    isolation: isolate;
    border-radius: 999px;
    background: color-mix(in srgb, var(--k-color-divider), transparent 48%);
    padding: 0.15rem;
    flex: 0 0 auto;

    .segment-thumb {
        position: absolute;
        top: 0.15rem;
        bottom: 0.15rem;
        left: 0.15rem;
        z-index: 0;
        width: calc((100% - 0.3rem) / 4);
        border-radius: 999px;
        background: var(--k-color-primary);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
        transform: translateX(calc(var(--segment-index, 0) * 100%));
        transition: transform 0.22s ease;
        pointer-events: none;
    }

    button {
        position: relative;
        z-index: 1;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: var(--k-text-light);
        cursor: pointer;
        font-size: 0.75rem;
        line-height: 1;
        min-width: 2rem;
        padding: 0.35rem 0.55rem;

        &.active {
            color: var(--k-card-bg);
        }
    }
}

.token-columns {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
    margin: 1.15rem 0 0;
    transform: translateY(var(--token-columns-shift));

    div {
        min-width: 0;
        padding: 0 0.8rem;
        text-align: center;

        & + div {
            border-left: 1px solid var(--k-card-border);
        }
    }

    span,
    strong {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    span {
        color: var(--k-text-light);
        font-size: 0.82rem;
    }

    strong {
        margin-top: 0.45rem;
        color: var(--k-text-dark);
        font-size: 1.25rem;
        font-weight: 500;
        line-height: 1.15;
    }
}

.chatluna-usage-source-panel {
    padding: 1rem;

    > header {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 0.75rem;

        p,
        span {
            margin: 0;
        }

        p {
            font-weight: 600;
        }

        span {
            color: var(--k-text-light);
            font-size: 0.82rem;
        }

        strong {
            color: var(--k-color-primary);
        }
    }
}

.source-total {
    display: grid;
    gap: 0.15rem;
    justify-items: end;

    span {
        color: var(--k-text-light);
        font-size: 0.75rem;
        font-weight: 400;
    }
}

.source-chart-body {
    display: grid;
    gap: 0.75rem;
}

.source-pie {
    width: 100%;
    height: 240px;
}

.source-detail {
    min-height: 11rem;
    border-top: 1px solid var(--k-card-border);
    padding-top: 0.75rem;

    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        margin-bottom: 0.65rem;

        span {
            min-width: 0;
            overflow: hidden;
            color: var(--k-text-dark);
            font-weight: 600;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }
}

.source-detail-content-enter-active,
.source-detail-content-leave-active {
    transition:
        opacity 0.2s ease,
        transform 0.22s ease;
}

.source-detail-content-enter-from,
.source-detail-content-leave-to {
    opacity: 0;
    transform: translateY(0.25rem);
}

.source-detail-content-enter-to,
.source-detail-content-leave-from {
    opacity: 1;
    transform: translateY(0);
}

.source-model-list {
    display: grid;
    align-content: start;
    grid-auto-rows: max-content;
    gap: 0.65rem;
    height: 7.75rem;
    overflow-y: auto;
    padding-right: 0.25rem;
    scrollbar-color: var(--k-card-border) var(--k-card-bg);
    scrollbar-width: thin;

    &::-webkit-scrollbar {
        width: 0.45rem;
    }

    &::-webkit-scrollbar-track,
    &::-webkit-scrollbar-corner {
        background: var(--k-card-bg);
    }

    &::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: color-mix(in srgb, var(--k-text-light), transparent 45%);
    }
}

.source-model-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.35rem 0.75rem;
    align-items: center;

    strong {
        color: var(--k-color-primary);
        font-size: 0.86rem;
        font-weight: 600;
    }
}

.source-model-name {
    overflow: hidden;
    color: var(--k-text-dark);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.source-model-bar {
    grid-column: 1 / -1;
    height: 0.38rem;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, var(--k-color-divider), transparent 48%);

    span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: var(--k-color-primary);
        transition: width 0.24s ease;
    }
}

.source-empty {
    display: grid;
    min-height: 300px;
    place-items: center;
    color: var(--k-text-light);

    &.compact {
        min-height: 4rem;
    }
}

.chatluna-usage-table {
    margin-top: 1rem;
}

.chatluna-usage-table header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
}

.chatluna-usage-table .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
}

.chatluna-usage-table .table-title {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--k-text-dark);
    font-size: 1.05rem;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
}

.chatluna-usage-table .filter-title-icon {
    display: block;
    width: 1.35rem;
    height: 1.35rem;
    flex: 0 0 auto;
    color: var(--k-text-dark);
}

.chatluna-usage-table {
    overflow: visible;
}

.chatluna-usage-table .filter-body {
    display: grid;
    box-sizing: border-box;
    gap: 0.8rem;
    padding: 0.5rem 0.9rem 1rem;
}

.chatluna-usage-table .model-filter-row {
    display: grid;
    gap: 0.85rem;
    grid-template-columns: repeat(5, minmax(0, 1fr));
}

.chatluna-usage-table .el-input,
.chatluna-usage-table .el-select,
.chatluna-usage-table .el-date-editor {
    width: 100%;
}

.chatluna-usage-table .filter-body .el-input__wrapper,
.chatluna-usage-table .filter-body .el-select__wrapper,
.chatluna-usage-table .filter-body .el-date-editor.el-input__wrapper {
    min-width: 0;
    background: color-mix(in srgb, var(--k-card-bg), var(--k-page-bg) 42%);
    box-shadow: 0 0 0 1px var(--k-card-border) inset;
}

.chatluna-usage-table .el-date-editor .el-range-input {
    min-width: 0;
}

.chatluna-usage-table .el-date-editor.date-filter {
    max-width: none;
    min-width: 0;
    width: calc(40% - 1.75rem);
}

.chatluna-usage-table .el-date-editor.date-filter .el-range__icon {
    color: var(--k-text-light);
}

.chatluna-usage-date-popper {
    --el-bg-color-overlay: var(--k-card-bg);
    --el-fill-color-blank: var(--k-card-bg);
    --el-fill-color-light: var(--k-hover-bg);
    --el-border-color: var(--k-card-border);
    --el-border-color-light: var(--k-card-border);
    --el-text-color-primary: var(--k-text-dark);
    --el-text-color-regular: var(--k-text-dark);
    --el-text-color-secondary: var(--k-text-light);
    --el-color-primary: var(--k-color-primary);
    overflow: hidden;
    border: 1px solid var(--k-card-border) !important;
    border-radius: 12px;
    background: var(--k-card-bg);
    box-shadow: var(--k-card-shadow);
}

.chatluna-usage-date-popper .el-popper__arrow::before {
    border-color: var(--k-card-border);
    background: var(--k-card-bg);
}

.chatluna-usage-date-popper .el-picker-panel,
.chatluna-usage-date-popper .el-picker-panel__body-wrapper,
.chatluna-usage-date-popper .el-picker-panel__body,
.chatluna-usage-date-popper .el-picker-panel__footer {
    border-color: var(--k-card-border);
    background: var(--k-card-bg);
    color: var(--k-text-dark);
}

.chatluna-usage-date-popper .el-date-range-picker__time-header,
.chatluna-usage-date-popper .el-date-range-picker__content.is-left {
    border-color: var(--k-card-border);
}

.chatluna-usage-date-popper .el-date-table th {
    border-bottom-color: var(--k-card-border);
    color: var(--k-text-light);
}

.chatluna-usage-date-popper .el-date-table td {
    color: var(--k-text-dark);
}

.chatluna-usage-date-popper .el-date-table td.available:hover {
    color: var(--k-color-primary);
}

.chatluna-usage-date-popper .el-date-table td.today .el-date-table-cell__text {
    color: var(--k-color-primary);
}

.chatluna-usage-date-popper .el-date-table td.in-range .el-date-table-cell {
    background: color-mix(in srgb, var(--k-color-primary), transparent 86%);
}

.chatluna-usage-date-popper
    .el-date-table
    td.current:not(.disabled)
    .el-date-table-cell__text,
.chatluna-usage-date-popper
    .el-date-table
    td.start-date
    .el-date-table-cell__text,
.chatluna-usage-date-popper
    .el-date-table
    td.end-date
    .el-date-table-cell__text {
    background: var(--k-color-primary);
    color: var(--el-color-white);
}

.chatluna-usage-date-popper .el-picker-panel__icon-btn,
.chatluna-usage-date-popper .el-date-range-picker__header,
.chatluna-usage-date-popper .el-date-range-picker__header div {
    color: var(--k-text-dark);
}

.chatluna-usage-date-popper .el-picker-panel__icon-btn:hover {
    color: var(--k-color-primary);
}

.chatluna-usage-date-popper .el-input__wrapper {
    background: color-mix(in srgb, var(--k-card-bg), var(--k-page-bg) 42%);
    box-shadow: 0 0 0 1px var(--k-card-border) inset;
}

.chatluna-usage-table .pager {
    justify-content: flex-end;
    padding: 0 1rem 0.25rem;
    margin-top: 1rem;
}

.chatluna-usage-table .el-table {
    --el-table-bg-color: var(--k-card-bg);
    --el-table-tr-bg-color: var(--k-card-bg);
    --el-table-header-bg-color: var(--k-card-bg);
    --el-table-row-hover-bg-color: var(--k-hover-bg);
    --el-table-current-row-bg-color: var(--k-hover-bg);
    --el-table-border-color: var(--k-card-border);
    --el-fill-color-lighter: color-mix(
        in srgb,
        var(--k-card-bg),
        var(--k-color-divider) 32%
    );
    color: var(--k-text-dark);
    width: 100%;
}

.chatluna-usage-table .el-table td.el-table__cell,
.chatluna-usage-table .el-table th.el-table__cell {
    background-color: var(--el-table-tr-bg-color);
}

.chatluna-usage-table .el-table .cell {
    white-space: nowrap;
}

.token-cell {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: center;
    gap: 0.9rem;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    min-width: 16rem;
    white-space: nowrap;
}

.token-header {
    display: inline-block;
    text-align: left;
    vertical-align: middle;
}

.nowrap-cell {
    display: inline-block;
    white-space: nowrap;
    vertical-align: middle;
}

.token-item {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.22rem;
    color: var(--k-text-dark);
    font-weight: 500;
    text-align: left;

    strong,
    span {
        min-width: 0;
    }

    strong {
        color: currentColor;
        font-weight: 600;
        text-align: left;
    }
}

.token-item-icon {
    width: 0.95rem;
    height: 0.95rem;
    flex: 0 0 auto;
}

.token-input {
    color: var(--el-color-success);
}

.token-output {
    color: var(--k-color-primary);
}

.token-cache {
    color: var(--el-color-warning);
}

.chatluna-usage-token-popper.el-popper {
    --el-bg-color-overlay: var(--k-card-bg);
    background: var(--k-card-bg);
    border: 1px solid var(--k-card-border);
    color: var(--k-text-dark);
    box-shadow: var(--k-card-shadow);
    padding: 0;
}

.chatluna-usage-token-popper .el-popper__arrow::before {
    border-color: var(--k-card-border);
    background: var(--k-card-bg);
}

.token-detail {
    min-width: 14rem;
    padding: 0.6rem 0.85rem 0.7rem;
    color: var(--k-text-dark);
    font-variant-numeric: tabular-nums;
}

.token-detail-title {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    font-weight: 600;
}

.token-detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1.5rem;
    padding: 0.18rem 0;
    color: var(--k-text-light);
    font-size: 0.85rem;

    strong {
        color: var(--k-text-dark);
        font-weight: 600;
    }

    &.total {
        color: var(--k-text-dark);
        font-weight: 600;

        strong {
            color: var(--k-color-primary);
        }
    }
}

.token-detail-divider {
    height: 1px;
    margin: 0.4rem 0 0.3rem;
    background: var(--k-card-border);
}

.chatluna-usage-table
    .el-table--striped
    .el-table__body
    tr.el-table__row--striped
    td.el-table__cell {
    background-color: var(--el-fill-color-lighter);
}

.chatluna-usage-table
    .el-table--enable-row-hover
    .el-table__body
    tr:hover
    > td.el-table__cell {
    background-color: var(--el-table-row-hover-bg-color);
}

@media (max-width: 1280px) {
    .dashboard-main {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 768px) {
    .dashboard-head {
        align-items: flex-start;
        flex-direction: column;
    }

    .chatluna-usage-table .model-filter-row {
        grid-template-columns: 1fr;
    }

    .chatluna-usage-table .el-date-editor.date-filter {
        width: 100%;
    }
}
</style>
