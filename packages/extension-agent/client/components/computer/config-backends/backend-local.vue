<template>
    <el-form class="backend-form" label-position="top">
        <div class="warning-box">
            <div class="warning-title">本地终端能力很危险</div>
            <div class="warning-desc">直接访问宿主机文件系统并运行系统命令。模型会以当前用户权限操作。</div>
        </div>

        <div class="section">
            <div class="section-title">基础设置</div>
            <div class="section-copy">
                Linux 未开启“跳过沙箱与权限约束”时需要安装
                bubblewrap (bwrap)。开启后不使用 bwrap。
            </div>

            <div class="form-grid">
                <div class="form-cell">
                    <el-form-item label="初始工作目录 (CWD)">
                        <el-input
                            :model-value="config.scopePath"
                            placeholder="留空时使用当前进程目录"
                            @update:model-value="set('scopePath', $event)"
                        />
                    </el-form-item>
                </div>

                <div class="form-cell">
                    <el-form-item label="沙箱模式">
                        <el-select
                            :model-value="config.sandboxMode"
                            @update:model-value="set('sandboxMode', $event)"
                        >
                            <el-option
                                label="沙箱：可写"
                                value="workspace-write"
                            />
                            <el-option label="沙箱：只读" value="read-only" />
                        </el-select>
                    </el-form-item>
                </div>

                <div class="form-cell">
                    <el-form-item label="审批模式">
                        <el-select
                            :model-value="config.approvalMode"
                            @update:model-value="set('approvalMode', $event)"
                        >
                            <el-option label="按需审批" value="on-request" />
                            <el-option label="从不审批" value="never" />
                        </el-select>
                    </el-form-item>
                </div>

                <div class="form-cell">
                    <el-form-item label="首选终端">
                        <el-select
                            :model-value="config.preferredShell"
                            @update:model-value="set('preferredShell', $event)"
                        >
                            <el-option label="自动检测" value="auto" />
                            <el-option label="Git Bash" value="git-bash" />
                            <el-option label="PowerShell" value="powershell" />
                            <el-option label="CMD" value="cmd" />
                        </el-select>
                    </el-form-item>
                </div>

                <div class="form-cell">
                    <el-form-item label="命令超时（分钟）">
                        <el-input-number
                            class="timeout-input"
                            :model-value="config.commandTimeoutMs / 60000"
                            :min="0.5"
                            :max="5"
                            :step="0.5"
                            :precision="1"
                            controls-position="right"
                            @update:model-value="setTimeout"
                        />
                    </el-form-item>
                </div>

                <div class="form-cell">
                    <el-form-item label="网络策略">
                        <el-select
                            :model-value="config.networkPolicy"
                            @update:model-value="set('networkPolicy', $event)"
                        >
                            <el-option label="阻止" value="block" />
                            <el-option label="允许" value="allow" />
                        </el-select>
                    </el-form-item>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">文件策略</div>
            <div class="section-copy">
                初始工作目录只是起点，不是访问边界。这里可以排除扫描结果，或单独禁止、只读某些路径。
            </div>

            <div class="form-grid">
                <div class="form-cell form-cell-full">
                    <el-form-item label="忽略模式">
                        <el-select
                            :model-value="config.ignores"
                            multiple
                            filterable
                            allow-create
                            clearable
                            default-first-option
                            :reserve-keyword="false"
                            placeholder="输入 glob 模式后按回车添加"
                            @update:model-value="setList('ignores', $event)"
                        >
                            <el-option
                                v-for="item in config.ignores"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                    </el-form-item>
                </div>

                <div class="form-cell form-cell-full">
                    <el-form-item label="只读根目录">
                        <el-select
                            :model-value="config.readOnlyRoots"
                            multiple
                            filterable
                            allow-create
                            clearable
                            default-first-option
                            :reserve-keyword="false"
                            placeholder="输入绝对路径后按回车添加"
                            @update:model-value="
                                setList('readOnlyRoots', $event)
                            "
                        >
                            <el-option
                                v-for="item in config.readOnlyRoots"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                    </el-form-item>
                </div>

                <div class="form-cell form-cell-full">
                    <el-form-item label="禁止访问目录">
                        <el-select
                            :model-value="config.denyRoots"
                            multiple
                            filterable
                            allow-create
                            clearable
                            default-first-option
                            :reserve-keyword="false"
                            placeholder="输入绝对路径后按回车添加"
                            @update:model-value="setList('denyRoots', $event)"
                        >
                            <el-option
                                v-for="item in config.denyRoots"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                    </el-form-item>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">命令策略</div>

            <div class="form-grid">
                <div class="form-cell form-cell-full">
                    <el-form-item label="允许的命令">
                        <el-select
                            :model-value="config.allowedCommands"
                            multiple
                            filterable
                            allow-create
                            clearable
                            default-first-option
                            :reserve-keyword="false"
                            placeholder="输入命令名后按回车添加"
                            @update:model-value="
                                setList('allowedCommands', $event)
                            "
                        >
                            <el-option
                                v-for="item in config.allowedCommands"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                    </el-form-item>
                </div>

                <div class="form-cell form-cell-full">
                    <el-form-item label="禁止的命令">
                        <el-select
                            :model-value="config.blockedCommands"
                            multiple
                            filterable
                            allow-create
                            clearable
                            default-first-option
                            :reserve-keyword="false"
                            placeholder="输入命令名后按回车添加"
                            @update:model-value="
                                setList('blockedCommands', $event)
                            "
                        >
                            <el-option
                                v-for="item in config.blockedCommands"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                    </el-form-item>
                </div>
            </div>
        </div>

        <div class="danger-box">
            <el-checkbox
                :model-value="config.dangerouslySkipPermissions"
                @update:model-value="set('dangerouslySkipPermissions', $event)"
            >
                <span class="danger-title">跳过沙箱与权限约束（危险）</span>
            </el-checkbox>
            <div class="danger-copy">
                开启后不使用 bwrap，也不做路径保护、命令白名单和高危确认。模型会直接以当前用户权限运行。
            </div>
        </div>
    </el-form>
</template>

<script setup lang="ts">
import type { LocalBackendConfig } from '../../../../src/types'

type LocalListKey =
    | 'readOnlyRoots'
    | 'denyRoots'
    | 'ignores'
    | 'allowedCommands'
    | 'blockedCommands'

const props = defineProps<{
    config: LocalBackendConfig
}>()

const emit = defineEmits<{
    update: [value: LocalBackendConfig]
}>()

function set<K extends keyof LocalBackendConfig>(
    key: K,
    value: LocalBackendConfig[K]
) {
    emit('update', {
        ...props.config,
        [key]: value
    })
}

function setTimeout(value: number | undefined) {
    if (value == null) return
    set('commandTimeoutMs', Math.round(value * 60000))
}

function setList(key: LocalListKey, value: string[]) {
    emit('update', {
        ...props.config,
        [key]: value
            .map((item) => item.trim())
            .filter(
                (item, idx, list) =>
                    item.length > 0 && list.indexOf(item) === idx
            )
    })
}
</script>

<style scoped>
:deep(.timeout-input .el-input__inner) {
    text-align: left;
}

.danger-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 18px;
    border-radius: 6px;
    border: 1px solid
        color-mix(in srgb, var(--el-color-danger), transparent 70%);
    background: color-mix(in srgb, var(--el-color-danger), transparent 94%);
}

.danger-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-color-danger);
    letter-spacing: -0.01em;
}

.danger-copy {
    margin-left: 24px;
    font-size: 13px;
    line-height: 1.65;
    color: var(--el-color-danger);
}
</style>
