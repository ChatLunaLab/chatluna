<template>
    <div class="computer-page" v-loading="loading">
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">Computer</div>
                    <div class="page-description">
                        管理 Agent
                        可用的本地与远程执行环境、文件能力和终端能力。
                    </div>
                </div>

                <div class="actions-section">
                    <el-button @click="reloadComputer">重新加载</el-button>
                    <el-button circle @click="$emit('refresh')">刷新</el-button>
                    <el-button
                        type="primary"
                        :disabled="!dirty"
                        @click="$emit('save-computer', draft)"
                    >
                        保存更改
                    </el-button>
                </div>
            </div>
        </div>

        <div class="overview-grid">
            <status-panel
                :config="draft"
                :status="status"
                @update-provider="updateProvider"
                @update-idle-timeout="updateIdleTimeout"
            />
            <backend-cards
                :config="draft"
                :status="status"
                :testing="testing"
                @update:config="updateConfig"
                @test="testBackend"
            />
        </div>

        <div class="panel tabs-panel">
            <el-tabs v-model="activeTab" class="computer-tabs">
                <el-tab-pane label="Terminal" name="terminal">
                    <terminal-panel :config="draft" :status="status" />
                </el-tab-pane>
                <el-tab-pane label="Files / Preview" name="files">
                    <files-panel :config="draft" :status="status" />
                </el-tab-pane>
                <el-tab-pane label="Desktop" name="desktop">
                    <desktop-panel :config="draft" :status="status" />
                </el-tab-pane>
            </el-tabs>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import BackendCards from './backend-cards.vue'
import StatusPanel from './status-panel.vue'
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
                        'terminal_pty',
                        'port_preview'
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
                        'terminal_pty',
                        'port_preview'
                    ],
                    sessionCount: 0
                }
            },
            activeSessions: 0
        }),
        loading: false
    }
)

defineEmits<{
    refresh: []
    'save-computer': [value: ComputerConfig]
}>()

const activeTab = ref('terminal')
const draft = ref<ComputerConfig>(structuredClone(toRaw(props.config)))
const testing = ref<Record<ComputerBackendType, boolean>>({
    local: false,
    e2b: false,
    'open-terminal': false
})

watch(
    () => props.config,
    (value) => {
        draft.value = structuredClone(toRaw(value))
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
    draft.value = value
}

function updateProvider(value: ComputerBackendType) {
    draft.value = {
        ...draft.value,
        defaultProvider: value
    }
}

function updateIdleTimeout(value: number) {
    draft.value = {
        ...draft.value,
        idleTimeoutMs: value
    }
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
    } catch {
        ElMessage.error('重新加载 Computer 配置失败')
    }
}

function label(type: ComputerBackendType) {
    if (type === 'local') return 'Local'
    if (type === 'e2b') return 'E2B'
    return 'open-terminal'
}
</script>

<style scoped>
.computer-page {
    min-height: 100%;
    width: min(100%, 1440px);
    margin: 0 auto;
    padding-bottom: 56px;
}

.toolbar-container {
    position: sticky;
    top: 0;
    z-index: 5;
    background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--k-page-bg), var(--k-color-surface-1) 18%) 0%,
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
    color: var(--k-color-text);
}

.page-description {
    margin-top: 4px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.actions-section {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.overview-grid {
    display: grid;
    grid-template-columns: minmax(320px, 0.95fr) minmax(0, 1.35fr);
    gap: 18px;
    margin-bottom: 18px;
}

.panel {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(
        in srgb,
        var(--k-color-surface-1),
        var(--k-page-bg) 18%
    );
}

.tabs-panel {
    padding: 0 18px 18px;
}

.computer-tabs :deep(.el-tabs__header) {
    margin: 0;
    padding-top: 14px;
}

@media (max-width: 1080px) {
    .overview-grid {
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
}
</style>
