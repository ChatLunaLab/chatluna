<template>
    <config-record-page
        title="Tool"
        description="管理工具配置与工具分组"
        :value="config"
        :stats="stats"
        :loading="loading"
        @refresh="$emit('refresh')"
        @save="$emit('save', $event)"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ConfigRecordPage from '../shared/config-record-page.vue'

const props = withDefaults(
    defineProps<{
        config: Record<string, unknown>
        loading?: boolean
    }>(),
    {
        config: () => ({}),
        loading: false
    }
)

defineEmits<{
    refresh: []
    save: [value: Record<string, unknown>]
}>()

const stats = computed(() => [
    {
        label: '工具数',
        value: Object.keys(props.config).length
    },
    {
        label: '已配置项',
        value: Object.values(props.config).filter((item) => item != null).length
    },
    {
        label: '首个键',
        value: Object.keys(props.config)[0] ?? '暂无'
    }
])
</script>
