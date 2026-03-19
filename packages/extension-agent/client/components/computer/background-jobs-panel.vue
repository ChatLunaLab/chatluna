<template>
    <div class="job-panel" :class="{ compact: props.compactMode }">
        <div class="job-panel-header">
            <div>
                <div class="job-panel-title">后台任务</div>
                <div v-if="!props.hideDesc" class="job-panel-description">
                    Agent 通过 bash 启动的后台命令会出现在这里。
                </div>
            </div>

            <button
                type="button"
                class="job-refresh"
                :disabled="loading"
                @click="refreshJobs"
            >
                刷新
            </button>
        </div>

        <div v-if="jobs.length > 0" class="job-list">
            <div v-for="job in jobs" :key="job.id" class="job-item">
                <div class="job-copy">
                    <div class="job-command">{{ job.command }}</div>
                    <div class="job-meta">
                        <span>{{ job.backend }}</span>
                        <span>{{ stateLabel(job.state) }}</span>
                        <span>{{ formatTime(job.startedAt) }}</span>
                    </div>
                </div>

                <div class="job-actions">
                    <button
                        type="button"
                        class="job-open"
                        @click="emit('open', job)"
                    >
                        进入终端
                    </button>
                    <button
                        v-if="job.state === 'running'"
                        type="button"
                        class="job-stop"
                        @click="stopJob(job.id)"
                    >
                        停止
                    </button>
                    <button
                        type="button"
                        class="job-remove"
                        @click="removeJob(job.id)"
                    >
                        删除
                    </button>
                </div>
            </div>
        </div>

        <div v-else class="job-empty">当前没有后台任务。</div>
    </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { send } from '@koishijs/client'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { ComputerBackgroundJobInfo } from '../../../src/types'

const props = defineProps<{
    compactMode?: boolean
    hideDesc?: boolean
}>()

const emit = defineEmits<{
    open: [value: ComputerBackgroundJobInfo]
}>()

const jobs = ref<ComputerBackgroundJobInfo[]>([])
const loading = ref(false)

let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
    void refreshJobs()
    timer = setInterval(() => {
        void refreshJobs()
    }, 2000)
})

onBeforeUnmount(() => {
    if (!timer) {
        return
    }

    clearInterval(timer)
    timer = undefined
})

async function refreshJobs() {
    loading.value = true
    try {
        jobs.value = await send('chatluna-agent/listComputerBackgroundJobs')
    } catch {
        jobs.value = []
    } finally {
        loading.value = false
    }
}

async function stopJob(jobId: string) {
    try {
        await send('chatluna-agent/killComputerBackgroundJob', jobId)
        await refreshJobs()
    } catch {
        ElMessage.error('停止后台任务失败')
    }
}

async function removeJob(jobId: string) {
    try {
        await send('chatluna-agent/removeComputerBackgroundJob', jobId)
        await refreshJobs()
    } catch {
        ElMessage.error('删除后台任务失败')
    }
}

function stateLabel(state: ComputerBackgroundJobInfo['state']) {
    if (state === 'running') return '运行中'
    if (state === 'completed') return '已完成'
    if (state === 'failed') return '失败'
    if (state === 'killed') return '已停止'
    return '已超时'
}

function formatTime(value: number) {
    return new Date(value).toLocaleTimeString()
}
</script>

<style scoped>
.job-panel {
    border: 1px solid var(--k-card-border);
    border-radius: 14px;
    background: var(--k-card-bg);
    box-shadow: var(--k-card-shadow);
}

.job-panel.compact .job-panel-header,
.job-panel.compact .job-item {
    padding: 12px 14px;
}

.job-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--k-card-border);
}

.job-panel-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.job-panel-description,
.job-meta,
.job-empty {
    margin-top: 4px;
    font-size: 12px;
    color: var(--k-text-light);
}

.job-refresh,
.job-open,
.job-stop,
.job-remove {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--k-card-border);
    border-radius: 8px;
    background: var(--k-menu-bg);
    color: var(--k-text-normal);
    cursor: pointer;
}

.job-list {
    display: flex;
    flex-direction: column;
}

.job-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-top: 1px solid var(--k-card-border);
}

.job-item:first-child {
    border-top: none;
}

.job-copy {
    min-width: 0;
}

.job-command {
    font-size: 13px;
    color: var(--k-text-dark);
    word-break: break-all;
}

.job-meta {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
}

.job-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
}

.job-stop,
.job-remove {
    color: var(--el-color-danger);
}

.job-empty {
    padding: 16px;
}

@media (max-width: 768px) {
    .job-panel-header,
    .job-item {
        flex-direction: column;
        align-items: flex-start;
    }

    .job-actions {
        width: 100%;
        flex-wrap: wrap;
    }
}
</style>
