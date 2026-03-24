<template>
    <el-dialog
        :model-value="visible"
        title="Skills 设置"
        width="720px"
        destroy-on-close
        @update:model-value="$emit('update:visible', $event)"
    >
        <div class="settings-body">
            <div class="setting-row info-row">
                <div class="setting-copy">
                    <div class="setting-title">电脑使用权限 (Computer Use)</div>
                    <div class="setting-description">指示 AI 是否具备操作终端、文件系统或桌面环境的能力。</div>
                    <div class="setting-description setting-hint">
                        状态：{{ computerHint }} (由当前配置的执行后端自动注入提示词)
                    </div>
                </div>
            </div>

            <div class="setting-row info-row">
                <div class="setting-copy">
                    <div class="setting-title">技能根目录</div>
                    <div class="setting-description path-copy">
                        {{ status.root || '尚未初始化' }}
                    </div>
                </div>
            </div>

            <div class="setting-row dialog-section-header">
                <div class="setting-copy">
                    <div class="setting-title">额外位置</div>
                    <div class="setting-description">
                        在这里添加的目录也会自动扫描可用的 Skills。
                    </div>
                </div>

                <el-button @click="addDraftDir()">添加位置</el-button>
            </div>

            <div v-if="dirDraft.length > 0" class="dir-list">
                <div v-for="(item, idx) in dirDraft" :key="idx" class="dir-row">
                    <el-input
                        :model-value="item"
                        placeholder="例如：~/.agents/skills"
                        @update:model-value="updateDraftDir(idx, $event)"
                    />
                    <el-button text @click="removeDraftDir(idx)">
                        删除
                    </el-button>
                </div>
            </div>

            <div v-else class="dir-empty">暂无额外位置。</div>
        </div>

        <template #footer>
            <el-button @click="$emit('update:visible', false)">取消</el-button>
            <el-button type="primary" :loading="saving" @click="saveSettings">
                保存
            </el-button>
        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import type {
    ComputerStatus,
    SkillsConfig,
    SkillsStatus
} from '../../../src/types'

const props = withDefaults(
    defineProps<{
        visible: boolean
        config: SkillsConfig
        status: SkillsStatus
        computer?: ComputerStatus
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
        computer: undefined
    }
)

const emit = defineEmits<{
    'update:visible': [value: boolean]
    refresh: []
}>()

const dirDraft = ref<string[]>([])
const saving = ref(false)

watch(
    () => [props.visible, props.config.dirs] as const,
    ([visible]) => {
        if (!visible) {
            return
        }

        dirDraft.value = [...(props.config.dirs ?? [])]
    },
    {
        immediate: true,
        deep: true
    }
)

const computerHint = computed(() => {
    if (props.computer?.enabled) {
        return '当前已生效。'
    }

    return '当前未生效。'
})

async function saveSettings() {
    try {
        saving.value = true
        const dirs = dirDraft.value
            .map((item) => item.trim())
            .filter(
                (item, idx, list) =>
                    item.length > 0 && list.indexOf(item) === idx
            )

        await send('chatluna-agent/saveSkills', {
            items: { ...props.config.items },
            dirs
        } satisfies SkillsConfig)

        emit('update:visible', false)
        emit('refresh')
        ElMessage.success('已保存设置，并重新扫描技能目录。')
    } catch {
        ElMessage.error('保存失败，请稍后重试。')
    } finally {
        saving.value = false
    }
}

function addDraftDir() {
    dirDraft.value.push('')
}

function removeDraftDir(idx: number) {
    dirDraft.value.splice(idx, 1)
}

function updateDraftDir(idx: number, value: string) {
    dirDraft.value[idx] = value
}
</script>

<style scoped>
.settings-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px;
    max-height: 50vh;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--k-color-divider), #71717a 40%)
        transparent;
}

.settings-body::-webkit-scrollbar {
    width: 10px;
}

.settings-body::-webkit-scrollbar-track {
    background: transparent;
}

.settings-body::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--k-color-divider), #71717a 40%);
    border-radius: 10px;
    border: 2px solid transparent;
    background-clip: content-box;
}

.settings-body::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--k-color-divider), #52525b 58%);
    background-clip: content-box;
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

.info-row,
.dialog-section-header {
    align-items: center;
}

.setting-copy {
    min-width: 0;
}

.setting-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.setting-description,
.dir-empty {
    font-size: 12px;
    color: var(--k-text-light);
    line-height: 1.6;
    word-break: break-word;
}

.path-copy {
    margin-top: 4px;
}

.setting-hint {
    margin-top: 6px;
    color: color-mix(in srgb, var(--el-color-success), var(--k-text-dark) 24%);
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

@media (max-width: 768px) {
    .setting-row,
    .dialog-section-header {
        flex-direction: column;
        align-items: flex-start;
    }
}
</style>
