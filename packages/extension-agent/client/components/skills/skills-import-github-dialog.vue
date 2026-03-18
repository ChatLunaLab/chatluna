<template>
    <el-dialog
        :model-value="visible"
        title="从 GitHub 导入 Skill"
        width="860px"
        destroy-on-close
        :close-on-click-modal="false"
        @update:model-value="$emit('update:visible', $event)"
    >
        <div class="dialog-body">
            <div class="form-card">
                <div class="field-label">GitHub 地址</div>
                <div class="field-row">
                    <el-input
                        v-model="url"
                        placeholder="https://github.com/owner/repo/tree/main/skills"
                    />
                    <el-button :loading="previewing" @click="previewImport">
                        预览文件树
                    </el-button>
                </div>
                <div class="field-hint">
                    支持仓库根目录或子目录。预览会先检查文件树和 SKILL.md
                    是否符合要求。
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
                                当前地址下没有识别到 Skill 包。
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
                :disabled="!preview || !preview.valid"
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

const url = ref('')
const preview = ref<SkillImportPreviewResult>()
const previewing = ref(false)
const importing = ref(false)

watch(
    () => props.visible,
    (value) => {
        if (!value) {
            return
        }

        url.value = ''
        preview.value = undefined
    }
)

watch(url, () => {
    preview.value = undefined
})

const tree = computed(() => buildImportTree(preview.value?.entries ?? []))

async function previewImport() {
    if (!url.value.trim()) {
        ElMessage.warning('请先输入 GitHub 地址。')
        return
    }

    try {
        previewing.value = true
        preview.value = await send('chatluna-agent/previewSkillImport', {
            type: 'github',
            url: url.value.trim()
        })
    } catch {
        ElMessage.error('预览失败，请检查地址或稍后重试。')
    } finally {
        previewing.value = false
    }
}

async function importSkills() {
    if (!preview.value?.valid) {
        ElMessage.warning('当前预览没有通过，暂时不能导入。')
        return
    }

    try {
        importing.value = true
        const result = await send('chatluna-agent/importSkills', {
            type: 'github',
            url: url.value.trim()
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
</script>

<style scoped>
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

.field-row :deep(.el-input) {
    flex: 1;
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
    margin-top: 8px;
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
