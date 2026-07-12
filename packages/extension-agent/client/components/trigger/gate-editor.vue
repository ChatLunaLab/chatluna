<template>
    <div class="gate-editor">
        <div v-if="!required" class="field full-row">
            <label>模型判断</label>
            <el-segmented
                :model-value="gate.type"
                :options="[
                    { label: '不使用', value: 'none' },
                    { label: '启用', value: 'model' }
                ]"
                @update:model-value="setType"
            />
        </div>

        <template v-if="gate.type === 'model'">
            <div class="field">
                <label>判断模型</label>
                <el-segmented
                    :model-value="gate.model.type"
                    :options="[
                        { label: '跟随任务模型', value: 'default' },
                        { label: '指定模型', value: 'fixed' }
                    ]"
                    @update:model-value="setModel"
                />
            </div>
            <div v-if="gate.model.type === 'fixed'" class="field">
                <label>指定模型</label>
                <el-select
                    v-model="gate.model.model"
                    filterable
                    placeholder="选择模型"
                >
                    <el-option
                        v-for="item in models"
                        :key="item"
                        :label="item"
                        :value="item"
                    />
                </el-select>
            </div>
            <div class="field full-row">
                <label>判断提示词</label>
                <el-input
                    v-model="gate.prompt"
                    type="textarea"
                    :rows="2"
                    placeholder="可选的附加判断标准"
                />
            </div>
            <div class="field">
                <label>判断超时</label>
                <duration-input v-model="gate.timeoutSeconds" base="seconds" />
            </div>
            <div class="field">
                <label>每日 Token 上限</label>
                <el-input-number
                    v-model="gate.dailyTokenLimit"
                    :min="1"
                    :max="100000000"
                    controls-position="right"
                />
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import type { TriggerGate } from '../../../src/types'
import DurationInput from './duration-input.vue'
import { createGate } from './types'

defineProps<{
    required?: boolean
    models: string[]
}>()

const gate = defineModel<TriggerGate>({ required: true })

function setType(value: string | number | boolean) {
    gate.value = value === 'model' ? createGate() : { type: 'none' }
}

function setModel(value: string | number | boolean) {
    if (gate.value.type !== 'model') return
    gate.value.model =
        value === 'fixed' ? { type: 'fixed', model: '' } : { type: 'default' }
}
</script>

<style scoped>
.gate-editor {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--k-color-divider);
}

.field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
}

.field label {
    font-size: 13px;
    font-weight: 500;
    color: var(--k-text-dark);
}

.full-row {
    grid-column: 1 / -1;
}

.field :deep(.el-select),
.field :deep(.el-input-number),
.field :deep(.el-segmented) {
    width: 100%;
}

@media (max-width: 680px) {
    .gate-editor {
        grid-template-columns: minmax(0, 1fr);
    }

    .full-row {
        grid-column: auto;
    }
}
</style>
