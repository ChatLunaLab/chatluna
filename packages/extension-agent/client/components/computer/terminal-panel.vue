<template>
    <div class="terminal-panel">
        <div class="toolbar-row">
            <div>
                <div class="section-title">Terminal</div>
                <div class="section-copy">
                    当前 backend 为
                    <strong>{{ backendLabel }}</strong>
                    ，
                    {{
                        ready
                            ? '可以直接打开交互式终端。'
                            : '暂不支持交互式终端。'
                    }}
                </div>
            </div>

            <div class="toolbar-actions">
                <el-button
                    v-if="ready && !connected"
                    :loading="connecting"
                    @click="openTerminal"
                >
                    打开终端
                </el-button>
                <el-button v-if="connected" @click="closeTerminal">
                    关闭终端
                </el-button>
            </div>
        </div>

        <div v-if="ready" class="terminal-shell">
            <div class="terminal-meta">
                <span>{{ connected ? '已连接' : '未连接' }}</span>
                <span v-if="sessionId">session: {{ sessionId }}</span>
            </div>
            <div ref="hostRef" class="terminal-host" />
        </div>

        <div v-else class="placeholder-box">
            <div class="placeholder-title">当前 provider 不支持终端</div>
            <div class="placeholder-copy">
                你仍然可以通过 `bash` 工具执行命令；切换到支持 `terminal_pty` 的
                backend 后，这里会启用实时终端。
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import 'xterm/css/xterm.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import type {
    ComputerConfig,
    ComputerStatus,
    ComputerTerminalInfo
} from '../../../src/types'

const props = defineProps<{
    config: ComputerConfig
    status: ComputerStatus
}>()

const hostRef = ref<HTMLDivElement>()
const connecting = ref(false)
const connected = ref(false)
const sessionId = ref('')
const terminalId = ref('')

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

let term: Terminal | undefined
let fit: FitAddon | undefined
let socket: WebSocket | undefined
let observer: ResizeObserver | undefined

onMounted(() => {
    createTerminalView()
})

onBeforeUnmount(() => {
    cleanup()
})

watch(
    () => props.config.defaultProvider,
    async () => {
        await closeTerminal()
        resetTerminal()
    }
)

function createTerminalView() {
    if (term || !hostRef.value) {
        return
    }

    term = new Terminal({
        convertEol: true,
        fontSize: 13,
        fontFamily: 'JetBrains Mono, SFMono-Regular, Consolas, monospace',
        theme: {
            background: '#11141a',
            foreground: '#d7dce2'
        }
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.value)
    fit.fit()
    term.writeln('Computer terminal is ready.')
    term.onData((data) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return
        }
        socket.send(JSON.stringify({ type: 'input', data }))
    })

    observer = new ResizeObserver(() => {
        fit?.fit()
        if (!socket || socket.readyState !== WebSocket.OPEN || !term) {
            return
        }
        socket.send(
            JSON.stringify({
                type: 'resize',
                cols: term.cols,
                rows: term.rows
            })
        )
    })
    observer.observe(hostRef.value)
}

async function openTerminal() {
    if (!ready.value) {
        return
    }

    try {
        connecting.value = true
        createTerminalView()
        fit?.fit()

        const result = await send('chatluna-agent/openComputerTerminal', {
            backend: props.config.defaultProvider,
            cols: term?.cols ?? 80,
            rows: term?.rows ?? 24
        })

        sessionId.value = result.sessionId
        terminalId.value = result.terminalId
        term?.clear()
        term?.writeln(`Opening ${backendLabel.value} terminal...`)
        await connectSocket(result)
        connected.value = true
    } catch {
        term?.writeln('Failed to open terminal.')
        ElMessage.error('打开终端失败')
    } finally {
        connecting.value = false
    }
}

async function connectSocket(info: ComputerTerminalInfo) {
    socket?.close()
    socket = new WebSocket(toWsUrl(info.url))

    await new Promise<void>((resolve, reject) => {
        if (!socket) {
            reject(new Error('socket missing'))
            return
        }

        socket.onopen = () => resolve()
        socket.onerror = () => reject(new Error('socket error'))
    })

    socket.onmessage = (event) => {
        const text = typeof event.data === 'string' ? event.data : ''
        try {
            const data = JSON.parse(text)
            if (data.type === 'data') {
                term?.write(data.data)
                return
            }
        } catch {}
        term?.write(text)
    }

    socket.onclose = () => {
        connected.value = false
    }
}

async function closeTerminal() {
    if (!sessionId.value || !terminalId.value) {
        socket?.close()
        socket = undefined
        connected.value = false
        return
    }

    try {
        await send(
            'chatluna-agent/closeComputerTerminal',
            sessionId.value,
            terminalId.value
        )
    } catch {}

    socket?.close()
    socket = undefined
    connected.value = false
    sessionId.value = ''
    terminalId.value = ''
}

function resetTerminal() {
    term?.clear()
    term?.writeln('Computer terminal is ready.')
}

function cleanup() {
    observer?.disconnect()
    observer = undefined
    socket?.close()
    socket = undefined
    term?.dispose()
    term = undefined
    fit = undefined
}

function toWsUrl(path: string) {
    const url = new URL(path, window.location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
}
</script>

<style scoped>
.terminal-panel {
    padding: 18px 0 0;
}

.toolbar-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
}

.toolbar-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.section-title,
.placeholder-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--k-color-text);
}

.section-copy,
.placeholder-copy,
.terminal-meta {
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.7;
    color: var(--k-text-light);
}

.terminal-shell,
.placeholder-box {
    margin-top: 16px;
    padding: 16px;
    border-radius: 12px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 24%);
    background: color-mix(
        in srgb,
        var(--k-page-bg),
        var(--k-color-surface-1) 20%
    );
}

.terminal-meta {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 0;
    margin-bottom: 10px;
}

.terminal-host {
    height: 420px;
    overflow: hidden;
}

:deep(.xterm) {
    height: 100%;
}

@media (max-width: 768px) {
    .toolbar-row {
        flex-direction: column;
    }

    .toolbar-actions {
        width: 100%;
        justify-content: flex-end;
    }
}
</style>
