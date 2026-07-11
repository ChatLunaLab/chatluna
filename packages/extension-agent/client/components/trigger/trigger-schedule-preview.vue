<template>
    <div v-if="scheduled" class="schedule-preview">
        <div class="preview-head">
            <span>未来运行时间</span>
            <el-button
                :icon="RefreshRight"
                circle
                text
                :loading="loading"
                @click="load"
            />
        </div>
        <div v-if="error" class="preview-error">{{ error }}</div>
        <ol v-else-if="items.length" class="preview-list">
            <li v-for="item in items" :key="item">
                {{ new Date(item).toLocaleString() }}
            </li>
        </ol>
        <div v-else-if="!loading" class="preview-empty">没有未来运行时间</div>
    </div>
</template>

<script setup lang="ts">
import { send } from '@koishijs/client'
import { RefreshRight } from '@element-plus/icons-vue'
import { computed, onBeforeUnmount, ref, toRaw, watch } from 'vue'
import type { TriggerCondition } from '../../../src/types'

const props = defineProps<{ condition: TriggerCondition }>()

const items = ref<string[]>([])
const error = ref('')
const loading = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0

const scheduled = computed(() => {
    if (props.condition.type === 'extension') return true
    return ['once', 'calendar', 'interval', 'cron', 'window'].includes(
        props.condition.type
    )
})

watch(
    () => props.condition,
    () => {
        if (timer) clearTimeout(timer)
        if (!scheduled.value) {
            items.value = []
            error.value = ''
            return
        }
        timer = setTimeout(load, 450)
    },
    { deep: true, immediate: true }
)

onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
})

async function load() {
    if (!scheduled.value) return
    const current = ++seq
    loading.value = true
    error.value = ''
    try {
        const result = await send(
            'chatluna-agent/previewTriggerCondition',
            structuredClone(toRaw(props.condition)),
            5
        )
        if (current === seq) items.value = result
    } catch (err) {
        if (current !== seq) return
        items.value = []
        error.value = err instanceof Error ? err.message : String(err)
    } finally {
        if (current === seq) loading.value = false
    }
}
</script>

<style scoped>
.schedule-preview {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--k-color-divider);
    min-width: 0;
}

.preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.preview-list {
    display: grid;
    gap: 5px;
    margin: 8px 0 0;
    padding-left: 24px;
    color: var(--k-text-light);
    font-size: 12px;
    line-height: 1.5;
}

.preview-error,
.preview-empty {
    margin-top: 8px;
    font-size: 12px;
    line-height: 1.5;
    word-break: break-word;
}

.preview-error {
    color: var(--el-color-danger);
}

.preview-empty {
    color: var(--k-text-light);
}
</style>
