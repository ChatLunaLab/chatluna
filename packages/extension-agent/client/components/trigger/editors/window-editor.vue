<template>
    <div class="condition-grid">
        <div class="field">
            <label>时区</label>
            <el-select v-model="model.timezone" filterable>
                <el-option
                    v-for="item in timezones"
                    :key="item"
                    :label="item"
                    :value="item"
                />
            </el-select>
        </div>
        <div class="field">
            <label>执行间隔</label>
            <duration-input v-model="model.everyMinutes" />
        </div>
        <div class="field full-row">
            <label>星期</label>
            <el-checkbox-group v-model="model.days" class="days">
                <el-checkbox-button
                    v-for="item in dayOptions"
                    :key="item.value"
                    :label="item.value"
                >
                    {{ item.label }}
                </el-checkbox-button>
            </el-checkbox-group>
        </div>
        <div class="field">
            <label>开始时间</label>
            <el-time-picker
                v-model="model.start"
                format="HH:mm"
                value-format="HH:mm"
            />
        </div>
        <div class="field">
            <label>结束时间</label>
            <el-time-picker
                v-model="model.end"
                format="HH:mm"
                value-format="HH:mm"
            />
        </div>
        <div class="field">
            <label>周期控制</label>
            <el-segmented
                v-model="model.control"
                :options="[
                    { label: '固定策略', value: 'fixed' },
                    { label: '由模型决定', value: 'model' }
                ]"
            />
        </div>
        <div class="field">
            <label>默认决定</label>
            <el-select v-model="model.defaultDecision">
                <el-option label="继续当前周期" value="continue" />
                <el-option label="停止当前周期" value="stop_period" />
            </el-select>
        </div>
        <div class="field">
            <label>错过执行</label>
            <el-select v-model="model.misfire">
                <el-option label="跳过" value="skip" />
                <el-option label="补执行一次" value="fire_once" />
            </el-select>
        </div>
        <div class="summary">
            {{ daySummary }} {{ model.start }} 至 {{ model.end }}，每
            {{ model.everyMinutes }} 分钟
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DurationInput from '../duration-input.vue'
import type { ConditionOf } from '../types'
import { dayOptions } from '../types'

defineProps<{ timezones: string[] }>()
const model = defineModel<ConditionOf<'window'>>({ required: true })
const daySummary = computed(() => {
    if (model.value.days.length === 7) return '每天'
    return dayOptions
        .filter((item) => model.value.days.includes(item.value))
        .map((item) => item.label)
        .join('、')
})
</script>

<style scoped>
@import './editor.css';
</style>
