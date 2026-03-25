<template>
    <div class="detail-view">
        <div class="back-link-wrapper">
            <button type="button" class="back-link" @click="$emit('back')">
                <el-icon><ArrowLeft /></el-icon>
                <span>返回</span>
            </button>
        </div>

        <div class="page-header">
            <div class="headline">
                <div class="page-title">{{ agent.name }} 配置</div>
                <div class="page-description">调整当前 Sub Agent 的详细配置。</div>
            </div>
            
            <div class="editor-actions">
                <el-button
                    v-if="canRemove"
                    class="danger-soft"
                    type="danger"
                    plain
                    @click="$emit('remove')"
                >
                    删除
                </el-button>
                <el-button type="primary" @click="$emit('save')">
                    保存
                </el-button>
            </div>
        </div>

        <div class="tabs-underline">
            <div
                v-for="item in tabs"
                :key="item.value"
                :class="['tab-item', { active: tab === item.value }]"
                @click="tab = item.value"
            >
                {{ item.label }}
            </div>
        </div>

        <div class="editor-body">
            <!-- 详细信息 -->
            <div v-if="tab === 'info'" class="page-grid">
                <div class="section-title">基础配置</div>
                <div class="field-grid readonly-grid">
                    <div class="field-card flat-card">
                        <div class="field-label">名称</div>
                        <div class="field-static">{{ agent.name }}</div>
                    </div>
                    <div class="field-card flat-card">
                        <div class="field-label">来源</div>
                        <div class="field-static">
                            {{ `${agent.source} / ${agent.format}` }}
                        </div>
                    </div>
                    <div class="field-card flat-card full-row" style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div class="field-label">说明</div>
                            <div class="field-static">
                                {{ agent.description || '暂无说明。' }}
                            </div>
                        </div>
                        <el-button v-if="canEditContent" @click="showEditDialog = true" plain>
                            查看/编辑内容
                        </el-button>
                        <el-button v-else @click="showEditDialog = true" plain>
                            查看内容
                        </el-button>
                    </div>
                </div>

                <el-divider style="margin: 4px 0;" />

                <div class="section-title">高级配置</div>
                <div class="field-grid option-grid">
                    <div class="field-card flat-card option-card">
                        <div class="field-label">模型覆盖</div>
                        <el-select
                            v-model="draft.model"
                            clearable
                            filterable
                            placeholder="留空则继承父会话模型"
                        >
                            <el-option label="继承当前会话模型" value="" />
                            <el-option
                                v-for="item in modelOptions"
                                :key="item"
                                :label="item"
                                :value="item"
                            />
                        </el-select>
                    </div>
                    <div class="field-card flat-card option-card">
                        <div class="field-label">最大轮次</div>
                        <el-input-number
                            v-model="draft.maxTurns"
                            :min="1"
                            :max="100"
                            :step="1"
                        />
                    </div>
                </div>

                <div class="field-grid">
                    <div class="field-card flat-card switch-card">
                        <div class="scope-row">
                            <div>
                                <div class="field-label">隐藏</div>
                                <div class="field-help">隐藏后该 Sub Agent 不会出现在任何 Agent 的工具描述里。</div>
                            </div>
                            <el-switch v-model="draft.hidden" />
                        </div>
                    </div>
                    <div class="field-card flat-card switch-card">
                        <div class="scope-row">
                            <div>
                                <div class="field-label">Koishi 消息解析</div>
                                <div class="field-help">开启后会把输入中的 Koishi 元素转成多模态消息。</div>
                            </div>
                            <el-switch v-model="draft.allowKoishiMessageTransform" />
                        </div>
                    </div>
                </div>

                <div
                    v-if="agent.diagnostics.length > 0"
                    class="diagnostics-panel"
                    style="margin-top: 16px;"
                >
                    <div class="field-label">诊断信息</div>
                    <div
                        v-for="line in agent.diagnostics"
                        :key="line"
                        class="diagnostic-line"
                    >
                        {{ line }}
                    </div>
                </div>
            </div>

            <!-- 权限配置 -->
            <div v-else-if="tab === 'permission'" class="page-grid">
                <div class="section-title">Skills 权限</div>
                <permission-editor
                    v-model="draft.skills"
                    :options="skillOptions"
                />

                <el-divider style="margin: 16px 0;" />
                <div class="section-title">MCP 权限</div>
                <permission-editor
                    v-model="draft.mcp"
                    :options="mcpOptions"
                />

                <el-divider style="margin: 16px 0;" />
                <div class="section-title">Tools 权限</div>
                <permission-editor
                    v-model="draft.tools"
                    :options="toolOptions"
                />

                <el-divider style="margin: 16px 0;" />
                <div class="section-title">Computer 权限</div>
                <permission-editor
                    v-model="draft.computer"
                    :options="computerOptions"
                />
            </div>
        </div>

        <el-dialog
            v-model="showEditDialog"
            title="查看/编辑 Agent 内容"
            width="860px"
            destroy-on-close
            :close-on-click-modal="false"
        >
            <div class="dialog-body">
                <div class="form-card">
                    <div class="field-label">Agent 名称</div>
                    <el-input v-model="editDraft.name" placeholder="例如：my-agent" :disabled="!canEditContent" />
                    
                    <div class="field-label" style="margin-top: 12px">简介</div>
                    <el-input v-model="editDraft.description" placeholder="一句简短的描述" :disabled="!canEditContent" />
                    
                    <div class="field-label" style="margin-top: 12px">指令</div>
                    <code-editor
                        v-model="editDraft.promptContent"
                        language="markdown"
                        :min-height="240"
                        :readonly="!canEditContent"
                    />
                </div>
            </div>
            <template #footer>
                <el-button @click="showEditDialog = false">取消</el-button>
                <el-button
                    type="primary"
                    :loading="savingContent"
                    :disabled="!canEditContent || !canSaveContent"
                    @click="saveContent"
                >
                    保存内容
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ArrowLeft } from '@element-plus/icons-vue'
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import PermissionEditor from './permission-editor.vue'
import CodeEditor from '../shared/code-editor.vue'
import type { SubAgentInfo, ToolInfo } from '../../../src/types'

interface RuleDraft {
    mode: string
    allowText: string
    denyText: string
}

interface AgentDraft {
    name: string
    description: string
    promptContent: string
    model: string
    maxTurns: number
    hidden: boolean
    allowKoishiMessageTransform: boolean
    skills: RuleDraft
    mcp: RuleDraft
    tools: RuleDraft
    computer: RuleDraft
}

interface RuleOption {
    value: string
    label: string
}

const props = defineProps<{
    agent: SubAgentInfo
    draft: AgentDraft
    modelNames: string[]
    skillOptions: RuleOption[]
    mcpOptions: RuleOption[]
    computerOptions: RuleOption[]
    tools: Record<string, ToolInfo>
    canRemove: boolean
}>()

const emit = defineEmits<{
    back: []
    save: []
    remove: []
    refresh: []
}>()

const tab = ref<'info' | 'permission'>('info')

const tabs = [
    { value: 'info', label: '基础信息' },
    { value: 'permission', label: '权限配置' }
] as const

const showEditDialog = ref(false)
const savingContent = ref(false)

const editDraft = ref({
    name: '',
    description: '',
    promptContent: ''
})

watch(
    () => props.agent,
    (val) => {
        if (!val) return
        editDraft.value.name = val.name ?? ''
        editDraft.value.description = val.description ?? ''
        editDraft.value.promptContent = val.promptContent ?? ''
    },
    { immediate: true }
)

const canEditContent = computed(() => {
    return props.agent.source === 'markdown' && !props.agent.remote
})

const canSaveContent = computed(() => {
    return editDraft.value.name.trim().length > 0 && 
           editDraft.value.description.trim().length > 0 && 
           editDraft.value.promptContent.trim().length > 0
})

const modelOptions = computed(() => {
    const items = new Set(props.modelNames)
    if (props.draft.model.trim()) {
        items.add(props.draft.model.trim())
    }
    return [...items]
})

const toolOptions = computed(() => {
    return Object.values(props.tools ?? {})
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({
            value: item.name,
            label: item.group ? `${item.name} · ${item.group}` : item.name
        }))
})

async function saveContent() {
    try {
        await ElMessageBox.confirm(
            props.agent.name !== editDraft.value.name.trim() 
                ? '您修改了 Agent 名称，这将会创建一个新的副本。确定要继续吗？' 
                : '确定要保存修改后的内容吗？',
            '确认保存',
            {
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )
    } catch {
        return
    }

    try {
        savingContent.value = true
        await send('chatluna-agent/addSubAgent', {
            name: editDraft.value.name.trim(),
            description: editDraft.value.description.trim(),
            promptContent: editDraft.value.promptContent.trim(),
            model: props.draft.model,
            maxTurns: props.draft.maxTurns,
            hidden: props.draft.hidden,
            allowKoishiMessageTransform: props.draft.allowKoishiMessageTransform,
            permissions: props.agent.permissions // We don't overwrite current draft permissions here
        })
        ElMessage.success('保存内容成功。')
        showEditDialog.value = false
        emit('refresh')
    } catch (error) {
        ElMessage.error(`保存失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
        savingContent.value = false
    }
}
</script>

<style scoped>
.detail-view {
    display: flex;
    flex-direction: column;
    max-width: 860px;
    margin: 0 auto;
    width: 100%;
    padding: 24px;
    box-sizing: border-box;
}

.back-link-wrapper {
    margin-bottom: 24px;
}

.page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 32px;
}

.headline {
    margin-bottom: 0;
}

.page-title {
    font-size: 24px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.page-description {
    margin-top: 8px;
    font-size: 13px;
    color: var(--k-text-light);
}

.back-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-light);
    padding: 0;
}

.back-link:hover {
    color: var(--k-text-dark);
}

.tabs-underline {
    display: flex;
    gap: 32px;
    border-bottom: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 60%);
    margin-top: 32px;
    margin-bottom: 32px;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    white-space: nowrap;
}

.tabs-underline::-webkit-scrollbar {
    display: none;
}

.tab-item {
    padding: 12px 0;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    color: var(--k-text-light);
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
    margin-bottom: -1px;
    flex-shrink: 0;
}

.tab-item:hover {
    color: var(--k-text-dark);
}

.tab-item.active {
    color: var(--k-color-primary);
    border-bottom-color: var(--k-color-primary);
}

.editor-body {
    padding-bottom: 40px;
}

.section-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--k-text-dark);
    margin-bottom: 16px;
}

.page-grid,
.field-grid {
    display: grid;
    gap: 16px;
}

.field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.option-grid {
    grid-template-columns: minmax(0, 1fr) minmax(220px, 280px);
}

.field-card {
    padding: 20px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 20%);
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    box-sizing: border-box;
}

.flat-card {
    background: transparent;
    border: none;
    padding: 0;
}

.full-row {
    grid-column: 1 / -1;
}

.option-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.option-card :deep(.el-select),
.option-card :deep(.el-input-number) {
    width: 100%;
}

.field-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--k-text-dark);
}

.field-static {
    margin-top: 8px;
    color: var(--k-text-dark);
    line-height: 1.6;
}

.field-help {
    margin-top: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--k-text-light);
}

.scope-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.editor-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.editor-actions :deep(.danger-soft.el-button) {
    --el-button-bg-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 92%
    );
    --el-button-border-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 68%
    );
    --el-button-text-color: color-mix(
        in srgb,
        var(--el-color-danger),
        var(--k-text-dark) 22%
    );
    --el-button-hover-bg-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 86%
    );
    --el-button-hover-border-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 52%
    );
    --el-button-hover-text-color: var(--el-color-danger);
}

.diagnostics-panel {
    padding: 12px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--el-color-warning), transparent 95%);
}

.diagnostic-line {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
}

.dialog-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.form-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 0;
}

@media (max-width: 768px) {
    .page-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .editor-actions {
        width: 100%;
        justify-content: flex-end;
    }

    .field-grid {
        grid-template-columns: 1fr;
    }

    .option-grid {
        grid-template-columns: 1fr;
    }
}
</style>
