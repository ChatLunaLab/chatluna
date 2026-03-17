<template>
    <div class="cards-column">
        <section class="panel">
            <div class="panel-header">
                <div>
                    <div class="panel-title">Backend 配置</div>
                    <div class="panel-description">
                        分别配置 Local、E2B 和 open-terminal，保存后立即生效。
                    </div>
                </div>
            </div>

            <div class="panel-body card-grid">
                <div class="backend-card">
                    <div class="card-head">
                        <div>
                            <div class="card-title">Local</div>
                            <div class="card-copy">
                                直接在宿主机上执行文件读写和命令，适合本地开发和仓库修改。
                            </div>
                        </div>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="tagType(status.backends.local.state)"
                        >
                            {{ stateLabel(status.backends.local.state) }}
                        </el-tag>
                    </div>

                    <div class="field-row">
                        <span>启用</span>
                        <el-switch
                            :model-value="config.local.enabled"
                            @update:model-value="setLocal('enabled', $event)"
                        />
                    </div>

                    <div class="field-group">
                        <label>Scope Path</label>
                        <el-input
                            :model-value="config.local.scopePath"
                            placeholder="留空时使用当前工作目录"
                            @update:model-value="setLocal('scopePath', $event)"
                        />
                    </div>

                    <div class="field-split">
                        <div class="field-group">
                            <label>Sandbox</label>
                            <el-select
                                :model-value="config.local.sandboxMode"
                                @update:model-value="
                                    setLocal('sandboxMode', $event)
                                "
                            >
                                <el-option
                                    label="workspace-write"
                                    value="workspace-write"
                                />
                                <el-option
                                    label="read-only"
                                    value="read-only"
                                />
                            </el-select>
                        </div>

                        <div class="field-group">
                            <label>Approval</label>
                            <el-select
                                :model-value="config.local.approvalMode"
                                @update:model-value="
                                    setLocal('approvalMode', $event)
                                "
                            >
                                <el-option
                                    label="on-request"
                                    value="on-request"
                                />
                                <el-option label="never" value="never" />
                            </el-select>
                        </div>
                    </div>

                    <div class="field-split">
                        <div class="field-group">
                            <label>Shell</label>
                            <el-select
                                :model-value="config.local.preferredShell"
                                @update:model-value="
                                    setLocal('preferredShell', $event)
                                "
                            >
                                <el-option label="auto" value="auto" />
                                <el-option label="git-bash" value="git-bash" />
                                <el-option
                                    label="powershell"
                                    value="powershell"
                                />
                                <el-option label="cmd" value="cmd" />
                            </el-select>
                        </div>

                        <div class="field-group">
                            <label>Timeout (ms)</label>
                            <el-input-number
                                :model-value="config.local.commandTimeoutMs"
                                :min="1000"
                                :max="300000"
                                :step="1000"
                                controls-position="right"
                                @update:model-value="
                                    setLocal('commandTimeoutMs', $event)
                                "
                            />
                        </div>
                    </div>

                    <div class="field-group">
                        <label>Network Policy</label>
                        <el-select
                            :model-value="config.local.networkPolicy"
                            @update:model-value="
                                setLocal('networkPolicy', $event)
                            "
                        >
                            <el-option label="block" value="block" />
                            <el-option label="allow" value="allow" />
                        </el-select>
                    </div>

                    <div class="field-group">
                        <label>Ignore Patterns</label>
                        <el-input
                            type="textarea"
                            :rows="4"
                            :model-value="config.local.ignores.join('\n')"
                            placeholder="每行一个 glob pattern"
                            @update:model-value="
                                setLocalLines('ignores', $event)
                            "
                        />
                    </div>

                    <div class="field-split">
                        <div class="field-group">
                            <label>Allowed Commands</label>
                            <el-input
                                type="textarea"
                                :rows="3"
                                :model-value="
                                    config.local.allowedCommands.join('\n')
                                "
                                placeholder="留空表示不启用白名单"
                                @update:model-value="
                                    setLocalLines('allowedCommands', $event)
                                "
                            />
                        </div>
                        <div class="field-group">
                            <label>Blocked Commands</label>
                            <el-input
                                type="textarea"
                                :rows="3"
                                :model-value="
                                    config.local.blockedCommands.join('\n')
                                "
                                placeholder="每行一个命令名"
                                @update:model-value="
                                    setLocalLines('blockedCommands', $event)
                                "
                            />
                        </div>
                    </div>

                    <div class="field-group">
                        <label>Writable Roots</label>
                        <el-input
                            type="textarea"
                            :rows="2"
                            :model-value="config.local.writableRoots.join('\n')"
                            @update:model-value="
                                setLocalLines('writableRoots', $event)
                            "
                        />
                    </div>

                    <div class="field-split">
                        <div class="field-group">
                            <label>Read-only Roots</label>
                            <el-input
                                type="textarea"
                                :rows="2"
                                :model-value="
                                    config.local.readOnlyRoots.join('\n')
                                "
                                @update:model-value="
                                    setLocalLines('readOnlyRoots', $event)
                                "
                            />
                        </div>
                        <div class="field-group">
                            <label>Deny Roots</label>
                            <el-input
                                type="textarea"
                                :rows="2"
                                :model-value="config.local.denyRoots.join('\n')"
                                @update:model-value="
                                    setLocalLines('denyRoots', $event)
                                "
                            />
                        </div>
                    </div>

                    <div class="warning-box danger-box">
                        <div class="warning-head">
                            <span>Dangerously Skip Permissions</span>
                            <el-switch
                                :model-value="
                                    config.local.dangerouslySkipPermissions
                                "
                                @update:model-value="
                                    setLocal(
                                        'dangerouslySkipPermissions',
                                        $event
                                    )
                                "
                            />
                        </div>
                        <div class="warning-copy">
                            启用后会跳过
                            scope、白名单、高危确认等保护，只适合你完全信任当前模型时使用。
                        </div>
                    </div>

                    <div class="card-actions">
                        <el-button
                            :loading="testing.local"
                            @click="$emit('test', 'local')"
                        >
                            测试连接
                        </el-button>
                    </div>
                </div>

                <div class="backend-card">
                    <div class="card-head">
                        <div>
                            <div class="card-title">E2B</div>
                            <div class="card-copy">
                                面向远程强隔离执行和桌面能力的 provider，支持
                                API Key 或 `env:` 前缀。
                            </div>
                        </div>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="tagType(status.backends.e2b.state)"
                        >
                            {{ stateLabel(status.backends.e2b.state) }}
                        </el-tag>
                    </div>

                    <div class="field-row">
                        <span>启用</span>
                        <el-switch
                            :model-value="config.e2b.enabled"
                            @update:model-value="setE2B('enabled', $event)"
                        />
                    </div>

                    <div class="field-group">
                        <label>API Key</label>
                        <el-input
                            :model-value="config.e2b.apiKey"
                            placeholder="env:E2B_API_KEY"
                            @update:model-value="setE2B('apiKey', $event)"
                        />
                    </div>

                    <div class="field-split">
                        <div class="field-group">
                            <label>Template</label>
                            <el-input
                                :model-value="config.e2b.template"
                                @update:model-value="setE2B('template', $event)"
                            />
                        </div>
                        <div class="field-group">
                            <label>Desktop Template</label>
                            <el-input
                                :model-value="config.e2b.desktopTemplate"
                                placeholder="留空表示不启用桌面"
                                @update:model-value="
                                    setE2B('desktopTemplate', $event)
                                "
                            />
                        </div>
                    </div>

                    <div class="field-split">
                        <div class="field-group">
                            <label>Timeout (ms)</label>
                            <el-input-number
                                :model-value="config.e2b.timeoutMs"
                                :min="1000"
                                :max="3600000"
                                :step="1000"
                                controls-position="right"
                                @update:model-value="
                                    setE2B('timeoutMs', $event)
                                "
                            />
                        </div>
                        <div class="field-row compact-row">
                            <span>Keep Alive</span>
                            <el-switch
                                :model-value="config.e2b.keepAlive"
                                @update:model-value="
                                    setE2B('keepAlive', $event)
                                "
                            />
                        </div>
                    </div>

                    <div class="warning-box">
                        <div class="warning-copy">
                            当前阶段已预留 E2B
                            配置面板，后端状态会提示实际可用性。
                        </div>
                    </div>

                    <div class="card-actions">
                        <el-button
                            :loading="testing.e2b"
                            @click="$emit('test', 'e2b')"
                        >
                            测试连接
                        </el-button>
                    </div>
                </div>

                <div class="backend-card">
                    <div class="card-head">
                        <div>
                            <div class="card-title">open-terminal</div>
                            <div class="card-copy">
                                对接远程终端与端口预览服务，浏览器不会直接接触
                                API Key。
                            </div>
                        </div>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="
                                tagType(status.backends['open-terminal'].state)
                            "
                        >
                            {{
                                stateLabel(
                                    status.backends['open-terminal'].state
                                )
                            }}
                        </el-tag>
                    </div>

                    <div class="field-row">
                        <span>启用</span>
                        <el-switch
                            :model-value="config.openTerminal.enabled"
                            @update:model-value="
                                setOpenTerminal('enabled', $event)
                            "
                        />
                    </div>

                    <div class="field-group">
                        <label>Base URL</label>
                        <el-input
                            :model-value="config.openTerminal.baseUrl"
                            placeholder="http://localhost:8765"
                            @update:model-value="
                                setOpenTerminal('baseUrl', $event)
                            "
                        />
                    </div>

                    <div class="field-group">
                        <label>API Key</label>
                        <el-input
                            :model-value="config.openTerminal.apiKey"
                            placeholder="env:OPEN_TERMINAL_API_KEY"
                            @update:model-value="
                                setOpenTerminal('apiKey', $event)
                            "
                        />
                    </div>

                    <div class="field-split">
                        <div class="field-group">
                            <label>Deployment Mode</label>
                            <el-select
                                :model-value="
                                    config.openTerminal.deploymentMode
                                "
                                @update:model-value="
                                    setOpenTerminal('deploymentMode', $event)
                                "
                            >
                                <el-option label="docker" value="docker" />
                                <el-option
                                    label="bare-metal"
                                    value="bare-metal"
                                />
                                <el-option label="unknown" value="unknown" />
                            </el-select>
                        </div>
                        <div class="field-row compact-row">
                            <span>User Isolation</span>
                            <el-switch
                                :model-value="config.openTerminal.userIsolation"
                                @update:model-value="
                                    setOpenTerminal('userIsolation', $event)
                                "
                            />
                        </div>
                    </div>

                    <div class="warning-box">
                        <div class="warning-copy">
                            {{ openTerminalWarning }}
                        </div>
                    </div>

                    <div class="card-actions">
                        <el-button
                            :loading="testing['open-terminal']"
                            @click="$emit('test', 'open-terminal')"
                        >
                            测试连接
                        </el-button>
                    </div>
                </div>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
    ComputerBackendType,
    ComputerConfig,
    ComputerStatus
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

const openTerminalWarning = computed(() => {
    if (props.config.openTerminal.deploymentMode === 'docker') {
        return 'Docker 模式的隔离效果取决于容器配置，建议额外控制网络和挂载目录。'
    }

    if (props.config.openTerminal.deploymentMode === 'bare-metal') {
        return 'Bare-metal 模式没有宿主机隔离，命令会直接作用在远端主机上。'
    }

    return '当前无法确认 open-terminal 的部署模式，请按最小权限原则配置。'
})

function update(next: ComputerConfig) {
    emit('update:config', next)
}

function setLocal(key: keyof ComputerConfig['local'], value: unknown) {
    update({
        ...props.config,
        local: {
            ...props.config.local,
            [key]: value
        }
    })
}

function setLocalLines(key: keyof ComputerConfig['local'], value: string) {
    setLocal(
        key,
        value
            .split('\n')
            .map((item) => item.trim())
            .filter(
                (item, idx, list) =>
                    item.length > 0 && list.indexOf(item) === idx
            )
    )
}

function setE2B(key: keyof ComputerConfig['e2b'], value: unknown) {
    update({
        ...props.config,
        e2b: {
            ...props.config.e2b,
            [key]: value
        }
    })
}

function setOpenTerminal(
    key: keyof ComputerConfig['openTerminal'],
    value: unknown
) {
    update({
        ...props.config,
        openTerminal: {
            ...props.config.openTerminal,
            [key]: value
        }
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
.cards-column {
    min-width: 0;
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
    overflow: hidden;
}

.panel-header {
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
}

.panel-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--k-color-text);
}

.panel-description,
.card-copy,
.warning-copy,
label {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.panel-body {
    padding: 18px;
}

.card-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
}

.backend-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
    border-radius: 12px;
    background: color-mix(
        in srgb,
        var(--k-page-bg),
        var(--k-color-surface-1) 20%
    );
}

.card-head,
.field-row,
.warning-head,
.card-actions,
.compact-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.card-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--k-color-text);
}

.field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}

.field-group :deep(.el-select),
.field-group :deep(.el-input-number) {
    width: 100%;
}

.field-split {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
}

.warning-box {
    padding: 12px 14px;
    border-radius: 10px;
    background: color-mix(
        in srgb,
        var(--k-page-bg),
        var(--k-color-surface-1) 28%
    );
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 24%);
}

.danger-box {
    border-color: color-mix(in srgb, var(--el-color-danger), transparent 60%);
    background: color-mix(in srgb, var(--el-color-danger), transparent 95%);
}

@media (max-width: 1280px) {
    .card-grid {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 768px) {
    .field-split {
        grid-template-columns: 1fr;
    }

    .card-head,
    .field-row,
    .warning-head,
    .compact-row {
        flex-direction: column;
        align-items: flex-start;
    }
}
</style>
