<template>
    <div class="configuration-panel">
        <section class="backend-card">
            <div class="backend-head">
                <div class="backend-intro">
                    <div class="backend-title-row">
                        <div class="backend-title">本地环境</div>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="tagType(props.status.backends.local.state)"
                        >
                            {{ stateLabel(props.status.backends.local.state) }}
                        </el-tag>
                        <el-tag
                            v-if="props.config.defaultProvider === 'local'"
                            size="small"
                            effect="plain"
                        >
                            默认
                        </el-tag>
                        <el-tag size="small" effect="plain">
                            {{ props.status.backends.local.sessionCount }}
                            个活跃会话
                        </el-tag>
                    </div>
                    <div class="backend-copy">
                        直接在本地执行，可访问工作目录和系统终端。
                    </div>
                    <div
                        v-if="props.status.backends.local.error"
                        class="backend-error"
                    >
                        {{ props.status.backends.local.error }}
                    </div>
                </div>

                <div class="backend-actions">
                    <el-button
                        text
                        type="primary"
                        :loading="props.testing.local"
                        @click="emit('test', 'local')"
                    >
                        测试连接
                    </el-button>
                    <el-button
                        :type="
                            props.config.local.enabled ? 'danger' : 'success'
                        "
                        @click="setLocalEnabled(!props.config.local.enabled)"
                    >
                        {{ props.config.local.enabled ? '禁用' : '启用' }}
                    </el-button>
                </div>
            </div>

            <div class="backend-body">
                <BackendLocal
                    :config="props.config.local"
                    @update="updateLocal"
                />
            </div>
        </section>

        <section class="backend-card">
            <div class="backend-head">
                <div class="backend-intro">
                    <div class="backend-title-row">
                        <div class="backend-title">E2B 沙箱</div>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="tagType(props.status.backends.e2b.state)"
                        >
                            {{ stateLabel(props.status.backends.e2b.state) }}
                        </el-tag>
                        <el-tag
                            v-if="props.config.defaultProvider === 'e2b'"
                            size="small"
                            effect="plain"
                        >
                            默认
                        </el-tag>
                        <el-tag size="small" effect="plain">
                            {{ props.status.backends.e2b.sessionCount }}
                            个活跃会话
                        </el-tag>
                    </div>
                    <div class="backend-copy">
                        云端隔离沙箱，支持桌面和 GUI，适合需要完整隔离的任务。
                    </div>
                    <div
                        v-if="props.status.backends.e2b.error"
                        class="backend-error"
                    >
                        {{ props.status.backends.e2b.error }}
                    </div>
                </div>

                <div class="backend-actions">
                    <el-button
                        text
                        type="primary"
                        :loading="props.testing.e2b"
                        @click="emit('test', 'e2b')"
                    >
                        测试连接
                    </el-button>
                    <el-button
                        :type="props.config.e2b.enabled ? 'danger' : 'success'"
                        @click="setE2BEnabled(!props.config.e2b.enabled)"
                    >
                        {{ props.config.e2b.enabled ? '禁用' : '启用' }}
                    </el-button>
                </div>
            </div>

            <div class="backend-body">
                <BackendE2B :config="props.config.e2b" @update="updateE2B" />
            </div>
        </section>

        <section class="backend-card">
            <div class="backend-head">
                <div class="backend-intro">
                    <div class="backend-title-row">
                        <div class="backend-title">远程终端</div>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="
                                tagType(
                                    props.status.backends['open-terminal'].state
                                )
                            "
                        >
                            {{
                                stateLabel(
                                    props.status.backends['open-terminal'].state
                                )
                            }}
                        </el-tag>
                        <el-tag
                            v-if="
                                props.config.defaultProvider === 'open-terminal'
                            "
                            size="small"
                            effect="plain"
                        >
                            默认
                        </el-tag>
                        <el-tag size="small" effect="plain">
                            {{
                                props.status.backends['open-terminal']
                                    .sessionCount
                            }}
                            个活跃会话
                        </el-tag>
                    </div>
                    <div class="backend-copy">
                        接入已部署的远程执行服务，适合复用现有的执行节点。
                    </div>
                    <div
                        v-if="props.status.backends['open-terminal'].error"
                        class="backend-error"
                    >
                        {{ props.status.backends['open-terminal'].error }}
                    </div>
                </div>

                <div class="backend-actions">
                    <el-button
                        text
                        type="primary"
                        :loading="props.testing['open-terminal']"
                        @click="emit('test', 'open-terminal')"
                    >
                        测试连接
                    </el-button>
                    <el-button
                        :type="
                            props.config.openTerminal.enabled
                                ? 'danger'
                                : 'success'
                        "
                        @click="
                            setOpenTerminalEnabled(
                                !props.config.openTerminal.enabled
                            )
                        "
                    >
                        {{
                            props.config.openTerminal.enabled ? '禁用' : '启用'
                        }}
                    </el-button>
                </div>
            </div>

            <div class="backend-body">
                <BackendOpenTerminal
                    :config="props.config.openTerminal"
                    @update="updateOpenTerminal"
                />
            </div>
        </section>

        <StatusPanel :config="props.config" :status="props.status" />
    </div>
</template>

<script setup lang="ts">
import BackendE2B from './config-backends/backend-e2b.vue'
import BackendLocal from './config-backends/backend-local.vue'
import BackendOpenTerminal from './config-backends/backend-open-terminal.vue'
import StatusPanel from './status-panel.vue'
import type {
    ComputerBackendType,
    ComputerConfig,
    ComputerStatus,
    E2BBackendConfig,
    LocalBackendConfig,
    OpenTerminalBackendConfig
} from '../../../src/types'

const props = defineProps<{
    config: ComputerConfig
    status: ComputerStatus
    testing: Record<ComputerBackendType, boolean>
}>()

const emit = defineEmits<{
    'update:config': [value: ComputerConfig]
    test: [value: ComputerBackendType]
}>()

function updateLocal(value: LocalBackendConfig) {
    emit('update:config', {
        ...props.config,
        local: value
    })
}

function setLocalEnabled(value: boolean) {
    updateLocal({
        ...props.config.local,
        enabled: value
    })
}

function updateE2B(value: E2BBackendConfig) {
    emit('update:config', {
        ...props.config,
        e2b: value
    })
}

function setE2BEnabled(value: boolean) {
    updateE2B({
        ...props.config.e2b,
        enabled: value
    })
}

function updateOpenTerminal(value: OpenTerminalBackendConfig) {
    emit('update:config', {
        ...props.config,
        openTerminal: value
    })
}

function setOpenTerminalEnabled(value: boolean) {
    updateOpenTerminal({
        ...props.config.openTerminal,
        enabled: value
    })
}

function stateLabel(state: ComputerStatus['backends']['local']['state']) {
    if (state === 'connected') return '已连接'
    if (state === 'connecting') return '连接中'
    if (state === 'idle') return '就绪'
    if (state === 'error') return '错误'
    return '未支持'
}

function tagType(state: ComputerStatus['backends']['local']['state']) {
    if (state === 'connected') return 'success'
    if (state === 'idle') return 'info'
    if (state === 'error') return 'danger'
    return 'warning'
}
</script>

<style scoped>
.configuration-panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.backend-card {
    border: 1px solid var(--k-color-divider);
    border-radius: 8px;
    background: var(--k-card-bg);
    overflow: hidden;
    transition: border-color 0.2s ease;
}

.backend-card:hover {
    border-color: color-mix(
        in srgb,
        var(--k-color-divider),
        var(--k-text-light) 20%
    );
}

.backend-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 20px;
    padding: 20px 24px;
    border-bottom: 1px solid var(--k-color-divider);
}

.backend-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
}

.backend-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--k-text-dark);
    letter-spacing: -0.01em;
}

.backend-copy,
.backend-error {
    font-size: 13px;
    line-height: 1.65;
}

.backend-copy {
    color: var(--k-text-light);
}

.backend-error {
    margin-top: 8px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--el-color-danger), transparent 92%);
    border-left: 2px solid var(--el-color-danger);
    border-radius: 4px;
    color: var(--el-color-danger);
}

.backend-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
}

.backend-body {
    padding: 24px;
}

:deep(.backend-form) {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

:deep(.backend-form .section) {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

:deep(.backend-form .form-grid) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
}

:deep(.backend-form .form-cell-full) {
    grid-column: 1 / -1;
}

:deep(.backend-form .section-title) {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
    letter-spacing: -0.01em;
    margin-bottom: 4px;
}

:deep(.backend-form .section-copy) {
    margin-top: -8px;
    font-size: 13px;
    line-height: 1.65;
    color: var(--k-text-light);
}

:deep(.backend-form .el-form-item) {
    margin-bottom: 0;
}

:deep(.backend-form .el-form-item__label) {
    padding-bottom: 6px;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.5;
    color: var(--k-text-normal);
}

:deep(.backend-form .el-form-item__content) {
    min-width: 0;
}

:deep(.backend-form .el-input),
:deep(.backend-form .el-select),
:deep(.backend-form .el-input-number) {
    width: 100%;
}

:deep(.backend-form .el-alert) {
    --el-alert-padding: 14px 16px;
    --el-alert-border-radius-base: 6px;
}

@media (max-width: 991px) {
    :deep(.backend-form .form-grid) {
        grid-template-columns: 1fr;
    }

    :deep(.backend-form .form-cell-full) {
        grid-column: auto;
    }
}

@media (max-width: 768px) {
    .backend-head {
        grid-template-columns: 1fr;
        padding: 16px 20px;
    }

    .backend-actions {
        justify-content: flex-start;
    }

    .backend-body {
        padding: 20px;
    }
}
</style>
