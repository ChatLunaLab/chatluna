<template>
    <div class="condition-grid">
        <div class="field">
            <label>活跃统计窗口</label>
            <duration-input v-model="model.activeWithinMinutes" :max="30" />
        </div>
        <div class="field">
            <label>最少消息数</label>
            <el-input-number
                v-model="model.minMessages"
                :min="1"
                :max="100"
                controls-position="right"
            />
        </div>
        <div class="field">
            <label>静默时长</label>
            <duration-input v-model="model.silentMinutes" />
        </div>
        <div class="field">
            <label>冷却时间</label>
            <duration-input v-model="model.cooldownMinutes" />
        </div>
        <gate-editor v-model="model.gate" :models="models" />
    </div>
</template>

<script setup lang="ts">
import DurationInput from '../duration-input.vue'
import GateEditor from '../gate-editor.vue'
import type { ConditionOf } from '../types'

defineProps<{ models: string[] }>()
const model = defineModel<ConditionOf<'inactivity'>>({ required: true })
</script>

<style scoped>
@import './editor.css';
</style>
