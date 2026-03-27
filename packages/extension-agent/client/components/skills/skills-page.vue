<template>
    <div class="skills-page" :class="{ compact: compactMode }">
        <div class="toolbar-container">
            <div class="toolbar-main" v-if="currentView === 'list'">
                <div class="headline">
                    <div class="page-title">Skills</div>
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

        <div class="page-content" v-loading="loading">
            <Transition name="page-swap" mode="out-in">
                <skills-detail
                    v-if="currentView === 'detail' && selectedSkill"
                    key="detail"
                    :skill="selectedSkill"
                    :draft="draft.items[selectedSkill.id]"
                    :agent-options="agentOptions"
                    @back="currentView = 'list'"
                    @save="saveSelected"
                />

                <div v-else key="list" class="panel catalog-panel">
                    <div class="panel-header catalog-header">
                        <div class="catalog-header-content">
                            <div class="catalog-header-info">
                                <div class="panel-title">Skills 列表</div>
                                <div class="panel-description">
                                    ChatLuna 目前可用的全部 Skills。
                                </div>
                            </div>

                            <div class="catalog-actions">
                                <el-button v-if="mobile" @click="showImportDialog = true">
                                    导入
                                </el-button>
                                <el-button v-else @click="showMarkdownDialog = true">
                                    从 Markdown 导入
                                </el-button>
                                <el-button v-if="!mobile" @click="showGithubDialog = true">
                                    从 Github 导入
                                </el-button>
                                <el-button v-if="!mobile" @click="showFolderDialog = true">
                                    从本地文件导入
                                </el-button>
                                <el-button @click="showSettingsDialog = true">
                                    管理设置
                                </el-button>
                            </div>
                        </div>

                        <div class="search-row">
                            <el-popover
                                placement="bottom-start"
                                trigger="click"
                                popper-class="skills-filter-popper"
                            >
                                <template #reference>
                                    <el-button class="filter-trigger" plain>
                                        {{ filters.length > 0 ? `筛选 ${filters.length}` : '筛选' }}
                                    </el-button>
                                </template>

                                <div class="filter-panel">
                                    <el-checkbox-group v-model="filters">
                                        <div class="filter-list">
                                            <el-checkbox
                                                v-for="item in filterOptions"
                                                :key="item.value"
                                                :label="item.value"
                                            >
                                                {{ item.label }}
                                            </el-checkbox>
                                        </div>
                                    </el-checkbox-group>

                                    <div class="filter-panel-actions">
                                        <el-button
                                            size="small"
                                            text
                                            :disabled="filters.length === 0"
                                            @click="filters = []"
                                        >
                                            清空
                                        </el-button>
                                    </div>
                                </div>
                            </el-popover>

                            <el-input
                                v-model="keyword"
                                class="search-input"
                                placeholder="搜索技能名称、描述、来源或路径"
                                clearable
                            >
                                <template #prefix>
                                    <el-icon><Search /></el-icon>
                                </template>
                            </el-input>
                        </div>
                    </div>

                    <div v-if="filteredSkills.length > 0" class="card-list" :class="{ compact: compactMode }">
                        <div
                            v-for="item in filteredSkills"
                            :key="item.id"
                            class="skill-card"
                            :class="{ centered: hideDesc, muted: !item.enabled, invalid: item.state !== 'ready', readonly: isReadonly(item) }"
                            :tabindex="isReadonly(item) ? -1 : 0"
                            :role="isReadonly(item) ? undefined : 'button'"
                            :aria-disabled="isReadonly(item)"
                            @click="!isReadonly(item) && openEditor(item.id)"
                            @keydown="handleCardKeydown($event, item)"
                        >
                            <div class="skill-top">
                                <div class="skill-brand">
                                    <div class="skill-icon">
                                        <el-icon :size="16"><MagicStick /></el-icon>
                                    </div>

                                    <div class="skill-copy">
                                        <div class="skill-title">
                                            {{ item.emoji ? `${item.emoji} ${item.name}` : item.name }}
                                        </div>
                                        <div v-if="!hideDesc" class="skill-name">
                                            {{ item.source }} / {{ item.scope }}
                                        </div>
                                    </div>
                                </div>

                                <el-switch
                                    :model-value="item.enabled"
                                    :disabled="isReadonly(item)"
                                    @change="setEnabled(item.id, $event as boolean)"
                                    @click.stop
                                />
                            </div>

                            <div v-if="!hideDesc" class="skill-description">
                                {{ item.description || '这个技能暂时没有说明。' }}
                            </div>

                            <div class="skill-footer">
                                <div class="skill-chips">
                                    <el-tag size="small" effect="plain" :type="item.available ? 'success' : 'warning'">
                                        {{ item.available ? '环境就绪' : '缺少依赖' }}
                                    </el-tag>
                                    <el-tag size="small" effect="plain" :type="item.mode === 'full' ? 'primary' : 'success'">
                                        {{ item.mode === 'full' ? '全文注入' : '描述注入' }}
                                    </el-tag>
                                    <el-tag size="small" effect="plain" :type="item.main ? 'success' : 'info'">
                                        {{ item.main ? '主 Agent 启用' : '主 Agent 禁用' }}
                                    </el-tag>
                                    <el-tag size="small" effect="plain" :type="item.chatlunaEnabled ? 'success' : 'info'">
                                        {{ item.chatlunaEnabled ? 'ChatLuna 启用' : 'ChatLuna 禁用' }}
                                    </el-tag>
                                    <el-tag size="small" effect="plain" :type="item.characterEnabled ? 'success' : 'info'">
                                        {{ item.characterEnabled ? 'Character 启用' : 'Character 禁用' }}
                                    </el-tag>
                                    <el-tag size="small" effect="plain" :type="subAgentModeType(item.subAgents.mode)">
                                        {{ subAgentModeLabel(item.subAgents.mode) }}
                                    </el-tag>
                                </div>

                                <div v-if="!hideDesc" class="skill-meta">{{ item.path || '当前没有可用路径' }}</div>

                                <div v-if="!hideDesc && item.homepage" class="skill-meta">
                                    主页：{{ item.homepage }}
                                </div>

                                <div v-if="!hideDesc && item.compatibility" class="skill-meta">
                                    兼容性：{{ item.compatibility }}
                                </div>

                                <div v-if="!hideDesc && formatRequires(item)" class="skill-meta">
                                    依赖要求：{{ formatRequires(item) }}
                                </div>

                                <div v-if="!hideDesc && formatInstall(item)" class="skill-meta">
                                    安装方式：{{ formatInstall(item) }}
                                </div>

                                <div class="skill-actions" @click.stop>
                                    <div class="skill-actions-main">
                                        <el-button
                                            size="small"
                                            plain
                                            :disabled="!item.path || isReadonly(item)"
                                            @click.stop="previewSkill(item)"
                                        >
                                            查看/编辑内容
                                        </el-button>
                                        <el-button size="small" plain :disabled="!canExport(item)" @click.stop="exportSkill(item)">
                                            导出 ZIP
                                        </el-button>
                                        <el-button
                                            class="danger-soft"
                                            size="small"
                                            plain
                                            type="danger"
                                            :loading="skillBusy[item.id] === true"
                                            :disabled="!canRemove(item)"
                                            @click.stop="removeSkill(item)"
                                        >
                                            删除
                                        </el-button>
                                        <el-button
                                            v-if="hasDiagnostics(item)"
                                            class="warning-soft"
                                            size="small"
                                            plain
                                            @click.stop="openDiagnostics(item)"
                                        >
                                            错误信息
                                        </el-button>
                                        <el-button v-if="item.homepage" size="small" plain @click.stop="openLink(item.homepage)">
                                            打开主页
                                        </el-button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div v-else class="empty-state">
                        <el-empty description="没有找到匹配的技能。" />
                    </div>
                </div>
            </Transition>
        </div>

        <skills-settings-dialog
            v-model:visible="showSettingsDialog"
            :config="config"
            :status="status"
            :computer="computer"
            @refresh="$emit('refresh')"
        />

        <skills-import-github-dialog
            v-model:visible="showGithubDialog"
            :config="config"
            @refresh="$emit('refresh')"
        />

        <skills-import-folder-dialog
            v-model:visible="showFolderDialog"
            @refresh="$emit('refresh')"
        />

        <skills-import-markdown-dialog
            v-model:visible="showMarkdownDialog"
            @refresh="$emit('refresh')"
        />

        <skills-diagnostics-dialog
            v-model:visible="showDiagnosticsDialog"
            :skill="diagnosticSkill"
        />

        <el-dialog
            v-model="showImportDialog"
            title="选择导入方式"
            width="min(420px, calc(100vw - 24px))"
            :fullscreen="mobile"
            destroy-on-close
        >
            <div class="import-dialog-actions">
                <el-button @click="openImport('markdown')">从 Markdown 导入</el-button>
                <el-button @click="openImport('github')">从 Github 导入</el-button>
                <el-button @click="openImport('folder')">从本地文件导入</el-button>
            </div>
        </el-dialog>

        <el-dialog v-model="showPreview" title="查看/编辑技能内容" width="720px" destroy-on-close>
            <div class="preview-meta">{{ previewTitle }}</div>
            <code-editor
                v-model="previewContent"
                :language="previewLanguage"
                :readonly="isReadonly(previewItem) || previewItem?.remote"
                :min-height="400"
            />
            <template #footer>
                <el-button @click="showPreview = false">取消</el-button>
                <el-button
                    type="primary"
                    :loading="savingContent"
                    :disabled="isReadonly(previewItem) || previewItem?.remote || previewContent === originalContent"
                    @click="saveContent"
                >
                    保存
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MagicStick, Search } from '@element-plus/icons-vue'
import CodeEditor from '../shared/code-editor.vue'
import { useCompactMode, useHideDesc } from '../shared/use-hide-desc'
import SkillsDetail from './skills-detail.vue'
import SkillsDiagnosticsDialog from './skills-diagnostics-dialog.vue'
import SkillsImportFolderDialog from './skills-import-folder-dialog.vue'
import SkillsImportGithubDialog from './skills-import-github-dialog.vue'
import SkillsImportMarkdownDialog from './skills-import-markdown-dialog.vue'
import SkillsSettingsDialog from './skills-settings-dialog.vue'
import type {
    ComputerStatus,
    PermissionRule,
    SkillConfig,
    SkillExportResult,
    SkillInfo,
    SkillsConfig,
    SkillsStatus,
    SubAgentInfo
} from '../../../src/types'

function formatError(error: unknown) {
    return String(error instanceof Error ? error.message : error)
        .replace(/^Error:\s*/, '')
        .split('\n')[0]
        .trim()
}

const props = withDefaults(
    defineProps<{
        config: SkillsConfig
        status: SkillsStatus
        agents: Record<string, SubAgentInfo>
        computer?: ComputerStatus
        loading?: boolean
    }>(),
    {
        config: () => ({
            dirs: [
                '~/.agents/skills',
                '~/.codex/skills',
                '~/.claude/skills',
                '~/.config/opencode/skills'
            ],
            items: {},
            githubToken: ''
        }),
        status: () => ({
            enabled: true,
            root: '',
            total: 0,
            visible: 0,
            modelEnabled: 0,
            activeConversations: 0,
            catalog: {}
        }),
        agents: () => ({}),
        computer: undefined,
        loading: false
    }
)

const emit = defineEmits<{
    refresh: []
    save: [value: SkillsConfig]
}>()

const keyword = ref('')
const filters = ref<string[]>([])
const compactMode = useCompactMode('skills')
const hideDesc = useHideDesc('skills')
const selectedId = ref('')
const currentView = ref<'list' | 'detail'>('list')
const draft = ref<SkillsConfig>(cloneConfig(props.config))
const localDirty = ref(false)

const filterOptions = [
    { label: '启用', value: 'enabled:yes' },
    { label: '禁用', value: 'enabled:no' },
    { label: '描述模式', value: 'mode:description' },
    { label: '全文注入', value: 'mode:full' },
    { label: '主 Agent 启用', value: 'main:yes' },
    { label: '主 Agent 禁用', value: 'main:no' },
    { label: '环境就绪', value: 'available:yes' },
    { label: '缺少依赖', value: 'available:no' },
    { label: '有诊断', value: 'diagnostics:yes' }
]

const showSettingsDialog = ref(false)
const showGithubDialog = ref(false)
const showFolderDialog = ref(false)
const showMarkdownDialog = ref(false)
const showImportDialog = ref(false)
const showDiagnosticsDialog = ref(false)
const showPreview = ref(false)
const diagnosticSkill = ref<SkillInfo>()
const previewTitle = ref('')
const previewContent = ref('')
const originalContent = ref('')
const previewLanguage = ref('plaintext')
const previewItem = ref<SkillInfo>()
const savingContent = ref(false)
const skillBusy = ref<Record<string, boolean>>({})
const mobile = ref(false)

function syncMobile() {
    mobile.value = window.innerWidth <= 768
}

onMounted(() => {
    syncMobile()
    window.addEventListener('resize', syncMobile)
})

onBeforeUnmount(() => {
    window.removeEventListener('resize', syncMobile)
})

watch(
    () => props.config,
    (value) => {
        const next = cloneConfig(value)
        if (JSON.stringify(draft.value) === JSON.stringify(next)) {
            localDirty.value = false
            draft.value = next
            return
        }

        if (localDirty.value) {
            return
        }

        draft.value = next
    },
    { immediate: true, deep: true }
)

const agentOptions = computed(() => {
    return Object.values(props.agents).sort((a, b) => {
        if (a.priority !== b.priority) {
            return a.priority - b.priority
        }

        return a.name.localeCompare(b.name)
    })
})

const skills = computed(() => {
    return Object.values(props.status.catalog)
        .map((item) => {
            const saved = draft.value.items[item.id]
            return {
                ...item,
                enabled: saved?.enabled ?? item.enabled,
                mode: saved?.enabled === false ? 'off' : (saved?.mode ?? item.mode),
                authority: saved?.authority ?? item.authority,
                main: saved?.main ?? item.main,
                chatlunaEnabled: saved?.chatluna ?? item.chatlunaEnabled,
                characterEnabled: saved?.character ?? item.characterEnabled,
                characterGroupEnabled: saved?.characterGroup ?? item.characterGroupEnabled,
                characterPrivateEnabled: saved?.characterPrivate ?? item.characterPrivateEnabled,
                characterGroupMode: saved?.characterGroupMode ?? item.characterGroupMode,
                characterPrivateMode: saved?.characterPrivateMode ?? item.characterPrivateMode,
                characterGroupIds: saved?.characterGroupIds ?? item.characterGroupIds,
                characterPrivateIds: saved?.characterPrivateIds ?? item.characterPrivateIds,
                subAgents: cloneRule(saved?.subAgents ?? item.subAgents)
            }
        })
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
})

const filteredSkills = computed(() => {
    const text = keyword.value.trim().toLowerCase()

    return skills.value.filter((item) => {
        if (
            filters.value.length > 0 &&
            !filters.value.every((value) => {
                if (value === 'enabled:yes') return item.enabled
                if (value === 'enabled:no') return !item.enabled
                if (value === 'mode:description') return item.mode === 'description'
                if (value === 'mode:full') return item.mode === 'full'
                if (value === 'main:yes') return item.main
                if (value === 'main:no') return !item.main
                if (value === 'available:yes') return item.available
                if (value === 'available:no') return !item.available
                if (value === 'diagnostics:yes') return item.diagnostics.length > 0
                return true
            })
        ) {
            return false
        }

        if (!text) {
            return true
        }

        return [
            item.name,
            item.description,
            item.path,
            item.source,
            item.scope,
            item.homepage,
            formatRequires(item),
            formatInstall(item),
            ...(item.diagnostics ?? [])
        ]
            .join('\n')
            .toLowerCase()
            .includes(text)
    })
})

const selectedSkill = computed(() => {
    return skills.value.find((item) => item.id === selectedId.value)
})

const dirty = computed(() => {
    return (
        JSON.stringify(normalizeConfig(draft.value)) !==
        JSON.stringify(normalizeConfig(props.config))
    )
})

function openEditor(id: string) {
    const item = skills.value.find((value) => value.id === id)
    if (!item || isReadonly(item)) {
        return
    }

    selectedId.value = id
    if (!draft.value.items[id]) {
        draft.value.items[id] = createItem(item)
    }
    currentView.value = 'detail'
}

function setEnabled(id: string, enabled: boolean) {
    const item = skills.value.find((value) => value.id === id)
    if (!item || isReadonly(item)) {
        return
    }

    if (!draft.value.items[id]) {
        draft.value.items[id] = createItem(item)
    }

    draft.value.items[id].enabled = enabled
    scheduleSave()
}

function saveSelected() {
    scheduleSave()
}

function handleCardKeydown(event: KeyboardEvent, item: SkillInfo) {
    if (isReadonly(item)) {
        return
    }

    if (event.key !== 'Enter' && event.key !== ' ') {
        return
    }

    event.preventDefault()
    openEditor(item.id)
}

function saveDraft() {
    emit('save', normalizeConfig(draft.value))
}

function scheduleSave() {
    if (!dirty.value) return
    localDirty.value = true
    saveDraft()
}

function subAgentModeLabel(mode: PermissionRule['mode']) {
    if (mode === 'allow') return '仅指定 sub-agent'
    if (mode === 'deny') return '排除指定 sub-agent'
    return '全部 sub-agent'
}

function subAgentModeType(mode: PermissionRule['mode']) {
    if (mode === 'allow') return 'success'
    if (mode === 'deny') return 'warning'
    return 'info'
}

function cloneConfig(value: SkillsConfig): SkillsConfig {
    return normalizeConfig(value)
}

function normalizeConfig(value: SkillsConfig): SkillsConfig {
    return {
        dirs: [...(value.dirs ?? [])],
        githubToken: value.githubToken ?? '',
        items: Object.fromEntries(
            Object.entries(value.items ?? {}).map(([id, item]) => [id, createItem(item)])
        )
    }
}

function createItem(item?: Partial<SkillConfig> | SkillInfo): SkillConfig {
    return {
        enabled: item?.enabled !== false,
        mode: item?.mode === 'full' ? 'full' : 'description',
        authority: (item as SkillConfig | undefined)?.authority ?? (item as SkillInfo | undefined)?.authority ?? 0,
        remote: (item as SkillConfig | undefined)?.remote === true,
        main: (item as SkillConfig | undefined)?.main !== false,
        chatluna: (item as SkillConfig | undefined)?.chatluna ?? (item as SkillInfo | undefined)?.chatlunaEnabled ?? true,
        character: (item as SkillConfig | undefined)?.character ?? (item as SkillInfo | undefined)?.characterEnabled ?? true,
        characterGroup: (item as SkillConfig | undefined)?.characterGroup ?? (item as SkillInfo | undefined)?.characterGroupEnabled ?? true,
        characterPrivate: (item as SkillConfig | undefined)?.characterPrivate ?? (item as SkillInfo | undefined)?.characterPrivateEnabled ?? true,
        characterGroupMode:
            (item as SkillConfig | undefined)?.characterGroupMode === 'allow' ||
            (item as SkillConfig | undefined)?.characterGroupMode === 'deny'
                ? (item as SkillConfig).characterGroupMode
                : ((item as SkillInfo | undefined)?.characterGroupMode ?? 'all'),
        characterPrivateMode:
            (item as SkillConfig | undefined)?.characterPrivateMode === 'allow' ||
            (item as SkillConfig | undefined)?.characterPrivateMode === 'deny'
                ? (item as SkillConfig).characterPrivateMode
                : ((item as SkillInfo | undefined)?.characterPrivateMode ?? 'all'),
        characterGroupIds: [...(((item as SkillConfig | undefined)?.characterGroupIds ?? (item as SkillInfo | undefined)?.characterGroupIds) ?? [])],
        characterPrivateIds: [...(((item as SkillConfig | undefined)?.characterPrivateIds ?? (item as SkillInfo | undefined)?.characterPrivateIds) ?? [])],
        subAgents: cloneRule((item as SkillConfig | undefined)?.subAgents ?? (item as SkillInfo | undefined)?.subAgents)
    }
}

function cloneRule(rule?: PermissionRule): PermissionRule {
    return {
        mode: rule?.mode ?? 'all',
        allow: [...(rule?.allow ?? [])],
        deny: [...(rule?.deny ?? [])]
    }
}

async function previewSkill(item: SkillInfo) {
    if (isReadonly(item)) {
        ElMessage.warning('当前 Skill 缺少依赖或状态异常，暂时不能打开。')
        return
    }

    try {
        const result = await send('chatluna-agent/getSkillContent', item.id)
        previewItem.value = item
        previewTitle.value = item.name
        originalContent.value = result?.content ?? ''
        previewContent.value = result?.content ?? ''
        previewLanguage.value = inferLanguage(item.path)
        showPreview.value = true
    } catch {
        ElMessage.error('读取技能内容失败，请稍后重试。')
    }
}

async function saveContent() {
    if (!previewItem.value) return

    try {
        await ElMessageBox.confirm('确定要保存对该 Skill 内容的修改吗？', '确认保存', {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
        })
    } catch {
        return
    }

    try {
        savingContent.value = true
        await send('chatluna-agent/saveSkillContent', previewItem.value.id, previewContent.value)
        originalContent.value = previewContent.value
        ElMessage.success('保存成功。')
        showPreview.value = false
        emit('refresh')
    } catch (error) {
        ElMessage.error(`保存失败: ${formatError(error)}`)
    } finally {
        savingContent.value = false
    }
}

function inferLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase()
    const map: Record<string, string> = {
        md: 'markdown',
        yaml: 'yaml',
        yml: 'yaml',
        json: 'json',
        js: 'javascript',
        ts: 'typescript',
        py: 'python',
        sh: 'shell',
        txt: 'plaintext'
    }
    return map[ext ?? ''] ?? 'plaintext'
}

function openImport(type: 'markdown' | 'github' | 'folder') {
    showImportDialog.value = false

    if (type === 'markdown') {
        showMarkdownDialog.value = true
        return
    }

    if (type === 'github') {
        showGithubDialog.value = true
        return
    }

    showFolderDialog.value = true
}

async function exportSkill(item: SkillInfo) {
    try {
        const result = await send('chatluna-agent/exportSkill', item.id)
        if (!result) {
            ElMessage.warning('这个技能暂时不能导出。')
            return
        }

        downloadExport(result)
        ElMessage.success('已开始下载技能 ZIP。')
    } catch {
        ElMessage.error('导出失败，请稍后重试。')
    }
}

async function removeSkill(item: SkillInfo) {
    try {
        await ElMessageBox.confirm(
            item.state === 'missing'
                ? `确定要移除这个残留的 skill 配置项吗？\n\n${item.id}`
                : `删除"${item.name}"后需要重新导入，确定继续吗？`,
            '删除 Skill',
            {
                confirmButtonText: '删除',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )

        skillBusy.value[item.id] = true
        await send('chatluna-agent/removeSkill', item.id)
        emit('refresh')
        ElMessage.success(item.state === 'missing' ? '已移除残留的 skill 配置。' : '已删除该 skill。')
    } catch (error) {
        if (error !== 'cancel' && error !== 'close') {
            ElMessage.error('删除失败，请稍后重试。')
        }
    } finally {
        skillBusy.value[item.id] = false
    }
}

function canExport(item: SkillInfo) {
    return item.path.length > 0 && item.state !== 'missing' && !item.remote
}

function canRemove(item: SkillInfo) {
    if (item.state === 'missing') {
        return true
    }

    if (item.remote) {
        return true
    }

    return item.source === 'chatluna' && item.scope === 'data'
}

function hasDiagnostics(item: SkillInfo) {
    return isReadonly(item) || item.diagnostics.length > 0
}

function isReadonly(item?: SkillInfo) {
    if (!item) {
        return true
    }

    return item.state !== 'ready' || !item.available
}

function openDiagnostics(item: SkillInfo) {
    diagnosticSkill.value = item
    showDiagnosticsDialog.value = true
}

function formatRequires(item: SkillInfo) {
    const bins = item.requires?.bins?.filter((bin) => bin !== 'clawhub') ?? []

    return [
        bins.length ? `bins: ${bins.join(', ')}` : '',
        item.requires?.anyBins?.length ? `anyBins: ${item.requires.anyBins.join(', ')}` : '',
        item.requires?.env?.length ? `env: ${item.requires.env.join(', ')}` : '',
        item.requires?.config?.length ? `config: ${item.requires.config.join(', ')}` : ''
    ]
        .filter(Boolean)
        .join(' | ')
}

function formatInstall(item: SkillInfo) {
    return (
        item.install
            ?.filter(
                (entry) =>
                    entry.label !== 'Install ClawHub CLI (npm)' &&
                    entry.id !== 'clawhub'
            )
            ?.map((entry) => entry.label ?? `${entry.kind}: ${entry.id}`)
            .join('；') ?? ''
    )
}

function openLink(url: string) {
    const value = url.trim()

    try {
        const parsed = new URL(value)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            ElMessage.warning('当前主页链接不是 http 或 https 地址。')
            return
        }

        window.open(parsed.toString(), '_blank', 'noopener,noreferrer')
    } catch {
        ElMessage.warning('当前主页链接格式无效。')
    }
}

function downloadExport(result: SkillExportResult) {
    const blob = base64ToBlob(result.data, 'application/zip')
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = result.fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
}

function base64ToBlob(data: string, type: string) {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)

    for (let idx = 0; idx < binary.length; idx++) {
        bytes[idx] = binary.charCodeAt(idx)
    }

    return new Blob([bytes], { type })
}
</script>

<style scoped>
.skills-page {
    min-height: 100%;
    width: 100%;
    min-width: 0;
    margin: 0 auto;
    padding-bottom: 56px;
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

.mobile-only-desc-toggle {
    display: none;
}

.page-title {
    font-size: 24px;
    font-weight: 600;
    color: var(--k-text-dark);
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

.panel {
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    overflow: hidden;
    box-sizing: border-box;
}

.catalog-panel {
    margin-top: 18px;
    padding-bottom: 18px;
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 20%);
    box-sizing: border-box;
}

.catalog-header-content {
    display: flex;
    align-items: center;
    gap: 24px;
    flex-wrap: wrap;
    justify-content: flex-start;
    flex: 1 1 auto;
    min-width: 0;
}

.catalog-header-info {
    flex: 0 0 auto;
    min-width: 0;
}

.panel-title {
    font-size: 17px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-description,
.skill-name,
.skill-description,
.skill-meta,
.preview-meta {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
}

.catalog-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-start;
}

.search-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    width: auto;
    flex-wrap: nowrap;
    flex: 0 1 420px;
    min-width: 220px;
}

.filter-trigger {
    height: 32px;
    min-width: 92px;
    padding-inline: 12px;
    flex: 0 0 auto;
}

.search-input {
    width: auto;
    min-width: 0;
    flex: 1 1 260px;
}

.filter-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: max-content;
    min-width: 0;
}

.filter-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
}

.filter-list :deep(.el-checkbox) {
    margin-right: 0;
}

.filter-list :deep(.el-checkbox__label) {
    padding-left: 8px;
    white-space: nowrap;
}

.filter-panel-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 4px;
    border-top: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 28%);
}

.import-dialog-actions {
    display: grid;
    gap: 10px;
}

.import-dialog-actions :deep(.el-button) {
    width: 100%;
    margin: 0;
}

:global(.skills-filter-popper.el-popover) {
    width: max-content !important;
    min-width: 0 !important;
    padding: 12px;
}

.card-list {
    --card-cols: 5;
    display: grid;
    grid-template-columns: repeat(var(--card-cols), minmax(0, 1fr));
    gap: 16px;
    padding: 16px;
    box-sizing: border-box;
}

.card-list.compact {
    --card-cols: 4;
}

.skill-card {
    border: 1px solid color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 12px;
    background: color-mix(in srgb, var(--k-activity-bg), var(--k-page-bg) 16%);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    box-sizing: border-box;
    cursor: pointer;
    transition: border-color 0.2s ease, transform 0.2s ease;
}

.skill-card:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 40%);
    transform: translateY(-1px);
}

.skill-card.muted {
    opacity: 0.72;
}

.skill-card.readonly {
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 30%);
    border-style: dashed;
    cursor: default;
}

.skill-card.invalid {
    border-color: color-mix(in srgb, var(--el-color-warning), transparent 66%);
}

.skill-card.readonly:hover {
    border-color: color-mix(in srgb, var(--k-color-divider), transparent 18%);
    transform: none;
}

.skill-top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
}

.skill-card.centered .skill-top {
    align-items: center;
    min-height: 34px;
}

.skill-brand {
    display: flex;
    justify-content: flex-start;
    gap: 12px;
    min-width: 0;
    flex: 1 1 auto;
}

.skill-card.centered .skill-brand {
    align-items: center;
}

.skill-copy {
    min-width: 0;
    flex: 1 1 auto;
}

.skill-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--k-text-dark);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.skill-icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-color-primary) 8%);
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 36%);
    flex: 0 0 auto;
}

.skill-description {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.card-list.compact .skill-description {
    -webkit-line-clamp: 2;
}

.skill-footer {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.skill-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.skill-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.skill-actions-main {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
    gap: 8px;
}

.skill-actions-main :deep(.el-button) {
    width: 100%;
    min-width: 0;
    margin: 0;
}

.skill-actions-main :deep(.danger-soft.el-button) {
    --el-button-bg-color: color-mix(in srgb, var(--el-color-danger), transparent 92%);
    --el-button-border-color: color-mix(in srgb, var(--el-color-danger), transparent 68%);
    --el-button-text-color: color-mix(in srgb, var(--el-color-danger), var(--k-text-dark) 22%);
}

.skill-actions-main :deep(.warning-soft.el-button) {
    --el-button-bg-color: color-mix(in srgb, var(--el-color-warning), transparent 90%);
    --el-button-border-color: color-mix(in srgb, var(--el-color-warning), transparent 58%);
    --el-button-text-color: color-mix(in srgb, var(--el-color-warning), var(--k-text-dark) 24%);
}

.empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 320px;
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

@media (max-width: 1680px) {
    .card-list {
        --card-cols: 4;
    }

    .card-list.compact {
        --card-cols: 3;
    }
}

@media (max-width: 1320px) {
    .card-list {
        --card-cols: 3;
    }

    .card-list.compact {
        --card-cols: 2;
    }
}

@media (max-width: 1080px) {
    .card-list {
        --card-cols: 2;
    }

    .card-list.compact {
        --card-cols: 1;
    }
}

@media (max-width: 768px) {
    .toolbar-main,
    .catalog-header,
    .catalog-header-content {
        flex-direction: column;
        align-items: flex-start;
    }

    .catalog-header {
        gap: 14px;
    }

    .catalog-header-content {
        gap: 16px;
    }

    .headline {
        justify-content: space-between;
        width: 100%;
        box-sizing: border-box;
    }

    .mobile-only-desc-toggle {
        display: inline-flex;
    }

    .hidden-mobile {
        display: none;
    }

    .actions-section,
    .catalog-actions {
        width: 100%;
        justify-content: flex-start;
    }

    .catalog-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
    }

    .catalog-actions :deep(.el-button) {
        width: 100%;
        min-width: 0;
        margin: 0;
        justify-content: center;
        white-space: normal;
        line-height: 1.3;
    }

    .search-row {
        width: 100%;
        min-width: 0;
        flex: none;
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        align-items: stretch;
    }

    .filter-trigger {
        min-width: 0;
        width: 100%;
        flex: none;
    }

    .search-input {
        width: 100% !important;
        min-width: 0;
        flex: none;
    }

    .search-input :deep(.el-input__wrapper) {
        min-height: 32px;
    }

    .card-list,
    .card-list.compact {
        --card-cols: 1;
    }
}
</style>
