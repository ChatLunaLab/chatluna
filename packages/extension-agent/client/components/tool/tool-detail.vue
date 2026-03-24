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
                <div class="page-title">{{ tool.name }} 工具设置</div>
                <div class="page-description">调整当前工具的详细配置。</div>
            </div>
            
            <el-button type="primary" class="save-btn" @click="$emit('save')">
                保存
            </el-button>
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
                <div class="section-title">全局状态</div>
                <div class="field-grid">
                    <div class="field-card flat-card switch-card">
                        <div class="scope-row">
                            <div>
                                <div class="field-label">全局启用</div>
                                <div class="field-help">关闭后当前工具在所有入口都不可用。</div>
                            </div>
                            <el-switch v-model="draft.enabled" />
                        </div>
                    </div>
                    <div class="field-card flat-card switch-card">
                        <div class="scope-row">
                            <div>
                                <div class="field-label">主 Agent 启用</div>
                                <div class="field-help">控制主 Agent 是否允许调用这个工具。</div>
                            </div>
                            <el-switch v-model="draft.main" />
                        </div>
                    </div>
                </div>

                <el-divider style="margin: 4px 0;" />

                <div class="section-title">工具信息</div>
                <div class="field-grid readonly-grid">
                    <div class="field-card flat-card">
                        <div class="field-label">名称</div>
                        <div class="field-static">{{ tool.name }}</div>
                    </div>
                    <div class="field-card flat-card">
                        <div class="field-label">来源</div>
                        <div class="field-static">
                            {{ tool.source || 'unknown' }}
                            {{ tool.group ? ` / ${tool.group}` : '' }}
                        </div>
                    </div>
                    <div class="field-card flat-card full-row">
                        <div class="field-label">说明</div>
                        <div class="field-static">
                            {{ tool.description || '暂无说明。' }}
                        </div>
                    </div>
                </div>

                <div class="field-card flat-card full-row" v-if="tool.tags?.length">
                    <div class="field-label">标签</div>
                    <div class="tag-list">
                        <el-tag
                            v-for="item in tool.tags"
                            :key="item"
                            size="small"
                            effect="plain"
                            class="tag-item"
                        >
                            {{ item }}
                        </el-tag>
                    </div>
                </div>
            </div>

            <!-- 会话权限 -->
            <div v-else-if="tab === 'session'" class="page-grid">
                <div class="section-title">全局配置</div>
                <div class="field-card flat-card">
                    <div class="scope-row">
                        <div>
                            <div class="field-subtitle">主插件</div>
                            <div class="field-help">控制 <code>chatluna</code> 主插件整体是否允许注入这个工具。</div>
                        </div>
                        <el-switch v-model="draft.chatluna" />
                    </div>
                </div>

                <div class="field-card flat-card" style="margin-top: 8px;">
                    <div class="scope-row">
                        <div>
                            <div class="field-subtitle">伪装插件</div>
                            <div class="field-help">控制 <code>chatluna-character</code> 是否允许注入这个工具。</div>
                        </div>
                        <el-switch v-model="draft.character" />
                    </div>
                </div>

                <template v-if="draft.character">
                    <el-divider style="margin: 16px 0;" />
                    <div class="section-title">伪装插件会话规则配置</div>
                    
                    <div class="inner-tabs" style="margin-bottom: 16px;">
                        <div 
                            :class="['inner-tab', { active: characterKind === 'private' }]" 
                            @click="characterKind = 'private'"
                        >
                            私聊
                        </div>
                        <div class="inner-tab-divider"></div>
                        <div 
                            :class="['inner-tab', { active: characterKind === 'group' }]" 
                            @click="characterKind = 'group'"
                        >
                            群聊
                        </div>
                    </div>

                    <div class="field-card flat-card">
                        <div class="scope-row">
                            <div>
                                <div class="field-subtitle">在此类型会话中启用</div>
                                <div class="field-help">独立控制私聊或群聊的工具开关。</div>
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

                        <template v-if="(characterKind === 'private' ? draft.characterPrivate : draft.characterGroup)">
                            <div class="scope-row" style="margin-top: 24px;">
                                <div>
                                    <div class="field-subtitle">生效模式</div>
                                    <div class="field-help">定义生效的白名单或黑名单。</div>
                                </div>
                                <el-segmented
                                    v-if="characterKind === 'private'"
                                    v-model="draft.characterPrivateMode"
                                    :options="modeOptions"
                                />
                                <el-segmented
                                    v-else
                                    v-model="draft.characterGroupMode"
                                    :options="modeOptions"
                                />
                            </div>
                        </template>
                    </div>

                    <div
                        v-if="(characterKind === 'private' ? draft.characterPrivate : draft.characterGroup) && currentMode !== 'all'"
                        style="margin-top: 24px;"
                    >
                        <div class="field-subtitle" style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                            <span>{{ currentListLabel }}，可用英文逗号分隔多个 ID</span>
                            <el-icon
                                v-if="currentIdArray.length > 0"
                                class="copy-icon"
                                title="复制所有 ID"
                                @click="copyIds"
                            >
                                <CopyDocument />
                            </el-icon>
                        </div>
                        
                        <div class="custom-id-input-wrapper">
                            <div class="id-tag-list" v-if="currentIdArray.length > 0">
                                <div
                                    v-for="id in currentIdArray"
                                    :key="id"
                                    class="id-tag"
                                >
                                    {{ id }}
                                    <el-icon class="id-tag-close" @click="removeId(id)"><Close /></el-icon>
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

            <!-- 触发者权限 -->
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

            <!-- Sub Agent 权限 -->
            <div v-else class="page-grid">
                <div class="field-card flat-card scope-card">
                    <div class="field-label" style="margin-bottom: 8px;">Sub Agent 范围</div>
                    <div class="field-help" style="margin-bottom: 16px;">
                        <code>all</code> 为全部 sub-agent，<code>allow</code> 为仅允许指定项，<code>deny</code> 为排除指定项。
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

        <el-dialog
            v-model="showCopyDialog"
            title="手动复制 ID"
            width="400px"
            append-to-body
        >
            <div style="margin-bottom: 16px; font-size: 13px; color: var(--k-text-light);">
                当前环境限制或复制失败，请手动全选并复制下方内容：
            </div>
            <el-input
                ref="copyInputRef"
                v-model="copyContent"
                type="textarea"
                :rows="4"
                readonly
            />
            <template #footer>
                <el-button type="primary" @click="showCopyDialog = false">确定</el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ArrowLeft, Close, CopyDocument } from '@element-plus/icons-vue'
import { computed, ref, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import type { SubAgentInfo, ToolInfo, ToolItemConfig } from '../../../src/types'

const props = defineProps<{
    tool: ToolInfo
    draft: ToolItemConfig
    agentOptions: SubAgentInfo[]
}>()

defineEmits<{
    back: []
    save: []
}>()

const tab = ref<'info' | 'session' | 'actor' | 'subagent'>('info')
const characterKind = ref<'private' | 'group'>('private')
const idInput = ref('')

const tabs = [
    { value: 'info', label: '详细信息' },
    { value: 'session', label: '会话权限' },
    { value: 'actor', label: '触发者权限' },
    { value: 'subagent', label: 'Sub Agent 权限' }
] as const

const showCopyDialog = ref(false)
const copyContent = ref('')
const copyInputRef = ref()

async function copyIds() {
    const text = currentIdArray.value.join(',')
    
    if (window.isSecureContext && navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(text)
            ElMessage.success('已复制到剪贴板')
            return
        } catch (e) {
            console.error('Copy failed', e)
        }
    }
    
    copyContent.value = text
    showCopyDialog.value = true
    nextTick(() => {
        copyInputRef.value?.focus()
        copyInputRef.value?.select()
    })
}

const modeOptions = [
    { label: '全局', value: 'all' },
    { label: '白名单', value: 'allow' },
    { label: '黑名单', value: 'deny' }
]

const currentMode = computed(() =>
    characterKind.value === 'private'
        ? props.draft.characterPrivateMode
        : props.draft.characterGroupMode
)

const currentIdArray = computed(() => {
    return characterKind.value === 'private'
        ? props.draft.characterPrivateIds
        : props.draft.characterGroupIds
})

function addId() {
    const val = idInput.value.trim()
    if (!val) return
    const ids = val.split(/[\n,]/g).map(v => v.trim()).filter(Boolean)
    
    if (characterKind.value === 'private') {
        const set = new Set(props.draft.characterPrivateIds)
        ids.forEach(id => set.add(id))
        props.draft.characterPrivateIds = Array.from(set)
    } else {
        const set = new Set(props.draft.characterGroupIds)
        ids.forEach(id => set.add(id))
        props.draft.characterGroupIds = Array.from(set)
    }
    idInput.value = ''
}

function removeId(id: string) {
    if (characterKind.value === 'private') {
        props.draft.characterPrivateIds = props.draft.characterPrivateIds.filter(i => i !== id)
    } else {
        props.draft.characterGroupIds = props.draft.characterGroupIds.filter(i => i !== id)
    }
}

const currentListLabel = computed(() => {
    if (characterKind.value === 'private') {
        return currentMode.value === 'allow'
            ? '要启用的私聊 ID 列表'
            : '要禁用的私聊 ID 列表'
    }

    return currentMode.value === 'allow'
        ? '要启用的群聊 ID 列表'
        : '要禁用的群聊 ID 列表'
})

const scopeValues = computed({
    get: () =>
        props.draft.subAgents.mode === 'deny'
            ? props.draft.subAgents.deny
            : props.draft.subAgents.allow,
    set: (value: string[]) => {
        const next = value.filter(
            (item, idx, list) => item.length > 0 && list.indexOf(item) === idx
        )
        if (props.draft.subAgents.mode === 'deny') {
            props.draft.subAgents.deny = next
            props.draft.subAgents.allow = []
            return
        }

        props.draft.subAgents.allow = next
        props.draft.subAgents.deny = []
    }
})

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
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--k-color-divider), #71717a 40%)
        transparent;
    white-space: nowrap;
}

.tabs-underline::-webkit-scrollbar {
    height: 6px;
}

.tabs-underline::-webkit-scrollbar-track {
    background: transparent;
}

.tabs-underline::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--k-color-divider), #71717a 40%);
    border-radius: 10px;
    border: 1px solid transparent;
    background-clip: content-box;
}

.tabs-underline::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--k-color-divider), #52525b 58%);
    background-clip: content-box;
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

.field-label,
.field-subtitle {
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

.inner-tabs {
    display: inline-flex;
    align-items: center;
    gap: 16px;
}

.inner-tab {
    font-size: 14px;
    color: var(--k-text-light);
    cursor: pointer;
    font-weight: 600;
    transition: color 0.2s;
}

.inner-tab:hover {
    color: var(--k-text-dark);
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

.id-tag-close {
    cursor: pointer;
    font-size: 12px;
    opacity: 0.6;
    transition: opacity 0.2s;
}

.id-tag-close:hover {
    opacity: 1;
}

.id-input-row {
    display: flex;
    align-items: center;
    background-color: color-mix(in srgb, var(--k-page-bg), transparent 30%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--k-color-divider), transparent 40%) inset;
    border-radius: 8px;
    padding: 4px;
    height: auto;
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

.id-native-input::placeholder {
    color: color-mix(in srgb, var(--k-text-light), transparent 40%);
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
    transition: background-color 0.2s;
}

.id-submit-btn:hover {
    background-color: color-mix(in srgb, var(--k-text-light), transparent 70%);
}

.tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
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

    .scope-row {
        flex-direction: column;
        align-items: flex-start;
    }
    
    .scope-grid {
        flex-direction: column;
        align-items: stretch;
    }
    
    .scope-grid .el-select {
        width: 100% !important;
    }
}

.field-help code {
    background-color: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 50%);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: var(--font-family-monospace, monospace);
    color: var(--k-text-dark);
}

:deep(.el-segmented__item:hover) {
    background-color: color-mix(in srgb, var(--k-text-light), transparent 85%) !important;
}

.tag-item {
    border: 1px solid color-mix(in srgb, var(--k-color-primary), transparent 40%);
    background-color: transparent !important;
    border-radius: 6px;
    padding: 0 10px;
    height: 24px;
    color: var(--k-color-primary) !important;
}

.copy-icon {
    cursor: pointer;
    font-size: 14px;
    color: var(--k-text-light);
    transition: color 0.2s, background-color 0.2s;
    padding: 4px;
    border-radius: 4px;
}

.copy-icon:hover {
    color: var(--k-color-primary);
    background-color: color-mix(in srgb, var(--k-color-primary), transparent 90%);
}
</style>
