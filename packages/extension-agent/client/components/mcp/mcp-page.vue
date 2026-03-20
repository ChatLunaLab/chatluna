<template>
    <div class="mcp-page" :class="{ compact: compactMode }" v-loading="loading">
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">MCP</div>
                </div>

                <div class="actions-section">
                    <el-button
                        size="small"
                        :type="compactMode ? 'primary' : 'default'"
                        plain
                        @click="compactMode = !compactMode"
                    >
                        {{ compactMode ? '宽屏模式' : '紧凑显示' }}
                    </el-button>
                    <el-button
                        size="small"
                        :type="hideDesc ? 'primary' : 'default'"
                        plain
                        @click="hideDesc = !hideDesc"
                    >
                        {{ hideDesc ? '显示描述' : '隐藏描述' }}
                    </el-button>
                </div>
            </div>
        </div>

        <div class="tabs">
            <div
                :class="['tab', { active: currentTab === 'servers' }]"
                @click="currentTab = 'servers'"
            >
                服务器与工具
            </div>
            <div
                :class="['tab', { active: currentTab === 'json' }]"
                @click="currentTab = 'json'"
            >
                JSON 配置
            </div>
        </div>

        <div class="tab-content">
            <mcp-servers-view
                v-if="currentTab === 'servers'"
                :config="config"
                :compact-mode="compactMode"
                :status="status"
                :hide-desc="hideDesc"
                @refresh="$emit('refresh')"
            />
            <mcp-json-view
                v-else
                :config="config"
                @refresh="$emit('refresh')"
                @save="$emit('save', $event)"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useCompactMode, useHideDesc } from '../shared/use-hide-desc'
import McpServersView from './mcp-servers-view.vue'
import McpJsonView from './mcp-json-view.vue'
import type { McpConfig, McpStatus } from '../../../src/types'

const props = withDefaults(
    defineProps<{
        config: McpConfig
        status: McpStatus
        loading?: boolean
    }>(),
    {
        config: () => ({
            mcpServers: {},
            tools: {}
        }),
        status: () => ({
            connected: false,
            servers: {},
            tools: {}
        }),
        loading: false
    }
)

defineEmits<{
    refresh: []
    save: [value: McpConfig]
}>()

const currentTab = ref('servers')
const compactMode = useCompactMode('mcp')
const hideDesc = useHideDesc('mcp')
</script>

<style scoped>
.mcp-page {
    min-height: 100%;
    width: 100%;
    min-width: 0;
    margin: 0 auto;
    padding-bottom: 56px;
}

.toolbar-container {
    position: sticky;
    top: 0;
    z-index: 5;
    background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 18%) 0%,
        color-mix(in srgb, var(--k-page-bg), transparent 12%) 76%,
        transparent 100%
    );
    padding: 10px 0 14px;
    margin-bottom: 10px;
    backdrop-filter: blur(8px);
}

.toolbar-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.headline {
    min-width: 0;
}

.page-title {
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--k-text-dark);
}

.actions-section {
    display: flex;
    gap: 8px;
    align-items: center;
}

.tabs {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 22px;
    padding: 4px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 28%);
    border-radius: 16px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 48%);
    width: fit-content;
    max-width: 100%;
}

.tab {
    padding: 10px 16px;
    cursor: pointer;
    transition:
        background-color 0.2s ease,
        color 0.2s ease;
    font-weight: 500;
    color: var(--k-text-light);
    border-radius: 12px;
    white-space: nowrap;
}

.tab:hover {
    background: color-mix(in srgb, var(--k-activity-bg), transparent 18%);
}

.tab.active {
    background: var(--k-side-bg);
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 24%);
    box-shadow: inset 0 0 0 1px
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
}

.tab-content {
    min-height: 400px;
}

@media (max-width: 768px) {
    .toolbar-main {
        flex-direction: column;
        align-items: flex-start;
    }

    .actions-section {
        width: 100%;
        justify-content: flex-end;
    }

    .tabs {
        width: 100%;
    }

    .tab {
        flex: 1 1 0;
        text-align: center;
    }
}
</style>
