<template>
    <div class="condition-grid">
        <div class="field full-row">
            <label>关键词</label>
            <el-select
                v-model="model.keywords"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="输入关键词后按回车"
            />
        </div>
        <div class="field">
            <label>匹配方式</label>
            <el-switch
                v-model="model.caseSensitive"
                active-text="区分大小写"
                inactive-text="忽略大小写"
            />
        </div>
        <div class="field">
            <label>冷却时间</label>
            <duration-input v-model="model.cooldownMinutes" />
        </div>
    </div>
</template>

<script setup lang="ts">
import DurationInput from '../duration-input.vue'
import type { ConditionOf } from '../types'

const model = defineModel<ConditionOf<'keyword'>>({ required: true })
</script>

<style scoped>
@import './editor.css';
</style>
