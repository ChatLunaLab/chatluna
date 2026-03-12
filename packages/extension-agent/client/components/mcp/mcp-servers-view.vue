<template>
    <div class="servers-view">
        <div class="panel">
            <div class="panel-header">
                <div>
                    <div class="panel-title">Servers</div>
                    <div class="panel-description">
                        配置 MCP 服务端连接、状态与重连操作
                    </div>
                </div>

                <div class="panel-actions">
                    <el-button circle :loading="reloading" @click="reloadMcp">
                        <el-icon><RefreshRight /></el-icon>
                    </el-button>
                    <el-button type="primary" circle @click="openCreate">
                        <el-icon><Plus /></el-icon>
                    </el-button>
                </div>
            </div>

            <div v-if="servers.length > 0" class="card-grid server-grid">
                <div
                    v-for="item in servers"
                    :key="item.name"
                    class="server-card"
                    :class="{ busy: item.status?.updating }"
                >
                    <div class="server-head">
                        <div class="server-brand">
                            <div class="server-icon">
                                <img
                                    v-if="item.status?.icon?.src"
                                    :src="item.status.icon.src"
                                    alt=""
                                />
                                <el-icon v-else :size="18">
                                    <Connection />
                                </el-icon>
                            </div>

                            <div class="server-copy">
                                <div
                                    v-if="
                                        item.status?.title &&
                                        item.status.title !== item.name
                                    "
                                    class="server-title"
                                >
                                    {{ item.status.title }}
                                </div>
                                <div class="server-name">{{ item.name }}</div>
                                <div class="server-kind">
                                    <span>{{ item.kind }}</span>
                                    <span v-if="item.status?.version">
                                        v{{ item.status.version }}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <el-tag
                            :type="stateTag(item.status?.state)"
                            round
                            effect="plain"
                        >
                            {{ stateLabel(item.status?.state) }}
                        </el-tag>
                    </div>

                    <div class="server-summary">
                        {{ item.status?.stateText || '尚未连接，等待初始化' }}
                    </div>

                    <div class="server-chips">
                        <el-tag size="small" effect="plain">
                            {{ item.kind }}
                        </el-tag>
                        <el-tag size="small" effect="plain">
                            {{ item.tools.length }} 工具
                        </el-tag>
                        <el-tag size="small" effect="plain">
                            {{ item.server.timeout ?? 60 }}s
                        </el-tag>
                        <el-tag
                            v-if="item.status?.attempts"
                            size="small"
                            type="warning"
                            effect="plain"
                        >
                            重试 {{ item.status.attempts }}/{{
                                item.status.maxAttempts ?? 5
                            }}
                        </el-tag>
                    </div>

                    <div class="server-endpoint">
                        {{ item.endpoint || '未配置入口' }}
                    </div>

                    <div v-if="item.status?.error" class="error-box">
                        {{ item.status.error }}
                    </div>

                    <div class="server-actions">
                        <el-button
                            size="small"
                            :disabled="item.status?.updating"
                            @click="openEdit(item.name)"
                        >
                            编辑
                        </el-button>
                        <el-button
                            size="small"
                            type="primary"
                            plain
                            :loading="item.status?.updating"
                            :disabled="item.status?.updating"
                            @click="reconnect(item.name)"
                        >
                            重连
                        </el-button>
                        <el-button
                            size="small"
                            type="danger"
                            plain
                            :disabled="item.status?.updating"
                            @click="removeServer(item.name)"
                        >
                            删除
                        </el-button>
                    </div>
                </div>
            </div>

            <div v-else class="empty-state">
                <el-empty description="当前没有 MCP 服务器" />
            </div>
        </div>

        <div class="panel">
            <div class="panel-header">
                <div>
                    <div class="panel-title">Tools</div>
                    <div class="panel-description">
                        单独查看工具状态、超时与选择器
                    </div>
                </div>
            </div>

            <div v-if="tools.length > 0" class="card-grid tool-grid">
                <div
                    v-for="item in tools"
                    :key="item.name"
                    class="tool-card"
                    :class="{ busy: item.updating }"
                >
                    <div class="tool-top">
                        <div class="tool-brand">
                            <div class="tool-icon">
                                <img
                                    v-if="item.icon?.src"
                                    :src="item.icon.src"
                                    alt=""
                                />
                                <el-icon v-else :size="16">
                                    <Tools />
                                </el-icon>
                            </div>

                            <div>
                                <div class="tool-title">
                                    {{ item.title || item.name }}
                                </div>
                                <div class="tool-name">{{ item.name }}</div>
                            </div>
                        </div>

                        <el-switch
                            :model-value="item.enabled"
                            :loading="item.updating"
                            :disabled="item.updating"
                            @change="
                                (value) => toggleTool(item, value as boolean)
                            "
                        />
                    </div>

                    <div class="tool-description">
                        {{ item.description || '无描述' }}
                    </div>

                    <div class="tool-chips">
                        <el-tag size="small" effect="plain">
                            {{ item.server }}
                        </el-tag>
                        <el-tag size="small" effect="plain">
                            {{ item.timeout ? `${item.timeout}s` : '默认超时' }}
                        </el-tag>
                        <el-tag
                            size="small"
                            :type="
                                item.updating
                                    ? 'warning'
                                    : item.enabled
                                      ? 'success'
                                      : 'info'
                            "
                            effect="plain"
                        >
                            {{
                                item.updating
                                    ? '更新中'
                                    : item.enabled
                                      ? '已启用'
                                      : '已停用'
                            }}
                        </el-tag>
                    </div>

                    <div class="tool-actions">
                        <el-button
                            size="small"
                            :disabled="item.updating"
                            @click="openTool(item)"
                        >
                            编辑配置
                        </el-button>
                    </div>
                </div>
            </div>

            <div v-else class="empty-state empty-tools">
                <el-empty description="当前没有 MCP 工具" />
            </div>
        </div>

        <el-dialog
            v-model="showServerDialog"
            :title="editing ? '编辑 MCP 服务器' : '新建 MCP 服务器'"
            width="760px"
            destroy-on-close
        >
            <div class="dialog-head">
                <el-radio-group
                    :model-value="serverMode"
                    @update:model-value="switchServerMode"
                    size="large"
                >
                    <el-radio-button value="form" label="form">
                        <div
                            style="display: flex; align-items: center; gap: 6px"
                        >
                            <el-icon><Menu /></el-icon>
                            表单模式
                        </div>
                    </el-radio-button>
                    <el-radio-button value="json" label="json">
                        <div
                            style="display: flex; align-items: center; gap: 6px"
                        >
                            <el-icon><Document /></el-icon>
                            JSON 模式
                        </div>
                    </el-radio-button>
                </el-radio-group>
            </div>

            <div v-if="serverMode === 'form'" class="dialog-grid">
                <div class="form-group">
                    <label class="form-label">服务器名称</label>
                    <el-input
                        v-model="form.name"
                        placeholder="例如: my-mcp-server"
                    />
                </div>

                <div class="form-group">
                    <label class="form-label">连接类型</label>
                    <el-select
                        v-model="form.type"
                        style="width: 100%"
                        placeholder="选择连接类型"
                    >
                        <el-option label="Stdio (本地进程)" value="stdio" />
                        <el-option
                            label="SSE (Server-Sent Events)"
                            value="sse"
                        />
                        <el-option label="HTTP" value="http" />
                        <el-option
                            label="Streamable HTTP"
                            value="streamable_http"
                        />
                    </el-select>
                </div>

                <div v-if="form.type === 'stdio'" class="form-span">
                    <label class="form-label">启动命令</label>
                    <el-input
                        v-model="form.command"
                        placeholder="例如: npx, node, python"
                    />
                </div>

                <div v-if="form.type === 'stdio'" class="form-span">
                    <label class="form-label">启动参数</label>
                    <el-input
                        v-model="form.args"
                        type="textarea"
                        :rows="3"
                        placeholder="每行一个参数，例如:&#10;-y&#10;@modelcontextprotocol/server-everything"
                    />
                </div>

                <div v-if="form.type === 'stdio'" class="form-span">
                    <label class="form-label">环境变量 (JSON)</label>
                    <code-editor
                        v-model="form.env"
                        language="json"
                        :min-height="160"
                        placeholder='例如: { "API_KEY": "xxx" }'
                    />
                </div>

                <div v-if="form.type !== 'stdio'" class="form-span">
                    <label class="form-label">服务 URL</label>
                    <el-input
                        v-model="form.url"
                        placeholder="例如: http://localhost:3000/sse"
                    />
                </div>

                <div v-if="form.type !== 'stdio'" class="form-span">
                    <label class="form-label">请求头 (JSON)</label>
                    <code-editor
                        v-model="form.headers"
                        language="json"
                        :min-height="160"
                        placeholder='例如: { "Authorization": "Bearer xxx" }'
                    />
                </div>

                <div class="form-group">
                    <label class="form-label">超时时间 (秒)</label>
                    <el-input-number
                        v-model="form.timeout"
                        :min="1"
                        :max="600"
                        style="width: 100%"
                    />
                </div>

                <div v-if="form.type === 'stdio'" class="form-group">
                    <label class="form-label">工作目录</label>
                    <el-input
                        v-model="form.cwd"
                        placeholder="可选，留空使用默认目录"
                    />
                </div>

                <div class="form-span">
                    <label class="form-label">网络代理</label>
                    <el-input
                        v-model="form.proxy"
                        placeholder="可选，例如: http://127.0.0.1:7890"
                    />
                </div>
            </div>

            <div v-else class="json-mode">
                <div class="json-layout">
                    <div class="json-editor-section">
                        <div class="section-header">
                            <label class="form-label">服务器 JSON</label>
                            <el-tag
                                v-if="jsonValid"
                                size="small"
                                type="success"
                                effect="plain"
                            >
                                有效
                            </el-tag>
                            <el-tag
                                v-else-if="serverJson.trim()"
                                size="small"
                                type="warning"
                                effect="plain"
                            >
                                输入中
                            </el-tag>
                        </div>
                        <code-editor
                            v-model="serverJson"
                            language="json"
                            :min-height="400"
                            placeholder="直接粘贴服务器 JSON 或包含 mcpServers 的对象"
                            @update:model-value="syncJsonToForm"
                        />
                    </div>

                    <div class="json-preview-section">
                        <label class="form-label">实时预览</label>
                        <div class="json-preview">
                            <div class="preview-card">
                                <div class="preview-header">
                                    <div class="preview-icon">
                                        <el-icon :size="18">
                                            <Connection />
                                        </el-icon>
                                    </div>
                                    <div class="preview-info">
                                        <div class="preview-name">
                                            {{ form.name || '未命名服务器' }}
                                        </div>
                                        <div class="preview-type">
                                            {{ form.type }}
                                        </div>
                                    </div>
                                </div>

                                <div class="preview-divider"></div>

                                <div class="preview-field">
                                    <span class="field-label">名称</span>
                                    <el-input
                                        v-model="form.name"
                                        size="small"
                                        placeholder="输入服务器名称"
                                        @input="syncFormToJson"
                                    />
                                </div>

                                <div class="preview-field">
                                    <span class="field-label">类型</span>
                                    <span class="field-value">
                                        {{ form.type }}
                                    </span>
                                </div>

                                <div
                                    v-if="form.type === 'stdio' && form.command"
                                    class="preview-field"
                                >
                                    <span class="field-label">命令</span>
                                    <span class="field-value">
                                        {{ form.command }}
                                    </span>
                                </div>

                                <div
                                    v-if="form.type !== 'stdio' && form.url"
                                    class="preview-field"
                                >
                                    <span class="field-label">URL</span>
                                    <span class="field-value">
                                        {{ form.url }}
                                    </span>
                                </div>

                                <div class="preview-field">
                                    <span class="field-label">超时</span>
                                    <span class="field-value">
                                        {{ form.timeout }}s
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <template #footer>
                <div class="dialog-footer">
                    <el-button @click="showServerDialog = false">
                        取消
                    </el-button>
                    <el-button
                        type="primary"
                        :loading="savingServer"
                        @click="saveServer"
                    >
                        保存
                    </el-button>
                </div>
            </template>
        </el-dialog>

        <el-dialog
            v-model="showToolDialog"
            title="编辑 MCP 工具"
            width="620px"
            destroy-on-close
        >
            <div class="dialog-grid">
                <div class="form-group">
                    <label class="form-label">名称</label>
                    <el-input :model-value="toolForm.name" disabled />
                </div>

                <div class="form-group">
                    <label class="form-label">来源服务器</label>
                    <el-input :model-value="toolForm.server" disabled />
                </div>

                <div class="form-group">
                    <label class="form-label">启用状态</label>
                    <el-switch v-model="toolForm.enabled" />
                </div>

                <div class="form-group">
                    <label class="form-label">超时（秒）</label>
                    <el-input-number
                        v-model="toolForm.timeout"
                        :min="0"
                        :max="600"
                    />
                </div>
            </div>

            <template #footer>
                <div class="dialog-footer">
                    <el-button @click="showToolDialog = false">取消</el-button>
                    <el-button
                        type="primary"
                        :loading="savingTool"
                        @click="saveTool"
                    >
                        保存
                    </el-button>
                </div>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
    Connection,
    Plus,
    RefreshRight,
    Tools,
    Menu,
    Document
} from '@element-plus/icons-vue'
import type {
    McpConfig,
    McpServerConfig,
    McpServerState,
    McpStatus,
    McpToolConfig,
    McpToolInfo
} from '../../../src/types'
import CodeEditor from '../shared/code-editor.vue'

function getServerType(config: McpServerConfig) {
    return config.type ?? (config.url ? 'http' : 'stdio')
}

function stateTag(state?: McpServerState) {
    if (state === 'connected') {
        return 'success'
    }

    if (state === 'connecting' || state === 'reconnecting') {
        return 'warning'
    }

    if (state === 'error') {
        return 'danger'
    }

    return 'info'
}

function stateLabel(state?: McpServerState) {
    if (state === 'connected') {
        return '已连接'
    }

    if (state === 'connecting') {
        return '连接中'
    }

    if (state === 'reconnecting') {
        return '重连中'
    }

    if (state === 'error') {
        return '异常'
    }

    return '待启动'
}

function looksLikeServer(value: Record<string, unknown>) {
    return 'command' in value || 'url' in value || 'type' in value
}

function parseJson(text: string) {
    const value = JSON.parse(text || '{}')

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('请输入合法的 JSON 对象')
    }

    return value as Record<string, unknown>
}

function parseRecord(text: string) {
    const value = parseJson(text)

    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, String(item ?? '')])
    )
}

function formatServerJson(name: string, config: McpServerConfig) {
    const value = name ? { name, ...config } : config
    return JSON.stringify(value, null, 2)
}

function withEnv(
    config: McpServerConfig & { environment?: Record<string, string> }
) {
    if (config.environment == null || config.env != null) {
        return config
    }

    return {
        ...config,
        env: config.environment
    }
}

function parseServerJson(text: string, rawName: string) {
    const parsed = parseJson(text)

    if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        const servers = parsed.mcpServers as Record<string, McpServerConfig>
        const name = rawName.trim()

        if (name && servers[name]) {
            return {
                name,
                config: withEnv(servers[name])
            }
        }

        const list = Object.entries(servers)
        if (list.length === 1) {
            return {
                name: name || list[0][0],
                config: withEnv(list[0][1])
            }
        }

        throw new Error('检测到多个服务器，请先输入名称或只保留一个配置')
    }

    if (looksLikeServer(parsed)) {
        const next = { ...parsed } as Record<string, unknown>
        const name = rawName.trim() || String(parsed.name || '')

        if (!name) {
            throw new Error('请输入名称，或在 JSON 中提供 name 字段')
        }

        if (next.environment != null && next.env == null) {
            next.env = next.environment
        }

        delete next.name
        delete next.environment

        return {
            name,
            config: withEnv(next as McpServerConfig)
        }
    }

    const list = Object.entries(parsed)
    if (
        list.length === 1 &&
        list[0][1] &&
        typeof list[0][1] === 'object' &&
        !Array.isArray(list[0][1]) &&
        looksLikeServer(list[0][1] as Record<string, unknown>)
    ) {
        return {
            name: rawName.trim() || list[0][0],
            config: withEnv(list[0][1] as McpServerConfig)
        }
    }

    throw new Error('无法从 JSON 识别 MCP 服务器')
}

const props = withDefaults(
    defineProps<{
        config: McpConfig
        status: McpStatus
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
        })
    }
)

defineEmits<{
    refresh: []
}>()

const showServerDialog = ref(false)
const showToolDialog = ref(false)
const savingServer = ref(false)
const savingTool = ref(false)
const reloading = ref(false)
const editing = ref('')
const serverMode = ref<'form' | 'json'>('form')
const serverJson = ref('')
const syncing = ref(false)

const jsonValid = computed(() => {
    if (!serverJson.value.trim()) return false
    try {
        parseServerJson(serverJson.value, form.name)
        return true
    } catch {
        return false
    }
})

const form = reactive({
    name: '',
    type: 'stdio' as NonNullable<McpServerConfig['type']>,
    command: '',
    args: '',
    env: '{}',
    url: '',
    headers: '{}',
    timeout: 60,
    cwd: '',
    proxy: ''
})

const toolForm = reactive({
    name: '',
    server: '',
    enabled: true,
    timeout: 0,
    selector: ''
})

const servers = computed(() =>
    Object.entries(props.config.mcpServers)
        .map(([name, server]) => ({
            name,
            kind: getServerType(server),
            endpoint: server.command || server.url || '',
            server,
            status: props.status.servers[name],
            tools: Object.values(props.status.tools).filter(
                (tool) => tool.server === name
            )
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
)

const tools = computed(() =>
    Object.values(props.status.tools).sort((a, b) =>
        a.name.localeCompare(b.name)
    )
)

function envCount(server: McpServerConfig) {
    return Object.keys(server.env || {}).length
}

function headerCount(server: McpServerConfig) {
    return Object.keys(server.headers || {}).length
}

function getFormConfig() {
    const config: McpServerConfig = {
        type: form.type,
        timeout: form.timeout
    }

    if (form.type === 'stdio') {
        if (form.command.trim()) {
            config.command = form.command.trim()
        }

        config.args = form.args
            .split('\n')
            .map((item) => item.trim())
            .filter(Boolean)
        config.env = parseRecord(form.env)

        if (form.cwd.trim()) {
            config.cwd = form.cwd.trim()
        }
    } else {
        if (form.url.trim()) {
            config.url = form.url.trim()
        }

        config.headers = parseRecord(form.headers)
    }

    if (form.proxy.trim()) {
        config.proxy = form.proxy.trim()
    }

    return config
}

function fillForm(name: string, server: McpServerConfig) {
    form.name = name
    form.type = server.type ?? (server.url ? 'http' : 'stdio')
    form.command = server.command ?? ''
    form.args = (server.args ?? []).join('\n')
    form.env = JSON.stringify(server.env ?? {}, null, 2)
    form.url = server.url ?? ''
    form.headers = JSON.stringify(server.headers ?? {}, null, 2)
    form.timeout = server.timeout ?? 60
    form.cwd = server.cwd ?? ''
    form.proxy = server.proxy ?? ''
    serverJson.value = formatServerJson(name, server)
}

function resetServerForm() {
    fillForm('', {
        type: 'stdio',
        command: '',
        args: []
    })
}

function syncJsonToForm() {
    if (syncing.value) return
    syncing.value = true

    try {
        const parsed = parseServerJson(serverJson.value, form.name)
        form.name = parsed.name
        form.type = parsed.config.type ?? (parsed.config.url ? 'http' : 'stdio')
        form.command = parsed.config.command ?? ''
        form.args = (parsed.config.args ?? []).join('\n')
        form.env = JSON.stringify(parsed.config.env ?? {}, null, 2)
        form.url = parsed.config.url ?? ''
        form.headers = JSON.stringify(parsed.config.headers ?? {}, null, 2)
        form.timeout = parsed.config.timeout ?? 60
        form.cwd = parsed.config.cwd ?? ''
        form.proxy = parsed.config.proxy ?? ''
    } catch {
        // ignore parse errors during typing
    } finally {
        syncing.value = false
    }
}

function syncFormToJson() {
    if (syncing.value) return
    syncing.value = true

    try {
        serverJson.value = formatServerJson(form.name.trim(), getFormConfig())
    } catch {
        // ignore errors
    } finally {
        syncing.value = false
    }
}

function switchServerMode(mode: 'form' | 'json') {
    if (mode === serverMode.value) {
        return
    }

    try {
        if (mode === 'json') {
            serverJson.value = formatServerJson(
                form.name.trim(),
                getFormConfig()
            )
            serverMode.value = mode
            return
        }

        const parsed = parseServerJson(serverJson.value, form.name)
        fillForm(parsed.name, parsed.config)
        serverMode.value = mode
    } catch (error) {
        ElMessage.error(
            error instanceof Error ? error.message : '模式切换失败，请检查输入'
        )
    }
}

function openCreate() {
    editing.value = ''
    serverMode.value = 'form'
    resetServerForm()
    showServerDialog.value = true
}

function openEdit(name: string) {
    const server = props.config.mcpServers[name]

    editing.value = name
    serverMode.value = 'form'
    fillForm(name, server)
    showServerDialog.value = true
}

function openTool(item: McpToolInfo) {
    toolForm.name = item.name
    toolForm.server = item.server
    toolForm.enabled = item.enabled
    toolForm.timeout = item.timeout ?? 0
    toolForm.selector = item.selector.join('\n')
    showToolDialog.value = true
}

async function removeServer(name: string) {
    try {
        await ElMessageBox.confirm(
            `确定删除 MCP 服务器 “${name}” 吗？`,
            '提示',
            {
                confirmButtonText: '删除',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )

        await send('chatluna-agent/removeMcpServer', name)
        ElMessage.success('服务器已删除')
    } catch (error) {
        if (error !== 'cancel') {
            ElMessage.error('删除服务器失败')
        }
    }
}

async function reloadMcp() {
    try {
        reloading.value = true
        await send('chatluna-agent/reloadMcp')
        ElMessage.success('MCP 已重新加载')
    } catch {
        ElMessage.error('重新加载 MCP 失败')
    } finally {
        reloading.value = false
    }
}

async function reconnect(name: string) {
    try {
        await send('chatluna-agent/reconnectMcpServer', name)
        ElMessage.success('已发起服务器重连')
    } catch {
        ElMessage.error('服务器重连失败')
    }
}

async function toggleTool(item: McpToolInfo, enabled: boolean) {
    try {
        await send('chatluna-agent/saveMcpTool', {
            name: item.name,
            enabled,
            timeout: item.timeout,
            selector: item.selector
        })
        ElMessage.success(enabled ? '工具已启用' : '工具已停用')
    } catch {
        ElMessage.error('切换工具失败')
    }
}

async function saveServer() {
    savingServer.value = true

    try {
        let name = form.name.trim()
        let config = getFormConfig()

        if (serverMode.value === 'json') {
            const parsed = parseServerJson(serverJson.value, name)
            name = parsed.name
            config = parsed.config
        }

        if (!name) {
            ElMessage.warning('请输入服务器名称')
            return
        }

        if (config.type === 'stdio' && !config.command?.trim()) {
            ElMessage.warning('请输入启动命令')
            return
        }

        if (config.type !== 'stdio' && !config.url?.trim()) {
            ElMessage.warning('请输入服务地址')
            return
        }

        await send('chatluna-agent/saveMcpServer', {
            oldName: editing.value || undefined,
            name,
            config
        })

        ElMessage.success(editing.value ? '服务器已更新' : '服务器已创建')
        showServerDialog.value = false
    } catch (error) {
        ElMessage.error(
            error instanceof Error
                ? error.message
                : '保存服务器失败，请检查输入'
        )
    } finally {
        savingServer.value = false
    }
}

async function saveTool() {
    savingTool.value = true

    try {
        await send('chatluna-agent/saveMcpTool', {
            name: toolForm.name,
            enabled: toolForm.enabled,
            timeout: toolForm.timeout || undefined,
            selector: toolForm.selector
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean)
        } satisfies McpToolConfig)

        ElMessage.success('工具配置已保存')
        showToolDialog.value = false
    } catch {
        ElMessage.error('保存工具配置失败')
    } finally {
        savingTool.value = false
    }
}
</script>

<style scoped>
.servers-view {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.panel {
    border: 1px solid var(--k-color-divider);
    border-radius: 20px;
    background: var(--k-color-surface-1);
    overflow: hidden;
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 20px;
    border-bottom: 1px solid var(--k-color-divider);
    gap: 16px;
}

.panel-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--k-color-text);
}

.panel-description {
    margin-top: 4px;
    font-size: 12px;
    color: var(--k-text-light);
}

.panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.card-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 18px 20px;
    padding: 18px 20px 20px;
    align-items: stretch;
    align-content: flex-start;
}

.server-grid {
    justify-content: flex-start;
}

.tool-grid {
    justify-content: flex-start;
}

.server-grid > .server-card {
    flex: 0 1 340px;
    max-width: 360px;
}

.tool-grid > .tool-card {
    flex: 0 1 300px;
    max-width: 360px;
}

.server-card,
.tool-card {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 10%);
    border-radius: 14px;
    background: var(--k-color-surface-2);
    padding: 14px;
    transition: border-color 0.2s ease;
    display: flex;
    flex-direction: column;
    min-height: 100%;
    min-width: 0;
    box-sizing: border-box;
}

.server-card.busy,
.tool-card.busy {
    border-color: color-mix(in srgb, var(--el-color-warning), transparent 52%);
}

.server-head,
.tool-top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
}

.server-brand,
.tool-brand {
    display: flex;
    gap: 10px;
    min-width: 0;
}

.server-icon,
.tool-icon {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 10%);
    background: color-mix(in srgb, var(--k-color-surface-2), transparent 12%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--k-color-primary);
    flex-shrink: 0;
    overflow: hidden;
}

.server-icon :deep(.el-icon) {
    font-size: 16px;
}

.tool-icon :deep(.el-icon) {
    font-size: 14px;
}

.server-icon img,
.tool-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.server-copy {
    min-width: 0;
}

.server-title,
.tool-name {
    font-size: 12px;
    color: var(--k-text-light);
}

.server-name,
.tool-title {
    margin-top: 2px;
    font-size: 14px;
    font-weight: 700;
    color: var(--k-color-text);
    word-break: break-word;
}

.server-kind {
    margin-top: 4px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11px;
    text-transform: uppercase;
    color: var(--k-text-light);
}

.server-summary,
.tool-description {
    margin-top: 8px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--k-text-light);
    word-break: break-word;
    overflow-wrap: anywhere;
}

.meta-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
}

.meta-card {
    flex: 1 1 120px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--k-color-surface-2), transparent 22%);
    padding: 8px 10px;
}

.meta-wide {
    flex-basis: 100%;
}

.meta-card span {
    display: block;
    font-size: 11px;
    color: var(--k-text-light);
}

.meta-card strong {
    display: block;
    margin-top: 4px;
    font-size: 13px;
    color: var(--k-color-text);
    line-height: 1.4;
    word-break: break-word;
}

.detail-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
}

.detail-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 11px;
    color: var(--k-text-light);
}

.detail-row span:last-child {
    color: var(--k-color-text);
    text-align: right;
    word-break: break-word;
}

.server-chips,
.tool-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 8px;
}

.server-endpoint {
    margin-top: 8px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--k-text-light);
    word-break: break-word;
    overflow-wrap: anywhere;
}

.error-box {
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--el-color-danger), transparent 92%);
    color: var(--el-color-danger);
    font-size: 11px;
    line-height: 1.5;
    word-break: break-word;
    overflow-wrap: anywhere;
}

.server-actions,
.tool-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: auto;
    padding-top: 10px;
}

.empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 240px;
}

.empty-tools {
    min-height: 200px;
}

.json-mode {
    display: flex;
    flex-direction: column;
}

.json-layout {
    display: grid;
    grid-template-columns: 1.2fr 320px;
    gap: 24px;
    align-items: start;
}

.json-editor-section,
.json-preview-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.json-preview {
    position: sticky;
    top: 20px;
}

.preview-card {
    border: 1px solid var(--k-color-divider);
    border-radius: 14px;
    background: var(--k-color-surface-2);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.preview-header {
    display: flex;
    align-items: center;
    gap: 12px;
}

.preview-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--k-color-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    flex-shrink: 0;
}

.preview-info {
    flex: 1;
    min-width: 0;
}

.preview-name {
    font-size: 14px;
    font-weight: 700;
    color: var(--k-color-text);
    word-break: break-word;
}

.preview-type {
    margin-top: 2px;
    font-size: 11px;
    text-transform: uppercase;
    color: var(--k-text-light);
    font-weight: 600;
}

.preview-divider {
    height: 1px;
    background: var(--k-color-divider);
    margin: 4px 0;
}

.preview-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.field-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--k-text-light);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.field-value {
    font-size: 13px;
    color: var(--k-color-text);
    word-break: break-all;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--k-color-surface-1);
    border: 1px solid var(--k-color-divider);
    line-height: 1.4;
}

.dialog-copy {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 24px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--k-color-divider);
}

.dialog-head {
    display: flex;
    justify-content: center;
    margin-bottom: 24px;
}

.dialog-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px 20px;
}

.json-mode,
.form-group,
.form-span {
    min-width: 0;
}

.dialog-grid > .form-group {
    flex: 1 1 320px;
}

.form-span {
    flex: 1 1 100%;
}

.form-label {
    display: block;
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--k-color-text);
}

.dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
}

@media (max-width: 768px) {
    .panel-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .dialog-grid > .form-group,
    .dialog-grid > .form-span,
    .server-grid > .server-card,
    .tool-grid > .tool-card {
        flex-basis: 100%;
        max-width: none;
    }

    .json-layout {
        grid-template-columns: 1fr;
    }

    .meta-wide {
        flex-basis: 100%;
    }

    .server-actions,
    .tool-actions {
        justify-content: flex-start;
        flex-wrap: wrap;
    }
}
</style>
