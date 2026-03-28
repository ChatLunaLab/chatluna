<template>
    <el-dialog
        class="preset-dialog"
        :model-value="visible"
        :fullscreen="mobile"
        title="从预设创建 Agent"
        width="640px"
        :close-on-click-modal="false"
        @update:model-value="$emit('update:visible', $event)"
    >
        <div class="preset-form">
            <div class="field-card full-row">
                <div class="field-label">名称</div>
                <el-input
                    v-model="form.name"
                    placeholder="例如 docs-writer"
                />
            </div>
            <div class="field-card full-row">
                <div class="field-label">说明</div>
                <el-input
                    v-model="form.description"
                    type="textarea"
                    :rows="3"
                    placeholder="这个预设 agent 适合做什么"
                />
            </div>
            <div class="field-card full-row">
                <div class="field-label">预设</div>
                <el-select v-model="form.preset" placeholder="选择预设">
                    <el-option
                        v-for="item in presetNames"
                        :key="item"
                        :label="item"
                        :value="item"
                    />
                </el-select>
            </div>
            <div class="field-grid two-col-grid">
                <div class="field-card">
                    <div class="field-label">模型覆盖</div>
                    <el-select
                        v-model="form.model"
                        clearable
                        filterable
                        placeholder="留空则继承父会话模型"
                    >
                        <el-option label="继承当前会话模型" value="" />
                        <el-option
                            v-for="item in modelOptions"
                            :key="item"
                            :label="item"
                            :value="item"
                        />
                    </el-select>
                </div>
                <div class="field-card">
                    <div class="field-label">最大轮次</div>
                    <el-input-number
                        v-model="form.maxTurns"
                        :min="1"
                        :max="100"
                    />
                </div>
            </div>
        </div>

        <template #footer>
            <el-button @click="$emit('update:visible', false)">
                取消
            </el-button>
            <el-button type="primary" @click="handleCreate">创建</el-button>
        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

const props = defineProps<{
    visible: boolean
    presetNames: string[]
    modelNames: string[]
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
    create: [
        name: string,
        preset: string,
        options: {
            description: string
            model: string | undefined
            maxTurns: number
            hidden: boolean
            allowKoishiMessageTransform: boolean
        }
    ]
}>()

const form = reactive({
    name: '',
    description: '',
    preset: '',
    model: '',
    maxTurns: 100
})

watch(
    () => props.visible,
    (value) => {
        if (value) {
            form.name = ''
            form.description = ''
            form.preset = props.presetNames[0] ?? ''
            form.model = ''
            form.maxTurns = 100
        }
    }
)

const modelOptions = computed(() => {
    const items = new Set(props.modelNames)
    if (form.model.trim()) {
        items.add(form.model.trim())
    }
    return [...items]
})

function handleCreate() {
    emit(
        'create',
        form.name.trim(),
        form.preset,
        {
            description: form.description.trim() || form.name.trim(),
            model: form.model.trim() || undefined,
            maxTurns: form.maxTurns,
            hidden: false,
            allowKoishiMessageTransform: false
        }
    )
}
</script>

<style scoped>
.preset-form {
    display: grid;
    gap: 14px;
    min-width: 0;
}

.field-grid {
    display: grid;
    gap: 14px;
}

.two-col-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.field-card {
    padding: 14px;
    min-width: 0;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(
        in srgb,
        var(--k-side-bg),
        var(--k-page-bg) 18%
    );
    box-sizing: border-box;
}

.field-card.full-row {
    grid-column: 1 / -1;
}

.field-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
    margin-bottom: 8px;
}

:deep(.preset-dialog .el-dialog__body) {
    min-width: 0;
}

:deep(.preset-dialog .el-input),
:deep(.preset-dialog .el-textarea),
:deep(.preset-dialog .el-select),
:deep(.preset-dialog .el-input-number) {
    width: 100%;
    max-width: 100%;
}

:deep(.preset-dialog .el-input-number) {
    display: flex;
}

:deep(.preset-dialog .el-input-number .el-input__wrapper) {
    width: 100%;
}

:deep(.preset-dialog .el-dialog__footer) {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

@media (max-width: 768px) {
    :deep(.preset-dialog .el-dialog.is-fullscreen) {
        width: 100vw !important;
        max-width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        margin: 0 !important;
        border-radius: 0;
    }

    :deep(.preset-dialog .el-dialog.is-fullscreen .el-dialog__body) {
        overflow: auto;
        -webkit-overflow-scrolling: touch;
    }

    .two-col-grid {
        grid-template-columns: 1fr;
    }

    :deep(.preset-dialog .el-dialog__header) {
        padding: 18px 16px 0;
    }

    :deep(.preset-dialog .el-dialog__body) {
        padding: 12px 16px;
    }

    :deep(.preset-dialog .el-dialog__footer) {
        padding: 12px 16px 16px;
    }

    :deep(.preset-dialog .el-dialog__footer .el-button) {
        flex: 1 1 0;
        min-width: 0;
        margin: 0;
    }
}
</style>
