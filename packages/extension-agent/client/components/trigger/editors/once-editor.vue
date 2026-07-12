<template>
    <div class="condition-grid">
        <div class="field full-row">
            <label>执行时间</label>
            <el-date-picker
                v-model="model.at"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
                placeholder="选择执行时间"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import type { ConditionOf } from '../types'

const model = defineModel<ConditionOf<'once'>>({ required: true })
</script>

<style scoped>
@import './editor.css';
</style>
