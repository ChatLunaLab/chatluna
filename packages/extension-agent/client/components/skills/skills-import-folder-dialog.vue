<template>
    <el-dialog
        :model-value="visible"
        title="从本地文件导入 Skill"
        width="860px"
        destroy-on-close
        :close-on-click-modal="false"
        @update:model-value="$emit('update:visible', $event)"
    >
        <div class="dialog-body">
            <input
                ref="fileInput"
                type="file"
                class="hidden-input"
                accept=".zip,.skill,application/zip"
                @change="handleSelect"
            />

            <div class="form-card">
                <div class="field-label">本地文件</div>
                <div class="field-row">
                    <div class="folder-copy">
                        <div class="folder-name">
                            {{ name || '尚未选择文件' }}
                        </div>
                        <div class="field-hint">
                            {{
                                data
                                    ? '已读取压缩包，并自动完成预览。'
                                    : '选择一个 .zip 或 .skill 文件后，会先生成预览并校验 Skill 包结构。'
                            }}
                        </div>
                    </div>

                    <el-button
                        :loading="reading || previewing"
                        @click="openPicker"
                    >
                        选择 .zip / .skill
                    </el-button>
                </div>
            </div>

            <div v-if="preview" class="preview-card">
                <div class="preview-top">
                    <div>
                        <div class="preview-title">{{ preview.target }}</div>
                        <div class="field-hint">
                            共 {{ preview.entries.length }} 个文件与目录，识别到
                            {{ preview.skills.length }} 个 Skill 包。
                        </div>
                    </div>

                    <el-tag
                        :type="preview.valid ? 'success' : 'warning'"
                        effect="plain"
                    >
                        {{ preview.valid ? '可导入' : '不可导入' }}
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
                        <div class="panel-title">Skill 校验</div>
                        <el-scrollbar max-height="320px">
                            <div
                                v-if="preview.skills.length > 0"
                                class="skill-list"
                            >
                                <div
                                    v-for="item in preview.skills"
                                    :key="`${item.dir}-${item.name}`"
                                    class="skill-item"
                                >
                                    <div class="skill-head">
                                        <div>
                                            <div class="skill-name">
                                                {{ item.name }}
                                            </div>
                                            <div class="skill-dir">
                                                {{ item.dir }}
                                            </div>
                                        </div>
                                        <el-tag
                                            size="small"
                                            effect="plain"
                                            :type="
                                                item.state === 'ready'
                                                    ? 'success'
                                                    : 'warning'
                                            "
                                        >
                                            {{
                                                item.state === 'ready'
                                                    ? '通过'
                                                    : '失败'
                                            }}
                                        </el-tag>
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
                            </div>

                            <div v-else class="empty-copy">
                                当前压缩包里没有识别到 Skill 包。
                            </div>
                        </el-scrollbar>
                    </div>
                </div>
            </div>
        </div>

        <template #footer>
            <el-button @click="$emit('update:visible', false)">取消</el-button>
            <el-button
                type="primary"
                :loading="importing"
                :disabled="!preview || !preview.valid || !data"
                @click="importSkills"
            >
                导入并启用
            </el-button>
        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import { Document, FolderOpened } from '@element-plus/icons-vue'
import type { SkillImportPreviewResult } from '../../../src/types'
import { buildImportTree } from './import-tree'

const props = defineProps<{
    visible: boolean
}>()

const emit = defineEmits<{
    'update:visible': [value: boolean]
    refresh: []
}>()

const fileInput = ref<HTMLInputElement>()
const name = ref('')
const data = ref('')
const preview = ref<SkillImportPreviewResult>()
const reading = ref(false)
const previewing = ref(false)
const importing = ref(false)

watch(
    () => props.visible,
    (value) => {
        if (!value) {
            return
        }

        name.value = ''
        data.value = ''
        preview.value = undefined
    }
)

const tree = computed(() => buildImportTree(preview.value?.entries ?? []))

function openPicker() {
    fileInput.value?.click()
}

async function handleSelect(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''

    if (!file) {
        return
    }

    if (!/\.(zip|skill)$/i.test(file.name)) {
        ElMessage.warning('请选择 .zip 或 .skill 文件。')
        return
    }

    try {
        reading.value = true
        preview.value = undefined
        name.value = file.name
        data.value = bufferToBase64(await file.arrayBuffer())

        previewing.value = true
        preview.value = await send('chatluna-agent/previewSkillImport', {
            type: 'zip',
            name: name.value,
            data: data.value
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
    if (!preview.value?.valid || !data.value) {
        ElMessage.warning('当前文件预览未通过，暂时不能导入。')
        return
    }

    try {
        importing.value = true
        const result = await send('chatluna-agent/importSkills', {
            type: 'zip',
            name: name.value,
            data: data.value
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
.hidden-input {
    display: none;
}

.dialog-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.form-card,
.preview-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.panel-block {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 40%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-side-bg), transparent 60%);
    padding: 14px;
}

.skill-item {
    padding: 12px 0;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 60%);
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

.field-row,
.preview-top,
.skill-head,
.tree-node {
    display: flex;
    align-items: center;
    gap: 10px;
}

.field-row,
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
}

.panel-block {
    padding: 14px;
}

.tree-wrap :deep(.el-tree) {
    background: transparent;
}

.tree-node {
    min-width: 0;
}

.skill-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
    .field-row,
    .preview-top,
    .skill-head {
        flex-direction: column;
        align-items: flex-start;
    }

    .preview-grid {
        grid-template-columns: 1fr;
    }
}
</style>
