<template>
    <config-record-page
        title="Sub Agent"
        description="管理子代理配置与实例状态"
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
        status: {
            enabled: boolean
            agents: Record<string, unknown>
        }
        loading?: boolean
    }>(),
    {
        config: () => ({}),
        status: () => ({
            enabled: false,
            agents: {}
        }),
        loading: false
    }
)

defineEmits<{
    refresh: []
    save: [value: Record<string, unknown>]
}>()

const stats = computed(() => [
    {
        label: '子代理状态',
        value: props.status.enabled ? '已启用' : '未启用'
    },
    {
        label: '运行实例',
        value: Object.keys(props.status.agents).length
    },
    {
        label: '配置项',
        value: Object.keys(props.config).length
    }
])
</script>
