<template>
    <div class="panel catalog-panel">
        <div class="panel-header catalog-header">
            <div>
                <div class="panel-title">子 Agent 列表</div>
                <div class="panel-description">
                    ChatLuna 目前可用的全部子 Agent。
                </div>
            </div>

            <el-input
                v-model="keyword"
                class="search-input"
                placeholder="搜索名称、描述、路径或诊断"
                clearable
            >
                <template #prefix>
                    <el-icon><Search /></el-icon>
                </template>
            </el-input>
        </div>

        <div v-if="filteredAgents.length > 0" class="card-list">
            <div
                v-for="item in filteredAgents"
                :key="item.id"
                class="agent-card"
                :class="{
                    muted: !!item.shadowedBy,
                    invalid: item.state !== 'ready'
                }"
                @click="$emit('select', item.id)"
            >
                <div class="agent-top">
                    <div class="agent-brand">
                        <div class="agent-icon">
                            <el-icon :size="16"><UserFilled /></el-icon>
                        </div>

                        <div class="agent-copy">
                            <div class="agent-title">{{ item.name }}</div>
                            <div class="agent-name">
                                {{ item.source
                                }}{{ item.format ? ` / ${item.format}` : '' }}
                            </div>
                        </div>
                    </div>

                    <el-switch
                        :model-value="item.enabled"
                        @change="$emit('toggle', item, $event as boolean)"
                        @click.stop
                    />
                </div>

                <div class="agent-desc">
                    {{ item.description || '这个 agent 暂时没有说明。' }}
                </div>

                <div class="agent-meta">
                    <div class="agent-path">
                        {{ item.path || item.preset || '内置定义' }}
                    </div>
                </div>

                <div class="agent-footer">
                    <div class="agent-tags">
                        <el-tag v-if="item.scope" size="small" effect="plain">
                            {{ item.scope }}
                        </el-tag>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="
                                item.state === 'ready' &&
                                !item.hidden &&
                                !item.shadowedBy
                                    ? 'success'
                                    : 'info'
                            "
                        >
                            {{
                                item.state === 'ready' &&
                                !item.hidden &&
                                !item.shadowedBy
                                    ? '可用'
                                    : '不可用'
                            }}
                        </el-tag>
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
                </div>
            </div>
        </div>

        <div v-else class="empty-state">
            <el-empty description="没有匹配的 sub-agent。" />
        </div>
    </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search, UserFilled } from '@element-plus/icons-vue'
import type { SubAgentInfo } from '../../../src/types'

const props = defineProps<{
    agents: SubAgentInfo[]
}>()

defineEmits<{
    select: [id: string]
    toggle: [item: SubAgentInfo, enabled: boolean]
}>()

const keyword = ref('')

const filteredAgents = computed(() => {
    const text = keyword.value.trim().toLowerCase()
    if (!text) {
        return props.agents
    }

    return props.agents.filter((item) => {
        return [
            item.name,
            item.description,
            item.path,
            item.source,
            item.format,
            item.scope,
            item.preset,
            ...(item.diagnostics ?? [])
        ]
            .join('\n')
            .toLowerCase()
            .includes(text)
    })
})

function stateLabel(state: SubAgentInfo['state']) {
    if (state === 'ready') return '可用'
    if (state === 'invalid') return '无效'
    return '缺失'
}

function stateTag(state: SubAgentInfo['state']) {
    if (state === 'ready') return 'success'
    if (state === 'invalid') return 'warning'
    return 'info'
}
</script>

<style scoped>
.panel {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    overflow: hidden;
    min-height: 420px;
}

.panel-header,
.catalog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
}

.panel-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-description,
.agent-name,
.agent-desc,
.agent-path,
.diagnostic-line {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
}

.agent-desc {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.search-input {
    width: min(360px, 100%);
}

.card-list {
    --card-cols: 5;
    --card-gap: 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 14px var(--card-gap);
    padding: 16px;
}

.agent-card {
    flex: 0 1
        calc(
            (100% - (var(--card-cols) - 1) * var(--card-gap)) / var(--card-cols)
        );
    max-width: calc(
        (100% - (var(--card-cols) - 1) * var(--card-gap)) / var(--card-cols)
    );
    min-width: 0;
    box-sizing: border-box;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 12px;
    background: color-mix(in srgb, var(--k-activity-bg), var(--k-page-bg) 16%);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    cursor: pointer;
    transition:
        border-color 0.2s ease,
        transform 0.2s ease;
}

.agent-card:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 40%);
    transform: translateY(-1px);
}

.agent-card.muted {
    opacity: 0.72;
}

.agent-card.invalid {
    border-color: color-mix(in srgb, var(--el-color-warning), transparent 60%);
}

.agent-top {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: flex-start;
}

.agent-brand {
    display: flex;
    justify-content: flex-start;
    gap: 12px;
    min-width: 0;
}

.agent-copy {
    min-width: 0;
}

.agent-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.agent-icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-color-primary) 8%);
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 36%);
    flex: 0 0 auto;
}

.agent-path {
    font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
}

.agent-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.agent-footer {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.diagnostic-box {
    padding: 12px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--el-color-warning), transparent 95%);
}

.empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 280px;
}

@media (max-width: 1680px) {
    .card-list {
        --card-cols: 4;
    }
}

@media (max-width: 1320px) {
    .card-list {
        --card-cols: 3;
    }
}

@media (max-width: 980px) {
    .card-list {
        --card-cols: 2;
    }
}

@media (max-width: 768px) {
    .catalog-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .search-input {
        width: 100%;
    }

    .card-list {
        --card-cols: 1;
        flex-direction: column;
        align-items: stretch;
    }

    .agent-card {
        flex-basis: 100%;
        max-width: none;
    }

    .agent-top,
    .agent-brand {
        flex-direction: column;
        align-items: flex-start;
    }
}
</style>
