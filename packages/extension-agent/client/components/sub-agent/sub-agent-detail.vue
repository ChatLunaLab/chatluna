<template>
    <div class="detail-view">
        <button type="button" class="back-link" @click="$emit('back')">
            <el-icon><ArrowLeft /></el-icon>
            <span>返回</span>
        </button>

        <div class="panel">
            <div class="panel-header">
                <div>
                    <div class="panel-title">{{ agent.name }}</div>
                    <div class="panel-description">调整当前 agent 的配置。</div>
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

            <div class="editor-body">
                <div class="field-grid readonly-grid">
                    <div class="field-card">
                        <div class="field-label">名称</div>
                        <div class="field-static">{{ agent.name }}</div>
                    </div>
                    <div class="field-card">
                        <div class="field-label">来源</div>
                        <div class="field-static">
                            {{ `${agent.source} / ${agent.format}` }}
                        </div>
                    </div>
                    <div class="field-card full-row">
                        <div class="field-label">说明</div>
                        <div class="field-static">
                            {{ agent.description || '暂无说明。' }}
                        </div>
                    </div>
                </div>

                <div class="field-grid option-grid">
                    <div class="field-card option-card">
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
                    <div class="field-card option-card">
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
                    <div class="field-card switch-card">
                        <div>
                            <div class="field-label">隐藏</div>
                            <div class="field-help">
                                隐藏后不会出现在 handoff 工具描述里。
                            </div>
                        </div>
                        <el-switch v-model="draft.hidden" />
                    </div>
                    <div class="field-card switch-card">
                        <div>
                            <div class="field-label">Koishi 消息解析</div>
                            <div class="field-help">
                                开启后会把输入中的 Koishi 元素转成多模态消息。
                            </div>
                        </div>
                        <el-switch
                            v-model="draft.allowKoishiMessageTransform"
                        />
                    </div>
                </div>

                <el-collapse class="permission-collapse">
                    <el-collapse-item title="Skills 权限" name="skills">
                        <permission-editor
                            v-model="draft.skills"
                            :options="skillOptions"
                        />
                    </el-collapse-item>
                    <el-collapse-item title="MCP 权限" name="mcp">
                        <permission-editor v-model="draft.mcp" />
                    </el-collapse-item>
                    <el-collapse-item title="Tools 权限" name="tools">
                        <permission-editor
                            v-model="draft.tools"
                            :options="toolOptions"
                        />
                    </el-collapse-item>
                    <el-collapse-item title="Computer 权限" name="computer">
                        <permission-editor
                            v-model="draft.computer"
                            :options="computerOptions"
                        />
                    </el-collapse-item>
                </el-collapse>

                <div
                    v-if="agent.diagnostics.length > 0"
                    class="diagnostics-panel"
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
        </div>
    </div>
</template>

<script setup lang="ts">
import { ArrowLeft } from '@element-plus/icons-vue'
import { computed } from 'vue'
import PermissionEditor from './permission-editor.vue'
import type { SubAgentInfo, ToolInfo } from '../../../src/types'

interface RuleDraft {
    mode: string
    allowText: string
    denyText: string
}

interface AgentDraft {
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
    computerOptions: RuleOption[]
    tools: Record<string, ToolInfo>
    canRemove: boolean
}>()

defineEmits<{
    back: []
    save: []
    remove: []
}>()

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
</script>

<style scoped>
.detail-view {
    display: flex;
    flex-direction: column;
    gap: 18px;
}

.back-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    align-self: flex-start;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 22%);
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 999px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 24%);
    padding: 8px 12px;
    transition:
        color 0.2s ease,
        border-color 0.2s ease,
        transform 0.2s ease,
        background-color 0.2s ease;
}

.back-link:hover {
    color: var(--k-color-primary);
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 50%);
    transform: translateX(-1px);
}

.panel {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    overflow: hidden;
}

.panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
}

.panel-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-description,
.field-help,
.diagnostic-line {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
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

.editor-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
}

.option-grid {
    grid-template-columns: minmax(0, 1fr) minmax(220px, 280px);
}

.readonly-grid {
    margin-bottom: 0;
}

.field-card {
    padding: 14px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    box-sizing: border-box;
}

.field-card.full-row {
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
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.field-static {
    margin-top: 8px;
    color: var(--k-text-dark);
    line-height: 1.6;
}

.switch-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.permission-collapse {
    margin-top: 2px;
}

.diagnostics-panel {
    padding: 12px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--el-color-warning), transparent 95%);
}

@media (max-width: 768px) {
    .panel-header {
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
