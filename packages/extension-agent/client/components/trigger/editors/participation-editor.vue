<template>
    <div class="condition-grid">
        <div class="field">
            <label>统计时间窗</label>
            <duration-input v-model="model.withinMinutes" :max="30" />
        </div>
        <div class="field">
            <label>冷却时间</label>
            <duration-input v-model="model.cooldownMinutes" />
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
            <label>最少参与人数</label>
            <el-input-number
                v-model="model.minUsers"
                :min="1"
                :max="100"
                controls-position="right"
            />
        </div>
        <gate-editor v-model="model.gate" :models="models" />
    </div>
</template>

<script setup lang="ts">
import DurationInput from '../duration-input.vue'
import GateEditor from '../gate-editor.vue'
import type { ConditionOf } from '../types'

defineProps<{ models: string[] }>()
const model = defineModel<ConditionOf<'participation'>>({ required: true })
</script>

<style scoped>
@import './editor.css';
</style>
