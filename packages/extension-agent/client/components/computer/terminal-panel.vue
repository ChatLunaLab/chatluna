<template>
    <div class="terminal-panel">
        <div class="job-panel">
            <div class="job-panel-header">
                <div>
                    <div class="job-panel-title">后台任务</div>
                    <div class="job-panel-description">
                        Agent 通过 bash 启动的后台命令会出现在这里。
                    </div>
                </div>

                <button
                    type="button"
                    class="job-refresh"
                    :disabled="loadingJobs"
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
                            @click="openJob(job)"
                        >
                            查看
                        </button>
                        <button
                            v-if="job.state === 'running'"
                            type="button"
                            class="job-stop"
                            @click="stopJob(job.id)"
                        >
                            停止
                        </button>
                    </div>
                </div>
            </div>

            <div v-else class="job-empty">当前没有后台任务。</div>
        </div>

        <div class="terminal-frame">
            <div class="terminal-tabs">
                <div
                    v-for="item in tabs"
                    :key="item.key"
                    class="terminal-tab-shell"
                    :class="{
                        active: item.key === activeKey,
                        connecting: item.connecting
                    }"
                >
                    <input
                        v-if="editingKey === item.key"
                        ref="editRef"
                        :value="editingTitle"
                        class="terminal-tab-input"
                        @input="updateEditingTitle"
                        @blur="commitRename"
                        @keydown.enter.prevent="commitRename"
                        @keydown.esc.prevent="cancelRename"
                    />
                    <button
                        type="button"
                        v-else
                        class="terminal-tab-trigger"
                        @click="activeKey = item.key"
                        @dblclick="startRename(item.key)"
                    >
                        <span class="terminal-tab-label">{{ item.title }}</span>
                        <span
                            class="terminal-tab-state"
                            :class="{ connected: item.connected }"
                        />
                    </button>
                    <button
                        type="button"
                        class="terminal-tab-close"
                        @click="closeTab(item.key)"
                    >
                        <el-icon :size="12"><Close /></el-icon>
                    </button>
                </div>

                <div class="terminal-tab-actions">
                    <button
                        v-if="tabs.length > 0"
                        type="button"
                        class="terminal-tab-clear"
                        @click="closeAllTabs"
                    >
                        关闭全部
                    </button>
                    <button
                        type="button"
                        class="terminal-tab-add"
                        :disabled="creating || !ready"
                        @click="createTab"
                    >
                        <el-icon :size="14"><Plus /></el-icon>
                    </button>
                </div>
            </div>

            <div class="terminal-workspace">
                <div class="terminal-panes">
                    <div
                        v-for="item in tabs"
                        v-show="item.key === activeKey"
                        :key="`${item.key}-pane`"
                        class="terminal-pane"
                    >
                        <div
                            :ref="(el) => setHost(item.key, el)"
                            class="terminal-host"
                        />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import 'xterm/css/xterm.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import { Close, Plus } from '@element-plus/icons-vue'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import type {
    ComputerBackgroundJobInfo,
    ComputerConfig,
    ComputerStatus,
    ComputerTerminalInfo
} from '../../../src/types'

interface TerminalTab {
    key: string
    title: string
    sessionId: string
    terminalId: string
    jobId?: string
    connecting: boolean
    connected: boolean
}

interface TerminalRuntime {
    term: Terminal
    fit: FitAddon
    socket?: WebSocket
    observer?: ResizeObserver
}

const props = defineProps<{
    config: ComputerConfig
    status: ComputerStatus
}>()

const tabs = ref<TerminalTab[]>([])
const jobs = ref<ComputerBackgroundJobInfo[]>([])
const activeKey = ref('')
const creating = ref(false)
const loadingJobs = ref(false)
const editingKey = ref('')
const editingTitle = ref('')
const editRef = ref<HTMLInputElement>()

const backend = computed(
    () => props.status.backends[props.config.defaultProvider]
)
const ready = computed(() =>
    backend.value.capabilities.includes('terminal_pty')
)
const backendLabel = computed(() => {
    if (props.config.defaultProvider === 'local') return 'Local'
    if (props.config.defaultProvider === 'e2b') return 'E2B'
    return 'open-terminal'
})

const hostMap = new Map<string, HTMLDivElement>()
const runtimeMap = new Map<string, TerminalRuntime>()
let count = 1
let jobTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
    void refreshJobs()
    jobTimer = setInterval(() => {
        void refreshJobs()
    }, 2000)
})

onBeforeUnmount(() => {
    if (jobTimer) {
        clearInterval(jobTimer)
        jobTimer = undefined
    }
    for (const item of [...tabs.value]) {
        void closeTab(item.key)
    }
})

watch(
    () => props.config.defaultProvider,
    async () => {
        await closeAllTabs()
    }
)

watch(ready, async (value) => {
    if (!value) {
        await closeAllTabs()
    }
})

watch(activeKey, async (key) => {
    if (!key) {
        return
    }

    await nextTick()
    fitTab(key)
    syncTabSize(key)
})

async function createTab() {
    if (!ready.value || creating.value) {
        return
    }

    creating.value = true
    const key = `terminal-${Date.now()}-${count++}`
    const tab: TerminalTab = {
        key,
        title: `终端 ${tabs.value.length + 1}`,
        sessionId: '',
        terminalId: '',
        connecting: true,
        connected: false
    }
    tabs.value.push(tab)
    activeKey.value = key

    try {
        const runtime = await ensureRuntime(
            tab,
            `Opening ${backendLabel.value} terminal...\r\n`
        )

        const info = await send('chatluna-agent/openComputerTerminal', {
            backend: props.config.defaultProvider,
            cols: runtime.term.cols,
            rows: runtime.term.rows
        })

        tab.sessionId = info.sessionId
        tab.terminalId = info.terminalId
        await connectSocket(tab, runtime, info)
        tab.connecting = false
        tab.connected = true
    } catch {
        await closeTab(key, false)
        ElMessage.error('打开终端失败')
    } finally {
        creating.value = false
    }
}

async function refreshJobs() {
    loadingJobs.value = true
    try {
        jobs.value = await send('chatluna-agent/listComputerBackgroundJobs')
    } catch {
        jobs.value = []
    } finally {
        loadingJobs.value = false
    }
}

async function openJob(job: ComputerBackgroundJobInfo) {
    const existing = tabs.value.find((item) => item.jobId === job.id)
    if (existing) {
        activeKey.value = existing.key
        return
    }

    const key = `job-${job.id}`
    const tab: TerminalTab = {
        key,
        title: formatJobTitle(job.command),
        sessionId: job.sessionId,
        terminalId: job.terminalId,
        jobId: job.id,
        connecting: job.state === 'running',
        connected: false
    }
    tabs.value.push(tab)
    activeKey.value = key

    try {
        const runtime = await ensureRuntime(tab, job.output)
        if (job.state === 'running') {
            await connectSocket(tab, runtime, {
                sessionId: job.sessionId,
                terminalId: job.terminalId,
                backend: job.backend,
                url: job.url
            })
            tab.connecting = false
            tab.connected = true
            return
        }

        tab.connecting = false
    } catch {
        await closeTab(key, false)
        ElMessage.error('打开后台任务失败')
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

async function ensureRuntime(tab: TerminalTab, initialOutput = '') {
    await nextTick()
    const host = hostMap.get(tab.key)
    if (!host) {
        throw new Error('terminal host missing')
    }

    const term = new Terminal({
        convertEol: true,
        fontSize: 13,
        fontFamily: 'JetBrains Mono, SFMono-Regular, Consolas, monospace',
        theme: {
            background: '#0f1115',
            foreground: '#d7dce2'
        }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    if (initialOutput) {
        term.write(initialOutput)
    }

    const runtime: TerminalRuntime = {
        term,
        fit
    }
    runtimeMap.set(tab.key, runtime)

    term.onData((data) => {
        if (!runtime.socket || runtime.socket.readyState !== WebSocket.OPEN) {
            return
        }

        runtime.socket.send(JSON.stringify({ type: 'input', data }))
    })

    runtime.observer = new ResizeObserver(() => {
        fitTab(tab.key)
        syncTabSize(tab.key)
    })
    runtime.observer.observe(host)
    return runtime
}

async function startRename(key: string) {
    const tab = tabs.value.find((item) => item.key === key)
    if (!tab) {
        return
    }

    editingKey.value = key
    editingTitle.value = tab.title
    await nextTick()
    editRef.value?.focus()
    editRef.value?.select()
}

function updateEditingTitle(event: Event) {
    editingTitle.value = (event.target as HTMLInputElement).value
}

function commitRename() {
    if (!editingKey.value) {
        return
    }

    const tab = tabs.value.find((item) => item.key === editingKey.value)
    if (tab) {
        tab.title = editingTitle.value.trim() || tab.title
    }

    editingKey.value = ''
    editingTitle.value = ''
}

function cancelRename() {
    editingKey.value = ''
    editingTitle.value = ''
}

async function connectSocket(
    tab: TerminalTab,
    runtime: TerminalRuntime,
    info: ComputerTerminalInfo
) {
    runtime.socket?.close()
    runtime.socket = new WebSocket(toWsUrl(info.url))

    await new Promise<void>((resolve, reject) => {
        if (!runtime.socket) {
            reject(new Error('socket missing'))
            return
        }

        runtime.socket.onopen = () => resolve()
        runtime.socket.onerror = () => reject(new Error('socket error'))
    })

    runtime.socket.onmessage = (event) => {
        const text = typeof event.data === 'string' ? event.data : ''
        try {
            const data = JSON.parse(text)
            if (data.type === 'data') {
                runtime.term.write(data.data)
                return
            }
        } catch {}

        runtime.term.write(text)
    }

    runtime.socket.onclose = () => {
        tab.connected = false
        tab.connecting = false
        void refreshJobs()
    }
}

async function closeTab(key: string, remote = true) {
    const tab = tabs.value.find((item) => item.key === key)
    if (!tab) {
        return
    }

    if (remote && !tab.jobId && tab.sessionId && tab.terminalId) {
        try {
            await send(
                'chatluna-agent/closeComputerTerminal',
                tab.sessionId,
                tab.terminalId
            )
        } catch {}
    }

    const runtime = runtimeMap.get(key)
    runtime?.observer?.disconnect()
    runtime?.socket?.close()
    runtime?.term?.dispose()
    runtimeMap.delete(key)
    hostMap.delete(key)

    const idx = tabs.value.findIndex((item) => item.key === key)
    tabs.value = tabs.value.filter((item) => item.key !== key)

    if (activeKey.value === key) {
        const next = tabs.value[idx] ?? tabs.value[idx - 1]
        activeKey.value = next?.key ?? ''
    }
}

async function closeAllTabs() {
    for (const item of [...tabs.value]) {
        await closeTab(item.key)
    }

    tabs.value = []
    activeKey.value = ''
}

function setHost(key: string, el: Element | null) {
    if (el instanceof HTMLDivElement) {
        hostMap.set(key, el)
        fitTab(key)
        syncTabSize(key)
        return
    }

    hostMap.delete(key)
}

function fitTab(key: string) {
    const runtime = runtimeMap.get(key)
    const host = hostMap.get(key)
    if (!runtime || !host || host.offsetParent == null) {
        return
    }

    runtime.fit.fit()
}

function syncTabSize(key: string) {
    const runtime = runtimeMap.get(key)
    const host = hostMap.get(key)
    if (!runtime || !host || host.offsetParent == null) {
        return
    }

    if (!runtime.socket || runtime.socket.readyState !== WebSocket.OPEN) {
        return
    }

    runtime.socket.send(
        JSON.stringify({
            type: 'resize',
            cols: runtime.term.cols,
            rows: runtime.term.rows
        })
    )
}

function toWsUrl(path: string) {
    const url = new URL(path, window.location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
}

function formatJobTitle(command: string) {
    return command.length > 24 ? `${command.slice(0, 24)}...` : command
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
.terminal-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 0;
}

.job-panel {
    border: 1px solid var(--k-card-border);
    border-radius: 14px;
    background: var(--k-card-bg);
    box-shadow: var(--k-card-shadow);
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
.job-stop {
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

.job-stop {
    color: var(--el-color-danger);
}

.job-empty {
    padding: 16px;
}

.terminal-frame {
    border: 1px solid var(--k-card-border);
    border-radius: 14px;
    background: var(--k-main-bg);
    overflow: hidden;
    box-shadow: var(--k-card-shadow);
}

.terminal-tabs {
    display: flex;
    align-items: flex-end;
    gap: 0;
    padding: 10px 12px 0;
    border-bottom: 1px solid var(--k-card-border);
    background: var(--k-side-bg);
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
}

.terminal-tabs::-webkit-scrollbar {
    display: none;
}

.terminal-tab-shell {
    position: relative;
    display: inline-flex;
    isolation: isolate;
    align-items: center;
    gap: 8px;
    min-width: 132px;
    max-width: 228px;
    height: 38px;
    margin-right: 4px;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 12px 12px 0 0;
    background: transparent;
    color: var(--k-text-light);
    transition: background-color 0.16s ease;
}

.terminal-tab-shell::before,
.terminal-tab-shell::after {
    content: '';
    position: absolute;
    bottom: -1px;
    width: 18px;
    height: 18px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.16s ease;
    z-index: -1;
}

.terminal-tab-shell::before {
    left: -18px;
    border-bottom-right-radius: 14px;
}

.terminal-tab-shell::after {
    right: -18px;
    border-bottom-left-radius: 14px;
}

.terminal-tab-shell.active {
    margin-bottom: -1px;
    border-color: var(--k-card-border);
    background: var(--k-main-bg);
    color: var(--k-text-dark);
    z-index: 3;
}

.terminal-tab-shell.active::before,
.terminal-tab-shell.active::after {
    opacity: 1;
}

.terminal-tab-shell.active::before {
    box-shadow: 8px 8px 0 0 var(--k-main-bg);
}

.terminal-tab-shell.active::after {
    box-shadow: -8px 8px 0 0 var(--k-main-bg);
}

.terminal-tab-shell.connecting {
    color: var(--k-text-dark);
}

.terminal-tab-shell:not(.active):hover {
    background: color-mix(in srgb, var(--k-main-bg), transparent 36%);
    color: var(--k-text-normal);
}

.terminal-tab-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1 1 auto;
    max-width: 100%;
    padding: 0 0 0 12px;
    height: 100%;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
}

.terminal-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.terminal-tab-input {
    width: 150px;
    height: 24px;
    margin-left: 8px;
    padding: 0 8px;
    border: 1px solid var(--k-color-border);
    border-radius: 6px;
    background: var(--k-main-bg);
    color: var(--k-text-dark);
    outline: none;
}

.terminal-tab-state {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--k-color-warning);
    flex: 0 0 auto;
}

.terminal-tab-state.connected {
    background: var(--k-color-success);
}

.terminal-tab-close,
.terminal-tab-add,
.terminal-tab-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: currentColor;
    cursor: pointer;
}

.terminal-tab-close {
    width: 22px;
    height: 22px;
    margin-right: 8px;
    border-radius: 999px;
}

.terminal-tab-close:hover {
    background: color-mix(in srgb, var(--k-color-divider), transparent 24%);
}

.terminal-tab-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    padding: 0 0 8px 8px;
}

.terminal-tab-add {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: transparent;
    color: var(--k-text-normal);
}

.terminal-tab-clear {
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    background: transparent;
    color: var(--k-text-light);
    font-size: 12px;
}

.terminal-tab-close:hover,
.terminal-tab-add:hover,
.terminal-tab-clear:hover {
    background: color-mix(in srgb, var(--k-main-bg), transparent 30%);
}

.terminal-tab-add:disabled,
.terminal-tab-clear:disabled {
    opacity: 0.5;
    cursor: default;
}

.terminal-workspace {
    background: #0f1115;
}

.terminal-panes {
    min-height: 420px;
    background: #0f1115;
}

.terminal-pane {
    height: 100%;
}

.terminal-host {
    height: min(56vh, 520px);
    overflow: hidden;
    padding: 12px 14px;
}

:deep(.xterm) {
    height: 100%;
}

:deep(.xterm-viewport) {
    scrollbar-width: none;
    -ms-overflow-style: none;
}

:deep(.xterm-viewport::-webkit-scrollbar) {
    display: none;
}

@media (max-width: 768px) {
    .job-panel-header,
    .job-item {
        flex-direction: column;
        align-items: flex-start;
    }

    .job-actions {
        width: 100%;
    }

    .terminal-tabs {
        flex-wrap: wrap;
    }

    .terminal-tab-shell {
        max-width: calc(100% - 34px);
    }

    .terminal-tab-actions {
        margin-left: 0;
        width: 100%;
        justify-content: flex-end;
    }

    .terminal-host {
        height: 420px;
        padding: 10px;
    }
}
</style>
