<template>
    <el-form class="backend-form" label-position="top">
        <div class="section">
            <div class="section-title">连接设置</div>

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
        return 'Docker 模式的隔离效果取决于容器配置，建议限制网络访问和挂载目录；如果容器隔离做得不好，风险会逐渐接近 Local。'
    }

    if (props.config.deploymentMode === 'bare-metal') {
        return '裸机模式没有宿主机隔离，命令会直接在远端主机上执行。虽然不是本机 Local，但仍属于高风险配置。'
    }

    return '无法确认部署模式，请按最小权限原则配置；隔离边界不明确时，不建议把它当成高信任后端。'
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
