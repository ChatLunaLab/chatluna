<template>
    <div class="trigger-page" v-loading="busy">
        <template v-if="view === 'list'">
            <header class="page-head">
                <div class="page-copy">
                    <h1>触发器</h1>
                    <div v-if="status" class="status-summary">
                        <span>共 {{ status.total }}</span>
                        <span>启用 {{ status.enabled }}</span>
                        <span>等待 {{ status.waiting }}</span>
                        <span>运行 {{ status.running }}</span>
                        <span>暂停 {{ status.paused }}</span>
                        <span v-if="status.error" class="status-error">
                            异常 {{ status.error }}
                        </span>
                    </div>
                </div>
                <div class="page-actions">
                    <el-button
                        :icon="RefreshRight"
                        :disabled="busy"
                        @click="load"
                    >
                        刷新
                    </el-button>
                    <el-button
                        :icon="Plus"
                        type="primary"
                        :disabled="busy"
                        @click="openCreate"
                    >
                        新建触发器
                    </el-button>
                </div>
            </header>

            <el-alert
                v-if="backendError"
                class="backend-error"
                type="error"
                :title="backendError"
                :closable="false"
                show-icon
            />

            <trigger-catalog
                :tasks="tasks"
                :scenarios="scenarios"
                :providers="providers"
                :busy="busy"
                @select="openEditor"
                @toggle="toggle"
                @fire="fire"
                @resume="resume"
                @remove="remove"
            />
        </template>

        <trigger-editor
            v-else
            :key="editing?.id ?? 'new'"
            :task="editing"
            :routes="routes"
            :tools="tools"
            :models="models"
            :presets="presets"
            :providers="providers"
            :scenarios="scenarios"
            :busy="busy"
            :error="backendError"
            @back="closeEditor"
            @save="save"
            @fire="fireSelected"
            @remove="removeSelected"
        />
    </div>
</template>

<script setup lang="ts">
import { send } from '@koishijs/client'
import { Plus, RefreshRight } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, ref, watch } from 'vue'
import type {
    ToolAvailabilityInfo,
    TriggerProviderMeta,
    TriggerStatus,
    TriggerTask,
    TriggerUpdateInput
} from '../../../src/types'
import TriggerCatalog from './trigger-catalog.vue'
import TriggerEditor from './trigger-editor.vue'
import { toScenarios, type TriggerRouteChoice } from './types'

const props = defineProps<{
    status?: TriggerStatus
    loading?: boolean
}>()

const view = ref<'list' | 'editor'>('list')
const pending = ref(false)
const tasks = ref<TriggerTask[]>([])
const editing = ref<TriggerTask | null>(null)
const routes = ref<TriggerRouteChoice[]>([])
const tools = ref<ToolAvailabilityInfo[]>([])
const models = ref<string[]>([])
const presets = ref<string[]>([])
const providers = ref<TriggerProviderMeta[]>([])
const backendError = ref('')
let seq = 0

const busy = computed(() => props.loading === true || pending.value)
const scenarios = computed(() => toScenarios(providers.value))

watch(
    () => props.status,
    () => load(),
    { immediate: true }
)

async function load() {
    const current = ++seq
    pending.value = true
    backendError.value = ''
    try {
        const result = await Promise.all([
            send('chatluna-agent/listTriggers'),
            send('chatluna-agent/getTriggerRoutingChoices'),
            send('chatluna-agent/getToolAvailability'),
            send('chatluna-agent/getModelNames'),
            send('chatluna-agent/getPresetNames'),
            send('chatluna-agent/listTriggerProviders')
        ])
        if (current !== seq) return
        tasks.value = result[0]
        routes.value = result[1]
        tools.value = result[2]
        models.value = result[3]
        presets.value = result[4]
        providers.value = result[5]
    } catch (err) {
        if (current !== seq) return
        backendError.value = err instanceof Error ? err.message : String(err)
        ElMessage.error(backendError.value)
    } finally {
        if (current === seq) pending.value = false
    }
}

function openCreate() {
    editing.value = null
    backendError.value = ''
    view.value = 'editor'
}

async function openEditor(id: number) {
    pending.value = true
    backendError.value = ''
    try {
        editing.value = await send('chatluna-agent/getTrigger', id)
        view.value = 'editor'
    } catch (err) {
        backendError.value = err instanceof Error ? err.message : String(err)
        ElMessage.error(backendError.value)
    } finally {
        pending.value = false
    }
}

function closeEditor() {
    view.value = 'list'
    editing.value = null
    backendError.value = ''
}

async function save(input: TriggerUpdateInput) {
    pending.value = true
    backendError.value = ''
    try {
        if (editing.value) {
            await send('chatluna-agent/updateTrigger', editing.value.id, input)
            ElMessage.success('触发器已更新。')
        } else {
            await send('chatluna-agent/createTrigger', input)
            ElMessage.success('触发器已创建。')
        }
        await load()
        closeEditor()
    } catch (err) {
        backendError.value = err instanceof Error ? err.message : String(err)
        ElMessage.error(backendError.value)
    } finally {
        pending.value = false
    }
}

async function toggle(id: number, enabled: boolean) {
    pending.value = true
    backendError.value = ''
    try {
        const task = await send('chatluna-agent/setTriggerEnabled', id, enabled)
        const index = tasks.value.findIndex((item) => item.id === id)
        if (index >= 0) tasks.value[index] = task
    } catch (err) {
        backendError.value = err instanceof Error ? err.message : String(err)
        ElMessage.error(backendError.value)
    } finally {
        pending.value = false
    }
}

async function resume(id: number) {
    pending.value = true
    backendError.value = ''
    try {
        const task = await send('chatluna-agent/resumeTrigger', id)
        const index = tasks.value.findIndex((item) => item.id === id)
        if (index >= 0) tasks.value[index] = task
        ElMessage.success('触发器已恢复。')
    } catch (err) {
        backendError.value = err instanceof Error ? err.message : String(err)
        ElMessage.error(backendError.value)
    } finally {
        pending.value = false
    }
}

async function fire(id: number) {
    pending.value = true
    backendError.value = ''
    try {
        const run = await send('chatluna-agent/fireTrigger', id)
        await load()
        if (run.status === 'failed') {
            backendError.value = run.error || '触发器执行失败。'
            ElMessage.error(backendError.value)
            return
        }
        if (run.status === 'skipped') {
            ElMessage.warning('触发器已跳过本次执行。')
            return
        }
        ElMessage.success('触发器已执行。')
    } catch (err) {
        backendError.value = err instanceof Error ? err.message : String(err)
        ElMessage.error(backendError.value)
    } finally {
        pending.value = false
    }
}

async function fireSelected() {
    if (!editing.value) return
    await fire(editing.value.id)
    pending.value = true
    try {
        editing.value = await send(
            'chatluna-agent/getTrigger',
            editing.value.id
        )
    } catch (err) {
        backendError.value = err instanceof Error ? err.message : String(err)
    } finally {
        pending.value = false
    }
}

async function remove(id: number) {
    try {
        await ElMessageBox.confirm(
            '删除后任务定义和运行计划无法恢复。',
            '删除触发器',
            {
                confirmButtonText: '删除',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )
    } catch (err) {
        if (err === 'cancel' || err === 'close') return
        backendError.value = err instanceof Error ? err.message : String(err)
        return
    }

    pending.value = true
    backendError.value = ''
    try {
        await send('chatluna-agent/removeTrigger', id)
        if (editing.value?.id === id) closeEditor()
        await load()
        ElMessage.success('触发器已删除。')
    } catch (err) {
        backendError.value = err instanceof Error ? err.message : String(err)
        ElMessage.error(backendError.value)
    } finally {
        pending.value = false
    }
}

async function removeSelected() {
    if (!editing.value) return
    await remove(editing.value.id)
}
</script>

<style scoped>
.trigger-page {
    width: min(100%, 1440px);
    min-width: 0;
    min-height: 480px;
    margin: 0 auto;
    padding-bottom: 48px;
    box-sizing: border-box;
}

.page-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 18px;
}

.page-copy {
    min-width: 0;
}

.page-copy h1 {
    margin: 0;
    color: var(--k-text-dark);
    font-size: 24px;
    line-height: 1.35;
    letter-spacing: 0;
}

.status-summary,
.page-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
}

.status-summary {
    margin-top: 7px;
    color: var(--k-text-light);
    font-size: 12px;
}

.status-error {
    color: var(--el-color-danger);
}

.page-actions {
    justify-content: flex-end;
}

.backend-error {
    margin-bottom: 14px;
}

:deep(.el-loading-mask) {
    background: color-mix(in srgb, var(--k-page-bg), transparent 24%);
}

@media (max-width: 680px) {
    .page-head {
        flex-direction: column;
    }

    .page-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        width: 100%;
    }

    .page-actions :deep(.el-button) {
        width: 100%;
        min-width: 0;
        margin: 0;
    }
}
</style>
