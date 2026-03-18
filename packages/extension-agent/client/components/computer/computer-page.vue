<template>
    <div class="computer-page" v-loading="loading">
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">Computer</div>
                </div>

                <div class="actions-section">
                    <el-button @click="reloadComputer">重新加载</el-button>
                </div>
            </div>
        </div>

        <div class="provider-row">
            <div class="provider-item">
                <div>
                    <div class="row-title">默认电脑能力后端</div>
                    <div class="row-description">
                        Agent 会优先使用这里选择的执行环境。
                    </div>
                </div>
                <el-select
                    :model-value="draft.defaultProvider"
                    class="provider-select"
                    @update:model-value="updateProvider"
                >
                    <el-option label="Local" value="local" />
                    <el-option label="E2B" value="e2b" />
                    <el-option label="open-terminal" value="open-terminal" />
                </el-select>
            </div>
            <div class="provider-item">
                <div>
                    <div class="row-title">会话自动关闭</div>
                    <div class="row-description">
                        当会话的空闲时间超过此时间后会自动关闭。
                    </div>
                </div>
                <div class="provider-value">
                    <el-input-number
                        :model-value="Math.round(draft.idleTimeoutMs / 60000)"
                        class="provider-select"
                        :min="1"
                        :max="60"
                        :step="1"
                        controls-position="right"
                        @update:model-value="updateIdleTimeout"
                    />
                    <span class="row-unit">分钟</span>
                </div>
            </div>
        </div>

        <div class="tabs">
            <div
                :class="['tab', { active: activeTab === 'config' }]"
                @click="activeTab = 'config'"
            >
                配置
            </div>
            <div
                :class="['tab', { active: activeTab === 'terminal' }]"
                @click="activeTab = 'terminal'"
            >
                终端
            </div>
            <div
                :class="['tab', { active: activeTab === 'files' }]"
                @click="activeTab = 'files'"
            >
                文件
            </div>
            <div
                :class="['tab', { active: activeTab === 'desktop' }]"
                @click="activeTab = 'desktop'"
            >
                桌面
            </div>
        </div>

        <div class="tab-content">
            <Transition name="fade-slide" mode="out-in">
                <div v-if="activeTab === 'config'" key="config">
                    <configuration-panel
                        :config="draft"
                        :status="status"
                        :testing="testing"
                        @update:config="updateConfig"
                        @test="testBackend"
                    />
                </div>

                <div v-else-if="activeTab === 'terminal'" key="terminal">
                    <terminal-panel :config="draft" :status="status" />
                </div>

                <div v-else-if="activeTab === 'files'" key="files">
                    <files-panel :config="draft" :status="status" />
                </div>

                <div v-else key="desktop">
                    <desktop-panel :config="draft" :status="status" />
                </div>
            </Transition>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import ConfigurationPanel from './configuration-panel.vue'
import TerminalPanel from './terminal-panel.vue'
import FilesPanel from './files-panel.vue'
import DesktopPanel from './desktop-panel.vue'
import type {
    ComputerBackendType,
    ComputerConfig,
    ComputerStatus
} from '../../../src/types'

const props = withDefaults(
    defineProps<{
        config: ComputerConfig
        status: ComputerStatus
        loading?: boolean
    }>(),
    {
        config: () => ({
            defaultProvider: 'local',
            idleTimeoutMs: 600000,
            local: {
                enabled: true,
                sandboxMode: 'workspace-write',
                approvalMode: 'on-request',
                dangerouslySkipPermissions: false,
                preferredShell: 'auto',
                scopePath: '',
                writableRoots: [],
                readOnlyRoots: [],
                denyRoots: [],
                ignores: [],
                allowedCommands: [],
                blockedCommands: [],
                commandTimeoutMs: 30000,
                networkPolicy: 'block'
            },
            e2b: {
                enabled: false,
                apiKey: '',
                template: 'base',
                desktopTemplate: '',
                timeoutMs: 300000,
                keepAlive: true
            },
            openTerminal: {
                enabled: false,
                baseUrl: '',
                apiKey: '',
                deploymentMode: 'unknown',
                userIsolation: false
            }
        }),
        status: () => ({
            enabled: false,
            defaultProvider: 'local',
            backends: {
                local: {
                    type: 'local',
                    state: 'unsupported',
                    capabilities: [
                        'file_read',
                        'file_write',
                        'file_edit',
                        'grep',
                        'glob',
                        'bash',
                        'terminal_pty'
                    ],
                    sessionCount: 0
                },
                e2b: {
                    type: 'e2b',
                    state: 'unsupported',
                    capabilities: [
                        'file_read',
                        'file_write',
                        'file_edit',
                        'grep',
                        'glob',
                        'bash',
                        'terminal_pty',
                        'desktop_stream',
                        'desktop_screenshot',
                        'desktop_action'
                    ],
                    sessionCount: 0
                },
                'open-terminal': {
                    type: 'open-terminal',
                    state: 'unsupported',
                    capabilities: [
                        'file_read',
                        'file_write',
                        'file_edit',
                        'grep',
                        'glob',
                        'bash',
                        'terminal_pty'
                    ],
                    sessionCount: 0
                }
            },
            activeSessions: 0
        }),
        loading: false
    }
)

const emit = defineEmits<{
    refresh: []
    'save-computer': [value: ComputerConfig]
}>()

const activeTab = ref('config')
const draft = ref<ComputerConfig>(cloneConfig(props.config))
const testing = ref<Record<ComputerBackendType, boolean>>({
    local: false,
    e2b: false,
    'open-terminal': false
})
const localDirty = ref(false)

watch(
    () => props.config,
    (value) => {
        const next = cloneConfig(value)
        if (JSON.stringify(draft.value) === JSON.stringify(next)) {
            localDirty.value = false
            draft.value = next
            return
        }

        if (localDirty.value) {
            return
        }

        draft.value = next
    },
    {
        immediate: true,
        deep: true
    }
)

const dirty = computed(() => {
    return JSON.stringify(draft.value) !== JSON.stringify(props.config)
})

function updateConfig(value: ComputerConfig) {
    draft.value = cloneConfig(value)
    scheduleComputerSave()
}

function updateProvider(value: ComputerBackendType) {
    draft.value = {
        ...draft.value,
        defaultProvider: value
    }
    scheduleComputerSave()
}

function updateIdleTimeout(value: number | undefined) {
    if (value == null) return
    draft.value = {
        ...draft.value,
        idleTimeoutMs: value * 60000
    }
    scheduleComputerSave()
}

function scheduleComputerSave() {
    if (!dirty.value) return
    localDirty.value = true
    emit('save-computer', cloneConfig(draft.value))
}

async function testBackend(type: ComputerBackendType) {
    try {
        testing.value[type] = true
        const result = await send('chatluna-agent/testBackend', type)
        if (result.state === 'connected') {
            ElMessage.success(`${label(type)} 连接测试成功`)
            return
        }

        ElMessage.warning(result.error || `${label(type)} 当前不可用`)
    } catch {
        ElMessage.error(`${label(type)} 连接测试失败`)
    } finally {
        testing.value[type] = false
    }
}

async function reloadComputer() {
    try {
        await send('chatluna-agent/reloadComputer')
        ElMessage.success('Computer 配置已重新加载')
        emit('refresh')
    } catch {
        ElMessage.error('重新加载 Computer 配置失败')
    }
}

function label(type: ComputerBackendType) {
    if (type === 'local') return 'Local'
    if (type === 'e2b') return 'E2B'
    return 'open-terminal'
}

function cloneConfig(value: ComputerConfig): ComputerConfig {
    return JSON.parse(JSON.stringify(value))
}
</script>

<style scoped>
.computer-page {
    min-height: 100%;
    width: min(100%, 1800px);
    margin: 0 auto;
    padding-bottom: 56px;
}

.toolbar-container {
    position: sticky;
    top: 0;
    z-index: 5;
    background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 18%) 0%,
        color-mix(in srgb, var(--k-page-bg), transparent 12%) 76%,
        transparent 100%
    );
    padding: 10px 0 14px;
    margin-bottom: 10px;
    backdrop-filter: blur(8px);
}

.toolbar-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.headline {
    min-width: 0;
}

.page-title {
    font-size: 19px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.actions-section {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.provider-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-top: 18px;
    margin-bottom: 18px;
}

.provider-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: flex-start;
    gap: 14px;
    padding: 16px 18px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
}

.provider-select {
    width: 180px;
}

.provider-value {
    display: flex;
    align-items: center;
    gap: 10px;
}

.row-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.row-description {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.row-unit {
    font-size: 12px;
    color: var(--k-text-light);
    white-space: nowrap;
}

.tabs {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 22px;
    padding: 4px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 28%);
    border-radius: 16px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 48%);
    width: fit-content;
    max-width: 100%;
}

.tab-content {
    min-height: 400px;
}

.tab {
    padding: 10px 16px;
    cursor: pointer;
    transition:
        background-color 0.2s ease,
        color 0.2s ease;
    font-weight: 500;
    color: var(--k-text-light);
    border-radius: 12px;
    white-space: nowrap;
}

.tab:hover {
    background: color-mix(in srgb, var(--k-activity-bg), transparent 18%);
}

.tab.active {
    background: var(--k-side-bg);
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 24%);
    box-shadow: inset 0 0 0 1px
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
    transition: all 0.2s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
    opacity: 0;
    transform: translateY(8px);
}

@media (max-width: 1080px) {
    .provider-row {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 768px) {
    .toolbar-main {
        flex-direction: column;
        align-items: flex-start;
    }

    .actions-section {
        width: 100%;
        justify-content: flex-end;
    }

    .provider-item {
        grid-template-columns: 1fr;
    }

    .provider-select {
        width: 100%;
    }

    .provider-value {
        width: 100%;
    }

    .tabs {
        width: 100%;
    }

    .tab {
        flex: 1 1 0;
        text-align: center;
    }
}
</style>
