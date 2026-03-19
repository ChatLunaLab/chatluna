<template>
    <div class="panel grants-panel">
        <div class="panel-header">
            <div>
                <div class="panel-title">工具可用性</div>
                <div class="panel-description">
                    反向查看每个工具当前会被哪些 sub-agent 看到与允许。
                </div>
            </div>
        </div>

        <div v-if="availability.length > 0" class="grants-list">
            <div
                v-for="item in availability"
                :key="item.name"
                class="grant-row"
            >
                <div class="grant-title">{{ item.name }}</div>
                <div class="grant-meta">
                    {{ item.source || 'unknown' }}
                    {{ item.group ? ` / ${item.group}` : '' }}
                </div>
                <div
                    v-if="item.description"
                    class="grant-meta grant-description"
                >
                    {{ item.description }}
                </div>
                <div class="grant-tags">
                    <el-tag
                        v-for="agent in item.agents"
                        :key="agent"
                        size="small"
                        effect="plain"
                    >
                        {{ agent }}
                    </el-tag>
                    <span v-if="item.agents.length === 0" class="grant-empty">
                        当前没有 sub-agent 获得这个工具
                    </span>
                </div>
            </div>
        </div>

        <div v-else class="empty-state">
            <el-empty description="暂时没有工具授权数据。" />
        </div>
    </div>
</template>

<script setup lang="ts">
import type { ToolAvailabilityInfo } from '../../../src/types'

defineProps<{
    availability: ToolAvailabilityInfo[]
}>()
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

.panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
}

.panel-title,
.grant-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-description,
.grant-meta,
.grant-empty {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
}

.grants-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
    padding: 16px;
}

.grant-row {
    padding: 14px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 18%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    min-height: 188px;
    max-height: 232px;
    overflow: hidden;
}

.grant-description {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.grant-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: auto;
    max-height: 84px;
    overflow: auto;
    align-content: flex-start;
}

.empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 280px;
}

@media (max-width: 768px) {
    .grants-list {
        grid-template-columns: 1fr;
    }
}
</style>
