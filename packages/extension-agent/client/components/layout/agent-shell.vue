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
                                :config="mcpCfg"
                                :status="mcpStatus"
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
                                :config="skillsCfg"
                                :status="skillsStatus"
                                :computer="computerStatus"
                                :loading="loading"
                                @refresh="refreshData"
                            />
                        </div>

                        <div
                            v-else-if="activeTab === 'computer'"
                            key="computer"
                            class="view-container"
                        >
                            <computer-page
                                :config="computerCfg"
                                :status="computerStatus"
                                :loading="loading"
                            />
                        </div>

                        <div
                            v-else-if="activeTab === 'subAgent'"
                            key="sub-agent"
                            class="view-container"
                        >
                            <sub-agent-page
                                :config="subAgentCfg"
                                :status="subAgentStatus"
                                :skills="skillsStatus?.catalog"
                                :computer="computerStatus"
                                :tools="toolStatus?.catalog"
                                :loading="loading"
                                @refresh="refreshData"
                                @save="
                                    (value) => saveSection('subAgent', value)
                                "
                            />
                        </div>

                        <div v-else key="tool" class="view-container">
                            <tool-page
                                :config="toolCfg"
                                :status="toolStatus"
                                :agents="subAgentStatus?.catalog"
                                :loading="loading"
                                @refresh="refreshData"
                                @save="(value) => saveSection('tool', value)"
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
import SkillsPage from '../skills/skills-page.vue'
import ComputerPage from '../computer/computer-page.vue'
import ToolPage from '../tool/tool-page.vue'
import SubAgentPage from '../sub-agent/sub-agent-page.vue'
import type { AgentConfig } from '../../../src/types'

const activeTab = ref('mcp')
const pending = ref(false)
const data = computed(() => store.chatluna_agent_webui)
const config = computed(() => data.value?.config)
const status = computed(() => data.value?.status)
const mcpCfg = computed(() => data.value?.config?.mcp)
const skillsCfg = computed(() => data.value?.config?.skills)
const computerCfg = computed(() => data.value?.config?.computer)
const subAgentCfg = computed(() => data.value?.config?.subAgent)
const toolCfg = computed(() => data.value?.config?.tool)
const mcpStatus = computed(() => data.value?.status?.mcp)
const skillsStatus = computed(() => data.value?.status?.skills)
const computerStatus = computed(() => data.value?.status?.computer)
const subAgentStatus = computed(() => data.value?.status?.subAgent)
const toolStatus = computed(() => data.value?.status?.tool)
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
    key: 'subAgent' | 'tool',
    value: AgentConfig['subAgent'] | AgentConfig['tool']
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
    color: var(--k-text-dark);
    overflow: hidden;
}

.main-content {
    height: 100%;
    width: 100%;
}

.content-wrapper {
    padding: 28px 96px 120px 28px;
    width: min(100%, 1920px);
    max-width: 1920px;
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
