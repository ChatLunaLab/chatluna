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
            <button
                v-for="item in runs"
                :key="item.runId"
                type="button"
                class="run-row"
                @click="selectedRunId = item.runId"
            >
                <div class="run-main">
                    <div class="run-title">{{ item.agentName }}</div>
                    <div class="run-meta">
                        {{ formatTime(item.startedAt) }}
                        · 深度 {{ item.depth }} · 工具 {{ item.toolCount }} ·
                        回合 {{ item.turnCount }} · 耗时 {{ formatDuration(item) }}
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
                    <div class="run-link">查看详情</div>
                </div>
            </button>
        </div>

        <div v-else class="empty-state">
            <el-empty description="目前还没有 Sub Agent 运行记录。" />
        </div>

        <el-dialog
            :model-value="selectedRun != null"
            width="min(960px, calc(100vw - 24px))"
            top="4vh"
            destroy-on-close
            @close="selectedRunId = ''"
        >
            <template #header>
                <div v-if="selectedRun" class="dialog-header">
                    <div>
                        <div class="dialog-title-row">
                            <div class="dialog-title">{{ selectedRun.agentName }} 运行详情</div>
                            <button
                                type="button"
                                class="icon-btn"
                                title="复制整个运行记录 Markdown"
                                aria-label="复制整个运行记录 Markdown"
                                @click="copyRun(selectedRun)"
                            >
                                <el-icon><CopyDocument /></el-icon>
                            </button>
                        </div>
                        <div class="dialog-meta">
                            {{ formatTime(selectedRun.startedAt) }}
                            · 深度 {{ selectedRun.depth }}
                            · 工具 {{ selectedRun.toolCount }}
                            · 回合 {{ selectedRun.turnCount }}
                            · 耗时 {{ formatDuration(selectedRun) }}
                        </div>
                    </div>
                    <el-tag
                        size="small"
                        effect="plain"
                        :type="runTag(selectedRun.state)"
                    >
                        {{ selectedRun.state }}
                    </el-tag>
                </div>
            </template>

            <div v-if="selectedRun" class="trace-wrap">
                <div class="trace-summary">
                    <div class="summary-card">
                        <span class="summary-label">运行 ID</span>
                        <code>{{ selectedRun.runId }}</code>
                    </div>
                    <div class="summary-card">
                        <span class="summary-label">会话 ID</span>
                        <code>{{ selectedRun.conversationId }}</code>
                    </div>
                    <div class="summary-card">
                        <span class="summary-label">运行时长</span>
                        <code>{{ formatDuration(selectedRun) }}</code>
                    </div>
                </div>

                <div class="trace-list">
                    <div
                        v-for="item in selectedRun.trace"
                        :key="item.id"
                        :class="['trace-item', `trace-item-${item.type}`]"
                    >
                        <div class="trace-head">
                            <div>
                                <div class="trace-title">{{ item.title || traceLabel(item.type) }}</div>
                                <div class="trace-meta">
                                    {{ traceLabel(item.type) }}
                                    <template v-if="item.tool">· {{ item.tool }}</template>
                                    <template v-if="item.callId">· {{ item.callId }}</template>
                                    · {{ formatTime(item.at) }}
                                </div>
                            </div>
                            <button
                                type="button"
                                class="icon-btn"
                                title="复制该条记录 Markdown"
                                aria-label="复制该条记录 Markdown"
                                @click.stop="copyTrace(item, selectedRun)"
                            >
                                <el-icon><CopyDocument /></el-icon>
                            </button>
                        </div>
                        <pre class="trace-content">{{ item.text || '(empty)' }}</pre>
                    </div>
                </div>

                <div v-if="selectedRun.trace.length < 1" class="trace-empty">
                    <el-empty description="该次运行暂时没有可展示的详情。" />
                </div>

                <div v-if="selectedRun.error" class="error-box">
                    <div class="trace-title">运行错误</div>
                    <pre class="trace-content">{{ selectedRun.error }}</pre>
                </div>
            </div>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { CopyDocument } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, ref } from 'vue'
import type { SubAgentRunInfo } from '../../../src/types'

const props = defineProps<{
    runs: SubAgentRunInfo[]
}>()

const selectedRunId = ref('')

const selectedRun = computed(() => {
    return props.runs.find((item) => item.runId === selectedRunId.value)
})

function runTag(state: SubAgentRunInfo['state']) {
    if (state === 'running') return 'warning'
    if (state === 'completed') return 'success'
    if (state === 'aborted') return 'info'
    return 'danger'
}

function formatTime(value: number) {
    return new Date(value).toLocaleString()
}

function formatDuration(run: SubAgentRunInfo) {
    const ms = (run.endedAt ?? Date.now()) - run.startedAt
    const sec = Math.max(0, Math.floor(ms / 1000))

    if (sec < 60) {
        return `${sec} 秒`
    }

    const min = Math.floor(sec / 60)
    const rest = sec % 60

    if (min < 60) {
        return rest > 0 ? `${min} 分 ${rest} 秒` : `${min} 分`
    }

    const hour = Math.floor(min / 60)
    const restMin = min % 60
    return restMin > 0 ? `${hour} 小时 ${restMin} 分` : `${hour} 小时`
}

function traceLabel(type: SubAgentRunInfo['trace'][number]['type']) {
    if (type === 'prompt') return '请求'
    if (type === 'message') return '追加消息'
    if (type === 'thought') return '模型输出'
    if (type === 'tool-call') return '工具调用'
    if (type === 'tool-result') return '工具输出'
    if (type === 'output') return '最终输出'
    return '错误'
}

async function copy(text: string, msg: string) {
    if (window.isSecureContext && navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(text)
            ElMessage.success(msg)
            return
        } catch {}
    }

    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', 'true')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    el.style.pointerEvents = 'none'
    document.body.appendChild(el)
    el.focus()
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    ElMessage.success(msg)
}

async function copyRun(run: SubAgentRunInfo) {
    const lines = [
        `# ${run.agentName} 运行详情`,
        '',
        `- 开始时间：${formatTime(run.startedAt)}`,
        `- 状态：${run.state}`,
        `- 深度：${run.depth}`,
        `- 工具数：${run.toolCount}`,
        `- 回合数：${run.turnCount}`,
        `- 运行时长：${formatDuration(run)}`,
        `- 运行 ID：${run.runId}`,
        `- 会话 ID：${run.conversationId}`,
        `- 父会话 ID：${run.parentConversationId}`
    ]

    if (run.lastTool) {
        lines.push(`- 最后工具：${run.lastTool}`)
    }

    if (run.endedAt) {
        lines.push(`- 结束时间：${formatTime(run.endedAt)}`)
    }

    lines.push('', '## 运行轨迹')

    for (const item of run.trace) {
        lines.push(
            '',
            `### ${item.title || traceLabel(item.type)}`,
            '',
            `- 类型：${traceLabel(item.type)}`,
            `- 时间：${formatTime(item.at)}`
        )

        if (item.tool) {
            lines.push(`- 工具：${item.tool}`)
        }

        if (item.callId) {
            lines.push(`- 调用 ID：${item.callId}`)
        }

        lines.push('', '```text', item.text || '(empty)', '```')
    }

    if (run.error) {
        lines.push('', '## 运行错误', '', '```text', run.error, '```')
    }

    await copy(lines.join('\n'), '已复制运行记录 Markdown')
}

async function copyTrace(
    item: SubAgentRunInfo['trace'][number],
    run: SubAgentRunInfo
) {
    await copy(
        [
            `## ${item.title || traceLabel(item.type)}`,
            '',
            `- Agent：${run.agentName}`,
            `- 类型：${traceLabel(item.type)}`,
            `- 时间：${formatTime(item.at)}`,
            ...(item.tool ? [`- 工具：${item.tool}`] : []),
            ...(item.callId ? [`- 调用 ID：${item.callId}`] : []),
            '',
            '```text',
            item.text || '(empty)',
            '```'
        ].join('\n'),
        '已复制该条运行记录 Markdown'
    )
}
</script>

<style scoped>
.runs-panel {
    --trace-surface: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 22%);
    --trace-surface-soft: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 14%);
    --trace-border: color-mix(in srgb, var(--k-color-divider), transparent 18%);
    --trace-scrollbar: color-mix(in srgb, var(--k-text-light), transparent 42%);
    --trace-scrollbar-hover: color-mix(in srgb, var(--k-text-light), transparent 20%);
}

.panel {
    border: 1px solid
        var(--trace-border);
    border-radius: 14px;
    background: var(--trace-surface);
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
    width: 100%;
    padding: 14px;
    border: 1px solid
        var(--trace-border);
    border-radius: 14px;
    background: var(--trace-surface);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.2s ease, background-color 0.2s ease;
}

.run-row:hover {
    border-color: color-mix(in srgb, var(--k-text-light), transparent 60%);
    background: color-mix(in srgb, var(--trace-surface), white 2%);
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

.run-link {
    margin-top: 10px;
    font-size: 12px;
    color: var(--el-color-primary);
}

.dialog-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding-right: 8px;
}

.dialog-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--k-text-dark);
}

.dialog-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.dialog-meta,
.trace-meta,
.summary-label {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.trace-wrap {
    max-height: 76vh;
    overflow: auto;
    padding-right: 6px;
    scrollbar-width: thin;
    scrollbar-color: var(--trace-scrollbar) transparent;
}

.trace-wrap::-webkit-scrollbar {
    width: 10px;
}

.trace-wrap::-webkit-scrollbar-track {
    background: transparent;
}

.trace-wrap::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: var(--trace-scrollbar);
    border: 2px solid transparent;
    background-clip: padding-box;
}

.trace-wrap::-webkit-scrollbar-thumb:hover {
    background: var(--trace-scrollbar-hover);
    border: 2px solid transparent;
    background-clip: padding-box;
}

.trace-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
    margin-bottom: 14px;
}

.summary-card,
.trace-item,
.error-box {
    border: 1px solid var(--trace-border);
    border-radius: 8px;
    background: var(--trace-surface);
    padding: 16px;
    transition: border-color 0.2s ease, background 0.2s ease;
}

.trace-item:hover {
    border-color: color-mix(in srgb, var(--k-text-light), transparent 60%);
    background: color-mix(in srgb, var(--trace-surface), white 2%);
}

.summary-card code {
    display: block;
    margin-top: 8px;
    font-size: 12px;
    word-break: break-all;
}

.trace-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.trace-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}

.trace-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--k-text-light);
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease;
}

.icon-btn:hover {
    background-color: color-mix(in srgb, var(--k-text-light), transparent 85%);
    color: var(--k-text-dark);
}

.icon-btn:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--el-color-primary), transparent 50%);
    outline-offset: 2px;
}

.trace-content {
    margin: 12px 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
    line-height: 1.7;
    color: var(--k-text-dark);
    font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', monospace;
}

.trace-item-prompt {
    border-left: 4px solid var(--el-color-primary);
}

.trace-item-thought {
    border-left: 4px solid var(--el-color-warning);
}

.trace-item-output {
    border-left: 4px solid var(--el-color-success);
}

.trace-item-tool-call {
    border-left: 4px solid var(--el-color-info);
}

.trace-item-tool-result {
    border-left: 4px solid var(--el-color-success);
}

.trace-item-message {
    border-left: 4px solid var(--el-color-primary);
}

.trace-item-error {
    border-left: 4px solid var(--el-color-danger);
    background: color-mix(in srgb, var(--el-color-danger), var(--trace-surface) 96%);
}

.trace-empty {
    padding: 12px 0;
}

.error-box {
    margin-top: 12px;
    border-left: 4px solid var(--el-color-danger);
    background: color-mix(in srgb, var(--el-color-danger), var(--trace-surface) 96%);
}

:deep(.el-dialog) {
    border: 1px solid var(--trace-border);
    border-radius: 18px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 18%);
    box-shadow: none;
}

:deep(.el-dialog__header) {
    margin-right: 0;
    padding: 20px 20px 10px;
}

:deep(.el-dialog__body) {
    padding: 8px 20px 20px;
    color: var(--k-text-dark);
}

:deep(.el-dialog__headerbtn .el-dialog__close) {
    color: var(--k-text-light);
}

:deep(.el-dialog__headerbtn:hover .el-dialog__close) {
    color: var(--k-text-dark);
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

    .dialog-header,
    .trace-head {
        flex-direction: column;
    }
}
</style>
