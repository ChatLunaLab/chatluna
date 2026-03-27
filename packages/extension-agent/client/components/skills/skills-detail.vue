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
                <div class="page-title">{{ skill.name }} Skill 设置</div>
                <div class="page-description">调整当前 Skill 的注入方式与可见范围。</div>
            </div>

            <el-button type="primary" class="save-btn" @click="$emit('save')">
                保存
            </el-button>
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
            <div v-if="tab === 'info'" class="page-grid">
                <div class="section-title">全局状态</div>
                <div class="field-grid">
                    <div class="field-card flat-card switch-card">
                        <div class="scope-row">
                            <div>
                                <div class="field-label">全局启用</div>
                                <div class="field-help">关闭后这个 Skill 不会被主 Agent 和 Sub Agent 注入。</div>
                            </div>
                            <el-switch v-model="draft.enabled" />
                        </div>
                    </div>
                    <div class="field-card flat-card switch-card">
                        <div class="scope-row">
                            <div>
                                <div class="field-label">主 Agent 启用</div>
                                <div class="field-help">控制主 Agent 是否允许看到并加载这个 Skill。</div>
                            </div>
                            <el-switch v-model="draft.main" />
                        </div>
                    </div>
                </div>

                <el-divider style="margin: 4px 0;" />

                <div class="section-title">注入模式</div>
                <div class="field-card flat-card full-row">
                    <div class="field-subtitle">切换注入方式</div>
                    <div class="field-help">决定模型先看到 Skill 摘要，还是直接注入完整内容。</div>
                    <div class="mode-row">
                        <el-segmented v-model="draft.mode" :options="modeOptions" />
                    </div>
                    <div class="mode-hint-list">
                        <div class="mode-hint-item">
                            <div class="mode-hint-title">描述</div>
                            <div class="field-help">仅把 Skill 名称、说明、路径等摘要注入给模型，模型需要时再主动加载。</div>
                        </div>
                        <div class="mode-hint-item">
                            <div class="mode-hint-title">全文</div>
                            <div class="field-help">在系统提示词阶段直接注入完整 Skill 内容，适合必须预先掌握完整规则的场景。</div>
                        </div>
                    </div>
                </div>

                <el-divider style="margin: 4px 0;" />

                <div class="section-title">Skill 信息</div>
                <div class="field-grid readonly-grid">
                    <div class="field-card flat-card">
                        <div class="field-label">名称</div>
                        <div class="field-static">{{ skill.name }}</div>
                    </div>
                    <div class="field-card flat-card">
                        <div class="field-label">来源</div>
                        <div class="field-static">{{ skill.source }} / {{ skill.scope }}</div>
                    </div>
                    <div class="field-card flat-card full-row">
                        <div class="field-label">说明</div>
                        <div class="field-static">{{ skill.description || '暂无说明。' }}</div>
                    </div>
                    <div class="field-card flat-card full-row">
                        <div class="field-label">路径</div>
                        <div class="field-static">{{ skill.path || '当前没有可用路径。' }}</div>
                    </div>
                </div>
            </div>

            <div v-else-if="tab === 'session'" class="page-grid">
                <div class="section-title">全局配置</div>
                <div class="field-card flat-card">
                    <div class="scope-row">
                        <div>
                            <div class="field-subtitle">主插件</div>
                            <div class="field-help">控制 `chatluna` 主插件整体是否允许注入这个 Skill。</div>
                        </div>
                        <el-switch v-model="draft.chatluna" />
                    </div>
                </div>

                <div class="field-card flat-card" style="margin-top: 8px;">
                    <div class="scope-row">
                        <div>
                            <div class="field-subtitle">伪装插件</div>
                            <div class="field-help">控制 `chatluna-character` 是否允许注入这个 Skill。</div>
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
                                <div class="field-help">独立控制私聊或群聊的 Skill 开关。</div>
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
                                class="icon-button"
                                title="复制所有 ID"
                                @click="copyIds"
                            >
                                <el-icon><CopyDocument /></el-icon>
                            </button>
                            <button
                                v-if="currentIds.length > 0"
                                type="button"
                                class="icon-button"
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

            <div v-else class="page-grid">
                <div class="field-card flat-card scope-card">
                    <div class="field-label" style="margin-bottom: 8px;">Sub Agent 范围</div>
                    <div class="field-help" style="margin-bottom: 16px;">
                        `all` 为全部 sub-agent，`allow` 为仅允许指定项，`deny` 为排除指定项。
                    </div>

                    <div class="scope-grid">
                        <el-select v-model="draft.subAgents.mode" style="width: 200px;">
                            <el-option label="全部允许 (all)" value="all" />
                            <el-option label="白名单 (allow)" value="allow" />
                            <el-option label="黑名单 (deny)" value="deny" />
                        </el-select>

                        <el-select
                            v-if="draft.subAgents.mode !== 'all'"
                            v-model="scopeValues"
                            multiple
                            filterable
                            clearable
                            collapse-tags
                            collapse-tags-tooltip
                            placeholder="选择 sub-agent"
                            style="flex: 1;"
                        >
                            <el-option
                                v-for="item in agentOptions"
                                :key="item.id"
                                :label="agentLabel(item)"
                                :value="item.id"
                            />
                        </el-select>
                    </div>
                </div>
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
import type { SkillConfig, SkillInfo, SubAgentInfo } from '../../../src/types'

const props = defineProps<{
    skill: SkillInfo
    draft: SkillConfig
    agentOptions: SubAgentInfo[]
}>()

defineEmits<{
    back: []
    save: []
}>()

const tab = ref<'info' | 'session' | 'actor' | 'subagent'>('info')
const characterKind = ref<'private' | 'group'>('private')
const idInput = ref('')
const showCopyDialog = ref(false)
const copyContent = ref('')
const copyInputRef = ref()

const tabs = [
    { value: 'info', label: '详细信息' },
    { value: 'session', label: '会话权限' },
    { value: 'actor', label: '触发者权限' },
    { value: 'subagent', label: 'Sub Agent 权限' }
] as const

const modeOptions = [
    { label: '描述', value: 'description' },
    { label: '全文', value: 'full' }
]

const scopeOptions = [
    { label: '全局', value: 'all' },
    { label: '白名单', value: 'allow' },
    { label: '黑名单', value: 'deny' }
]

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
        ? (props.draft.characterPrivateIds ?? [])
        : (props.draft.characterGroupIds ?? [])
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

const scopeValues = computed({
    get: () =>
        props.draft.subAgents?.mode === 'deny'
            ? (props.draft.subAgents?.deny ?? [])
            : (props.draft.subAgents?.allow ?? []),
    set: (value: string[]) => {
        const next = value.filter(
            (item, idx, list) => item.length > 0 && list.indexOf(item) === idx
        )

        if (props.draft.subAgents?.mode === 'deny') {
            props.draft.subAgents.deny = next
            props.draft.subAgents.allow = []
            return
        }

        props.draft.subAgents.allow = next
        props.draft.subAgents.deny = []
    }
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
        props.draft.characterPrivateIds = (props.draft.characterPrivateIds ?? []).filter((item) => item !== id)
        return
    }

    props.draft.characterGroupIds = (props.draft.characterGroupIds ?? []).filter((item) => item !== id)
}

function clearIds() {
    if (characterKind.value === 'private') {
        props.draft.characterPrivateIds = []
        return
    }

    props.draft.characterGroupIds = []
}

function agentLabel(item: SubAgentInfo) {
    return `${item.name} · ${item.source}${item.scope ? ` / ${item.scope}` : ''}`
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
    white-space: nowrap;
    scrollbar-width: none;
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
    margin-bottom: -1px;
    flex-shrink: 0;
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

.flat-card {
    background: transparent;
    border: none;
    padding: 0;
}

.full-row {
    grid-column: 1 / -1;
}

.field-label,
.field-subtitle,
.mode-hint-title {
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

.scope-grid {
    display: flex;
    gap: 12px;
    align-items: center;
}

.mode-row {
    margin-top: 16px;
}

.mode-hint-list {
    display: grid;
    gap: 16px;
    margin-top: 18px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mode-hint-item {
    padding: 0;
    border: none;
    background: transparent;
}

.inner-tabs {
    display: inline-flex;
    align-items: center;
    gap: 16px;
}

.inner-tab {
    background: transparent;
    border: none;
}

.icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
}

.id-tag-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
}

.inner-tab {
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

@media (max-width: 768px) {
    .tabs-underline {
        gap: 16px;
        margin-top: 16px;
        margin-bottom: 24px;
    }

    .field-grid {
        grid-template-columns: 1fr;
    }

    .mode-hint-list {
        grid-template-columns: 1fr;
    }

    .scope-row,
    .scope-grid,
    .page-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .scope-grid .el-select {
        width: 100% !important;
    }

    .detail-view {
        padding: 0;
    }
}
</style>
