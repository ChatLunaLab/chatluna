<template>
    <div class="desktop-panel">
        <div class="toolbar-row">
            <div>
                <div class="section-title">Desktop</div>
                <div class="section-copy">
                    支持桌面能力的 backend
                    会在这里提供截图、点击、输入和滚动操作。
                </div>
            </div>

            <div class="toolbar-actions">
                <el-button :loading="loading" @click="refreshDesktop">
                    刷新截图
                </el-button>
            </div>
        </div>

        <div v-if="state?.screenshot" class="desktop-shell">
            <div class="desktop-meta">
                <span>{{ backendLabel }}</span>
                <span v-if="state.info">
                    {{ state.info.width }} x {{ state.info.height }}
                </span>
                <span>session: {{ state.sessionId }}</span>
            </div>

            <div class="desktop-actions">
                <el-input
                    v-model="typeText"
                    placeholder="输入文本后发送到桌面"
                />
                <el-button @click="sendType">输入文本</el-button>
                <el-input
                    v-model="keyText"
                    placeholder="Enter / Tab / Escape"
                />
                <el-button @click="sendKey">发送按键</el-button>
            </div>

            <div class="desktop-stage">
                <img
                    :src="imageUrl"
                    class="desktop-image"
                    @click="handleClick"
                    @wheel.prevent="handleWheel"
                />
            </div>
        </div>

        <div v-else class="placeholder-box">
            <div class="placeholder-title">当前 backend 没有桌面能力</div>
            <div class="placeholder-copy">
                Desktop streaming is only available with desktop-capable
                providers such as E2B.
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import type {
    ComputerConfig,
    ComputerDesktopState,
    ComputerStatus
} from '../../../src/types'

const props = defineProps<{
    config: ComputerConfig
    status: ComputerStatus
}>()

const loading = ref(false)
const state = ref<ComputerDesktopState>()
const typeText = ref('')
const keyText = ref('Enter')

const backendLabel = computed(() => {
    if (props.config.defaultProvider === 'local') return 'Local'
    if (props.config.defaultProvider === 'e2b') return 'E2B'
    return 'open-terminal'
})

const imageUrl = computed(() => {
    if (!state.value?.screenshot) {
        return ''
    }

    return `data:${state.value.screenshot.mimeType};base64,${state.value.screenshot.data}`
})

onMounted(() => {
    refreshDesktop()
})

watch(
    () => props.config.defaultProvider,
    () => {
        refreshDesktop()
    }
)

async function refreshDesktop() {
    try {
        loading.value = true
        state.value = await send('chatluna-agent/getComputerDesktop', {
            backend: props.config.defaultProvider
        })
    } catch {
        ElMessage.error('刷新桌面失败')
    } finally {
        loading.value = false
    }
}

async function sendType() {
    if (!state.value?.sessionId || !typeText.value.trim()) {
        return
    }

    try {
        await send(
            'chatluna-agent/sendComputerDesktopAction',
            state.value.sessionId,
            {
                type: 'type',
                text: typeText.value
            }
        )
        typeText.value = ''
        await refreshDesktop()
    } catch {
        ElMessage.error('发送文本失败')
    }
}

async function sendKey() {
    if (!state.value?.sessionId || !keyText.value.trim()) {
        return
    }

    try {
        await send(
            'chatluna-agent/sendComputerDesktopAction',
            state.value.sessionId,
            {
                type: 'key',
                key: keyText.value.trim()
            }
        )
        await refreshDesktop()
    } catch {
        ElMessage.error('发送按键失败')
    }
}

async function handleClick(event: MouseEvent) {
    if (!state.value?.sessionId || !state.value.screenshot) {
        return
    }

    const target = event.currentTarget as HTMLImageElement
    const rect = target.getBoundingClientRect()
    const scaleX = state.value.screenshot.width / rect.width
    const scaleY = state.value.screenshot.height / rect.height

    try {
        await send(
            'chatluna-agent/sendComputerDesktopAction',
            state.value.sessionId,
            {
                type: 'click',
                x: Math.round((event.clientX - rect.left) * scaleX),
                y: Math.round((event.clientY - rect.top) * scaleY)
            }
        )
        await refreshDesktop()
    } catch {
        ElMessage.error('发送点击失败')
    }
}

async function handleWheel(event: WheelEvent) {
    if (!state.value?.sessionId || !state.value.screenshot) {
        return
    }

    const target = event.currentTarget as HTMLImageElement
    const rect = target.getBoundingClientRect()
    const scaleX = state.value.screenshot.width / rect.width
    const scaleY = state.value.screenshot.height / rect.height

    try {
        await send(
            'chatluna-agent/sendComputerDesktopAction',
            state.value.sessionId,
            {
                type: 'scroll',
                x: Math.round((event.clientX - rect.left) * scaleX),
                y: Math.round((event.clientY - rect.top) * scaleY),
                deltaY: Math.round(event.deltaY)
            }
        )
        await refreshDesktop()
    } catch {
        ElMessage.error('发送滚动失败')
    }
}
</script>

<style scoped>
.desktop-panel {
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
}

.section-title,
.placeholder-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--k-color-text);
}

.section-copy,
.placeholder-copy,
.desktop-meta {
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.7;
    color: var(--k-text-light);
}

.desktop-shell,
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

.desktop-meta {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 0;
    margin-bottom: 12px;
}

.desktop-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 220px) auto;
    gap: 8px;
    margin-bottom: 14px;
}

.desktop-stage {
    overflow: auto;
}

.desktop-image {
    width: 100%;
    border-radius: 10px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 24%);
    background: #111;
    cursor: crosshair;
}

@media (max-width: 900px) {
    .desktop-actions {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 768px) {
    .toolbar-row {
        flex-direction: column;
    }
}
</style>
