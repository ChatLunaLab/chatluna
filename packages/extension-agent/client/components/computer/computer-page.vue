<template>
    <div class="computer-page" :class="{ compact: compactMode }">
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title-row">
                        <div class="page-title">Computer</div>
                        <el-tag
                            v-if="dirty"
                            size="small"
                            type="warning"
                            effect="plain"
                        >
                            未保存
                        </el-tag>
                    </div>
                </div>

                <div class="actions-section">
                    <el-button
                        v-if="dirty"
                        type="primary"
                        :loading="saving"
                        @click="saveComputer"
                    >
                        保存
                    </el-button>
                    <el-button :loading="reloading" @click="reloadComputer">
                        重新加载
                    </el-button>
                    <el-button
                        size="small"
                        class="hidden-mobile"
                        :type="compactMode ? 'primary' : 'default'"
                        plain
                        @click="compactMode = !compactMode"
                    >
                        {{ compactMode ? '紧凑模式' : '宽屏模式' }}
                    </el-button>
                    <el-button
                        size="small"
                        class="hidden-mobile"
                        :type="hideDesc ? 'primary' : 'default'"
                        plain
                        @click="hideDesc = !hideDesc"
                    >
                        {{ hideDesc ? '显示描述' : '隐藏描述' }}
                    </el-button>
                </div>
            </div>
        </div>

        <div class="page-content" v-loading="busy">
            <div class="provider-row">
                <div class="provider-item">
                    <div class="provider-copy">
                        <div class="row-title">默认能力后端</div>
                        <div v-if="!hideDesc" class="row-description">
                            Agent 会优先使用这里选择的执行环境。推荐先用隔离后端。
                        </div>
                    </div>
                    <div class="provider-value">
                        <el-select
                            :model-value="draft.defaultProvider"
                            class="provider-select"
                            @update:model-value="updateProvider"
                        >
                            <el-option label="E2B（云端沙箱）" value="e2b" />
                            <el-option label="Open Terminal（远程/容器）" value="open-terminal" />
                            <el-option label="Local（本机环境）" value="local" />
                        </el-select>
                    </div>
                </div>
                <div class="provider-item">
                    <div class="provider-copy">
                        <div class="row-title">会话自动释放</div>
                        <div v-if="!hideDesc" class="row-description">
                            会话闲置超过此时间后自动关闭。
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
                    :class="['tab', { active: activeTab === 'jobs' }]"
                    @click="activeTab = 'jobs'"
                >
                    后台任务
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
                <div v-if="activeTab === 'config'">
                    <configuration-panel
                        :config="draft"
                        :hide-desc="hideDesc"
                        :status="status"
                        :testing="testing"
                        @update:config="updateConfig"
                        @test="testBackend"
                    />
                </div>

                <div v-else-if="activeTab === 'terminal'">
                    <terminal-panel
                        :config="draft"
                        :status="status"
                        :job="pendingJob"
                        @job-handled="pendingJob = undefined"
                    />
                </div>

                <div v-else-if="activeTab === 'jobs'">
                    <background-jobs-panel
                        :hide-desc="hideDesc"
                        @open="openJob"
                    />
                </div>

                <div v-else-if="activeTab === 'files'">
                    <files-panel :config="draft" :status="status" />
                </div>

                <div v-else>
                    <desktop-panel
                        :config="draft"
                        :hide-desc="hideDesc"
                        :status="status"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import { useCompactMode, useHideDesc } from '../shared/use-hide-desc'
import ConfigurationPanel from './configuration-panel.vue'
import BackgroundJobsPanel from './background-jobs-panel.vue'
import TerminalPanel from './terminal-panel.vue'
import FilesPanel from './files-panel.vue'
import DesktopPanel from './desktop-panel.vue'
import type {
    ComputerBackgroundJobInfo,
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
            defaultProvider: 'e2b',
            idleTimeoutMs: 600000,
            local: {
                enabled: false,
                sandboxMode: 'workspace-write',
                approvalMode: 'on-request',
                dangerouslySkipPermissions: false,
                preferredShell: 'auto',
                scopePath: '',
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
            defaultProvider: 'e2b',
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

const activeTab = ref('config')
const draft = ref<ComputerConfig>(cloneConfig(props.config))
const hideDesc = useHideDesc('computer')
const compactMode = useCompactMode('computer')
const pendingJob = ref<ComputerBackgroundJobInfo>()
const saving = ref(false)
const reloading = ref(false)
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

const busy = computed(() => {
    return props.loading || saving.value || reloading.value
})

function updateConfig(value: ComputerConfig) {
    draft.value = cloneConfig(value)
    localDirty.value = dirty.value
}

function updateProvider(value: ComputerBackendType) {
    draft.value = {
        ...draft.value,
        defaultProvider: value
    }
    localDirty.value = dirty.value
}

function updateIdleTimeout(value: number | undefined) {
    if (value == null) return
    draft.value = {
        ...draft.value,
        idleTimeoutMs: value * 60000
    }
    localDirty.value = dirty.value
}

async function saveDraft() {
    if (!dirty.value) {
        return false
    }

    await send('chatluna-agent/saveComputer', cloneConfig(draft.value))
    localDirty.value = false
    return true
}

async function saveBeforeAction() {
    if (!dirty.value) {
        return true
    }

    saving.value = true
    try {
        await saveDraft()
        return true
    } catch {
        ElMessage.error('保存 Computer 配置失败')
        return false
    } finally {
        saving.value = false
    }
}

async function saveComputer() {
    if (!dirty.value) {
        return
    }

    saving.value = true
    try {
        await saveDraft()
        ElMessage.success('Computer 配置已保存')
    } catch {
        ElMessage.error('保存 Computer 配置失败')
    } finally {
        saving.value = false
    }
}

async function testBackend(type: ComputerBackendType) {
    const ok = await saveBeforeAction()
    if (!ok) {
        return
    }

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
    const ok = await saveBeforeAction()
    if (!ok) {
        return
    }

    reloading.value = true
    try {
        await send('chatluna-agent/reloadComputer')
        ElMessage.success('Computer 配置已重新加载')
    } catch {
        ElMessage.error('重新加载 Computer 配置失败')
    } finally {
        reloading.value = false
    }
}

function openJob(job: ComputerBackgroundJobInfo) {
    pendingJob.value = job
    activeTab.value = 'terminal'
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
    min-width: 0;
    margin: 0 auto;
    padding-bottom: 56px;
    box-sizing: border-box;
}

.computer-page.compact {
    width: min(100%, 1440px);
}

.hidden-mobile {
    display: inline-flex;
}

@media (max-width: 768px) {
    .hidden-mobile {
        display: none;
    }
}

.toolbar-container {
    margin-bottom: 16px;
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

.page-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.page-title {
    font-size: 24px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.actions-section {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.page-content {
    position: relative;
    min-height: 200px;
}

:deep(.el-loading-mask) {
    background-color: color-mix(in srgb, var(--k-page-bg), transparent 30%);
    z-index: 10;
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
    align-items: center;
    gap: 14px;
    padding: 16px 18px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    box-sizing: border-box;
}

.provider-copy {
    min-width: 0;
}

.tabs {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 24px;
    margin-bottom: 24px;
    padding: 4px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 28%);
    border-radius: 16px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 48%);
    width: fit-content;
    max-width: 100%;
    box-sizing: border-box;
}

.provider-select {
    width: 220px;
}

.provider-value {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-self: end;
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
        justify-content: flex-start;
    }

    .actions-section .el-button {
        margin-left: 0;
        margin-bottom: 4px;
    }

    .provider-item {
        grid-template-columns: 1fr;
        align-items: flex-start;
    }

    .provider-select,
    .provider-value {
        width: 100%;
    }

    .tabs {
        width: 100%;
        display: flex;
        overflow-x: auto;
        justify-content: flex-start;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in srgb, var(--k-color-divider), #71717a 40%)
            transparent;
    }

    .tabs::-webkit-scrollbar {
        height: 6px;
    }

    .tabs::-webkit-scrollbar-track {
        background: transparent;
    }

    .tabs::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--k-color-divider), #71717a 40%);
        border-radius: 10px;
        border: 1px solid transparent;
        background-clip: content-box;
    }

    .tabs::-webkit-scrollbar-thumb:hover {
        background: color-mix(in srgb, var(--k-color-divider), #52525b 58%);
        background-clip: content-box;
    }

    .tab {
        flex: 0 0 auto;
        text-align: center;
    }
}
</style>
