<template>
    <div
        class="trigger-page"
        :class="{ compact: compactMode }"
        v-loading="busy"
    >
        <template v-if="view === 'list'">
            <div class="toolbar-container">
                <div class="toolbar-main">
                    <div class="headline">
                        <div class="page-title">触发器</div>
                    </div>
                    <div class="actions-section">
                        <el-button
                            class="hidden-mobile"
                            :type="compactMode ? 'primary' : 'default'"
                            plain
                            @click="compactMode = !compactMode"
                        >
                            {{ compactMode ? '紧凑模式' : '宽屏模式' }}
                        </el-button>
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
                </div>
            </div>

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
                :compact-mode="compactMode"
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
import { useCompactMode } from '../shared/use-hide-desc'
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
const compactMode = useCompactMode('trigger')
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
    width: min(100%, 1800px);
    min-width: 0;
    min-height: 480px;
    margin: 0 auto;
    padding-bottom: 48px;
    box-sizing: border-box;
}

.trigger-page.compact {
    width: min(100%, 1200px);
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
    min-width: 0;
}

.page-title {
    font-size: 24px;
    font-weight: 600;
    color: var(--k-text-dark);
    line-height: 1.35;
}

.actions-section {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: flex-end;
}

.backend-error {
    margin-bottom: 14px;
}

:deep(.el-loading-mask) {
    background: color-mix(in srgb, var(--k-page-bg), transparent 24%);
}

@media (max-width: 680px) {
    .hidden-mobile {
        display: none;
    }

    .toolbar-main {
        flex-direction: column;
        align-items: flex-start;
    }

    .actions-section {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        width: 100%;
    }

    .actions-section :deep(.el-button) {
        width: 100%;
        min-width: 0;
        margin: 0;
    }
}
</style>
