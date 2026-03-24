<template>
    <div class="panel" :class="{ compact: props.compactMode }">
        <div class="panel-header">
            <div>
                <div class="panel-title">后端状态</div>
                <div v-if="!props.hideDesc" class="panel-description">
                    查看可用性和会话数量。
                </div>
            </div>
        </div>

        <div class="panel-body">
            <div class="backend-list">
                <div
                    v-for="item in backends"
                    :key="item.key"
                    class="backend-row"
                >
                    <div>
                        <div class="row-title">{{ item.label }}</div>
                        <div
                            v-if="!props.hideDesc || item.status.error"
                            class="row-description"
                        >
                            {{
                                item.status.error ||
                                stateLabel(item.status.state)
                            }}
                        </div>
                    </div>

                    <div class="backend-meta">
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="tagType(item.status.state)"
                        >
                            {{ stateLabel(item.status.state) }}
                        </el-tag>
                        <span class="session-copy">
                            {{ item.status.sessionCount }} 个会话
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ComputerStatus } from '../../../src/types'

const props = defineProps<{
    compactMode?: boolean
    hideDesc?: boolean
    status: ComputerStatus
}>()

const backends = computed(() => [
    { key: 'e2b', label: 'E2B', status: props.status.backends.e2b },
    {
        key: 'open-terminal',
        label: 'open-terminal',
        status: props.status.backends['open-terminal']
    },
    {
        key: 'local',
        label: 'Local',
        status: props.status.backends.local
    }
])

function stateLabel(state: ComputerStatus['backends']['local']['state']) {
    if (state === 'connected') return '已连接'
    if (state === 'connecting') return '连接中'
    if (state === 'idle') return '就绪'
    if (state === 'error') return '错误'
    return '未支持'
}

function tagType(state: ComputerStatus['backends']['local']['state']) {
    if (state === 'connected') return 'success'
    if (state === 'idle') return 'info'
    if (state === 'error') return 'danger'
    return 'warning'
}
</script>

<style scoped>
.panel {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    overflow: hidden;
    box-sizing: border-box;
}

.panel.compact .panel-header {
    padding: 14px 16px;
}

.panel-header {
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
}

.panel-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-description,
.row-description,
.session-copy {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.panel-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 18px;
}

.panel.compact .panel-body {
    gap: 14px;
    padding: 16px;
}

.backend-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.panel.compact .backend-list {
    gap: 10px;
}

.backend-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
}

.row-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.backend-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
}

@media (max-width: 768px) {
    .backend-row {
        flex-direction: column;
    }

    .backend-meta {
        width: 100%;
        justify-content: flex-start;
    }
}
</style>
