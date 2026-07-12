<template>
    <div class="condition-grid">
        <div class="field full-row">
            <label>Cron 表达式</label>
            <el-input
                v-model="model.expression"
                placeholder="例如 0 9 * * 1-5"
            />
        </div>
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
    </div>
</template>

<script setup lang="ts">
import type { ConditionOf } from '../types'

defineProps<{ timezones: string[] }>()
const model = defineModel<ConditionOf<'cron'>>({ required: true })
</script>

<style scoped>
@import './editor.css';
</style>
