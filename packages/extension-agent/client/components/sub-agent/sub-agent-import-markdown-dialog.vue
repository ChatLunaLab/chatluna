<template>
    <el-dialog
        class="sub-agent-import-dialog"
        :model-value="visible"
        :fullscreen="mobile"
        title="从 Markdown 创建 Sub Agent"
        width="860px"
        destroy-on-close
        :close-on-click-modal="false"
        @update:model-value="$emit('update:visible', $event)"
    >
        <div class="dialog-body">
            <el-tabs v-model="activeTab">
                <el-tab-pane label="新建" name="create">
                    <div class="form-card">
                        <div class="field-label">Agent 名称 (将作为文件名)</div>
                        <el-input v-model="agentName" placeholder="例如：my-agent" />
                        
                        <div class="field-label" style="margin-top: 12px">简介</div>
                        <el-input v-model="agentDescription" placeholder="一句简短的描述" />
                        
                        <div class="field-label" style="margin-top: 12px">指令</div>
                        <code-editor
                            v-model="agentInstructions"
                            language="markdown"
                            :min-height="240"
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
                导入
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

function formatError(error: unknown) {
    return String(error instanceof Error ? error.message : error)
        .replace(/^Error:\s*/, '')
        .split('\n')[0]
        .trim()
}

const emit = defineEmits<{
    'update:visible': [value: boolean]
    refresh: []
    created: [id: string]
}>()

const activeTab = ref('create')
const agentName = ref('')
const agentDescription = ref('')
const agentInstructions = ref('')

const uploadFileName = ref('')
const uploadFileContent = ref('')

const importing = ref(false)

watch(
    () => props.visible,
    (value) => {
        if (!value) return
        activeTab.value = 'create'
        agentName.value = ''
        agentDescription.value = ''
        agentInstructions.value = ''
        uploadFileName.value = ''
        uploadFileContent.value = ''
    }
)

const canImport = computed(() => {
    if (activeTab.value === 'create') {
        return agentName.value.trim().length > 0 && agentDescription.value.trim().length > 0 && agentInstructions.value.trim().length > 0
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

async function confirmImport() {
    try {
        await ElMessageBox.confirm(
            '确定要保存并导入该 Sub Agent 吗？',
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

    importAgent()
}

async function importAgent() {
    try {
        importing.value = true
        
        let createdId = ''

        if (activeTab.value === 'create') {
            const targetName = agentName.value.trim()
            const result = await send('chatluna-agent/addSubAgent', {
                name: targetName,
                description: agentDescription.value.trim(),
                promptContent: agentInstructions.value
            })
            createdId = result.id
        } else {
            const targetName = uploadFileName.value
            const targetContent = uploadFileContent.value

            const previewResult = await send('chatluna-agent/previewSubAgentImport', targetContent)
            
            if (previewResult.state === 'invalid') {
                const errors = previewResult.diagnostics?.join('\n')
                ElMessage.error(`Sub Agent 验证未通过：\n${errors || '未知错误'}`)
                return
            }

            await send('chatluna-agent/uploadSubAgent', {
                name: targetName,
                data: targetContent
            })
        }

        emit('update:visible', false)
        emit('refresh')
        ElMessage.success('导入成功。')

        if (createdId) {
            emit('created', createdId)
        }
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

:deep(.sub-agent-import-dialog .el-dialog__body) {
    min-width: 0;
}

:deep(.sub-agent-import-dialog .el-input),
:deep(.sub-agent-import-dialog .el-textarea),
:deep(.sub-agent-import-dialog .el-tabs),
:deep(.sub-agent-import-dialog .el-upload) {
    width: 100%;
    max-width: 100%;
}

:deep(.sub-agent-import-dialog .el-dialog__footer) {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

@media (max-width: 768px) {
    :deep(.sub-agent-import-dialog .el-dialog.is-fullscreen) {
        width: 100vw !important;
        max-width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        margin: 0 !important;
        border-radius: 0;
    }

    :deep(.sub-agent-import-dialog .el-dialog.is-fullscreen .el-dialog__body) {
        overflow: auto;
        -webkit-overflow-scrolling: touch;
    }

    :deep(.sub-agent-import-dialog .el-dialog__header) {
        padding: 18px 16px 0;
    }

    :deep(.sub-agent-import-dialog .el-dialog__body) {
        padding: 12px 16px;
    }

    :deep(.sub-agent-import-dialog .el-tabs__header) {
        margin-bottom: 8px;
    }

    :deep(.sub-agent-import-dialog .el-upload-dragger) {
        width: 100%;
        padding: 18px 12px;
    }

    :deep(.sub-agent-import-dialog .el-dialog__footer) {
        padding: 12px 16px 16px;
    }

    :deep(.sub-agent-import-dialog .el-dialog__footer .el-button) {
        flex: 1 1 0;
        min-width: 0;
        margin: 0;
    }
}
</style>
