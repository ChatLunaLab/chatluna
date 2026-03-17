<template>
    <div class="panel">
        <div class="panel-header">
            <div>
                <div class="panel-title">Health / Status</div>
                <div class="panel-description">
                    查看当前 provider、能力矩阵和活跃 session 状态。
                </div>
            </div>
        </div>

        <div class="panel-body">
            <div class="provider-row">
                <div>
                    <div class="row-title">默认 provider</div>
                    <div class="row-description">
                        主 Agent 和子 Agent 会优先使用这里选择的执行环境。
                    </div>
                </div>

                <el-select
                    :model-value="config.defaultProvider"
                    class="provider-select"
                    @update:model-value="$emit('update-provider', $event)"
                >
                    <el-option label="Local" value="local" />
                    <el-option label="E2B" value="e2b" />
                    <el-option label="open-terminal" value="open-terminal" />
                </el-select>
            </div>

            <div class="provider-row">
                <div>
                    <div class="row-title">空闲自动关闭</div>
                    <div class="row-description">
                        Session 空闲超过这个时间会自动关闭；持续使用时不会关闭。
                    </div>
                </div>

                <el-input-number
                    :model-value="config.idleTimeoutMs"
                    class="provider-select"
                    :min="60000"
                    :max="3600000"
                    :step="60000"
                    controls-position="right"
                    @update:model-value="updateIdleTimeout"
                />
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Computer 状态</div>
                    <div class="stat-value">
                        {{ status.enabled ? '可用' : '未就绪' }}
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">可用能力</div>
                    <div class="stat-value">{{ availableCount }}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">活跃 Session</div>
                    <div class="stat-value">{{ status.activeSessions }}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">可用 Backend</div>
                    <div class="stat-value">{{ readyBackends }}</div>
                </div>
            </div>

            <div class="backend-list">
                <div
                    v-for="item in backends"
                    :key="item.key"
                    class="backend-row"
                >
                    <div>
                        <div class="row-title">{{ item.label }}</div>
                        <div class="row-description">
                            {{
                                item.status.error ||
                                stateLabel(item.status.state)
                            }}
                        </div>
                    </div>

                    <div class="backend-meta">
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="tagType(item.status.state)"
                        >
                            {{ stateLabel(item.status.state) }}
                        </el-tag>
                        <span class="session-copy">
                            {{ item.status.sessionCount }} sessions
                        </span>
                    </div>
                </div>
            </div>

            <div class="matrix-wrap">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th>Capability</th>
                            <th>Local</th>
                            <th>E2B</th>
                            <th>open-terminal</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="cap in capabilities" :key="cap">
                            <td>{{ cap }}</td>
                            <td>{{ supports('local', cap) }}</td>
                            <td>{{ supports('e2b', cap) }}</td>
                            <td>{{ supports('open-terminal', cap) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
    ComputerBackendType,
    ComputerCapability,
    ComputerConfig,
    ComputerStatus
} from '../../../src/types'

const props = defineProps<{
    config: ComputerConfig
    status: ComputerStatus
}>()

const emit = defineEmits<{
    'update-provider': [value: ComputerBackendType]
    'update-idle-timeout': [value: number]
}>()

const capabilities: ComputerCapability[] = [
    'file_read',
    'file_write',
    'file_edit',
    'grep',
    'glob',
    'bash',
    'terminal_pty',
    'port_preview',
    'desktop_stream',
    'desktop_screenshot',
    'desktop_action'
]

const backends = computed(() => [
    { key: 'local', label: 'Local', status: props.status.backends.local },
    { key: 'e2b', label: 'E2B', status: props.status.backends.e2b },
    {
        key: 'open-terminal',
        label: 'open-terminal',
        status: props.status.backends['open-terminal']
    }
])

const availableCount = computed(() => {
    return new Set(
        Object.values(props.status.backends)
            .filter((item) => item.state !== 'unsupported')
            .flatMap((item) => item.capabilities)
    ).size
})

const readyBackends = computed(() => {
    return Object.values(props.status.backends).filter(
        (item) => item.state !== 'unsupported'
    ).length
})

function supports(type: ComputerBackendType, cap: ComputerCapability) {
    const backend = props.status.backends[type]
    if (backend.state === 'unsupported') {
        return '-'
    }

    return backend.capabilities.includes(cap) ? '支持' : ''
}

function updateIdleTimeout(value: number | undefined) {
    if (value == null) {
        return
    }

    emit('update-idle-timeout', value)
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
.row-description,
.session-copy {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.panel-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 18px;
}

.provider-row,
.backend-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
}

.provider-select {
    width: 180px;
}

.row-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-color-text);
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
}

.stat-card {
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 24%);
    background: color-mix(
        in srgb,
        var(--k-page-bg),
        var(--k-color-surface-1) 24%
    );
}

.stat-label {
    font-size: 12px;
    color: var(--k-text-light);
}

.stat-value {
    margin-top: 6px;
    font-size: 18px;
    font-weight: 600;
    color: var(--k-color-text);
}

.backend-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.backend-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
}

.matrix-wrap {
    overflow-x: auto;
}

.matrix-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
}

.matrix-table th,
.matrix-table td {
    text-align: left;
    padding: 10px 8px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 24%);
}

.matrix-table th {
    font-weight: 600;
    color: var(--k-color-text);
}

.matrix-table td {
    color: var(--k-text-light);
}

@media (max-width: 768px) {
    .provider-row,
    .backend-row {
        flex-direction: column;
    }

    .provider-select {
        width: 100%;
    }

    .stats-grid {
        grid-template-columns: 1fr;
    }

    .backend-meta {
        width: 100%;
        justify-content: flex-start;
    }
}
</style>
