<template>
    <div class="chatluna-usage-dashboard">
        <section class="dashboard-shell">
            <header class="dashboard-head">
                <h2>ChatLuna 模型用量统计</h2>
            </header>

            <number-grid />

            <section class="dashboard-main">
                <div class="chart-panel">
                    <k-slot name="chatluna-usage-chart"></k-slot>
                </div>
                <source-list />
            </section>

            <k-card class="frameless chatluna-usage-filter">
                <template #header>
                    <span class="filter-title">
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
                        用量查询
                    </span>
                    <span class="actions">
                        <el-button
                            :loading="loading"
                            type="primary"
                            @click="refresh"
                        >
                            刷新
                        </el-button>
                        <el-button :loading="loading" @click="resetFilters">
                            重置
                        </el-button>
                        <el-button
                            :loading="loading"
                            type="danger"
                            @click="clearHistory"
                        >
                            清除历史
                        </el-button>
                    </span>
                </template>

                <div class="filter-body">
                    <el-date-picker
                        v-model="range"
                        class="date-filter"
                        popper-class="chatluna-usage-date-popper"
                        :prefix-icon="Calendar"
                        type="datetimerange"
                        start-placeholder="开始时间"
                        end-placeholder="结束时间"
                        value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
                        @change="changeRange"
                    />

                    <div class="model-filter-row">
                        <el-select
                            v-model="query.platform"
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
                            v-model="query.model"
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
                            v-model="query.callType"
                            filterable
                            default-first-option
                            clearable
                            placeholder="模型类型"
                        >
                            <el-option
                                v-for="item in typeOptions"
                                :key="item"
                                :label="
                                    item === 'llm'
                                        ? 'LLM'
                                        : item === 'embeddings'
                                          ? 'Embeddings'
                                          : 'Reranker'
                                "
                                :value="item"
                            />
                        </el-select>
                        <el-select
                            v-model="query.success"
                            clearable
                            placeholder="成功状态"
                        >
                            <el-option label="成功" :value="true" />
                            <el-option label="失败" :value="false" />
                        </el-select>
                        <el-select
                            v-model="query.source"
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
            </k-card>

            <k-card class="frameless chatluna-usage-table">
                <template #header>
                    <span>调用明细</span>
                    <span>{{ usage?.list.total ?? 0 }} 条</span>
                </template>
                <el-table
                    ref="table"
                    :data="usage?.list.rows ?? []"
                    :default-sort="{ prop: 'createdAt', order: 'descending' }"
                    stripe
                >
                    <el-table-column
                        prop="createdAt"
                        label="时间"
                        width="190"
                        sortable
                    >
                        <template #default="scope">
                            {{ time(scope.row.createdAt) }}
                        </template>
                    </el-table-column>
                    <el-table-column
                        prop="model"
                        label="模型"
                        min-width="180"
                        sortable
                    />
                    <el-table-column
                        prop="source"
                        label="插件来源"
                        min-width="160"
                        sortable
                    />
                    <el-table-column
                        prop="callType"
                        label="类型"
                        width="120"
                        sortable
                    />
                    <el-table-column
                        prop="totalTokens"
                        label="Token"
                        width="110"
                        sortable
                    />
                    <el-table-column label="状态" width="100">
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
                    :total="usage?.list.total ?? 0"
                    :current-page="query.page"
                    :page-size="query.pageSize"
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
    changeRange,
    clearHistory,
    loading,
    query,
    range,
    refresh,
    resetFilters as resetQuery,
    time,
    usage
} from './state'

const table = ref<TableInstance>()

const platformOptions = computed(
    () =>
        [
            ...new Set([
                query.platform,
                ...(usage.value?.list.rows ?? []).map((row) => row.platform)
            ])
        ].filter(Boolean) as string[]
)

const modelOptions = computed(
    () =>
        [
            ...new Set([
                query.model,
                ...(usage.value?.models ?? []).map((row) => row.label)
            ])
        ].filter(Boolean) as string[]
)

const sourceOptions = computed(
    () =>
        [
            ...new Set([
                query.source,
                ...(usage.value?.sources ?? []).map((row) => row.label)
            ])
        ].filter(Boolean) as string[]
)

const typeOptions = computed(
    () =>
        [
            ...new Set([
                query.callType,
                ...(usage.value?.list.rows ?? []).map((row) => row.callType),
                'llm',
                'embeddings',
                'reranker'
            ])
        ].filter(Boolean) as string[]
)

function resetFilters() {
    table.value?.sort('createdAt', 'descending')
    resetQuery()
}

function changePage(page: number) {
    query.page = page
}

function changeSize(size: number) {
    query.page = 1
    query.pageSize = size
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
    min-height: 150px;
    padding: 1rem;

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
    padding: 1.45rem 1.6rem;
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

.metric-pills {
    display: flex;
    justify-content: center;
    gap: 0.5rem;

    span {
        border-radius: 999px;
        background: color-mix(in srgb, var(--k-color-divider), transparent 48%);
        color: var(--k-text-light);
        padding: 0.25rem 0.65rem;
        font-size: 0.8rem;
    }
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
    min-height: 170px;
    padding: 1.45rem 1.6rem;
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
    margin: 1.45rem 0 0;

    div {
        min-width: 0;
        padding: 0 1rem;
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

.accent-card {
    gap: 0.85rem;

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

.accent-dot {
    width: 0.5rem;
    height: 0.5rem;
    flex: 0 0 auto;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.7;
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

.chatluna-usage-filter,
.chatluna-usage-table {
    margin-top: 1rem;
}

.chatluna-usage-filter header,
.chatluna-usage-table header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
}

.chatluna-usage-filter .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
}

.chatluna-usage-filter .filter-title {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--k-text-dark);
    font-size: 1.05rem;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
}

.chatluna-usage-filter .filter-title-icon {
    display: block;
    width: 1.35rem;
    height: 1.35rem;
    flex: 0 0 auto;
    color: var(--k-text-dark);
}

.chatluna-usage-filter {
    overflow: visible;
}

.chatluna-usage-filter .filter-body {
    display: grid;
    box-sizing: border-box;
    gap: 0.8rem;
    padding: 0.1rem 0.9rem 0.85rem;
}

.chatluna-usage-filter .model-filter-row {
    display: grid;
    gap: 0.85rem;
    grid-template-columns: repeat(5, minmax(0, 1fr));
}

.chatluna-usage-filter .el-input,
.chatluna-usage-filter .el-select,
.chatluna-usage-filter .el-date-editor {
    width: 100%;
}

.chatluna-usage-filter .el-input__wrapper,
.chatluna-usage-filter .el-select__wrapper,
.chatluna-usage-filter .el-date-editor.el-input__wrapper {
    min-width: 0;
    background: color-mix(in srgb, var(--k-card-bg), var(--k-page-bg) 42%);
    box-shadow: 0 0 0 1px var(--k-card-border) inset;
}

.chatluna-usage-filter .el-date-editor .el-range-input {
    min-width: 0;
}

.chatluna-usage-filter .el-date-editor.date-filter {
    max-width: none;
    min-width: 0;
    width: calc(40% - 1.75rem);
}

.chatluna-usage-filter .el-date-editor.date-filter .el-range__icon {
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
}

.chatluna-usage-table .el-table td.el-table__cell,
.chatluna-usage-table .el-table th.el-table__cell {
    background-color: var(--el-table-tr-bg-color);
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
    }

    .chatluna-usage-filter .model-filter-row {
        grid-template-columns: 1fr;
    }

    .chatluna-usage-filter .el-date-editor.date-filter {
        width: 100%;
    }
}
</style>
