<template>
    <div class="skills-page" v-loading="loading">
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">Skills</div>
                    <div class="page-description">
                        管理技能目录、导入来源、开关状态与提示词注入设置
                    </div>
                </div>

                <div class="actions-section">
                    <el-button circle @click="$emit('refresh')">
                        <el-icon><RefreshRight /></el-icon>
                    </el-button>
                </div>
            </div>
        </div>

        <div class="stats-grid">
            <div v-for="item in stats" :key="item.label" class="stat-card">
                <div class="stat-label">{{ item.label }}</div>
                <div class="stat-value">{{ item.value }}</div>
            </div>
        </div>

        <div class="top-grid">
            <div class="panel">
                <div class="panel-header">
                    <div>
                        <div class="panel-title">Import</div>
                        <div class="panel-description">
                            从 GitHub、ZIP 压缩包或本地文件夹导入 skills 到
                            `data/chatluna/skills`
                        </div>
                    </div>
                </div>

                <div class="import-grid">
                    <div class="import-card">
                        <div class="import-head">
                            <el-icon :size="18"><Link /></el-icon>
                            <span>GitHub</span>
                        </div>
                        <div class="import-copy">
                            支持仓库地址与常见的 `tree/...` 目录地址
                        </div>
                        <el-input
                            v-model="githubUrl"
                            placeholder="https://github.com/owner/repo"
                        />
                        <div class="import-actions">
                            <el-button
                                type="primary"
                                :loading="importing === 'github'"
                                @click="importGithub"
                            >
                                导入 GitHub
                            </el-button>
                        </div>
                    </div>

                    <div class="import-card">
                        <div class="import-head">
                            <el-icon :size="18"><UploadFilled /></el-icon>
                            <span>ZIP</span>
                        </div>
                        <div class="import-copy">
                            选择本地 ZIP 压缩包，后端会自动解压并识别 SKILL.md
                        </div>
                        <div class="import-file">
                            {{ zipFile?.name || '尚未选择 ZIP 文件' }}
                        </div>
                        <div class="import-actions">
                            <el-button @click="openZipPicker">
                                选择 ZIP
                            </el-button>
                            <el-button
                                type="primary"
                                :disabled="!zipFile"
                                :loading="importing === 'zip'"
                                @click="importZip"
                            >
                                导入 ZIP
                            </el-button>
                        </div>
                    </div>

                    <div class="import-card">
                        <div class="import-head">
                            <el-icon :size="18"><FolderOpened /></el-icon>
                            <span>Folder</span>
                        </div>
                        <div class="import-copy">
                            直接选择本地目录，浏览器会上传其中的技能文件
                        </div>
                        <div class="import-file">
                            {{ folderLabel }}
                        </div>
                        <div class="import-actions">
                            <el-button @click="openFolderPicker">
                                选择文件夹
                            </el-button>
                            <el-button
                                type="primary"
                                :disabled="folderFiles.length === 0"
                                :loading="importing === 'folder'"
                                @click="importFolder"
                            >
                                导入文件夹
                            </el-button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel settings-panel">
                <div class="panel-header">
                    <div>
                        <div class="panel-title">Settings</div>
                        <div class="panel-description">
                            控制 skills 注入行为与根目录信息
                        </div>
                    </div>
                </div>

                <div class="settings-body">
                    <div class="setting-row">
                        <div class="setting-copy">
                            <div class="setting-title">允许电脑能力提示</div>
                            <div class="setting-description">
                                开启后，注入到模型的 skill
                                内容会提示“可使用电脑能力”。
                            </div>
                        </div>

                        <el-switch v-model="allowComputerUsePrompt" />
                    </div>

                    <div class="setting-row info-row">
                        <div class="setting-copy">
                            <div class="setting-title">Skills Root</div>
                            <div class="setting-description path-copy">
                                {{ status.root || '未初始化' }}
                            </div>
                        </div>
                    </div>

                    <div class="setting-row info-row">
                        <div class="setting-copy">
                            <div class="setting-title">当前会话激活数</div>
                            <div class="setting-description">
                                {{ status.activeConversations }}
                                个会话持有已加载的技能上下文
                            </div>
                        </div>
                    </div>

                    <div class="settings-actions">
                        <el-button
                            type="primary"
                            :loading="savingSettings"
                            @click="saveSettings"
                        >
                            保存设置
                        </el-button>
                    </div>
                </div>
            </div>
        </div>

        <div class="panel catalog-panel">
            <div class="panel-header catalog-header">
                <div>
                    <div class="panel-title">Catalog</div>
                    <div class="panel-description">
                        查看扫描结果、来源、诊断信息与启用状态
                    </div>
                </div>

                <div class="catalog-actions">
                    <el-input
                        v-model="filterText"
                        class="search-input"
                        placeholder="搜索 skill 名称、描述或路径"
                        clearable
                    >
                        <template #prefix>
                            <el-icon><Search /></el-icon>
                        </template>
                    </el-input>

                    <el-tag round effect="plain" type="info">
                        {{ filteredSkills.length }} / {{ skills.length }} 项
                    </el-tag>
                </div>
            </div>

            <div v-if="filteredSkills.length > 0" class="skill-grid">
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
                        {{ item.description || '该 skill 没有可用描述' }}
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
                                      ? '被同名 skill 覆盖'
                                      : '未进入 catalog'
                            }}
                        </el-tag>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="item.modelEnabled ? 'success' : 'warning'"
                        >
                            {{
                                item.modelEnabled
                                    ? '模型可调用'
                                    : '模型不自动调用'
                            }}
                        </el-tag>
                    </div>

                    <div v-if="item.compatibility" class="skill-meta">
                        Compatibility: {{ item.compatibility }}
                    </div>

                    <div
                        v-if="item.allowedTools && item.allowedTools.length > 0"
                        class="skill-meta"
                    >
                        Allowed tools: {{ item.allowedTools.join(', ') }}
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
                            删除本地导入
                        </el-button>
                    </div>
                </div>
            </div>

            <div v-else class="empty-state">
                <el-empty description="当前没有匹配的 skills" />
            </div>
        </div>

        <el-dialog
            v-model="showPreview"
            title="Skill 内容"
            width="900px"
            destroy-on-close
        >
            <div class="preview-meta">{{ previewTitle }}</div>
            <code-editor
                v-model="previewContent"
                language="plaintext"
                :readonly="true"
                :min-height="520"
            />
        </el-dialog>

        <input
            ref="zipInput"
            type="file"
            accept=".zip,application/zip"
            style="display: none"
            @change="handleZipPicked"
        />
        <input
            ref="folderInput"
            type="file"
            webkitdirectory
            directory
            multiple
            style="display: none"
            @change="handleFolderPicked"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
    FolderOpened,
    Link,
    RefreshRight,
    Search,
    UploadFilled
} from '@element-plus/icons-vue'
import CodeEditor from '../shared/code-editor.vue'
import type {
    SkillExportResult,
    SkillImportInput,
    SkillImportResult,
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

const githubUrl = ref('')
const filterText = ref('')
const allowComputerUsePrompt = ref(false)
const savingSettings = ref(false)
const importing = ref<SkillImportInput['type'] | ''>('')

const zipInput = ref<HTMLInputElement>()
const folderInput = ref<HTMLInputElement>()
const zipFile = ref<File>()
const folderFiles = ref<File[]>([])
const folderName = ref('')

const showPreview = ref(false)
const previewTitle = ref('')
const previewContent = ref('')

watch(
    () => props.config.allowComputerUsePrompt,
    (value) => {
        allowComputerUsePrompt.value = value
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

const stats = computed(() => [
    {
        label: '已发现技能',
        value: props.status.total
    },
    {
        label: '当前生效',
        value: props.status.visible
    },
    {
        label: '模型可调用',
        value: props.status.modelEnabled
    },
    {
        label: '启用项',
        value: skills.value.filter((item) => item.enabled).length
    }
])

const folderLabel = computed(() => {
    if (folderFiles.value.length < 1) {
        return '尚未选择文件夹'
    }

    return `${folderName.value || 'folder'} (${folderFiles.value.length} files)`
})

async function saveSettings() {
    try {
        savingSettings.value = true
        await send('chatluna-agent/saveSkills', {
            ...props.config,
            allowComputerUsePrompt: allowComputerUsePrompt.value
        } satisfies SkillsConfig)
        ElMessage.success('Skills 设置已保存')
    } catch {
        ElMessage.error('保存 Skills 设置失败')
    } finally {
        savingSettings.value = false
    }
}

function openZipPicker() {
    zipInput.value?.click()
}

function openFolderPicker() {
    folderInput.value?.click()
}

function handleZipPicked(event: Event) {
    const input = event.target as HTMLInputElement
    zipFile.value = input.files?.[0] ?? undefined
}

function handleFolderPicked(event: Event) {
    const input = event.target as HTMLInputElement
    const files = Array.from(input.files ?? [])

    folderFiles.value = files
    folderName.value =
        files[0]?.webkitRelativePath?.split('/')[0] || files[0]?.name || ''
}

async function importGithub() {
    const url = githubUrl.value.trim()
    if (!url) {
        ElMessage.warning('请输入 GitHub 地址')
        return
    }

    await runImport(
        {
            type: 'github',
            url
        },
        'github'
    )
}

async function importZip() {
    if (!zipFile.value) {
        ElMessage.warning('请先选择 ZIP 文件')
        return
    }

    await runImport(
        {
            type: 'zip',
            name: zipFile.value.name,
            data: await fileToBase64(zipFile.value)
        },
        'zip'
    )
}

async function importFolder() {
    if (folderFiles.value.length < 1) {
        ElMessage.warning('请先选择文件夹')
        return
    }

    const files = await Promise.all(
        folderFiles.value.map(async (file) => ({
            path: file.webkitRelativePath || file.name,
            data: await fileToBase64(file)
        }))
    )

    await runImport(
        {
            type: 'folder',
            name: folderName.value || 'folder',
            files
        },
        'folder'
    )
}

async function runImport(
    input: SkillImportInput,
    type: SkillImportInput['type']
) {
    try {
        importing.value = type
        const result = await send('chatluna-agent/importSkills', input)
        showImportResult(result)

        if (type === 'github') {
            githubUrl.value = ''
        }

        if (type === 'zip') {
            zipFile.value = undefined
            if (zipInput.value) {
                zipInput.value.value = ''
            }
        }

        if (type === 'folder') {
            folderFiles.value = []
            folderName.value = ''
            if (folderInput.value) {
                folderInput.value.value = ''
            }
        }
    } catch (error) {
        ElMessage.error(
            error instanceof Error ? error.message : '导入 skills 失败'
        )
    } finally {
        importing.value = ''
    }
}

async function toggleSkill(item: SkillInfo, enabled: boolean) {
    try {
        await send('chatluna-agent/setSkillEnabled', item.id, enabled)
        ElMessage.success(enabled ? 'Skill 已启用' : 'Skill 已停用')
    } catch {
        ElMessage.error('更新 Skill 状态失败')
    }
}

async function previewSkill(item: SkillInfo) {
    try {
        const result = await send('chatluna-agent/getSkillContent', item.id)
        previewTitle.value = item.name
        previewContent.value = result?.content ?? ''
        showPreview.value = true
    } catch {
        ElMessage.error('读取 Skill 内容失败')
    }
}

async function exportSkill(item: SkillInfo) {
    try {
        const result = await send('chatluna-agent/exportSkill', item.id)
        if (!result) {
            ElMessage.warning('当前 skill 无法导出')
            return
        }

        downloadExport(result)
        ElMessage.success('Skill ZIP 已开始下载')
    } catch {
        ElMessage.error('导出 Skill 失败')
    }
}

async function removeSkill(item: SkillInfo) {
    try {
        await ElMessageBox.confirm(
            `确定删除本地导入的 skill “${item.name}” 吗？`,
            '删除 Skill',
            {
                confirmButtonText: '删除',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )

        await send('chatluna-agent/removeSkill', item.id)
        ElMessage.success('本地 Skill 已删除')
    } catch (error) {
        if (error !== 'cancel') {
            ElMessage.error('删除 Skill 失败')
        }
    }
}

async function copyPath(path: string) {
    try {
        await navigator.clipboard.writeText(path)
        ElMessage.success('路径已复制')
    } catch {
        ElMessage.error('复制路径失败')
    }
}

function stateLabel(state: SkillInfo['state']) {
    if (state === 'ready') return '可用'
    if (state === 'invalid') return '无效'
    return '缺失'
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

function showImportResult(result: SkillImportResult) {
    const text =
        result.imported.length > 0
            ? `已导入 ${result.imported.length} 个 skill`
            : '导入完成，但没有发现新的 skill'

    ElMessage.success(text)

    if (result.diagnostics.length > 0) {
        void ElMessageBox.alert(result.diagnostics.join('\n'), '导入提示', {
            type: 'warning'
        })
    }
}

function fileToBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()

        reader.onload = () => {
            const value = String(reader.result || '')
            const idx = value.indexOf(',')
            resolve(idx >= 0 ? value.slice(idx + 1) : value)
        }

        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
    })
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
    width: min(100%, 1480px);
    margin: 0 auto;
    padding-bottom: 56px;
}

.toolbar-container {
    position: sticky;
    top: 0;
    z-index: 5;
    background: linear-gradient(180deg, var(--k-page-bg) 72%, transparent);
    padding: 12px 0;
    margin-bottom: 12px;
}

.toolbar-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.headline {
    min-width: 0;
}

.page-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--k-color-text);
}

.page-description {
    margin-top: 4px;
    font-size: 13px;
    color: var(--k-text-light);
}

.actions-section {
    display: flex;
    gap: 8px;
    align-items: center;
}

.stats-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 20px;
}

.stat-card {
    border: 1px solid var(--k-color-divider);
    border-radius: 16px;
    background: var(--k-color-surface-1);
    padding: 18px;
    flex: 1 1 180px;
    min-width: 0;
}

.stat-label {
    font-size: 12px;
    color: var(--k-text-light);
    margin-bottom: 8px;
}

.stat-value {
    font-size: 24px;
    font-weight: 700;
    color: var(--k-color-text);
}

.top-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.9fr);
    gap: 20px;
    margin-bottom: 20px;
}

.panel {
    border: 1px solid var(--k-color-divider);
    border-radius: 20px;
    background: var(--k-color-surface-1);
    overflow: hidden;
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 18px 20px;
    border-bottom: 1px solid var(--k-color-divider);
}

.panel-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--k-color-text);
}

.panel-description {
    margin-top: 4px;
    font-size: 12px;
    color: var(--k-text-light);
}

.import-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    padding: 20px;
}

.import-card {
    border: 1px solid var(--k-color-divider);
    border-radius: 16px;
    background: var(--k-page-bg);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.import-head {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 700;
    color: var(--k-color-text);
}

.import-copy,
.import-file,
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

.import-file {
    min-height: 20px;
}

.import-actions,
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
    padding: 20px;
}

.setting-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border: 1px solid var(--k-color-divider);
    border-radius: 16px;
    background: var(--k-page-bg);
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
    font-weight: 700;
    color: var(--k-color-text);
}

.path-copy {
    margin-top: 4px;
    font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
}

.catalog-panel {
    padding-bottom: 20px;
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

.skill-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
    padding: 20px;
}

.skill-card {
    border: 1px solid var(--k-color-divider);
    border-radius: 18px;
    background: var(--k-page-bg);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.skill-card.muted {
    opacity: 0.8;
}

.skill-card.invalid {
    border-color: color-mix(in srgb, var(--el-color-warning), transparent 45%);
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
    border-radius: 14px;
    background: color-mix(in srgb, var(--el-color-warning), transparent 92%);
    color: var(--el-color-warning-dark-2);
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

    .import-grid {
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

    .stats-grid {
        gap: 12px;
    }

    .stat-card {
        flex-basis: 100%;
    }

    .search-input {
        width: 100%;
    }

    .skill-grid {
        grid-template-columns: 1fr;
    }
}
</style>
