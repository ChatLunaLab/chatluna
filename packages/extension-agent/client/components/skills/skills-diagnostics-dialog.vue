<template>
    <el-dialog
        :model-value="visible"
        title="Skill 状态"
        width="680px"
        destroy-on-close
        @update:model-value="$emit('update:visible', $event)"
    >
        <div v-if="skill" class="dialog-body">
            <div class="hero-block">
                <div class="hero-title">
                    {{
                        skill.emoji
                            ? `${skill.emoji} ${skill.name}`
                            : skill.name
                    }}
                </div>
                <div class="hero-meta">
                    {{ `${skill.source} / ${skill.scope}` }}
                </div>
                <div class="hero-path">{{ skill.path }}</div>
            </div>

            <div v-if="summary.length > 0" class="section-block warning-block">
                <div class="section-title">当前状态</div>
                <div v-for="line in summary" :key="line" class="section-line">
                    {{ line }}
                </div>
            </div>

            <div class="section-block">
                <div class="section-title">诊断信息</div>
                <div v-if="skill.diagnostics.length > 0" class="section-list">
                    <div
                        v-for="line in skill.diagnostics"
                        :key="line"
                        class="section-line"
                    >
                        {{ line }}
                    </div>
                </div>
                <div v-else class="section-empty">当前没有更多错误信息。</div>
            </div>

            <div v-if="requires || install" class="section-block">
                <div class="section-title">依赖与安装</div>
                <div v-if="requires" class="section-line">
                    依赖要求：{{ requires }}
                </div>
                <div v-if="install" class="section-line">
                    安装方式：{{ install }}
                </div>
            </div>
        </div>

        <template #footer>
            <el-button @click="$emit('update:visible', false)">关闭</el-button>
        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SkillInfo } from '../../../src/types'

const props = defineProps<{
    visible: boolean
    skill?: SkillInfo
}>()

defineEmits<{
    'update:visible': [value: boolean]
}>()

const summary = computed(() => {
    if (!props.skill) {
        return []
    }

    const lines: string[] = []

    if (props.skill.state !== 'ready') {
        lines.push('当前技能定义无效，仅展示，不可编辑。')
    }

    if (!props.skill.available) {
        lines.push('当前环境未满足依赖，仅展示，不可编辑。')
    }

    return lines
})

const requires = computed(() => {
    if (!props.skill) {
        return ''
    }

    return [
        props.skill.requires?.bins?.length
            ? `bins: ${props.skill.requires.bins.join(', ')}`
            : '',
        props.skill.requires?.anyBins?.length
            ? `anyBins: ${props.skill.requires.anyBins.join(', ')}`
            : '',
        props.skill.requires?.env?.length
            ? `env: ${props.skill.requires.env.join(', ')}`
            : '',
        props.skill.requires?.config?.length
            ? `config: ${props.skill.requires.config.join(', ')}`
            : ''
    ]
        .filter(Boolean)
        .join(' | ')
})

const install = computed(() => {
    return (
        props.skill?.install
            ?.map((item) => item.label ?? `${item.kind}: ${item.id}`)
            .join('；') ?? ''
    )
})
</script>

<style scoped>
.dialog-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 6px 4px;
}

.hero-block,
.section-block {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 24%);
    border-radius: 12px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 22%);
    padding: 14px 16px;
}

.warning-block {
    border-color: color-mix(in srgb, var(--el-color-warning), transparent 52%);
    background: color-mix(
        in srgb,
        var(--el-color-warning-light-9),
        var(--k-page-bg) 38%
    );
}

.hero-title,
.section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.hero-meta,
.hero-path,
.section-line,
.section-empty {
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.7;
    color: var(--k-text-light);
    word-break: break-word;
}

.hero-path {
    font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
}

.section-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
</style>
