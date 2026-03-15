<template>
    <div class="skills-page" v-loading="loading">
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">Skills</div>
                    <div class="page-description">
                        管理技能目录、可用状态和模型提示设置。
                    </div>
                </div>

                <div class="actions-section">
                    <el-button circle @click="$emit('refresh')">
                        <el-icon><RefreshRight /></el-icon>
                    </el-button>
                </div>
            </div>
        </div>

        <div class="top-grid">
            <div class="panel">
                <div class="panel-header">
                    <div>
                        <div class="panel-title">扫描目录</div>
                        <div class="panel-description">
                            `data/chatluna/skills`
                            会始终扫描，可在这里添加其他目录。
                        </div>
                    </div>

                    <el-button @click="addDir()">添加目录</el-button>
                </div>

                <div class="dir-body">
                    <div class="dir-note">
                        支持绝对路径、相对路径和 `~` 路径。保存后会重新扫描。
                    </div>

                    <div v-if="dirs.length > 0" class="dir-list">
                        <div
                            v-for="(item, idx) in dirs"
                            :key="idx"
                            class="dir-row"
                        >
                            <el-input
                                v-model="dirs[idx]"
                                placeholder="~/.agents/skills"
                            />
                            <el-button text @click="removeDir(idx)">
                                删除
                            </el-button>
                        </div>
                    </div>

                    <div v-else class="dir-empty">
                        还没有额外目录，点“添加目录”即可。
                    </div>
                </div>
            </div>

            <div class="panel settings-panel">
                <div class="panel-header">
                    <div>
                        <div class="panel-title">设置</div>
                        <div class="panel-description">
                            控制模型是否收到技能相关提示，并查看当前目录。
                        </div>
                    </div>
                </div>

                <div class="settings-body">
                    <div class="setting-row">
                        <div class="setting-copy">
                            <div class="setting-title">
                                告诉模型可以使用电脑能力
                            </div>
                            <div class="setting-description">
                                开启后，模型会知道当前环境可以调用电脑操作相关能力。
                            </div>
                        </div>

                        <el-switch v-model="allowComputerUsePrompt" />
                    </div>

                    <div class="setting-row info-row">
                        <div class="setting-copy">
                            <div class="setting-title">技能根目录</div>
                            <div class="setting-description path-copy">
                                {{ status.root || '尚未初始化' }}
                            </div>
                        </div>
                    </div>

                    <div class="settings-actions">
                        <el-button
                            type="primary"
                            :loading="savingSettings"
                            @click="saveSettings"
                        >
                            保存更改
                        </el-button>
                    </div>
                </div>
            </div>
        </div>

        <div class="panel catalog-panel">
            <div class="panel-header catalog-header">
                <div>
                    <div class="panel-title">技能目录</div>
                    <div class="panel-description">
                        查看已扫描的技能、来源和当前状态。
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

            <div v-if="filteredSkills.length > 0" class="card-grid">
                <div
                    v-for="item in filteredSkills"
                    :key="item.id"
                    class="skill-card"
                    :class="{
                        muted: !item.visible,
                        invalid: item.state !== 'ready'
                    }"
                >
                    <div class="skill-head">
                        <div class="skill-copy">
                            <div class="skill-title">{{ item.name }}</div>
                            <div class="skill-path">
                                {{ item.path || '当前没有可用路径' }}
                            </div>
                        </div>

                        <el-switch
                            :model-value="item.enabled"
                            @change="
                                (value) => toggleSkill(item, value as boolean)
                            "
                        />
                    </div>

                    <div class="skill-description">
                        {{ item.description || '这个技能暂时没有说明。' }}
                    </div>

                    <div class="skill-chips">
                        <el-tag size="small" effect="plain">
                            {{ `${item.source} / ${item.scope}` }}
                        </el-tag>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="stateTag(item.state)"
                        >
                            {{ stateLabel(item.state) }}
                        </el-tag>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="item.visible ? 'success' : 'info'"
                        >
                            {{
                                item.visible
                                    ? '当前生效'
                                    : item.shadowedBy
                                      ? '被同名技能替代'
                                      : '当前目录未使用'
                            }}
                        </el-tag>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="item.modelEnabled ? 'success' : 'warning'"
                        >
                            {{
                                item.modelEnabled
                                    ? '模型可自动使用'
                                    : '模型不会自动使用'
                            }}
                        </el-tag>
                    </div>

                    <div v-if="item.compatibility" class="skill-meta">
                        兼容性：{{ item.compatibility }}
                    </div>

                    <div
                        v-if="item.allowedTools && item.allowedTools.length > 0"
                        class="skill-meta"
                    >
                        允许使用的工具：{{ item.allowedTools.join(', ') }}
                    </div>

                    <div
                        v-if="item.diagnostics.length > 0"
                        class="diagnostic-box"
                    >
                        <div
                            v-for="line in item.diagnostics.slice(0, 3)"
                            :key="line"
                            class="diagnostic-line"
                        >
                            {{ line }}
                        </div>
                    </div>

                    <div class="skill-actions">
                        <el-button
                            size="small"
                            :disabled="!item.path"
                            @click="previewSkill(item)"
                        >
                            查看内容
                        </el-button>
                        <el-button
                            size="small"
                            :disabled="!canExport(item)"
                            @click="exportSkill(item)"
                        >
                            导出 ZIP
                        </el-button>
                        <el-button
                            size="small"
                            text
                            :disabled="!item.path"
                            @click="copyPath(item.path)"
                        >
                            复制路径
                        </el-button>
                        <el-button
                            v-if="canRemove(item)"
                            size="small"
                            type="danger"
                            text
                            @click="removeSkill(item)"
                        >
                            删除导入项
                        </el-button>
                    </div>
                </div>
            </div>

            <div v-else class="empty-state">
                <el-empty description="没有找到匹配的技能。" />
            </div>
        </div>

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
import { RefreshRight, Search } from '@element-plus/icons-vue'
import CodeEditor from '../shared/code-editor.vue'
import type {
    SkillExportResult,
    SkillInfo,
    SkillsConfig,
    SkillsStatus
} from '../../../src/types'

const props = withDefaults(
    defineProps<{
        config: SkillsConfig
        status: SkillsStatus
        loading?: boolean
    }>(),
    {
        config: () => ({
            allowComputerUsePrompt: false,
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
        loading: false
    }
)

defineEmits<{
    refresh: []
}>()

const filterText = ref('')
const allowComputerUsePrompt = ref(false)
const dirs = ref<string[]>([])
const savingSettings = ref(false)

const showPreview = ref(false)
const previewTitle = ref('')
const previewContent = ref('')
const previewLanguage = ref('plaintext')

watch(
    () => props.config.allowComputerUsePrompt,
    (value) => {
        allowComputerUsePrompt.value = value
    },
    {
        immediate: true
    }
)

watch(
    () => props.config.dirs,
    (value) => {
        dirs.value = [...(value ?? [])]
    },
    {
        immediate: true
    }
)

const skills = computed(() => {
    return Object.values(props.status.catalog).sort((a, b) => {
        if (a.visible !== b.visible) {
            return a.visible ? -1 : 1
        }

        if (a.enabled !== b.enabled) {
            return a.enabled ? -1 : 1
        }

        return a.name.localeCompare(b.name)
    })
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
            ...(item.diagnostics ?? [])
        ]
            .join('\n')
            .toLowerCase()
            .includes(keyword)
    })
})

async function saveSettings() {
    try {
        savingSettings.value = true
        const nextDirs = dirs.value
            .map((item) => item.trim())
            .filter(
                (item, idx, list) =>
                    item.length > 0 && list.indexOf(item) === idx
            )

        await send('chatluna-agent/saveSkills', {
            ...props.config,
            allowComputerUsePrompt: allowComputerUsePrompt.value,
            dirs: nextDirs
        } satisfies SkillsConfig)

        dirs.value = nextDirs
        ElMessage.success('已保存设置，并重新扫描技能目录。')
    } catch {
        ElMessage.error('保存失败，请稍后重试。')
    } finally {
        savingSettings.value = false
    }
}

function addDir(value = '') {
    if (!value) {
        dirs.value.push('')
        return
    }

    if (dirs.value.includes(value)) {
        return
    }

    dirs.value.push(value)
}

function removeDir(idx: number) {
    dirs.value.splice(idx, 1)
}

async function toggleSkill(item: SkillInfo, enabled: boolean) {
    try {
        await send('chatluna-agent/setSkillEnabled', item.id, enabled)
        ElMessage.success(enabled ? '已启用该技能。' : '已停用该技能。')
    } catch {
        ElMessage.error('更新技能状态失败，请稍后重试。')
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
            `删除“${item.name}”后，如需恢复，需要重新导入。确定删除吗？`,
            '删除技能',
            {
                confirmButtonText: '删除',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )

        await send('chatluna-agent/removeSkill', item.id)
        ElMessage.success('已删除导入的技能。')
    } catch (error) {
        if (error !== 'cancel') {
            ElMessage.error('删除失败，请稍后重试。')
        }
    }
}

async function copyPath(path: string) {
    try {
        await navigator.clipboard.writeText(path)
        ElMessage.success('已复制路径。')
    } catch {
        ElMessage.error('复制失败，请手动复制。')
    }
}

function stateLabel(state: SkillInfo['state']) {
    if (state === 'ready') return '可用'
    if (state === 'invalid') return '无效'
    return '缺少文件'
}

function stateTag(state: SkillInfo['state']) {
    if (state === 'ready') return 'success'
    if (state === 'invalid') return 'warning'
    return 'info'
}

function canExport(item: SkillInfo) {
    return item.path.length > 0 && item.state !== 'missing'
}

function canRemove(item: SkillInfo) {
    return item.source === 'chatluna' && item.scope === 'data' && !!item.path
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
    width: min(100%, 1440px);
    margin: 0 auto;
    padding-bottom: 56px;
}

.toolbar-container {
    position: sticky;
    top: 0;
    z-index: 5;
    background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--k-page-bg), var(--k-color-surface-1) 18%) 0%,
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
    min-width: 0;
}

.page-title {
    font-size: 19px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--k-color-text);
}

.page-description {
    margin-top: 4px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.actions-section {
    display: flex;
    gap: 8px;
    align-items: center;
}

.top-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.9fr);
    gap: 18px;
    margin-bottom: 18px;
}

.panel {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(
        in srgb,
        var(--k-color-surface-1),
        var(--k-page-bg) 18%
    );
    overflow: hidden;
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
    font-size: 15px;
    font-weight: 600;
    color: var(--k-color-text);
}

.panel-description {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.dir-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px;
}

.dir-note,
.dir-empty,
.setting-description,
.skill-description,
.skill-path,
.skill-meta,
.diagnostic-line,
.preview-meta {
    font-size: 12px;
    color: var(--k-text-light);
    line-height: 1.6;
    word-break: break-word;
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

.settings-actions,
.skill-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.settings-panel {
    min-height: 100%;
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
    background: color-mix(
        in srgb,
        var(--k-page-bg),
        var(--k-color-surface-1) 24%
    );
}

.info-row {
    align-items: center;
}

.setting-copy {
    min-width: 0;
}

.setting-title,
.skill-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-color-text);
}

.path-copy {
    margin-top: 4px;
    font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
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

.card-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 16px;
    padding: 14px 14px 16px;
    align-items: stretch;
    align-content: flex-start;
}

.skill-card {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 12px;
    background: color-mix(
        in srgb,
        var(--k-color-surface-2),
        var(--k-page-bg) 16%
    );
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 0 1 320px;
    max-width: 360px;
    min-width: 0;
    box-sizing: border-box;
}

.skill-card.muted {
    opacity: 0.72;
}

.skill-card.invalid {
    border-color: color-mix(in srgb, var(--el-color-warning), transparent 66%);
}

.skill-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
}

.skill-copy {
    min-width: 0;
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

.diagnostic-box {
    padding: 12px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--el-color-warning), transparent 95%);
    color: color-mix(
        in srgb,
        var(--el-color-warning-dark-2),
        var(--k-color-text) 26%
    );
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

@media (max-width: 1080px) {
    .top-grid {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 768px) {
    .toolbar-main,
    .catalog-header,
    .setting-row {
        flex-direction: column;
        align-items: flex-start;
    }

    .actions-section,
    .catalog-actions {
        width: 100%;
        justify-content: flex-end;
    }

    .search-input {
        width: 100%;
    }

    .dir-row {
        grid-template-columns: 1fr;
        align-items: stretch;
    }

    .card-grid > .skill-card {
        flex-basis: 100%;
        max-width: none;
    }
}
</style>
