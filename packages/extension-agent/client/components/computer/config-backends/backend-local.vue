<template>
    <el-form class="backend-form" label-position="top">
        <div class="warning-box">
            <div class="warning-title">本地终端能力很危险</div>
            <div class="warning-desc">它会直接在宿主机执行命令，而不是隔离沙箱。建议默认关闭，只在明确知道风险、且需要访问本地工作区时临时启用。</div>
        </div>

        <div class="section">
            <div class="section-title">基础设置</div>

            <div class="form-grid">
                <div class="form-cell">
                    <el-form-item label="作用域路径">
                        <el-input
                            :model-value="config.scopePath"
                            placeholder="留空时使用当前工作目录"
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
                                label="工作区可写"
                                value="workspace-write"
                            />
                            <el-option label="只读" value="read-only" />
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
            <div class="section-title">访问边界</div>
            <div class="section-copy">
                路径和 glob
                模式请逐条输入，按回车后会变成标签，修改时更直观，也不容易误删。
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
                    <el-form-item label="可写根目录">
                        <el-select
                            :model-value="config.writableRoots"
                            multiple
                            filterable
                            allow-create
                            clearable
                            default-first-option
                            :reserve-keyword="false"
                            placeholder="输入绝对路径后按回车添加"
                            @update:model-value="
                                setList('writableRoots', $event)
                            "
                        >
                            <el-option
                                v-for="item in config.writableRoots"
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
                <span class="danger-title">跳过权限检查（危险）</span>
            </el-checkbox>
            <div class="danger-copy">
                启用后将跳过作用域、白名单和高危操作确认。仅在完全信任当前模型时使用。
            </div>
        </div>
    </el-form>
</template>

<script setup lang="ts">
import type { LocalBackendConfig } from '../../../../src/types'

type LocalListKey =
    | 'writableRoots'
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
