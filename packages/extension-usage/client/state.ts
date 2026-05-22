import { computed, reactive, ref, watch } from 'vue'
import { send, store } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ChatLunaUsage } from 'koishi-plugin-chatluna-usage'

export type Scope = 'all' | 'month' | 'week' | 'day'

export const scopes: { label: string; value: Scope }[] = [
    { label: '全部', value: 'all' },
    { label: '月', value: 'month' },
    { label: '周', value: 'week' },
    { label: '日', value: 'day' }
]

export const loading = ref(false)
export const range = ref<[string, string]>()
export const scope = ref<Scope>('all')
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

let scopeChanging = false
let reqId = 0

function scopeRange(value: Scope): [Date, Date] | undefined {
    if (value === 'all') return
    const now = new Date()
    const start = new Date(now)
    if (value === 'day') start.setHours(0, 0, 0, 0)
    if (value === 'week') start.setDate(start.getDate() - 7)
    if (value === 'month') start.setMonth(start.getMonth() - 1)
    return [start, now]
}

export function setScope(value: Scope) {
    scope.value = value
    scopeChanging = true
    const r = scopeRange(value)
    if (!r) {
        range.value = undefined
        query.start = undefined
        query.end = undefined
    } else {
        range.value = [r[0].toISOString(), r[1].toISOString()]
        query.start = r[0]
        query.end = r[1]
    }
    query.page = 1
    scopeChanging = false
}

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

    const id = ++reqId
    try {
        loading.value = true
        const result = await send('chatluna-usage/query', query)
        if (id === reqId) store.chatluna_usage = result
    } catch {
        if (id === reqId) ElMessage.error('查询 ChatLuna 用量失败')
    } finally {
        if (id === reqId) loading.value = false
    }
}

export function changeRange() {
    query.start = range.value?.[0]
    query.end = range.value?.[1]
    query.page = 1
    if (!scopeChanging) scope.value = 'all'
}

export function resetFilters() {
    range.value = undefined
    scope.value = 'all'
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

    const id = ++reqId
    try {
        loading.value = true
        await send('chatluna-usage/cleanup')
        const result = await send('chatluna-usage/query', query)
        if (id === reqId) {
            store.chatluna_usage = result
            ElMessage.success('已清除 ChatLuna 用量历史数据')
        }
    } catch {
        if (id === reqId) ElMessage.error('清除 ChatLuna 用量历史数据失败')
    } finally {
        if (id === reqId) loading.value = false
    }
}

export function fmt(value?: number) {
    return (value ?? 0).toLocaleString()
}

const compact = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1
})

export function short(value?: number) {
    const v = value ?? 0
    return v >= 1000 ? compact.format(v) : v.toLocaleString()
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
