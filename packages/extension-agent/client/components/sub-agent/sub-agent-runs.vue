<template>
    <div class="panel runs-panel">
        <div class="panel-header">
            <div>
                <div class="panel-title">运行记录</div>
                <div class="panel-description">
                    展示当前运行中的委托任务和最近完成的几次运行。
                </div>
            </div>
        </div>

        <div v-if="runs.length > 0" class="runs-list">
            <div v-for="item in runs" :key="item.runId" class="run-row">
                <div class="run-main">
                    <div class="run-title">{{ item.agentName }}</div>
                    <div class="run-meta">
                        {{ formatTime(item.startedAt) }}
                        · 深度 {{ item.depth }} · 工具 {{ item.toolCount }} ·
                        回合 {{ item.turnCount }}
                    </div>
                </div>

                <div class="run-side">
                    <el-tag
                        size="small"
                        effect="plain"
                        :type="runTag(item.state)"
                    >
                        {{ item.state }}
                    </el-tag>
                    <div class="run-last">
                        {{ item.lastTool || '尚未调用工具' }}
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="empty-state">
            <el-empty description="目前还没有 sub-agent 运行记录。" />
        </div>
    </div>
</template>

<script setup lang="ts">
import type { SubAgentRunInfo } from '../../../src/types'

defineProps<{
    runs: SubAgentRunInfo[]
}>()

function runTag(state: SubAgentRunInfo['state']) {
    if (state === 'running') return 'warning'
    if (state === 'completed') return 'success'
    if (state === 'aborted') return 'info'
    return 'danger'
}

function formatTime(value: number) {
    return new Date(value).toLocaleString()
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
}

.panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
}

.panel-title,
.run-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-description,
.run-meta,
.run-last {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
}

.runs-list {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.run-row {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: flex-start;
    padding: 14px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
}

.run-main {
    min-width: 0;
}

.run-side {
    min-width: 120px;
    text-align: right;
}

.run-last {
    margin-top: 8px;
}

.empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 280px;
}

@media (max-width: 768px) {
    .run-row {
        flex-direction: column;
        align-items: flex-start;
    }

    .run-side {
        min-width: 0;
        text-align: left;
    }
}
</style>
