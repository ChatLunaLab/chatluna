<template>
    <div class="dashboard-container">
        <div class="main-content">
            <el-scrollbar>
                <div class="content-wrapper">
                    <Transition name="fade-slide" mode="out-in">
                        <div
                            v-if="activeTab === 'mcp'"
                            key="mcp"
                            class="view-container"
                        >
                            <mcp-page
                                :config="config?.mcp"
                                :status="status?.mcp"
                                :loading="loading"
                                @refresh="refreshData"
                                @save="saveMcp"
                            />
                        </div>

                        <div
                            v-else-if="activeTab === 'skills'"
                            key="skills"
                            class="view-container"
                        >
                            <skills-page
                                :config="config?.skills"
                                :loading="loading"
                                @refresh="refreshData"
                                @save="(value) => saveSection('skills', value)"
                            />
                        </div>

                        <div
                            v-else-if="activeTab === 'tool'"
                            key="tool"
                            class="view-container"
                        >
                            <tool-page
                                :config="config?.tool"
                                :loading="loading"
                                @refresh="refreshData"
                                @save="(value) => saveSection('tool', value)"
                            />
                        </div>

                        <div
                            v-else-if="activeTab === 'subAgent'"
                            key="sub-agent"
                            class="view-container"
                        >
                            <sub-agent-page
                                :config="config?.subAgent"
                                :status="status?.subAgent"
                                :loading="loading"
                                @refresh="refreshData"
                                @save="
                                    (value) => saveSection('subAgent', value)
                                "
                            />
                        </div>

                        <div v-else key="scheduler" class="view-container">
                            <scheduler-page
                                :config="config?.scheduler"
                                :loading="loading"
                                @refresh="refreshData"
                                @save="
                                    (value) => saveSection('scheduler', value)
                                "
                            />
                        </div>
                    </Transition>
                </div>
            </el-scrollbar>
        </div>

        <agent-sidebar :current="activeTab" @select="handleTabChange" />
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { send, store } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import AgentSidebar from './agent-sidebar.vue'
import McpPage from '../mcp/mcp-page.vue'
import SkillsPage from '../placeholder/skills-page.vue'
import SchedulerPage from '../placeholder/scheduler-page.vue'
import ToolPage from '../placeholder/tool-page.vue'
import SubAgentPage from '../placeholder/sub-agent-page.vue'
import type { AgentConfig, AgentConsoleData } from '../../../src/types'

const activeTab = ref('mcp')
const pending = ref(false)
const data = computed(() => store.chatlunaAgent as AgentConsoleData | undefined)
const config = computed(() => data.value?.config)
const status = computed(() => data.value?.status)
const loading = computed(() => pending.value || !data.value)

const refreshData = async () => {
    try {
        pending.value = true
        await send('chatluna-agent/refreshConsoleData')
    } catch {
        ElMessage.error('刷新 Agent 数据失败')
    } finally {
        pending.value = false
    }
}

const handleTabChange = (tab: string) => {
    activeTab.value = tab
}

const saveMcp = async (value: AgentConfig['mcp']) => {
    try {
        pending.value = true
        await send('chatluna-agent/saveMcp', value)
        ElMessage.success('MCP 配置已保存')
    } catch {
        ElMessage.error('保存 MCP 配置失败')
    } finally {
        pending.value = false
    }
}

const saveSection = async (
    key: 'skills' | 'tool' | 'subAgent' | 'scheduler',
    value: Record<string, unknown>
) => {
    if (!config.value) {
        return
    }

    try {
        pending.value = true
        await send('chatluna-agent/saveConfig', {
            ...config.value,
            [key]: value
        })

        ElMessage.success('配置已保存')
    } catch {
        ElMessage.error('保存配置失败')
    } finally {
        pending.value = false
    }
}
</script>

<style scoped>
.dashboard-container {
    position: relative;
    height: 100vh;
    background-color: var(--k-page-bg);
    color: var(--k-color-text);
    overflow: hidden;
}

.main-content {
    height: 100%;
    width: 100%;
}

.content-wrapper {
    padding: 28px 96px 120px 28px;
    width: min(100%, 1540px);
    max-width: 1540px;
    margin: 0 auto;
}

.view-container {
    min-height: 500px;
}

.fade-slide-enter-active,
.fade-slide-leave-active {
    transition: all 0.25s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
    opacity: 0;
    transform: translateY(12px);
}

@media (max-width: 768px) {
    .content-wrapper {
        padding: 16px;
        padding-bottom: 112px;
    }
}
</style>
