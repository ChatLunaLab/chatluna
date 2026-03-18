<template>
    <div class="terminal-panel">
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
import { nextTick, computed, onBeforeUnmount, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import { Close, Plus } from '@element-plus/icons-vue'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import type {
    ComputerConfig,
    ComputerStatus,
    ComputerTerminalInfo
} from '../../../src/types'

interface TerminalTab {
    key: string
    title: string
    sessionId: string
    terminalId: string
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
const activeKey = ref('')
const creating = ref(false)
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

onBeforeUnmount(() => {
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
        await nextTick()
        const host = hostMap.get(key)
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
        term.writeln(`Opening ${backendLabel.value} terminal...`)

        const runtime: TerminalRuntime = {
            term,
            fit
        }
        runtimeMap.set(key, runtime)

        term.onData((data) => {
            if (
                !runtime.socket ||
                runtime.socket.readyState !== WebSocket.OPEN
            ) {
                return
            }

            runtime.socket.send(JSON.stringify({ type: 'input', data }))
        })

        runtime.observer = new ResizeObserver(() => {
            fitTab(key)
            syncTabSize(key)
        })
        runtime.observer.observe(host)

        const info = await send('chatluna-agent/openComputerTerminal', {
            backend: props.config.defaultProvider,
            cols: term.cols,
            rows: term.rows
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
    }
}

async function closeTab(key: string, remote = true) {
    const tab = tabs.value.find((item) => item.key === key)
    if (!tab) {
        return
    }

    if (remote && tab.sessionId && tab.terminalId) {
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
</script>

<style scoped>
.terminal-panel {
    padding: 0;
}

.terminal-frame {
    border: 1px solid var(--k-card-border);
    border-radius: 14px;
    background: #0f1115;
    overflow: hidden;
    box-shadow: var(--k-card-shadow);
}

.terminal-tabs {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
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
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 240px;
    height: 34px;
    border: 1px solid var(--k-card-border);
    border-radius: 10px;
    background: var(--k-menu-bg);
    color: var(--k-text-normal);
}

.terminal-tab-shell.active {
    background: var(--k-color-primary-fade);
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 30%);
    color: var(--k-text-active);
}

.terminal-tab-shell.connecting {
    color: var(--k-text-dark);
}

.terminal-tab-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    padding: 0 0 0 10px;
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
    width: 6px;
    height: 6px;
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
    width: 24px;
    height: 24px;
    margin-right: 4px;
}

.terminal-tab-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
}

.terminal-tab-add {
    width: 28px;
    height: 28px;
    border: 1px solid var(--k-card-border);
    background: var(--k-menu-bg);
    color: var(--k-color-primary);
}

.terminal-tab-clear {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--k-card-border);
    background: var(--k-menu-bg);
    color: var(--k-text-normal);
    font-size: 12px;
}

.terminal-tab-close:hover,
.terminal-tab-add:hover,
.terminal-tab-clear:hover {
    background: var(--k-hover-bg);
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
