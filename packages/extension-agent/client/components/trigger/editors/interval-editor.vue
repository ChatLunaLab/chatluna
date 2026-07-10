<template>
    <div class="condition-grid">
        <div class="field">
            <label>执行间隔</label>
            <duration-input v-model="model.everyMinutes" />
        </div>
        <div class="field">
            <label>错过执行</label>
            <el-select v-model="model.misfire">
                <el-option label="跳过" value="skip" />
                <el-option label="补执行一次" value="fire_once" />
            </el-select>
        </div>
        <div class="field full-row">
            <label>锚点时间</label>
            <el-date-picker
                v-model="model.anchorAt"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
                placeholder="选择间隔锚点"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import DurationInput from '../duration-input.vue'
import type { ConditionOf } from '../types'

const model = defineModel<ConditionOf<'interval'>>({ required: true })
</script>

<style scoped>
@import './editor.css';
</style>
