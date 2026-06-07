import { computed, reactive, ref, watch } from 'vue'
import { send, store } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ChatLunaUsage } from 'koishi-plugin-chatluna-usage'

export type Scope = 'all' | 'year' | 'month' | 'week' | 'day'

export const scopes: { label: string; value: Scope }[] = [
    { label: '全部', value: 'all' },
    { label: '月', value: 'month' },
    { label: '周', value: 'week' },
    { label: '日', value: 'day' }
]

export const loading = ref(false)
export const listLoading = ref(false)
export const listRange = ref<[string, string]>()
export const scope = ref<Scope>('all')
export const query = reactive<ChatLunaUsage.Query>({
    period: 'day',
    groupBy: 'model',
    sortBy: 'totalTokens',
    desc: true
})
export const listQuery = reactive<ChatLunaUsage.Query>({
    listSortBy: 'createdAt',
    listDesc: true,
    page: 1,
    pageSize: 50
})
export const list = ref<ChatLunaUsage.List>()

let reqId = 0
let listReqId = 0

function scopeRange(value: Scope): [Date, Date] | undefined {
    if (value === 'all') return
    const now = new Date()
    const start = new Date(now)
    if (value === 'day') start.setHours(0, 0, 0, 0)
    if (value === 'year') start.setFullYear(start.getFullYear() - 1)
    if (value === 'month') start.setMonth(start.getMonth() - 1)
    if (value === 'week') start.setDate(start.getDate() - 7)
    return [start, now]
}

export function setScope(value: Scope) {
    scope.value = value
    const r = scopeRange(value)
    if (!r) {
        query.start = undefined
        query.end = undefined
    } else {
        query.start = r[0]
        query.end = r[1]
    }
}

export const usage = computed(() => store.chatluna_usage)

let timer: ReturnType<typeof setTimeout> | undefined
let listTimer: ReturnType<typeof setTimeout> | undefined

function refreshSoon() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
        timer = undefined
        refresh()
    }, 250)
}

function refreshListSoon() {
    if (listTimer) clearTimeout(listTimer)
    listTimer = setTimeout(() => {
        listTimer = undefined
        refreshList()
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

export async function refreshList() {
    if (listTimer) {
        clearTimeout(listTimer)
        listTimer = undefined
    }

    const id = ++listReqId
    try {
        listLoading.value = true
        const result = await send('chatluna-usage/list', listQuery)
        if (id === listReqId) list.value = result
    } catch {
        if (id === listReqId) ElMessage.error('查询调用明细失败')
    } finally {
        if (id === listReqId) listLoading.value = false
    }
}

export function changeListRange() {
    listQuery.start = listRange.value?.[0]
    listQuery.end = listRange.value?.[1]
    listQuery.page = 1
}

export function resetFilters() {
    listRange.value = undefined
    Object.assign(listQuery, {
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
    refreshListSoon()
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
    const listId = ++listReqId
    try {
        loading.value = true
        listLoading.value = true
        await send('chatluna-usage/cleanup')
        const [result, rows] = await Promise.all([
            send('chatluna-usage/query', query),
            send('chatluna-usage/list', listQuery)
        ])
        if (id === reqId) {
            store.chatluna_usage = result
            ElMessage.success('已清除 ChatLuna 用量历史数据')
        }
        if (listId === listReqId) list.value = rows
    } catch {
        if (id === reqId) ElMessage.error('清除 ChatLuna 用量历史数据失败')
    } finally {
        if (id === reqId) loading.value = false
        if (listId === listReqId) listLoading.value = false
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
        query.start,
        query.end
    ],
    () => refreshSoon(),
    { immediate: true }
)

watch(
    () => [
        listQuery.listSortBy,
        listQuery.listDesc,
        listQuery.start,
        listQuery.end,
        listQuery.source,
        listQuery.model,
        listQuery.platform,
        listQuery.chatPlatform,
        listQuery.callType,
        listQuery.guildId,
        listQuery.userId,
        listQuery.success,
        listQuery.estimated,
        listQuery.keyword
    ],
    () => {
        listQuery.page = 1
        refreshListSoon()
    },
    { immediate: true }
)

watch(
    () => [listQuery.page, listQuery.pageSize],
    () => refreshListSoon()
)
