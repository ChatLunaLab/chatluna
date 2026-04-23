<template>
    <div class="trigger-page" :class="{ compact: compactMode }">
        <div class="toolbar-container">
            <div class="toolbar-main" v-if="currentView === 'list'">
                <div class="headline">
                    <div class="page-title">触发器</div>
                    <el-button
                        size="small"
                        class="mobile-only-desc-toggle"
                        :type="hideDesc ? 'primary' : 'default'"
                        plain
                        @click="hideDesc = !hideDesc"
                    >
                        {{ hideDesc ? '显示描述' : '隐藏描述' }}
                    </el-button>
                </div>

                <div class="actions-section">
                    <el-button size="small" @click="loadAll">
                        刷新
                    </el-button>
                    <el-button
                        size="small"
                        type="primary"
                        @click="openCreate"
                    >
                        新建触发器
                    </el-button>
                    <el-button
                        size="small"
                        @click="providersDialog = true"
                    >
                        提供器
                    </el-button>
                    <el-button
                        size="small"
                        class="hidden-mobile"
                        :type="compactMode ? 'primary' : 'default'"
                        plain
                        @click="compactMode = !compactMode"
                    >
                        {{ compactMode ? '宽屏模式' : '紧凑显示' }}
                    </el-button>
                    <el-button
                        size="small"
                        class="hidden-mobile"
                        :type="hideDesc ? 'primary' : 'default'"
                        plain
                        @click="hideDesc = !hideDesc"
                    >
                        {{ hideDesc ? '显示描述' : '隐藏描述' }}
                    </el-button>
                </div>
            </div>
        </div>

        <div class="page-content" v-loading="busy">
            <Transition name="page-swap" mode="out-in">
                <trigger-catalog
                    v-if="currentView === 'list'"
                    key="list"
                    :tasks="tasks"
                    :providers="providers"
                    :compact-mode="compactMode"
                    :hide-desc="hideDesc"
                    @select="openEditor"
                    @toggle="handleToggle"
                    @fire="handleFire"
                    @remove="handleRemove"
                />

                <trigger-detail
                    v-else
                    :key="detailKey"
                    :task="editingTask"
                    :providers="providers"
                    :routes="routes"
                    :tools="tools"
                    @back="currentView = 'list'"
                    @save="handleSave"
                    @remove="handleRemoveSelected"
                    @fire="handleFireSelected"
                />
            </Transition>
        </div>

        <el-dialog
            v-model="providersDialog"
            title="触发器提供器"
            width="520px"
            destroy-on-close
        >
            <div class="providers-dialog-hint">
                关闭某个提供器后，模型将不再看到对应的创建说明，
                被动触发也会失效，但已有任务不会被删除。
            </div>
            <div class="providers-dialog-list">
                <div
                    v-for="provider in providers"
                    :key="provider.kind"
                    class="provider-row"
                >
                    <div class="provider-row-info">
                        <div class="provider-row-name">
                            {{ provider.name }}
                            <span class="provider-row-kind">
                                ({{ provider.kind }})
                            </span>
                        </div>
                        <div class="provider-row-desc">
                            {{ provider.description }}
                        </div>
                    </div>
                    <el-switch
                        :model-value="provider.enabled !== false"
                        :loading="providerPending === provider.kind"
                        :disabled="providerPending === provider.kind"
                        @change="(value) => handleProviderToggle(provider.kind, !!value)"
                    />
                </div>
                <div v-if="providers.length < 1" class="providers-empty">
                    暂无已注册的提供器。
                </div>
            </div>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useCompactMode, useHideDesc } from '../shared/use-hide-desc'
import TriggerCatalog from './trigger-catalog.vue'
import TriggerDetail from './trigger-detail.vue'
import type {
    ToolAvailabilityInfo,
    TriggerCreateTaskInput,
    TriggerProviderDescriptor,
    TriggerRoutingChoice,
    TriggerStatus,
    TriggerTask
} from '../../../src/types'

type TriggerDraftPayload = Omit<TriggerCreateTaskInput, 'createdBy' | 'source'>

const props = defineProps<{
    status?: TriggerStatus
    loading?: boolean
}>()

const currentView = ref<'list' | 'detail'>('list')
const editingId = ref<number | null>(null)
const pending = ref(false)
let loadSeq = 0
const providersDialog = ref(false)
const providerPending = ref<string | null>(null)
const compactMode = useCompactMode('trigger')
const hideDesc = useHideDesc('trigger')

const tasks = ref<TriggerTask[]>([])
const providers = ref<TriggerProviderDescriptor[]>([])
const routes = ref<TriggerRoutingChoice[]>([])
const tools = ref<ToolAvailabilityInfo[]>([])

const busy = computed(() => props.loading || pending.value)

const editingTask = computed(() => {
    if (editingId.value == null) return null
    return tasks.value.find((item) => item.id === editingId.value) ?? null
})

const detailKey = computed(() =>
    editingId.value == null ? 'detail-new' : `detail-${editingId.value}`
)

watch(
    () => props.status,
    async () => {
        await loadAll()
    },
    { immediate: true }
)

async function loadAll() {
    const current = ++loadSeq
    try {
        pending.value = true
        const [nextTasks, nextProviders, nextRoutes, nextTools] =
            await Promise.all([
                send('chatluna-agent/listTriggerTasks'),
                send('chatluna-agent/getTriggerProviders'),
                send('chatluna-agent/getTriggerRoutingChoices'),
                send('chatluna-agent/getToolAvailability')
            ])
        if (current !== loadSeq) return
        tasks.value = nextTasks
        providers.value = nextProviders
        routes.value = nextRoutes
        tools.value = nextTools
    } catch {
        if (current !== loadSeq) return
        ElMessage.error('加载触发器数据失败。')
    } finally {
        if (current === loadSeq) {
            pending.value = false
        }
    }
}

function openEditor(id: number) {
    editingId.value = id
    currentView.value = 'detail'
}

function openCreate() {
    editingId.value = null
    currentView.value = 'detail'
}

async function handleSave(payload: TriggerDraftPayload) {
    try {
        pending.value = true
        if (editingId.value == null) {
            const created = await send('chatluna-agent/createTriggerTask', {
                ...payload,
                createdBy: 'console'
            })
            ElMessage.success('触发任务已创建。')
            editingId.value = created?.id ?? null
        } else {
            await send(
                'chatluna-agent/updateTriggerTask',
                editingId.value,
                payload
            )
            ElMessage.success('触发任务已更新。')
        }
        await loadAll()
        currentView.value = 'list'
    } catch {
        ElMessage.error(
            editingId.value == null
                ? '创建触发任务失败。'
                : '更新触发任务失败。'
        )
    } finally {
        pending.value = false
    }
}

async function handleToggle(id: number, enabled: boolean) {
    try {
        pending.value = true
        await send('chatluna-agent/setTriggerTaskEnabled', id, enabled)
        await loadAll()
    } catch {
        ElMessage.error('更新触发任务状态失败。')
    } finally {
        pending.value = false
    }
}

async function handleFire(id: number) {
    try {
        pending.value = true
        const result = await send('chatluna-agent/fireTriggerTask', id)
        await loadAll()
        if (result.ok) {
            ElMessage.success('触发任务已执行。')
            return
        }

        ElMessage.error(result.error?.message || '触发任务执行失败。')
    } catch {
        ElMessage.error('执行触发任务失败。')
    } finally {
        pending.value = false
    }
}

async function handleFireSelected() {
    if (editingId.value == null) return
    await handleFire(editingId.value)
}

async function handleRemove(id: number) {
    try {
        await ElMessageBox.confirm(
            '删除后触发器配置无法恢复，确定继续吗？',
            '删除触发器',
            {
                confirmButtonText: '删除',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )

        pending.value = true
        await send('chatluna-agent/removeTriggerTask', id)
        if (editingId.value === id) {
            editingId.value = null
            currentView.value = 'list'
        }
        await loadAll()
        ElMessage.success('触发任务已删除。')
    } catch (err) {
        if (err !== 'cancel' && err !== 'close') {
            ElMessage.error('删除触发任务失败。')
        }
    } finally {
        pending.value = false
    }
}

async function handleRemoveSelected() {
    if (editingId.value == null) return
    await handleRemove(editingId.value)
}

async function handleProviderToggle(kind: string, enabled: boolean) {
    try {
        providerPending.value = kind
        await send(
            'chatluna-agent/setTriggerProviderEnabled',
            kind,
            enabled
        )
        const idx = providers.value.findIndex((item) => item.kind === kind)
        if (idx >= 0) {
            providers.value[idx] = { ...providers.value[idx], enabled }
        }
        ElMessage.success(enabled ? '提供器已启用。' : '提供器已禁用。')
    } catch {
        ElMessage.error('更新提供器状态失败。')
    } finally {
        providerPending.value = null
    }
}
</script>

<style scoped>
.trigger-page {
    min-height: 100%;
    width: min(100%, 1800px);
    min-width: 0;
    margin: 0 auto;
    padding-bottom: 56px;
    box-sizing: border-box;
}

.trigger-page.compact {
    width: min(100%, 1440px);
}

.toolbar-container {
    margin-bottom: 16px;
}

.toolbar-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.headline {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
}

.page-title {
    font-size: 24px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.mobile-only-desc-toggle {
    display: none;
}

.actions-section {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.page-content {
    position: relative;
    min-height: 200px;
}

:deep(.el-loading-mask) {
    background-color: color-mix(in srgb, var(--k-page-bg), transparent 30%);
    z-index: 10;
}

.page-swap-enter-active,
.page-swap-leave-active {
    transition: all 0.24s ease;
}

.page-swap-enter-from,
.page-swap-leave-to {
    opacity: 0;
    transform: translateX(18px) translateY(4px);
}

.providers-dialog-hint {
    color: var(--k-text-light);
    font-size: 13px;
    line-height: 1.6;
    margin-bottom: 12px;
}

.providers-dialog-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.provider-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 14px;
    border: 1px solid var(--k-color-border);
    border-radius: 8px;
}

.provider-row-info {
    min-width: 0;
    flex: 1;
}

.provider-row-name {
    font-weight: 600;
    color: var(--k-text-dark);
    font-size: 14px;
}

.provider-row-kind {
    color: var(--k-text-light);
    font-weight: 400;
    margin-left: 4px;
    font-size: 12px;
}

.provider-row-desc {
    color: var(--k-text-light);
    font-size: 12px;
    line-height: 1.6;
    margin-top: 4px;
}

.providers-empty {
    text-align: center;
    color: var(--k-text-light);
    padding: 24px 0;
}

@media (max-width: 768px) {
    .toolbar-main {
        flex-direction: column;
        align-items: flex-start;
    }

    .headline {
        justify-content: space-between;
        width: 100%;
        box-sizing: border-box;
    }

    .actions-section {
        width: 100%;
        justify-content: flex-start;
    }

    .hidden-mobile {
        display: none;
    }

    .mobile-only-desc-toggle {
        display: inline-flex;
    }
}
</style>
