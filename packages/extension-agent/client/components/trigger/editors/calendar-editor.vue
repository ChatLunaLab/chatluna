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
            <label>错过执行</label>
            <el-select v-model="model.misfire">
                <el-option label="跳过" value="skip" />
                <el-option label="补执行一次" value="fire_once" />
            </el-select>
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
        <div class="field full-row">
            <label>执行时间</label>
            <div class="time-list">
                <div
                    v-for="(_, index) in model.times"
                    :key="index"
                    class="time-row"
                >
                    <el-time-picker
                        v-model="model.times[index]"
                        format="HH:mm"
                        value-format="HH:mm"
                    />
                    <el-tooltip content="删除时间" placement="top">
                        <el-button
                            size="small"
                            plain
                            :icon="Minus"
                            :disabled="model.times.length === 1"
                            aria-label="删除时间"
                            @click="model.times.splice(index, 1)"
                        />
                    </el-tooltip>
                </div>
                <el-button
                    :icon="Plus"
                    plain
                    @click="model.times.push('09:00')"
                >
                    添加时间
                </el-button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Minus, Plus } from '@element-plus/icons-vue'
import type { ConditionOf } from '../types'
import { dayOptions } from '../types'

defineProps<{ timezones: string[] }>()
const model = defineModel<ConditionOf<'calendar'>>({ required: true })
</script>

<style scoped>
@import './editor.css';
</style>
