<template>
    <div
        class="skills-page"
        :class="{ compact: compactMode }"
    >
        <div class="toolbar-container">
            <div class="toolbar-main">
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
                    <el-button @click="showGithubDialog = true">
                        从 Github 导入
                    </el-button>
                    <el-button @click="showFolderDialog = true">
                        从本地文件导入
                    </el-button>
                    <el-button @click="showSettingsDialog = true">
                        管理设置
                    </el-button>
                </div>
            </div>
        </div>

        <div class="page-content" v-loading="loading">
            <div class="panel catalog-panel">
                <div class="panel-header catalog-header">
                    <div>
                        <div class="panel-title">Skills 列表</div>
                        <div class="panel-description">
                            ChatLuna 目前可用的全部 Skills。
                        </div>
                    </div>

                    <div class="catalog-actions">
                        <el-input
                            v-model="filterText"
                            class="search-input"
                            placeholder="搜索技能名称、描述或路径"
                            clearable
                        >
                            <template #prefix>
                                <el-icon><Search /></el-icon>
                            </template>
                        </el-input>
                    </div>
                </div>

                <div
                    v-if="filteredSkills.length > 0"
                    class="card-list"
                    :class="{ compact: compactMode }"
                >
                    <div
                        v-for="item in filteredSkills"
                        :key="item.id"
                        class="skill-card"
                        :class="{
                            centered: hideDesc,
                            muted: !item.visible,
                            invalid: item.state !== 'ready',
                            readonly: isReadonly(item)
                        }"
                    >
                        <div class="skill-top">
                            <div class="skill-brand">
                                <div class="skill-icon">
                                    <el-icon :size="16"><MagicStick /></el-icon>
                                </div>

                                <div class="skill-copy">
                                    <div class="skill-title">
                                        {{
                                            item.emoji
                                                ? `${item.emoji} ${item.name}`
                                                : item.name
                                        }}
                                    </div>
                                    <div v-if="!hideDesc" class="skill-name">
                                        {{ `${item.source} / ${item.scope}` }}
                                    </div>
                                </div>
                            </div>

                            <el-switch
                                :model-value="item.enabled"
                                :loading="skillBusy[item.id] === true"
                                :disabled="isReadonly(item)"
                                @change="
                                    (value) => toggleSkill(item, value as boolean)
                                "
                            />
                        </div>

                        <div v-if="!hideDesc" class="skill-description">
                            {{ item.description || '这个技能暂时没有说明。' }}
                        </div>

                        <div v-if="!hideDesc" class="skill-path">
                            {{ item.path || '当前没有可用路径' }}
                        </div>

                        <div class="skill-footer">
                            <div class="skill-chips">
                                <el-tag
                                    size="small"
                                    effect="plain"
                                    :type="item.available ? 'success' : 'warning'"
                                >
                                    {{ item.available ? '环境就绪' : '缺少依赖' }}
                                </el-tag>
                                <el-tag
                                    size="small"
                                    effect="plain"
                                    :type="item.modelEnabled ? 'success' : 'info'"
                                >
                                    {{
                                        item.modelEnabled
                                            ? '模型可见'
                                            : '模型不可见'
                                    }}
                                </el-tag>
                            </div>

                            <div
                                v-if="!hideDesc && item.homepage"
                                class="skill-meta"
                            >
                                主页：{{ item.homepage }}
                            </div>

                            <div
                                v-if="!hideDesc && item.compatibility"
                                class="skill-meta"
                            >
                                兼容性：{{ item.compatibility }}
                            </div>

                            <div
                                v-if="!hideDesc && formatRequires(item)"
                                class="skill-meta"
                            >
                                依赖要求：{{ formatRequires(item) }}
                            </div>

                            <div
                                v-if="!hideDesc && formatInstall(item)"
                                class="skill-meta"
                            >
                                安装方式：{{ formatInstall(item) }}
                            </div>

                            <div class="skill-actions">
                                <div class="skill-actions-main">
                                    <el-button
                                        size="small"
                                        plain
                                        :disabled="!item.path"
                                        @click="previewSkill(item)"
                                    >
                                        查看内容
                                    </el-button>
                                    <el-button
                                        size="small"
                                        plain
                                        :disabled="!canExport(item)"
                                        @click="exportSkill(item)"
                                    >
                                        导出 ZIP
                                    </el-button>
                                    <el-button
                                        class="danger-soft"
                                        size="small"
                                        plain
                                        type="danger"
                                        :loading="skillBusy[item.id] === true"
                                        :disabled="!canRemove(item)"
                                        @click="removeSkill(item)"
                                    >
                                        删除
                                    </el-button>
                                    <el-button
                                        v-if="hasDiagnostics(item)"
                                        size="small"
                                        plain
                                        type="warning"
                                        @click="openDiagnostics(item)"
                                    >
                                        错误信息
                                    </el-button>
                                    <el-button
                                        v-if="item.homepage"
                                        size="small"
                                        plain
                                        @click="openLink(item.homepage)"
                                    >
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
            @refresh="$emit('refresh')"
        />

        <skills-import-folder-dialog
            v-model:visible="showFolderDialog"
            @refresh="$emit('refresh')"
        />

        <skills-diagnostics-dialog
            v-model:visible="showDiagnosticsDialog"
            :skill="diagnosticSkill"
        />

        <el-dialog
            v-model="showPreview"
            title="技能内容"
            width="720px"
            destroy-on-close
        >
            <div class="preview-meta">{{ previewTitle }}</div>
            <code-editor
                v-model="previewContent"
                :language="previewLanguage"
                :readonly="true"
                :min-height="400"
            />
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MagicStick, Search } from '@element-plus/icons-vue'
import CodeEditor from '../shared/code-editor.vue'
import { useCompactMode, useHideDesc } from '../shared/use-hide-desc'
import SkillsDiagnosticsDialog from './skills-diagnostics-dialog.vue'
import SkillsImportFolderDialog from './skills-import-folder-dialog.vue'
import SkillsImportGithubDialog from './skills-import-github-dialog.vue'
import SkillsSettingsDialog from './skills-settings-dialog.vue'
import type {
    ComputerStatus,
    SkillExportResult,
    SkillInfo,
    SkillsConfig,
    SkillsStatus
} from '../../../src/types'

const props = withDefaults(
    defineProps<{
        config: SkillsConfig
        status: SkillsStatus
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
            items: {}
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
        computer: undefined,
        loading: false
    }
)

const emit = defineEmits<{
    refresh: []
}>()

const filterText = ref('')
const compactMode = useCompactMode('skills')
const hideDesc = useHideDesc('skills')
const skillState = ref<Record<string, boolean>>({})
const skillBusy = ref<Record<string, boolean>>({})

const showSettingsDialog = ref(false)
const showGithubDialog = ref(false)
const showFolderDialog = ref(false)
const showDiagnosticsDialog = ref(false)
const showPreview = ref(false)
const diagnosticSkill = ref<SkillInfo>()
const previewTitle = ref('')
const previewContent = ref('')
const previewLanguage = ref('plaintext')

watch(
    () => props.status.catalog,
    (value) => {
        for (const [id, enabled] of Object.entries(skillState.value)) {
            if (value[id]?.enabled === enabled) {
                delete skillState.value[id]
            }
        }
    },
    {
        deep: true,
        immediate: true
    }
)

const skills = computed(() => {
    return Object.values(props.status.catalog)
        .map((item) => {
            const enabled = skillState.value[item.id] ?? item.enabled
            return {
                ...item,
                enabled,
                visible: enabled ? item.visible : false,
                modelEnabled: enabled ? item.modelEnabled : false
            }
        })
        .sort(
            (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
        )
})

const filteredSkills = computed(() => {
    const keyword = filterText.value.trim().toLowerCase()
    if (!keyword) {
        return skills.value
    }

    return skills.value.filter((item) => {
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
            .includes(keyword)
    })
})

async function toggleSkill(item: SkillInfo, enabled: boolean) {
    const prev = skillState.value[item.id] ?? item.enabled
    skillState.value[item.id] = enabled
    skillBusy.value[item.id] = true

    try {
        await send('chatluna-agent/setSkillEnabled', item.id, enabled)
        await send('chatluna-agent/refreshConsoleData')
        ElMessage.success(enabled ? '已启用该技能。' : '已停用该技能。')
    } catch {
        skillState.value[item.id] = prev
        ElMessage.error('更新技能状态失败，请稍后重试。')
    } finally {
        skillBusy.value[item.id] = false
    }
}

async function previewSkill(item: SkillInfo) {
    try {
        const result = await send('chatluna-agent/getSkillContent', item.id)
        previewTitle.value = item.name
        previewContent.value = result?.content ?? ''
        previewLanguage.value = inferLanguage(item.path)
        showPreview.value = true
    } catch {
        ElMessage.error('读取技能内容失败，请稍后重试。')
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
        ElMessage.success(
            item.state === 'missing'
                ? '已移除残留的 skill 配置。'
                : '已删除该 skill。'
        )
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

function isReadonly(item: SkillInfo) {
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
        item.requires?.anyBins?.length
            ? `anyBins: ${item.requires.anyBins.join(', ')}`
            : '',
        item.requires?.env?.length
            ? `env: ${item.requires.env.join(', ')}`
            : '',
        item.requires?.config?.length
            ? `config: ${item.requires.config.join(', ')}`
            : ''
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
    window.open(url, '_blank', 'noopener,noreferrer')
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
    position: sticky;
    top: 0;
    z-index: 20;
    background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 18%) 0%,
        color-mix(in srgb, var(--k-page-bg), transparent 12%) 76%,
        transparent 100%
    );
    padding: 10px 0 14px;
    margin-bottom: 10px;
    backdrop-filter: blur(8px);
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

@media (max-width: 768px) {
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

    .catalog-actions {
        width: 100%;
        justify-content: flex-start;
    }
}

.page-title {
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--k-text-dark);
}

.actions-section {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
}

.panel {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    overflow: hidden;
    box-sizing: border-box;
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
}

.panel-title {
    font-size: 17px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-description {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.dir-note,
.dir-empty,
.setting-description,
.skill-name,
.skill-description,
.skill-path,
.skill-meta,
.preview-meta {
    font-size: 12px;
    color: var(--k-text-light);
    line-height: 1.6;
    word-break: break-word;
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

.dir-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.dir-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
}

.settings-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
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
    --el-button-active-bg-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 82%
    );
    --el-button-active-border-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 44%
    );
    --el-button-disabled-bg-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 95%
    );
    --el-button-disabled-border-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 82%
    );
}

.skill-footer {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.settings-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px;
}

.setting-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 13px 14px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 24%);
    border-radius: 10px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 24%);
}

.info-row {
    align-items: center;
}

.dialog-section-header {
    align-items: center;
}

.setting-copy {
    min-width: 0;
}

.setting-title,
.skill-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--k-text-dark);
    line-height: 1.4;
}

.skill-title {
    font-size: 18px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.path-copy {
    margin-top: 4px;
}

.setting-hint {
    margin-top: 6px;
    color: color-mix(in srgb, var(--el-color-success), var(--k-text-dark) 24%);
}

.catalog-panel {
    padding-bottom: 18px;
}

.catalog-header {
    align-items: flex-start;
}

.catalog-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: flex-end;
}

.search-input {
    width: min(360px, 100%);
}

.card-list {
    --card-cols: 5;
    --card-gap: 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 14px var(--card-gap);
    padding: 14px 14px 16px;
}

.card-list.compact {
    --card-cols: 4;
}

.skill-card {
    flex: 0 1
        calc(
            (100% - (var(--card-cols) - 1) * var(--card-gap)) / var(--card-cols)
        );
    max-width: calc(
        (100% - (var(--card-cols) - 1) * var(--card-gap)) / var(--card-cols)
    );
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 12px;
    background: color-mix(in srgb, var(--k-activity-bg), var(--k-page-bg) 16%);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    box-sizing: border-box;
}

.skill-card.muted {
    opacity: 0.72;
}

.skill-card.readonly {
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 30%);
    border-style: dashed;
}

.skill-card.invalid {
    border-color: color-mix(in srgb, var(--el-color-warning), transparent 66%);
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

.skill-card.centered .skill-copy {
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.skill-name {
    margin-top: 4px;
    font-size: 14px;
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

.skill-path {
    margin-top: 4px;
    font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
}

.skill-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 320px;
}

.preview-meta {
    margin-bottom: 12px;
}

@media (max-width: 1680px) {
    .card-list {
        --card-cols: 4;
    }

    .card-list.compact {
        --card-cols: 4;
    }
}

@media (max-width: 1320px) {
    .card-list {
        --card-cols: 3;
    }

    .card-list.compact {
        --card-cols: 4;
    }
}

@media (max-width: 1080px) {
    .card-list {
        --card-cols: 2;
    }

    .card-list.compact {
        --card-cols: 3;
    }
}

@media (max-width: 768px) {
    .toolbar-main {
        flex-direction: column;
        align-items: flex-start;
    }

    .catalog-header,
    .panel-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .actions-section,
    .catalog-actions {
        width: 100%;
        justify-content: flex-start;
    }

    .actions-section .el-button,
    .catalog-actions .el-button {
        margin-left: 0;
        margin-bottom: 4px;
    }

    .hidden-mobile {
        display: none;
    }

    .mobile-only-desc-toggle {
        display: inline-flex;
    }

    .search-input {
        width: 100%;
    }

    .dialog-section-header,
    .setting-row {
        flex-direction: column;
        align-items: flex-start;
    }

    .dir-row {
        grid-template-columns: 1fr;
        align-items: stretch;
    }

    .card-list {
        --card-cols: 1;
        flex-direction: column;
        align-items: stretch;
    }

    .card-list.compact {
        --card-cols: 1;
    }

    .skill-card {
        flex-basis: 100%;
        max-width: none;
    }

    .skill-top,
    .skill-brand {
        flex-direction: column;
        align-items: flex-start;
    }
}
</style>
