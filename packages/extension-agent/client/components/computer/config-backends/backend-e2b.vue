<template>
    <el-form class="backend-form" label-position="top">
        <div class="section">
            <div class="section-title">基础设置</div>

            <div class="form-grid">
                <div class="form-cell form-cell-full">
                    <el-form-item>
                        <el-checkbox
                            :model-value="config.keepAlive"
                            @update:model-value="set('keepAlive', $event)"
                        >
                            保持连接
                        </el-checkbox>
                    </el-form-item>
                </div>

                <div class="form-cell form-cell-full">
                    <el-form-item label="API 密钥">
                        <el-input
                            type="password"
                            show-password
                            :model-value="config.apiKey"
                            placeholder="env:E2B_API_KEY"
                            @update:model-value="set('apiKey', $event)"
                        />
                    </el-form-item>
                </div>

                <div class="form-cell">
                    <el-form-item label="模板">
                        <el-input
                            :model-value="config.template"
                            @update:model-value="set('template', $event)"
                        />
                    </el-form-item>
                </div>

                <div class="form-cell">
                    <el-form-item label="桌面模板">
                        <el-input
                            :model-value="config.desktopTemplate"
                            placeholder="留空表示不启用桌面"
                            @update:model-value="set('desktopTemplate', $event)"
                        />
                    </el-form-item>
                </div>

                <div class="form-cell form-cell-full">
                    <el-form-item label="超时时间（分钟）">
                        <el-input-number
                            class="timeout-input"
                            :model-value="config.timeoutMs / 60000"
                            :min="0.5"
                            :max="60"
                            :step="0.5"
                            :precision="1"
                            controls-position="right"
                            @update:model-value="setTimeout"
                        />
                    </el-form-item>
                </div>
            </div>
        </div>

        <el-alert
            type="info"
            effect="dark"
            :closable="false"
            description="推荐优先把 E2B 作为默认后端；配置会被保存，但实际可用性仍取决于状态检测结果。"
        />
    </el-form>
</template>

<script setup lang="ts">
import type { E2BBackendConfig } from '../../../../src/types'

const props = defineProps<{
    config: E2BBackendConfig
}>()

const emit = defineEmits<{
    update: [value: E2BBackendConfig]
}>()

function set<K extends keyof E2BBackendConfig>(
    key: K,
    value: E2BBackendConfig[K]
) {
    emit('update', {
        ...props.config,
        [key]: value
    })
}

function setTimeout(value: number | undefined) {
    if (value == null) return
    set('timeoutMs', Math.round(value * 60000))
}
</script>

<style scoped>
:deep(.timeout-input .el-input__inner) {
    text-align: left;
}
</style>
