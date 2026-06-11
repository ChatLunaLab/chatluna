<template>
    <el-form class="backend-form" label-position="top">
        <div class="section">
            <div class="section-title">接口设置</div>

            <div class="form-grid">
                <div class="form-cell form-cell-full">
                    <el-form-item>
                        <el-checkbox
                            :model-value="config.userIsolation"
                            @update:model-value="set('userIsolation', $event)"
                        >
                            用户隔离
                        </el-checkbox>
                    </el-form-item>
                </div>

                <div class="form-cell form-cell-full">
                    <el-form-item label="基础 URL">
                        <el-input
                            :model-value="config.baseUrl"
                            placeholder="http://localhost:8765"
                            @update:model-value="set('baseUrl', $event)"
                        />
                    </el-form-item>
                </div>

                <div class="form-cell form-cell-full">
                    <el-form-item label="API 密钥">
                        <el-input
                            type="password"
                            show-password
                            :model-value="config.apiKey"
                            placeholder="env:OPEN_TERMINAL_API_KEY"
                            @update:model-value="set('apiKey', $event)"
                        />
                    </el-form-item>
                </div>

                <div class="form-cell form-cell-full">
                    <el-form-item label="部署模式">
                        <el-select
                            :model-value="config.deploymentMode"
                            @update:model-value="set('deploymentMode', $event)"
                        >
                            <el-option label="Docker" value="docker" />
                            <el-option label="裸机" value="bare-metal" />
                            <el-option label="未知" value="unknown" />
                        </el-select>
                    </el-form-item>
                </div>
            </div>
        </div>

        <div class="warning-box">
            <div class="warning-desc">{{ warning }}</div>
        </div>
    </el-form>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { OpenTerminalBackendConfig } from '../../../../src/types'

const props = defineProps<{
    config: OpenTerminalBackendConfig
}>()

const emit = defineEmits<{
    update: [value: OpenTerminalBackendConfig]
}>()

const warning = computed(() => {
    if (props.config.deploymentMode === 'docker') {
        return 'Docker 模式的安全性取决于容器配置。请限制挂载目录和网络权限。'
    }

    if (props.config.deploymentMode === 'bare-metal') {
        return '裸机模式会直接在远端主机执行命令，请只用于受控服务器。'
    }

    return '无法确认部署模式。请按最低权限配置。'
})

function set<K extends keyof OpenTerminalBackendConfig>(
    key: K,
    value: OpenTerminalBackendConfig[K]
) {
    emit('update', {
        ...props.config,
        [key]: value
    })
}
</script>
