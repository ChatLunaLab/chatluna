import { computed, reactive, ref, watch } from 'vue'
import { send, store } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
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

let timer: ReturnType<typeof setTimeout> | undefined

function refreshSoon() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
        timer = undefined
        refresh()
    }, 250)
}

export async function refresh() {
    if (timer) {
        clearTimeout(timer)
        timer = undefined
    }

    try {
        loading.value = true
        store.chatluna_usage = await send('chatluna-usage/query', query)
    } catch {
        ElMessage.error('查询 ChatLuna 用量失败')
    } finally {
        loading.value = false
    }
}

export function changeRange() {
    query.start = range.value?.[0]
    query.end = range.value?.[1]
    query.page = 1
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
    refreshSoon()
}

export async function clearHistory() {
    try {
        await ElMessageBox.confirm(
            '这会删除所有 ChatLuna 用量历史数据，无法撤销。',
            '清除历史数据',
            {
                confirmButtonText: '清除',
                cancelButtonText: '取消',
                type: 'warning',
                confirmButtonClass: 'el-button--danger'
            }
        )
    } catch {
        return
    }

    try {
        loading.value = true
        await send('chatluna-usage/cleanup')
        store.chatluna_usage = await send('chatluna-usage/query', query)
        ElMessage.success('已清除 ChatLuna 用量历史数据')
    } catch {
        ElMessage.error('清除 ChatLuna 用量历史数据失败')
    } finally {
        loading.value = false
    }
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

watch(
    () => [
        query.period,
        query.groupBy,
        query.sortBy,
        query.desc,
        query.listSortBy,
        query.listDesc,
        query.start,
        query.end,
        query.source,
        query.model,
        query.platform,
        query.chatPlatform,
        query.callType,
        query.guildId,
        query.userId,
        query.success,
        query.estimated,
        query.keyword
    ],
    () => {
        query.page = 1
        refreshSoon()
    }
)

watch(
    () => [query.page, query.pageSize],
    () => refreshSoon()
)
