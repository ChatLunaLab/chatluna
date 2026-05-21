import { computed, reactive, ref } from 'vue'
import { send, store } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import type { ChatLunaUsage } from 'koishi-plugin-chatluna-usage'

export const loading = ref(false)
export const range = ref<[string, string]>()
export const query = reactive<ChatLunaUsage.Query>({
    period: 'day',
    groupBy: 'model',
    sortBy: 'totalTokens',
    desc: true,
    listSortBy: 'createdAt',
    listDesc: true,
    page: 1,
    pageSize: 50
})

export const usage = computed(() => store.chatluna_usage)

export async function refresh() {
    try {
        loading.value = true
        store.chatluna_usage = await send('chatluna-usage/query', query)
    } catch {
        ElMessage.error('查询 ChatLuna 用量失败')
    } finally {
        loading.value = false
    }
}

export function search() {
    query.page = 1
    refresh()
}

export function selectModel(model: string) {
    query.model = query.model === model ? undefined : model
    query.page = 1
    refresh()
}

export function selectSource(source: string) {
    query.source = query.source === source ? undefined : source
    query.page = 1
    refresh()
}

export function changeRange() {
    query.start = range.value?.[0]
    query.end = range.value?.[1]
    query.page = 1
    refresh()
}

export function resetFilters() {
    range.value = undefined
    Object.assign(query, {
        period: 'day',
        groupBy: 'model',
        sortBy: 'totalTokens',
        desc: true,
        listSortBy: 'createdAt',
        listDesc: true,
        page: 1,
        pageSize: 50,
        start: undefined,
        end: undefined,
        source: undefined,
        model: undefined,
        platform: undefined,
        chatPlatform: undefined,
        callType: undefined,
        guildId: undefined,
        userId: undefined,
        success: undefined,
        estimated: undefined,
        keyword: undefined
    })
    refresh()
}

export function fmt(value?: number) {
    return (value ?? 0).toLocaleString()
}

export function pct(value?: number) {
    return `${(((value ?? 0) * 1000) / 10).toFixed(1)}%`
}

export function time(value?: string | Date) {
    return value ? new Date(value).toLocaleString() : '-'
}
