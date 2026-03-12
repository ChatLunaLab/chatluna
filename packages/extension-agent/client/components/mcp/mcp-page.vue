<template>
    <div class="mcp-page" v-loading="loading">
        <div class="toolbar-container">
            <div class="toolbar-main">
                <div class="headline">
                    <div class="page-title">MCP</div>
                    <div class="page-description">
                        管理服务器、工具与原始配置
                    </div>
                </div>

                <div class="actions-section">
                    <el-button circle @click="$emit('refresh')">
                        <el-icon><RefreshRight /></el-icon>
                    </el-button>
                </div>
            </div>
        </div>

        <div class="stats-grid">
            <div v-for="item in stats" :key="item.label" class="stat-card">
                <div class="stat-label">{{ item.label }}</div>
                <div class="stat-value">{{ item.value }}</div>
            </div>
        </div>

        <div class="tabs">
            <div
                :class="['tab', { active: currentTab === 'servers' }]"
                @click="currentTab = 'servers'"
            >
                Servers
            </div>
            <div
                :class="['tab', { active: currentTab === 'json' }]"
                @click="currentTab = 'json'"
            >
                JSON
            </div>
        </div>

        <div class="tab-content">
            <mcp-servers-view
                v-if="currentTab === 'servers'"
                :config="config"
                :status="status"
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
import { computed, ref } from 'vue'
import { RefreshRight } from '@element-plus/icons-vue'
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

const stats = computed(() => [
    {
        label: '已配置服务器',
        value: Object.keys(props.config.mcpServers).length
    },
    {
        label: '在线服务器',
        value: Object.values(props.status.servers).filter(
            (item) => item.connected
        ).length
    },
    {
        label: '可用工具',
        value: Object.keys(props.status.tools).length
    },
    {
        label: '启用工具',
        value: Object.values(props.status.tools).filter((item) => item.enabled)
            .length
    }
])
</script>

<style scoped>
.mcp-page {
    min-height: 100%;
    width: min(100%, 1480px);
    margin: 0 auto;
    padding-bottom: 56px;
}

.toolbar-container {
    position: sticky;
    top: 0;
    z-index: 5;
    background: linear-gradient(180deg, var(--k-page-bg) 72%, transparent);
    padding: 12px 0;
    margin-bottom: 12px;
}

.toolbar-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.page-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--k-color-text);
}

.page-description {
    margin-top: 4px;
    font-size: 13px;
    color: var(--k-text-light);
}

.actions-section {
    display: flex;
    gap: 8px;
    align-items: center;
}

.stats-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 20px;
}

.stat-card {
    border: 1px solid var(--k-color-divider);
    border-radius: 16px;
    background: var(--k-color-surface-1);
    padding: 18px;
    flex: 1 1 180px;
    min-width: 0;
}

.stat-label {
    font-size: 12px;
    color: var(--k-text-light);
    margin-bottom: 8px;
}

.stat-value {
    font-size: 24px;
    font-weight: 700;
    color: var(--k-color-text);
}

.tabs {
    display: flex;
    border-bottom: 1px solid var(--k-color-divider);
    margin-bottom: 20px;
    gap: 4px;
}

.tab {
    padding: 12px 20px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
    font-weight: 600;
    color: var(--k-text-light);
    border-radius: 14px 14px 0 0;
}

.tab:hover {
    background: var(--k-color-surface-1);
}

.tab.active {
    border-bottom-color: var(--k-color-primary);
    color: var(--k-color-primary);
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

    .stats-grid {
        gap: 12px;
    }

    .stat-card {
        flex-basis: 100%;
    }
}
</style>
