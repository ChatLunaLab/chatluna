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
            <button
                v-for="item in tabs"
                :key="item.value"
                type="button"
                :class="['tab-item', { active: tab === item.value }]"
                @click="tab = item.value"
            >
                {{ item.label }}
            </button>
        </div>

        <div class="editor-body">
            <!-- 详细信息 -->
            <div v-if="tab === 'info'" class="page-grid">
                <div class="section-title">全局状态</div>
                <div class="field-grid">
                    <div class="field-card flat-card switch-card">
                        <div class="scope-row">
                            <div>
                                <div class="field-label">全局启用</div>
                                <div class="field-help">关闭后当前 Sub Agent 不会被主 Agent 调用。</div>
                            </div>
                            <el-switch v-model="draft.enabled" />
                        </div>
                    </div>
                    <div class="field-card flat-card switch-card">
                        <div class="scope-row">
                            <div>
                                <div class="field-label">隐藏</div>
                                <div class="field-help">隐藏后该 Sub Agent 不会出现在 Agent 的工具描述里。</div>
                            </div>
                            <el-switch v-model="draft.hidden" />
                        </div>
                    </div>
                    <div class="field-card flat-card switch-card">
                        <div class="scope-row">
                            <div>
                                <div class="field-label">主 LLM 去重重复工具</div>
                                <div class="field-help">开启后，主 LLM 会隐藏与当前 Sub Agent 重叠的工具。</div>
                            </div>
                            <el-switch v-model="draft.dedupeTools" />
                        </div>
                    </div>
                </div>

                <el-divider style="margin: 4px 0;" />

                <div class="section-title">Sub Agent 信息</div>
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
                    <div class="field-card flat-card full-row">
                        <div class="field-label">说明</div>
                        <div class="field-static">
                            {{ agent.description || '暂无说明。' }}
                        </div>
                    </div>
                    <div class="field-card flat-card full-row">
                        <div class="field-label">内容来源</div>
                        <div class="field-static">
                            {{ agent.path || agent.preset || '内置定义' }}
                        </div>
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

            <div v-else-if="tab === 'session'" class="page-grid">
                <div class="section-title">会话配置</div>
                <div class="field-card flat-card">
                    <div class="scope-row">
                        <div>
                            <div class="field-subtitle">主插件</div>
                            <div class="field-help">控制 `chatluna` 主插件是否允许调用当前 Sub Agent。</div>
                        </div>
                        <el-switch v-model="draft.chatluna" />
                    </div>
                </div>

                <div class="field-card flat-card" style="margin-top: 8px;">
                    <div class="scope-row">
                        <div>
                            <div class="field-subtitle">伪装插件</div>
                            <div class="field-help">控制 `chatluna-character` 是否允许调用当前 Sub Agent。</div>
                        </div>
                        <el-switch v-model="draft.character" />
                    </div>
                </div>

                <template v-if="draft.character">
                    <el-divider style="margin: 16px 0;" />
                    <div class="section-title">伪装插件会话规则配置</div>

                    <div class="inner-tabs" style="margin-bottom: 16px;">
                        <button
                            type="button"
                            :class="['inner-tab', { active: characterKind === 'private' }]"
                            @click="characterKind = 'private'"
                        >
                            私聊
                        </button>
                        <div class="inner-tab-divider"></div>
                        <button
                            type="button"
                            :class="['inner-tab', { active: characterKind === 'group' }]"
                            @click="characterKind = 'group'"
                        >
                            群聊
                        </button>
                    </div>

                    <div class="field-card flat-card">
                        <div class="scope-row">
                            <div>
                                <div class="field-subtitle">在此类型会话中启用</div>
                                <div class="field-help">独立控制私聊或群聊的 Sub Agent 开关。</div>
                            </div>
                            <el-switch
                                v-if="characterKind === 'private'"
                                v-model="draft.characterPrivate"
                            />
                            <el-switch
                                v-else
                                v-model="draft.characterGroup"
                            />
                        </div>

                        <template v-if="currentEnabled">
                            <div class="scope-row" style="margin-top: 24px;">
                                <div>
                                    <div class="field-subtitle">生效模式</div>
                                    <div class="field-help">定义当前会话类型使用全局、白名单或黑名单。</div>
                                </div>
                                <el-segmented v-model="currentModeValue" :options="scopeOptions" />
                            </div>
                        </template>
                    </div>

                    <div v-if="currentEnabled && currentModeValue !== 'all'" style="margin-top: 24px;">
                        <div class="field-subtitle" style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                            <span>{{ currentListLabel }}，可用英文逗号分隔多个 ID</span>
                            <button
                                v-if="currentIds.length > 0"
                                type="button"
                                class="copy-icon"
                                title="复制所有 ID"
                                @click="copyIds"
                            >
                                <el-icon><CopyDocument /></el-icon>
                            </button>
                            <button
                                v-if="currentIds.length > 0"
                                type="button"
                                class="copy-icon"
                                title="清空所有 ID"
                                @click="clearIds"
                            >
                                <el-icon><Delete /></el-icon>
                            </button>
                        </div>

                        <div class="custom-id-input-wrapper">
                            <div v-if="currentIds.length > 0" class="id-tag-list">
                                <div v-for="id in currentIds" :key="id" class="id-tag">
                                    {{ id }}
                                    <button
                                        type="button"
                                        class="id-tag-close"
                                        title="移除 ID"
                                        @click="removeId(id)"
                                    >
                                        <el-icon><Close /></el-icon>
                                    </button>
                                </div>
                            </div>

                            <div class="id-input-row">
                                <input
                                    v-model="idInput"
                                    type="text"
                                    class="id-native-input"
                                    placeholder="输入自定义会话 ID"
                                    @keyup.enter="addId"
                                />
                                <button class="id-submit-btn" type="button" @click="addId">填入</button>
                            </div>
                        </div>
                    </div>
                </template>
            </div>

            <div v-else-if="tab === 'actor'" class="page-grid">
                <div class="field-card flat-card">
                    <div class="field-label" style="margin-bottom: 8px;">最低权限</div>
                    <div class="field-help" style="margin-bottom: 16px;">
                        基于 Koishi 用户 authority。0 表示不限制，3 通常表示管理员。
                    </div>
                    <el-input-number
                        v-model="draft.authority"
                        :min="0"
                        :step="1"
                        controls-position="right"
                    />
                </div>
            </div>

            <!-- 功能权限 -->
            <div v-else class="page-grid">
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

        <el-dialog v-model="showCopyDialog" title="手动复制 ID" width="400px" append-to-body>
            <div style="margin-bottom: 16px; font-size: 13px; color: var(--k-text-light);">
                当前环境限制或复制失败，请手动全选并复制下方内容：
            </div>
            <el-input ref="copyInputRef" v-model="copyContent" type="textarea" :rows="4" readonly />
            <template #footer>
                <el-button type="primary" @click="showCopyDialog = false">确定</el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ArrowLeft, Close, CopyDocument, Delete } from '@element-plus/icons-vue'
import { computed, nextTick, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PermissionEditor from './permission-editor.vue'
import type { SubAgentInfo, ToolInfo } from '../../../src/types'

interface RuleDraft {
    mode: string
    allowText: string
    denyText: string
}

interface AgentDraft {
    enabled: boolean
    dedupeTools: boolean
    name: string
    description: string
    promptContent: string
    chatluna: boolean
    character: boolean
    characterGroup: boolean
    characterPrivate: boolean
    characterGroupMode: 'all' | 'allow' | 'deny'
    characterPrivateMode: 'all' | 'allow' | 'deny'
    characterGroupIds: string[]
    characterPrivateIds: string[]
    authority: number
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
}>()

const tab = ref<'info' | 'session' | 'actor' | 'feature'>('info')
const characterKind = ref<'private' | 'group'>('private')
const idInput = ref('')
const showCopyDialog = ref(false)
const copyContent = ref('')
const copyInputRef = ref()

const tabs = [
    { value: 'info', label: '基础信息' },
    { value: 'session', label: '会话权限' },
    { value: 'actor', label: '触发者权限' },
    { value: 'feature', label: '功能权限' }
] as const

const scopeOptions = [
    { label: '全局', value: 'all' },
    { label: '白名单', value: 'allow' },
    { label: '黑名单', value: 'deny' }
]

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

const currentEnabled = computed(() => {
    return characterKind.value === 'private'
        ? props.draft.characterPrivate !== false
        : props.draft.characterGroup !== false
})

const currentModeValue = computed({
    get: () => {
        return characterKind.value === 'private'
            ? props.draft.characterPrivateMode ?? 'all'
            : props.draft.characterGroupMode ?? 'all'
    },
    set: (value: 'all' | 'allow' | 'deny') => {
        if (characterKind.value === 'private') {
            props.draft.characterPrivateMode = value
            return
        }

        props.draft.characterGroupMode = value
    }
})

const currentIds = computed(() => {
    return characterKind.value === 'private'
        ? props.draft.characterPrivateIds
        : props.draft.characterGroupIds
})

const currentListLabel = computed(() => {
    if (characterKind.value === 'private') {
        return currentModeValue.value === 'allow'
            ? '要启用的私聊 ID 列表'
            : '要禁用的私聊 ID 列表'
    }

    return currentModeValue.value === 'allow'
        ? '要启用的群聊 ID 列表'
        : '要禁用的群聊 ID 列表'
})

async function copyIds() {
    const text = currentIds.value.join(',')

    if (window.isSecureContext && navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(text)
            ElMessage.success('已复制到剪贴板')
            return
        } catch {}
    }

    copyContent.value = text
    showCopyDialog.value = true
    nextTick(() => {
        copyInputRef.value?.focus()
        copyInputRef.value?.select()
    })
}

function addId() {
    const value = idInput.value.trim()
    if (!value) return

    const ids = value.split(/[\n,]/g).map((item) => item.trim()).filter(Boolean)
    const set = new Set(currentIds.value)
    ids.forEach((item) => set.add(item))

    if (characterKind.value === 'private') {
        props.draft.characterPrivateIds = Array.from(set)
    } else {
        props.draft.characterGroupIds = Array.from(set)
    }

    idInput.value = ''
}

function removeId(id: string) {
    if (characterKind.value === 'private') {
        props.draft.characterPrivateIds = props.draft.characterPrivateIds.filter((item) => item !== id)
        return
    }

    props.draft.characterGroupIds = props.draft.characterGroupIds.filter((item) => item !== id)
}

function clearIds() {
    if (characterKind.value === 'private') {
        props.draft.characterPrivateIds = []
        return
    }

    props.draft.characterGroupIds = []
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
    background: transparent;
    border-left: none;
    border-right: none;
    border-top: none;
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

.field-help,
.field-static {
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

.field-subtitle,
.field-static {
    font-size: 15px;
    font-weight: 500;
    color: var(--k-text-dark);
}

.inner-tabs {
    display: inline-flex;
    align-items: center;
    gap: 16px;
}

.inner-tab {
    border: none;
    background: transparent;
    font-size: 14px;
    color: var(--k-text-light);
    cursor: pointer;
    font-weight: 600;
}

.inner-tab.active {
    color: var(--k-color-primary);
}

.inner-tab-divider {
    width: 1px;
    height: 14px;
    background: color-mix(in srgb, var(--k-color-divider), transparent 40%);
}

.custom-id-input-wrapper {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.id-tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.id-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 16px;
    background-color: color-mix(in srgb, var(--k-text-light), transparent 85%);
    color: var(--k-text-dark);
    font-size: 13px;
    font-weight: 500;
}

.id-tag-close,
.copy-icon {
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
}

.id-input-row {
    display: flex;
    align-items: center;
    background-color: color-mix(in srgb, var(--k-page-bg), transparent 30%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--k-color-divider), transparent 40%) inset;
    border-radius: 8px;
    padding: 4px;
}

.id-native-input {
    flex: 1;
    border: none;
    background: transparent;
    padding: 8px 12px;
    font-size: 13px;
    color: var(--k-text-dark);
    outline: none;
}

.id-submit-btn {
    border: none;
    background-color: color-mix(in srgb, var(--k-text-light), transparent 85%);
    border-radius: 6px;
    padding: 8px 20px;
    color: var(--k-text-dark);
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
}

:deep(.el-segmented) {
    padding: 3px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--k-color-divider), transparent 42%);
}

:deep(.el-segmented__item) {
    border-radius: 6px;
    color: var(--k-text-light);
    transition: color 0.2s ease, background-color 0.2s ease;
}

:deep(.el-segmented__item.is-selected) {
    color: #fff;
}

:deep(.el-segmented__item-selected) {
    border-radius: 6px;
    background: var(--k-color-primary);
    box-shadow: none;
}

:deep(.el-segmented__item:hover) {
    background-color: color-mix(in srgb, var(--k-side-bg), var(--k-text-light) 12%) !important;
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

    .scope-row {
        flex-direction: column;
        align-items: flex-start;
    }

    .detail-view {
        padding: 0;
    }
}
</style>
