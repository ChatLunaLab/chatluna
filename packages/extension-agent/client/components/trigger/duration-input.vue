<template>
    <div class="duration-input">
        <el-input-number
            v-model="amount"
            :min="min"
            :max="inputMax"
            :step="1"
            controls-position="right"
        />
        <el-select v-model="unit" class="duration-unit">
            <el-option
                :label="base === 'seconds' ? '秒' : '分钟'"
                value="base"
            />
            <el-option
                v-if="max >= 60"
                :label="base === 'seconds' ? '分钟' : '小时'"
                value="large"
            />
        </el-select>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(
    defineProps<{
        modelValue: number
        base?: 'seconds' | 'minutes'
        min?: number
        max?: number
    }>(),
    { base: 'minutes', min: 1, max: 1000000 }
)

const emit = defineEmits<{
    'update:modelValue': [value: number]
}>()

const unit = ref(
    props.modelValue >= 60 && props.modelValue % 60 === 0 ? 'large' : 'base'
)

// Auto-pick display unit from stored value only; never rewrite modelValue
// merely because the user changed the unit selector.
watch(
    () => props.modelValue,
    (value) => {
        if (unit.value === 'large' && (value < 60 || value % 60 !== 0)) {
            unit.value = 'base'
            return
        }
        if (unit.value === 'base' && value >= 60 && value % 60 === 0) {
            unit.value = 'large'
        }
    }
)

const inputMax = computed(() =>
    unit.value === 'large' ? Math.floor(props.max / 60) : props.max
)

const amount = computed({
    get: () =>
        unit.value === 'large' ? props.modelValue / 60 : props.modelValue,
    set: (value: number | undefined) => {
        const next = Math.round(
            (value ?? props.min) * (unit.value === 'large' ? 60 : 1)
        )
        emit(
            'update:modelValue',
            Math.min(props.max, Math.max(props.min, next))
        )
    }
})
</script>

<style scoped>
.duration-input {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 92px;
    gap: 8px;
    width: 100%;
    min-width: 0;
}

.duration-input :deep(.el-input-number),
.duration-unit {
    width: 100%;
}
</style>
