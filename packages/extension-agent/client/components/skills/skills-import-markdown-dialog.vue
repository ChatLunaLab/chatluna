<template>
    <el-dialog
        class="skills-import-dialog"
        :model-value="visible"
        :fullscreen="mobile"
        title="从 Markdown 导入 Skill"
        width="min(860px, calc(100vw - 24px))"
        destroy-on-close
        :close-on-click-modal="false"
        @update:model-value="$emit('update:visible', $event)"
    >
        <div class="dialog-body">
            <el-tabs v-model="activeTab">
                <el-tab-pane label="新建 Markdown" name="create">
                    <div class="form-card">
                        <div class="field-label">技能名称 (将作为目录名)</div>
                        <el-input v-model="skillName" placeholder="例如：my-skill" />
                        
                        <div class="field-label" style="margin-top: 12px">Markdown 内容</div>
                        <code-editor
                            v-model="skillContent"
                            language="markdown"
                            :min-height="300"
                        />
                    </div>
                </el-tab-pane>
                <el-tab-pane label="上传 Markdown" name="upload">
                    <div class="form-card">
                        <el-upload
                            drag
                            action="#"
                            :auto-upload="false"
                            :show-file-list="false"
                            accept=".md,text/markdown"
                            @change="handleFileSelect"
                        >
                            <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                            <div class="el-upload__text">
                                将文件拖到此处，或 <em>点击上传</em>
                            </div>
                            <template #tip>
                                <div class="el-upload__tip">
                                    只能上传单个 Markdown 文件
                                </div>
                            </template>
                        </el-upload>
                        
                        <div v-if="uploadFileName" class="upload-file-info">
                            已选择文件：{{ uploadFileName }}
                        </div>
                    </div>
                </el-tab-pane>
            </el-tabs>
        </div>

        <template #footer>
            <el-button @click="$emit('update:visible', false)">取消</el-button>
            <el-button
                type="primary"
                :loading="importing"
                :disabled="!canImport"
                @click="confirmImport"
            >
                导入并启用
            </el-button>
        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import CodeEditor from '../shared/code-editor.vue'

function formatError(error: unknown) {
    return String(error instanceof Error ? error.message : error)
        .replace(/^Error:\s*/, '')
        .split('\n')[0]
        .trim()
}

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

const activeTab = ref('create')
const skillName = ref('')
const skillContent = ref(`---
name: My Skill
description: A short description
---

# Instructions
Here are the instructions for the skill.
`)

const uploadFileName = ref('')
const uploadFileContent = ref('')

const importing = ref(false)

watch(
    () => props.visible,
    (value) => {
        if (!value) return
        activeTab.value = 'create'
        skillName.value = ''
        skillContent.value = `---\nname: My Skill\ndescription: A short description\n---\n\n# Instructions\nHere are the instructions for the skill.\n`
        uploadFileName.value = ''
        uploadFileContent.value = ''
    }
)

const canImport = computed(() => {
    if (activeTab.value === 'create') {
        return skillName.value.trim().length > 0 && skillContent.value.trim().length > 0
    } else {
        return uploadFileName.value.length > 0 && uploadFileContent.value.length > 0
    }
})

async function handleFileSelect(file: any) {
    const rawFile = file.raw as File
    if (!rawFile) return
    
    if (!/\.md$/i.test(rawFile.name)) {
        ElMessage.warning('请选择 .md 文件。')
        return
    }

    uploadFileName.value = rawFile.name
    uploadFileContent.value = await rawFile.text()
}

function stringToBase64(str: string) {
    const bytes = new TextEncoder().encode(str)
    let text = ''
    for (let idx = 0; idx < bytes.length; idx += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(idx, idx + 0x8000))
    }
    return btoa(text)
}

async function confirmImport() {
    try {
        await ElMessageBox.confirm(
            '确定要保存并导入该 Skill 吗？',
            '确认导入',
            {
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )
    } catch {
        return
    }

    importSkills()
}

async function importSkills() {
    try {
        importing.value = true
        
        let targetName = ''
        let targetContent = ''
        
        if (activeTab.value === 'create') {
            targetName = skillName.value.trim()
            targetContent = skillContent.value
        } else {
            targetName = uploadFileName.value.replace(/\.md$/i, '')
            targetContent = uploadFileContent.value
        }

        const previewResult = await send('chatluna-agent/previewSkillImport', {
            type: 'folder',
            name: targetName,
            files: [
                {
                    path: 'SKILL.md',
                    data: stringToBase64(targetContent)
                }
            ]
        })

        if (!previewResult.valid) {
            const errors = previewResult.skills?.[0]?.diagnostics?.join('\n') || previewResult.diagnostics.join('\n')
            ElMessage.error(`Skill 验证未通过：\n${errors || '未知错误'}`)
            return
        }

        const result = await send('chatluna-agent/importSkills', {
            type: 'folder',
            name: targetName,
            files: [
                {
                    path: 'SKILL.md',
                    data: stringToBase64(targetContent)
                }
            ]
        })

        emit('update:visible', false)
        emit('refresh')
        ElMessage.success(
            result.replaced.length > 0
                ? `已导入 1 个 Skill，并覆盖同名项。`
                : `已导入 1 个 Skill。`
        )
    } catch (error) {
        ElMessage.error(`导入失败: ${formatError(error)}`)
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
    min-width: 0;
}

.form-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 0;
    min-width: 0;
}

.field-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.upload-file-info {
    margin-top: 10px;
    font-size: 14px;
    color: var(--el-color-success);
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
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

@media (max-width: 768px) {
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

    :deep(.skills-import-dialog .el-tabs__header) {
        margin-bottom: 8px;
    }

    :deep(.skills-import-dialog .el-upload) {
        width: 100%;
    }

    :deep(.skills-import-dialog .el-upload-dragger) {
        width: 100%;
        padding: 18px 12px;
    }

    :deep(.skills-import-dialog .el-dialog__footer) {
        padding: 12px 16px 16px;
    }

    :deep(.skills-import-dialog .el-dialog__footer .el-button) {
        flex: 1 1 0;
        min-width: 0;
        margin: 0;
    }
}
</style>
