<template>
    <div class="mcp-page" :class="{ compact: compactMode }">
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">MCP</div>
                    <el-button
                        size="small"
                        class="mobile-only-desc-toggle"
                        :type="hideDesc ? 'primary' : 'default'"
                        plain
                        @click="hideDesc = !hideDesc"
                    >
                        {{ hideDesc ? '显示描述' : '隐藏描述' }}
                    </el-button>
                </div>

                <div class="actions-section">
                    <el-select
                        size="small"
                        :model-value="config?.mcpToolMode ?? 'eager'"
                        @change="saveMode"
                    >
                        <el-option value="eager" label="全量模式" />
                        <el-option value="catalog" label="目录懒加载" />
                    </el-select>
                    <el-button
                        size="small"
                        class="hidden-mobile"
                        :type="compactMode ? 'primary' : 'default'"
                        plain
                        @click="compactMode = !compactMode"
                    >
                        {{ compactMode ? '紧凑模式' : '宽屏模式' }}
                    </el-button>
                    <el-button
                        size="small"
                        class="hidden-mobile"
                        :type="hideDesc ? 'primary' : 'default'"
                        plain
                        @click="hideDesc = !hideDesc"
                    >
                        {{ hideDesc ? '显示描述' : '隐藏描述' }}
                    </el-button>
                </div>
            </div>
        </div>

        <div class="page-content" v-loading="loading">
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
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useCompactMode, useHideDesc } from '../shared/use-hide-desc'
import McpServersView from './mcp-servers-view.vue'
import McpJsonView from './mcp-json-view.vue'
import type { McpConfig, McpStatus, McpToolMode } from '../../../src/types'

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

const emit = defineEmits<{
    refresh: []
    save: [value: McpConfig]
}>()

const currentTab = ref('servers')
const compactMode = useCompactMode('mcp')
const hideDesc = useHideDesc('mcp')

const saveMode = (mode: McpToolMode) => {
    emit('save', {
        mcpServers: props.config.mcpServers,
        tools: props.config.tools,
        mcpToolMode: mode
    })
}
</script>

<style scoped>
.mcp-page {
    min-height: 100%;
    width: min(100%, 1800px);
    min-width: 0;
    margin: 0 auto;
    padding-bottom: 56px;
    box-sizing: border-box;
}

.mcp-page.compact {
    width: min(100%, 1200px);
}

.toolbar-container {
    margin-bottom: 16px;
}

.toolbar-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.headline {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
}

.mobile-only-desc-toggle {
    display: none;
}

.page-content {
    position: relative;
    min-height: 200px;
}

:deep(.el-loading-mask) {
    background-color: color-mix(in srgb, var(--k-page-bg), transparent 30%);
    z-index: 10;
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
    margin-top: 18px;
    margin-bottom: 22px;
    padding: 4px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 28%);
    border-radius: 16px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 48%);
    width: fit-content;
    max-width: 100%;
    box-sizing: border-box;
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

    .headline {
        justify-content: space-between;
        width: 100%;
        box-sizing: border-box;
    }

    .mobile-only-desc-toggle {
        display: inline-flex;
    }

    .actions-section {
        width: 100%;
        justify-content: flex-start;
    }

    .actions-section .el-button {
        margin-left: 0;
        margin-bottom: 4px;
    }

    .hidden-mobile {
        display: none;
    }

    .tabs {
        width: 100%;
        display: flex;
        justify-content: center;
    }

    .tab {
        flex: 1;
        text-align: center;
    }
}
</style>
