<template>
    <el-dialog
        class="skills-import-dialog"
        :model-value="visible"
        :fullscreen="mobile"
        title="从本地文件导入 Skill"
        width="min(860px, calc(100vw - 24px))"
        destroy-on-close
        :close-on-click-modal="false"
        @update:model-value="$emit('update:visible', $event)"
    >
        <div class="dialog-body">
            <div class="form-card">
                <div class="field-label">本地文件</div>
                <el-upload
                    drag
                    action="#"
                    :auto-upload="false"
                    :show-file-list="false"
                    accept=".zip,.skill,application/zip"
                    :disabled="reading || previewing"
                    @change="handleSelect"
                >
                    <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                    <div class="el-upload__text">
                        将文件拖到此处，或 <em>点击上传</em>
                    </div>
                    <template #tip>
                        <div class="el-upload__tip">
                            只能上传单个 `.zip` 或 `.skill` 文件
                        </div>
                    </template>
                </el-upload>

                <div v-if="name" class="upload-file-info">
                    已选择文件：{{ name }}
                </div>

                <div class="field-hint">
                    {{
                        data
                            ? '已读取压缩包，并自动完成预览。'
                            : '选择一个 .zip 或 .skill 文件后，会先生成预览并校验 Skill 包结构。'
                    }}
                </div>
            </div>

            <div v-if="preview" class="preview-card">
                <div class="preview-top">
                    <div>
                        <div class="preview-title">{{ preview.target }}</div>
                        <div class="field-hint">
                            共 {{ preview.entries.length }} 个文件与目录，识别到
                            {{ preview.skills.length }} 个 Skill 包，当前已勾选
                            {{ selected.length }} 个。
                        </div>
                    </div>

                    <el-tag :type="canImport ? 'success' : 'warning'" effect="plain">
                        {{ canImport ? '可导入' : '不可导入' }}
                    </el-tag>
                </div>

                <div v-if="preview.diagnostics.length > 0" class="note-list">
                    <div
                        v-for="line in preview.diagnostics"
                        :key="line"
                        class="note-item"
                    >
                        {{ line }}
                    </div>
                </div>

                <div class="preview-grid">
                    <div class="panel-block">
                        <div class="panel-title">文件树</div>
                        <el-scrollbar max-height="320px" class="tree-wrap">
                            <el-tree
                                :data="tree"
                                node-key="key"
                                default-expand-all
                                empty-text="没有可预览的文件"
                            >
                                <template #default="{ data }">
                                    <div class="tree-node">
                                        <el-icon>
                                            <FolderOpened
                                                v-if="data.type === 'directory'"
                                            />
                                            <Document v-else />
                                        </el-icon>
                                        <span>{{ data.label }}</span>
                                    </div>
                                </template>
                            </el-tree>
                        </el-scrollbar>
                    </div>

                    <div class="panel-block">
                        <div class="panel-head">
                            <div class="panel-title">Skill 校验</div>
                            <div class="panel-actions">
                                <el-button text @click="selectReady(true)">
                                    全选可导入项
                                </el-button>
                                <el-button text @click="selectReady(false)">
                                    清空勾选
                                </el-button>
                            </div>
                        </div>
                        <el-scrollbar max-height="320px">
                            <el-checkbox-group
                                v-if="preview.skills.length > 0"
                                v-model="selected"
                                class="skill-list"
                            >
                                <div
                                    v-for="item in preview.skills"
                                    :key="`${item.dir}-${item.name}`"
                                    class="skill-item"
                                    :class="{
                                        selected: selected.includes(item.dir),
                                        disabled: item.state !== 'ready'
                                    }"
                                >
                                    <div class="skill-head">
                                        <el-checkbox
                                            :value="item.dir"
                                            :disabled="item.state !== 'ready'"
                                        >
                                            <div>
                                                <div class="skill-name">
                                                    {{ item.name }}
                                                </div>
                                                <div class="skill-dir">
                                                    {{ item.dir }}
                                                </div>
                                            </div>
                                        </el-checkbox>
                                        <div class="skill-tags">
                                            <el-tag
                                                v-if="item.exists"
                                                size="small"
                                                effect="plain"
                                                type="warning"
                                            >
                                                将覆盖
                                            </el-tag>
                                            <el-tag
                                                size="small"
                                                effect="plain"
                                                :type="
                                                    item.state === 'ready'
                                                        ? 'success'
                                                        : 'danger'
                                                "
                                            >
                                                {{
                                                    item.state === 'ready'
                                                        ? '通过'
                                                        : '失败'
                                                }}
                                            </el-tag>
                                        </div>
                                    </div>

                                    <div class="skill-desc">
                                        {{
                                            item.description ||
                                            '这个 Skill 暂时没有说明。'
                                        }}
                                    </div>

                                    <div
                                        v-if="item.diagnostics.length > 0"
                                        class="skill-notes"
                                    >
                                        <div
                                            v-for="line in item.diagnostics"
                                            :key="line"
                                            class="skill-note"
                                        >
                                            {{ line }}
                                        </div>
                                    </div>
                                </div>
                            </el-checkbox-group>

                            <div v-else class="empty-copy">
                                当前压缩包里没有识别到 Skill 包。
                            </div>
                        </el-scrollbar>
                    </div>
                </div>
            </div>
        </div>

        <template #footer>
            <div class="dialog-footer">
                <div class="footer-copy">
                    {{
                        preview
                            ? canImport
                                ? replaceCount > 0
                                    ? `已勾选 ${selected.length} 个 Skill，其中 ${replaceCount} 个会覆盖现有内容。`
                                    : `已勾选 ${selected.length} 个 Skill，现在可以直接导入并启用。`
                                : '请至少勾选一个通过校验的 Skill；若提示将覆盖，可取消对应勾选。'
                            : '先选择本地文件，再导入。'
                    }}
                </div>
                <div class="footer-actions">
                    <el-button @click="$emit('update:visible', false)">取消</el-button>
                    <el-button
                        type="primary"
                        :loading="importing"
                        :disabled="!canImport || !data"
                        @click="importSkills"
                    >
                        导入并启用
                    </el-button>
                </div>
            </div>
        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import { Document, FolderOpened, UploadFilled } from '@element-plus/icons-vue'
import type { SkillImportPreviewResult } from '../../../src/types'
import { buildImportTree } from './import-tree'

const props = defineProps<{
    visible: boolean
}>()

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

const emit = defineEmits<{
    'update:visible': [value: boolean]
    refresh: []
}>()

const name = ref('')
const data = ref('')
const preview = ref<SkillImportPreviewResult>()
const reading = ref(false)
const previewing = ref(false)
const importing = ref(false)
const selected = ref<string[]>([])

watch(
    () => props.visible,
    (value) => {
        if (!value) {
            return
        }

        name.value = ''
        data.value = ''
        preview.value = undefined
        selected.value = []
    }
)

const tree = computed(() => buildImportTree(preview.value?.entries ?? []))
const selectedSkills = computed(() => {
    return preview.value?.skills.filter((item) => selected.value.includes(item.dir)) ?? []
})
const replaceCount = computed(() => {
    return selectedSkills.value.filter((item) => item.exists).length
})
const canImport = computed(() => {
    return (
        preview.value != null &&
        selectedSkills.value.length > 0 &&
        selectedSkills.value.every((item) => item.state === 'ready')
    )
})

watch(preview, (value) => {
    selected.value = value
        ? value.skills
              .filter((item) => item.state === 'ready')
              .map((item) => item.dir)
        : []
})

function selectReady(all: boolean) {
    selected.value = all
        ? (preview.value?.skills ?? [])
              .filter((item) => item.state === 'ready')
              .map((item) => item.dir)
        : []
}

async function handleSelect(file: any) {
    const raw = file.raw as File
    const next = raw ?? (file as File)

    if (!next) {
        return
    }

    if (!/\.(zip|skill)$/i.test(next.name)) {
        ElMessage.warning('请选择 .zip 或 .skill 文件。')
        return
    }

    try {
        reading.value = true
        preview.value = undefined
        name.value = next.name
        data.value = bufferToBase64(await next.arrayBuffer())

        previewing.value = true
        preview.value = await send('chatluna-agent/previewSkillImport', {
            type: 'zip',
            name: name.value,
            data: data.value,
            selected: selected.value
        })
    } catch {
        data.value = ''
        preview.value = undefined
        ElMessage.error('读取文件失败，请稍后重试。')
    } finally {
        reading.value = false
        previewing.value = false
    }
}

async function importSkills() {
    if (!canImport.value || !data.value) {
        ElMessage.warning('当前文件预览未通过，暂时不能导入。')
        return
    }

    try {
        importing.value = true
        const result = await send('chatluna-agent/importSkills', {
            type: 'zip',
            name: name.value,
            data: data.value,
            selected: selected.value
        })

        emit('update:visible', false)
        emit('refresh')
        ElMessage.success(
            result.replaced.length > 0
                ? `已导入 ${result.imported.length} 个 Skill，并覆盖 ${result.replaced.length} 个同名项。`
                : `已导入 ${result.imported.length} 个 Skill，并默认启用。`
        )
    } catch {
        ElMessage.error('导入失败，请稍后重试。')
    } finally {
        importing.value = false
    }
}

function bufferToBase64(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer)
    let text = ''

    for (let idx = 0; idx < bytes.length; idx += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(idx, idx + 0x8000))
    }

    return btoa(text)
}
</script>

<style scoped>
.dialog-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
}

.form-card,
.preview-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
}

.preview-card {
    overflow: hidden;
}

.panel-block {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 40%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-side-bg), transparent 60%);
    padding: 14px;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    overflow: hidden;
}

.skill-item {
    padding: 12px 0;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 60%);
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    overflow: hidden;
}

.skill-item:last-child {
    border-bottom: none;
}

.field-label,
.folder-name,
.preview-title,
.panel-title,
.skill-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-title {
    white-space: nowrap;
    flex-shrink: 0;
}

.panel-head,
.panel-actions,
.skill-tags {
    display: flex;
    align-items: center;
    gap: 8px;
}

.panel-head {
    justify-content: space-between;
    margin-bottom: 10px;
    flex-wrap: wrap;
}

.panel-actions {
    flex-wrap: wrap;
}

.preview-top,
.skill-head,
.tree-node {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}

.preview-top,
.skill-head {
    justify-content: space-between;
}

.folder-copy {
    min-width: 0;
}

.field-hint,
.skill-dir,
.skill-desc,
.skill-note,
.note-item,
.empty-copy {
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
}

.field-hint {
    margin-top: 6px;
}

.upload-file-info {
    margin-top: 10px;
    font-size: 14px;
    color: var(--el-color-success);
    overflow-wrap: anywhere;
}

.footer-copy {
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.dialog-footer {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
}

.footer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
}

.preview-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.note-list,
.skill-notes {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.note-item,
.skill-notes {
    padding: 10px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--el-color-warning), transparent 94%);
}

.preview-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px;
    min-width: 0;
    width: 100%;
}

.panel-block {
    padding: 14px;
}

.tree-wrap :deep(.el-tree) {
    background: transparent;
}

.preview-card :deep(.el-scrollbar__wrap) {
    overflow-x: hidden;
}

.tree-wrap :deep(.el-scrollbar__wrap) {
    overflow-x: auto;
}

.tree-wrap :deep(.el-scrollbar__view),
.preview-card :deep(.el-scrollbar__view),
.tree-wrap :deep(.el-tree),
.tree-wrap :deep(.el-tree-node),
.tree-wrap :deep(.el-tree-node__children),
.preview-card :deep(.el-tree-node__content) {
    min-width: 0;
}

.tree-wrap :deep(.el-tree-node__content) {
    height: auto;
    align-items: flex-start;
    white-space: normal;
}

.tree-node {
    min-width: 0;
}

.tree-node span,
.skill-head > div:first-child,
.folder-copy {
    min-width: 0;
    flex: 1 1 auto;
}

.tree-node span {
    display: block;
    white-space: normal;
    word-break: break-all;
}

.folder-name,
.preview-title,
.skill-name,
.skill-dir,
.skill-desc,
.skill-note,
.note-item,
.empty-copy {
    overflow-wrap: anywhere;
}

:deep(.skills-import-dialog .el-overlay-dialog) {
    overflow: auto;
    padding: calc(env(safe-area-inset-top, 0px) + 8px) 8px calc(env(safe-area-inset-bottom, 0px) + 8px);
    box-sizing: border-box;
}

:deep(.skills-import-dialog .el-dialog) {
    max-height: min(92dvh, 920px);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
}

:deep(.skills-import-dialog .el-dialog.is-fullscreen) {
    width: 100vw !important;
    max-width: 100vw;
    max-height: 100dvh;
    height: 100dvh;
    margin: 0 !important;
    border-radius: 0;
}

:deep(.skills-import-dialog .el-dialog.is-fullscreen .el-dialog__body) {
    -webkit-overflow-scrolling: touch;
}

:deep(.skills-import-dialog .el-dialog__header),
:deep(.skills-import-dialog .el-dialog__footer) {
    flex-shrink: 0;
}

:deep(.skills-import-dialog .el-dialog__body) {
    padding-top: 12px;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
}

:deep(.skills-import-dialog .el-dialog__footer) {
    display: flex;
    padding-top: 8px;
}

.skill-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    width: 100%;
}

.skill-item.selected {
    border-radius: 10px;
    background: color-mix(in srgb, var(--el-color-primary), transparent 95%);
}

.skill-item.disabled {
    opacity: 0.82;
}

.skill-head :deep(.el-checkbox) {
    align-items: flex-start;
    min-width: 0;
    flex: 1 1 auto;
}

.skill-head :deep(.el-checkbox__label) {
    min-width: 0;
    white-space: normal;
}

.skill-item {
    padding: 12px;
}

.skill-dir,
.skill-desc {
    margin-top: 4px;
}

.skill-notes {
    margin-top: 10px;
}

.empty-copy {
    padding: 10px 2px;
}

@media (max-width: 768px) {
    .preview-top,
    .skill-head {
        flex-direction: column;
        align-items: flex-start;
    }

    .preview-grid {
        grid-template-columns: 1fr;
        gap: 12px;
    }

    .panel-block,
    .skill-item,
    .skill-head,
    .skill-head > div:first-child,
    .skill-list,
    .folder-copy {
        width: 100%;
    }

    :deep(.skills-import-dialog .el-upload) {
        width: 100%;
    }

    :deep(.skills-import-dialog .el-upload-dragger) {
        width: 100%;
        padding: 18px 12px;
    }

    .panel-head,
    .skill-head {
        align-items: flex-start;
    }

    .panel-actions,
    .skill-tags {
        width: 100%;
    }

    .skill-tags {
        justify-content: flex-start;
    }

    :deep(.skills-import-dialog .el-overlay-dialog) {
        overflow: auto;
        padding: calc(env(safe-area-inset-top, 0px) + 8px) 8px calc(env(safe-area-inset-bottom, 0px) + 8px);
        box-sizing: border-box;
    }

    :deep(.skills-import-dialog .el-dialog) {
        width: calc(100vw - 16px) !important;
        max-width: calc(100vw - 16px);
        max-height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 16px);
        margin: 0 auto !important;
        border-radius: 14px;
    }

    :deep(.skills-import-dialog .el-dialog__header) {
        padding: 18px 16px 0;
    }

    :deep(.skills-import-dialog .el-dialog__body) {
        padding: 12px 16px;
    }

    :deep(.skills-import-dialog .el-dialog__footer) {
        padding: 12px 16px 16px;
    }

    .footer-actions {
        width: 100%;
    }

    .footer-actions :deep(.el-button) {
        flex: 1 1 0;
        min-width: 0;
        margin: 0;
    }

    .footer-copy {
        width: 100%;
    }
}
</style>
