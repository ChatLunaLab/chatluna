<template>
    <div class="model-success-panel" v-if="rows.length">
        <p class="model-success-desc">不同模型的请求成功率情况。</p>
        <div class="model-success-list">
            <div
                class="model-success-row"
                v-for="row in rows"
                :key="row.key"
            >
                <span class="model-success-icon" aria-hidden="true">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                    >
                        <path
                            d="M3 12h3l3-7 5 14 3-7h4"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    </svg>
                </span>
                <div class="model-success-meta">
                    <el-tooltip
                        :content="
                            row.platform
                                ? `${row.platform}/${row.label}`
                                : row.label
                        "
                        placement="top"
                        effect="dark"
                    >
                        <span class="model-success-name">
                            <span
                                class="model-success-platform"
                                v-if="row.platform"
                            >
                                {{ row.platform }}/
                            </span>{{ row.label }}
                        </span>
                    </el-tooltip>
                    <span class="model-success-counts">
                        <span class="ok">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                aria-hidden="true"
                            >
                                <circle
                                    cx="12"
                                    cy="12"
                                    r="9"
                                    stroke="currentColor"
                                    stroke-width="2"
                                />
                                <path
                                    d="m8.5 12.5 2.5 2.5 4.5-5"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                />
                            </svg>
                            {{ fmt(row.successfulCalls) }}
                        </span>
                        <span class="fail">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                aria-hidden="true"
                            >
                                <circle
                                    cx="12"
                                    cy="12"
                                    r="9"
                                    stroke="currentColor"
                                    stroke-width="2"
                                />
                                <path
                                    d="m9 9 6 6m0-6-6 6"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                />
                            </svg>
                            {{ fmt(row.failedCalls) }}
                        </span>
                    </span>
                </div>
                <strong
                    class="model-success-rate"
                    :class="rateClass(row.successRate)"
                >
                    {{ pct(row.successRate) }}
                </strong>
            </div>
        </div>
    </div>

    <div class="chart-empty" v-else>暂无模型数据</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { fmt, pct, usage } from '../state'

const rows = computed(() =>
    (usage.value?.models ?? [])
        .slice()
        .filter((row) => row.calls > 0)
        .sort((a, b) => b.calls - a.calls)
)

function rateClass(rate: number) {
    if (rate >= 0.99) return 'rate-ok'
    if (rate >= 0.9) return 'rate-warn'
    return 'rate-bad'
}
</script>

<style lang="scss">
.model-success-panel {
    padding: 0.5rem 1.25rem 1rem;
}

.model-success-desc {
    margin: 0 0 0.75rem;
    color: var(--k-text-light);
    font-size: 0.85rem;
    line-height: 1.4;
}

.model-success-list {
    display: grid;
    gap: 0.45rem;
    max-height: 22rem;
    overflow-y: auto;
    padding-right: 0.25rem;
    scrollbar-color: var(--k-card-border) transparent;
    scrollbar-width: thin;

    &::-webkit-scrollbar {
        width: 0.4rem;
    }

    &::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: color-mix(in srgb, var(--k-text-light), transparent 55%);
    }
}

.model-success-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.85rem;
    padding: 0.5rem 0.25rem;

    & + & {
        border-top: 1px solid
            color-mix(in srgb, var(--k-card-border), transparent 60%);
    }
}

.model-success-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    flex: 0 0 auto;
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-color-primary), transparent 88%);
    color: var(--k-color-primary);

    svg {
        width: 1.1rem;
        height: 1.1rem;
    }
}

.model-success-meta {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
}

.model-success-name {
    overflow: hidden;
    color: var(--k-text-dark);
    font-size: 0.95rem;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.model-success-platform {
    color: var(--k-text-light);
    font-weight: 400;
}

.model-success-counts {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--k-text-light);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    line-height: 1;

    .ok,
    .fail {
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
    }

    .ok {
        color: var(--el-color-success);
    }

    .fail {
        color: var(--el-color-danger);
    }

    svg {
        width: 0.85rem;
        height: 0.85rem;
    }
}

.model-success-rate {
    color: var(--k-text-dark);
    font-size: 1rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;

    &.rate-ok {
        color: var(--el-color-success);
    }

    &.rate-warn {
        color: var(--el-color-warning);
    }

    &.rate-bad {
        color: var(--el-color-danger);
    }
}
</style>
