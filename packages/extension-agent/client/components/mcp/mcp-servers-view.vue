<template>
    <div class="servers-view">
        <div class="panel">
            <div class="panel-header">
                <div>
                    <div class="panel-title">服务器</div>
                    <div class="panel-description">
                        管理 MCP 服务器的连接方式、运行状态和重连操作。
                    </div>
                </div>

                <div class="panel-actions">
                    <el-button :loading="reloading" @click="reloadMcp">
                        <el-icon><RefreshRight /></el-icon>
                        重新加载
                    </el-button>
                    <el-button type="primary" @click="openCreate">
                        <el-icon><Plus /></el-icon>
                        添加服务器
                    </el-button>
                </div>
            </div>

            <div v-if="servers.length > 0" class="card-list server-grid">
                <div
                    v-for="item in servers"
                    :key="item.name"
                    class="server-card"
                    :class="{
                        busy: item.updating,
                        selected: selectedServerName === item.name
                    }"
                    role="button"
                    tabindex="0"
                    :aria-pressed="selectedServerName === item.name"
                    @click="selectedServerName = item.name"
                    @keydown.enter.prevent="selectedServerName = item.name"
                    @keydown.space.prevent="selectedServerName = item.name"
                >
                    <span
                        v-if="selectedServerName === item.name"
                        class="server-selected-mark"
                        aria-hidden="true"
                    >
                        <el-icon><Check /></el-icon>
                    </span>

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
                                <div v-if="!props.hideDesc" class="server-kind">
                                    <span>{{ item.kind }}</span>
                                    <span v-if="item.status?.version">
                                        v{{ item.status.version }}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <el-tag
                            :type="
                                stateTag(
                                    item.updating
                                        ? 'reconnecting'
                                        : item.status?.state
                                )
                            "
                            round
                            effect="plain"
                        >
                            {{
                                stateLabel(
                                    item.updating
                                        ? 'reconnecting'
                                        : item.status?.state
                                )
                            }}
                        </el-tag>
                    </div>

                    <div class="server-chips">
                        <el-tag size="small" effect="plain">
                            {{ item.kind }}
                        </el-tag>
                        <el-tag size="small" effect="plain">
                            {{ item.tools.length }} 工具
                        </el-tag>
                        <el-tag size="small" effect="plain">
                            启动 {{ item.server.startupTimeout ?? 20 }}s
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

                    <div v-if="item.status?.error" class="error-box">
                        {{ item.status.error }}
                    </div>

                    <div class="server-actions" @click.stop @keydown.stop>
                        <el-dropdown trigger="click" placement="bottom-end">
                            <el-button
                                class="server-menu"
                                text
                                circle
                                :disabled="item.updating"
                                :aria-label="`管理服务器 ${item.name}`"
                            >
                                <el-icon><MoreFilled /></el-icon>
                            </el-button>
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item
                                        :disabled="
                                            serverToolsBusy[item.name] ||
                                            item.updating ||
                                            item.tools.length === 0 ||
                                            item.tools.some((t) => t.updating)
                                        "
                                        @click="toggleServerTools(item.name)"
                                    >
                                        {{
                                            item.tools.some((t) => t.enabled)
                                                ? '禁用全部工具'
                                                : '启用全部工具'
                                        }}
                                    </el-dropdown-item>
                                    <el-dropdown-item
                                        @click="openEdit(item.name)"
                                    >
                                        编辑服务器
                                    </el-dropdown-item>
                                    <el-dropdown-item
                                        @click="reconnect(item.name)"
                                    >
                                        重新连接
                                    </el-dropdown-item>
                                    <el-dropdown-item
                                        divided
                                        @click="removeServer(item.name)"
                                    >
                                        删除服务器
                                    </el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                    </div>
                </div>
            </div>

            <div v-else class="empty-state server-empty">
                <el-empty description="还没有 MCP 服务器，先添加一个。" />
            </div>

            <div class="tool-section">
                <div class="panel-header tool-panel-header">
                    <div>
                        <div class="panel-title">
                            工具
                            <span v-if="selectedServer" class="panel-count">
                                {{ visibleTools.length }}
                            </span>
                        </div>
                        <div v-if="selectedServer" class="panel-description">
                            {{
                                selectedServer.status?.title ||
                                selectedServer.name
                            }}
                        </div>
                    </div>
                </div>

                <div v-if="visibleTools.length > 0" class="card-list tool-grid">
                    <div
                        v-for="item in visibleTools"
                        :key="item.name"
                        class="tool-card"
                        :class="{ busy: item.updating }"
                        role="button"
                        tabindex="0"
                        @click="openTool(item)"
                        @keydown.enter.prevent="openTool(item)"
                        @keydown.space.prevent="openTool(item)"
                    >
                        <div class="tool-brand">
                            <div class="tool-icon">
                                <img
                                    v-if="item.icon?.src"
                                    :src="item.icon.src"
                                    alt=""
                                />
                                <el-icon v-else :size="14">
                                    <Tools />
                                </el-icon>
                            </div>

                            <div class="tool-copy">
                                <div class="tool-title">
                                    {{ item.title || item.name }}
                                </div>
                                <div
                                    v-if="
                                        item.title && item.title !== item.name
                                    "
                                    class="tool-name"
                                >
                                    {{ item.name }}
                                </div>
                            </div>
                        </div>

                        <div class="tool-controls" @click.stop @keydown.stop>
                            <el-switch
                                :model-value="item.enabled"
                                :loading="item.updating"
                                :disabled="item.updating"
                                :aria-label="`${item.enabled ? '禁用' : '启用'}工具 ${item.name}`"
                                @change="
                                    (value) =>
                                        toggleTool(item, value as boolean)
                                "
                            />
                        </div>
                    </div>
                </div>

                <div v-else class="empty-state empty-tools">
                    <el-empty
                        :description="
                            selectedServer
                                ? '该服务器当前没有可用工具。'
                                : '请先添加一个 MCP 服务器。'
                        "
                    />
                </div>
            </div>
        </div>

        <el-dialog
            v-model="showServerDialog"
            :title="editing ? '编辑 MCP 服务器' : '新增 MCP 服务器'"
            width="min(960px, calc(100vw - 32px))"
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
                            表单
                        </div>
                    </el-radio-button>
                    <el-radio-button value="json" label="json">
                        <div
                            style="display: flex; align-items: center; gap: 6px"
                        >
                            <el-icon><Document /></el-icon>
                            JSON
                        </div>
                    </el-radio-button>
                </el-radio-group>
            </div>

            <div v-if="serverMode === 'form'" class="dialog-grid">
                <div class="form-group">
                    <label class="form-label">服务器名称</label>
                    <el-input
                        v-model="form.name"
                        placeholder="例如：my-mcp-server"
                    />
                </div>

                <div class="form-group">
                    <label class="form-label">连接类型</label>
                    <el-select
                        v-model="form.type"
                        style="width: 100%"
                        placeholder="选择连接方式"
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
                        placeholder="例如：npx -y mcp-remote https://..."
                    />
                </div>

                <div v-if="form.type === 'stdio'" class="form-span">
                    <label class="form-label">启动参数</label>
                    <el-input
                        v-model="form.args"
                        type="textarea"
                        :rows="3"
                        placeholder="每行一个参数，例如：&#10;-y&#10;@modelcontextprotocol/server-everything"
                    />
                </div>

                <div v-if="form.type === 'stdio'" class="form-span">
                    <label class="form-label">环境变量 (JSON)</label>
                    <code-editor
                        v-model="form.env"
                        language="json"
                        :min-height="160"
                        placeholder='例如：{ "API_KEY": "xxx" }'
                    />
                </div>

                <div v-if="form.type !== 'stdio'" class="form-span">
                    <label class="form-label">服务 URL</label>
                    <el-input
                        v-model="form.url"
                        placeholder="例如：http://localhost:3000/sse"
                    />
                </div>

                <div v-if="form.type !== 'stdio'" class="form-span">
                    <label class="form-label">请求头 (JSON)</label>
                    <code-editor
                        v-model="form.headers"
                        language="json"
                        :min-height="160"
                        placeholder='例如：{ "Authorization": "Bearer xxx" }'
                    />
                </div>

                <div class="form-group">
                    <label class="form-label">启动超时 (秒)</label>
                    <el-input-number
                        v-model="form.startupTimeout"
                        :min="1"
                        :max="300"
                        style="width: 100%"
                    />
                </div>

                <div class="form-group">
                    <label class="form-label">工具调用超时 (秒)</label>
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
                        placeholder="可选，例如：http://127.0.0.1:7890"
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
                                JSON 有效
                            </el-tag>
                            <el-tag
                                v-else-if="serverJson.trim()"
                                size="small"
                                type="warning"
                                effect="plain"
                            >
                                JSON 尚未完成
                            </el-tag>
                        </div>
                        <code-editor
                            v-model="serverJson"
                            language="json"
                            :min-height="400"
                            placeholder="粘贴单个服务器配置，或包含 mcpServers 的完整对象"
                            @update:model-value="syncJsonToForm"
                        />
                        <div v-if="jsonError" class="json-error">
                            {{ jsonError }}
                        </div>
                    </div>

                    <div class="json-preview-section">
                        <label class="form-label">预览</label>
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
                                            {{ form.name || '未命名' }}
                                        </div>
                                        <div class="preview-type">
                                            {{ form.type }}
                                        </div>
                                    </div>
                                </div>

                                <div class="preview-divider"></div>

                                <div class="preview-field">
                                    <span class="field-label">保存名称</span>
                                    <el-input
                                        v-model="form.name"
                                        size="small"
                                        placeholder="输入名称，或指定 mcpServers 中的目标项"
                                    />
                                    <div class="preview-note">
                                        这里只用于选择或保存服务器名称，不会改写左侧
                                        JSON。
                                    </div>
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
                                    <span class="field-label">启动超时</span>
                                    <span class="field-value">
                                        {{ form.startupTimeout }}s
                                    </span>
                                </div>

                                <div class="preview-field">
                                    <span class="field-label">工具调用超时</span>
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
                    <label class="form-label">工具名称</label>
                    <el-input :model-value="toolForm.name" disabled />
                </div>

                <div class="form-span tool-description-field">
                    <label class="form-label">工具描述</label>
                    <el-input
                        :model-value="toolForm.description || '暂无工具描述'"
                        type="textarea"
                        :rows="4"
                        resize="none"
                        readonly
                    />
                </div>

                <div class="form-group">
                    <label class="form-label">是否启用</label>
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
import { computed, reactive, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
    Check,
    Connection,
    MoreFilled,
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
        throw new Error('请输入有效的 JSON 对象')
    }

    return value as Record<string, unknown>
}

function parseRecord(text: string) {
    const value = parseJson(text)

    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, String(item ?? '')])
    )
}

function splitCommand(text: string) {
    const args: string[] = []
    let part = ''
    let quote = ''

    for (const ch of text.trim()) {
        if (quote) {
            if (ch === quote) {
                quote = ''
            } else {
                part += ch
            }
            continue
        }

        if (ch === '"' || ch === "'") {
            quote = ch
            continue
        }

        if (/\s/.test(ch)) {
            if (part) {
                args.push(part)
                part = ''
            }
            continue
        }

        part += ch
    }

    if (part) {
        args.push(part)
    }

    return args
}

function normalizeServer(config: McpServerConfig) {
    const next = { ...config }
    const type = getServerType(next)

    if (type === 'stdio' && next.command?.trim()) {
        const raw = next.command.trim()

        if (!next.args?.length && /\s/.test(raw)) {
            const args = splitCommand(raw)

            if (args.length > 1) {
                next.command = args[0]
                next.args = args.slice(1)
            } else {
                next.command = raw
            }
        } else {
            next.command = raw
        }
    }

    if (type !== 'stdio' && next.url?.trim()) {
        next.url = next.url.trim()
    }

    return next
}

function formatServerJson(name: string, config: McpServerConfig) {
    const next = normalizeServer(config)
    const value = name ? { name, ...next } : next
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

function validateServer(name: string, config: McpServerConfig) {
    const next = normalizeServer(config)
    const server = getServerType(next)
    const key = name.trim()

    if (!key) {
        throw new Error('请填写名称，或在 JSON 中提供 name 字段')
    }

    if (server === 'stdio' && !next.command?.trim()) {
        throw new Error('请填写启动命令')
    }

    if (server !== 'stdio' && !next.url?.trim()) {
        throw new Error('请填写服务地址')
    }

    return {
        name: key,
        config: next
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
                config: normalizeServer(withEnv(servers[name]))
            }
        }

        const list = Object.entries(servers)
        if (list.length === 1) {
            return {
                name: name || list[0][0],
                config: normalizeServer(withEnv(list[0][1]))
            }
        }

        throw new Error('检测到多个服务器，请先填写名称，或只保留一个配置')
    }

    if (looksLikeServer(parsed)) {
        const next = { ...parsed } as Record<string, unknown>
        const name = rawName.trim() || String(parsed.name || '')

        if (next.environment != null && next.env == null) {
            next.env = next.environment
        }

        delete next.name
        delete next.environment

        return {
            name,
            config: normalizeServer(withEnv(next as McpServerConfig))
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
            config: normalizeServer(withEnv(list[0][1] as McpServerConfig))
        }
    }

    throw new Error('无法从这段 JSON 中识别 MCP 服务器配置')
}

const props = withDefaults(
    defineProps<{
        config: McpConfig
        status: McpStatus
        compactMode: boolean
        hideDesc: boolean
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
        compactMode: false,
        hideDesc: false
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
const selectedServerName = ref('')
const serverMode = ref<'form' | 'json'>('form')
const serverJson = ref('')
const syncing = ref(false)
const serverBusy = ref<Record<string, boolean>>({})
const serverToolsBusy = ref<Record<string, boolean>>({})
const toolBusy = ref<Record<string, boolean>>({})
const toolEnabled = ref<Record<string, boolean>>({})

watch(
    () => props.status.tools,
    (value) => {
        const names = new Set(Object.keys(value))

        for (const [name, item] of Object.entries(value)) {
            if (!toolBusy.value[name]) {
                toolEnabled.value[name] = item.enabled
            }
        }

        for (const name of Object.keys(toolEnabled.value)) {
            if (!names.has(name)) {
                delete toolEnabled.value[name]
            }
        }

        for (const name of Object.keys(toolBusy.value)) {
            if (!names.has(name)) {
                delete toolBusy.value[name]
            }
        }
    },
    {
        immediate: true,
        deep: true
    }
)

const jsonError = computed(() => {
    if (!serverJson.value.trim()) return ''

    try {
        parseJson(serverJson.value)
        return ''
    } catch (error) {
        return error instanceof Error ? error.message : String(error)
    }
})

const jsonValid = computed(() => {
    if (jsonError.value || !serverJson.value.trim()) {
        return false
    }

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
    startupTimeout: 20,
    timeout: 60,
    cwd: '',
    proxy: ''
})

const toolForm = reactive({
    name: '',
    description: '',
    enabled: true,
    timeout: 0,
    selector: ''
})

const servers = computed(() =>
    Object.entries(props.config.mcpServers)
        .map(([name, server]) => ({
            name,
            kind: getServerType(server),
            server,
            status: props.status.servers[name],
            updating:
                props.status.servers[name]?.updating ||
                !!serverBusy.value[name],
            tools: tools.value.filter((tool) => tool.server === name)
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
)

const tools = computed(() =>
    Object.values(props.status.tools)
        .map((item) => ({
            ...item,
            enabled: toolEnabled.value[item.name] ?? item.enabled,
            updating: item.updating || !!toolBusy.value[item.name]
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
)

const selectedServer = computed(() =>
    servers.value.find((server) => server.name === selectedServerName.value)
)

const visibleTools = computed(() => selectedServer.value?.tools ?? [])

watch(
    servers,
    (value) => {
        if (!value.some((server) => server.name === selectedServerName.value)) {
            selectedServerName.value = value[0]?.name ?? ''
        }
    },
    { immediate: true }
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
        startupTimeout: form.startupTimeout,
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

    return normalizeServer(config)
}

function fillForm(name: string, server: McpServerConfig) {
    const next = normalizeServer(server)

    form.name = name
    form.type = next.type ?? (next.url ? 'http' : 'stdio')
    form.command = next.command ?? ''
    form.args = (next.args ?? []).join('\n')
    form.env = JSON.stringify(next.env ?? {}, null, 2)
    form.url = next.url ?? ''
    form.headers = JSON.stringify(next.headers ?? {}, null, 2)
    form.startupTimeout = next.startupTimeout ?? 20
    form.timeout = next.timeout ?? 60
    form.cwd = next.cwd ?? ''
    form.proxy = next.proxy ?? ''
    serverJson.value = formatServerJson(name, next)
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
        form.startupTimeout = parsed.config.startupTimeout ?? 20
        form.timeout = parsed.config.timeout ?? 60
        form.cwd = parsed.config.cwd ?? ''
        form.proxy = parsed.config.proxy ?? ''
    } catch {
        // ignore parse errors during typing
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
            error instanceof Error ? error.message : '切换失败，请检查输入内容'
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
    toolForm.description = item.description
    toolForm.enabled = item.enabled
    toolForm.timeout = item.timeout ?? 0
    toolForm.selector = item.selector.join('\n')
    showToolDialog.value = true
}

async function removeServer(name: string) {
    try {
        await ElMessageBox.confirm(
            `删除服务器“${name}”后，需要重新创建才能恢复。确定继续吗？`,
            '删除 MCP 服务器',
            {
                confirmButtonText: '删除',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )

        await send('chatluna-agent/removeMcpServer', name)
        ElMessage.success('已删除服务器。')
    } catch (error) {
        if (error !== 'cancel') {
            ElMessage.error('删除失败，请稍后重试。')
        }
    }
}

async function reloadMcp() {
    try {
        reloading.value = true
        await send('chatluna-agent/reloadMcp')
        ElMessage.success('已重新加载 MCP。')
    } catch {
        ElMessage.error('重新加载失败，请稍后重试。')
    } finally {
        reloading.value = false
    }
}

async function reconnect(name: string) {
    try {
        serverBusy.value[name] = true
        await send('chatluna-agent/reconnectMcpServer', name)
        ElMessage.success('已开始重新连接。')
    } catch {
        ElMessage.error('重连失败，请检查连接配置。')
    } finally {
        serverBusy.value[name] = false
    }
}

async function toggleTool(item: McpToolInfo, enabled: boolean) {
    const prev = toolEnabled.value[item.name] ?? item.enabled

    try {
        toolEnabled.value[item.name] = enabled
        toolBusy.value[item.name] = true
        await send('chatluna-agent/saveMcpTool', {
            name: item.name,
            enabled,
            timeout: item.timeout,
            selector: item.selector
        })
        ElMessage.success(enabled ? '已启用该工具。' : '已停用该工具。')
    } catch {
        toolEnabled.value[item.name] = prev
        ElMessage.error('更新工具状态失败，请稍后重试。')
    } finally {
        toolBusy.value[item.name] = false
    }
}

async function toggleServerTools(name: string) {
    if (serverToolsBusy.value[name]) return

    const srv = servers.value.find((s) => s.name === name)
    if (!srv || srv.tools.length === 0 || srv.tools.some((t) => t.updating)) {
        return
    }

    const enabled = !srv.tools.some((t) => t.enabled)
    const prev = srv.tools.map((t) => ({ name: t.name, enabled: t.enabled }))

    try {
        serverToolsBusy.value[name] = true
        for (const t of srv.tools) {
            toolEnabled.value[t.name] = enabled
            toolBusy.value[t.name] = true
        }

        const nextTools = { ...props.config.tools }
        for (const t of srv.tools) {
            const cur = nextTools[t.name]
            nextTools[t.name] = {
                name: t.name,
                enabled,
                timeout: cur?.timeout ?? t.timeout ?? undefined,
                selector: cur?.selector ?? t.selector ?? []
            }
        }

        await send('chatluna-agent/saveMcp', {
            ...props.config,
            tools: nextTools
        })
        ElMessage.success(
            enabled
                ? '已启用该服务器的所有工具。'
                : '已停用该服务器的所有工具。'
        )
    } catch {
        for (const p of prev) {
            toolEnabled.value[p.name] = p.enabled
        }
        ElMessage.error('更新工具状态失败，请稍后重试。')
    } finally {
        serverToolsBusy.value[name] = false
        for (const t of srv.tools) {
            toolBusy.value[t.name] = false
        }
    }
}

async function saveServer() {
    savingServer.value = true

    try {
        const parsed =
            serverMode.value === 'json'
                ? (() => {
                      const item = parseServerJson(serverJson.value, form.name)
                      return validateServer(item.name, item.config)
                  })()
                : validateServer(form.name, getFormConfig())

        await send('chatluna-agent/saveMcpServer', {
            oldName: editing.value || undefined,
            name: parsed.name,
            config: parsed.config
        })

        ElMessage.success(editing.value ? '已更新服务器。' : '已创建服务器。')
        showServerDialog.value = false
    } catch (error) {
        ElMessage.error(
            error instanceof Error
                ? error.message
                : '保存失败，请检查填写内容。'
        )
    } finally {
        savingServer.value = false
    }
}

async function saveTool() {
    savingTool.value = true
    toolBusy.value[toolForm.name] = true

    const prev = toolEnabled.value[toolForm.name]

    try {
        toolEnabled.value[toolForm.name] = toolForm.enabled
        await send('chatluna-agent/saveMcpTool', {
            name: toolForm.name,
            enabled: toolForm.enabled,
            timeout: toolForm.timeout || undefined,
            selector: toolForm.selector
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean)
        } satisfies McpToolConfig)

        ElMessage.success('已保存工具配置。')
        showToolDialog.value = false
    } catch {
        if (prev == null) {
            delete toolEnabled.value[toolForm.name]
        } else {
            toolEnabled.value[toolForm.name] = prev
        }
        ElMessage.error('保存失败，请稍后重试。')
    } finally {
        savingTool.value = false
        toolBusy.value[toolForm.name] = false
    }
}
</script>

<style scoped>
.servers-view {
    display: flex;
    flex-direction: column;
    gap: 18px;
}

.panel {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 16px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 20%);
    overflow: hidden;
    box-sizing: border-box;
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 18px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
    gap: 16px;
    box-sizing: border-box;
}

.panel-title {
    font-size: 17px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-description {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.panel-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 20px;
    margin-left: 6px;
    padding: 0 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--k-color-primary), transparent 88%);
    color: var(--k-color-primary);
    font-size: 12px;
    font-weight: 600;
    vertical-align: 2px;
    box-sizing: border-box;
}

.panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.card-list {
    display: grid;
    box-sizing: border-box;
}

.server-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    padding: 14px;
}

.server-card {
    position: relative;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-activity-bg), var(--k-page-bg) 18%);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box;
    transition:
        border-color 0.18s ease,
        background-color 0.18s ease,
        box-shadow 0.18s ease;
    min-width: 0;
    overflow: hidden;
    cursor: pointer;
    outline: none;
}

.server-card:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 48%);
    background: color-mix(
        in srgb,
        var(--k-color-primary),
        var(--k-activity-bg) 95%
    );
}

.server-card:focus-visible {
    box-shadow: 0 0 0 2px
        color-mix(in srgb, var(--k-color-primary), transparent 72%);
}

.server-card.selected {
    border-color: var(--k-color-primary);
    background: color-mix(
        in srgb,
        var(--k-color-primary),
        var(--k-activity-bg) 92%
    );
    box-shadow: inset 3px 0 0 var(--k-color-primary);
}

.server-card.busy {
    border-color: color-mix(in srgb, var(--el-color-warning), transparent 68%);
    background: color-mix(
        in srgb,
        var(--k-activity-bg),
        var(--el-color-warning) 4%
    );
}

.server-card.selected.busy {
    box-shadow: inset 3px 0 0 var(--el-color-warning);
}

.server-selected-mark {
    position: absolute;
    top: 0;
    right: 0;
    width: 24px;
    height: 24px;
    border-radius: 0 7px 0 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--k-color-primary);
    color: white;
    font-size: 13px;
}

.server-head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: flex-start;
    padding-right: 28px;
}

.server-brand,
.tool-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1 1 auto;
}

.server-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    background: color-mix(in srgb, var(--k-side-bg), transparent 8%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 28%);
    flex-shrink: 0;
    overflow: hidden;
}

.tool-icon {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 25%);
    background: color-mix(in srgb, var(--k-side-bg), transparent 8%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 28%);
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

.server-copy,
.tool-copy {
    min-width: 0;
    flex: 1 1 auto;
}

.server-title {
    font-size: 12px;
    color: var(--k-text-light);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.server-name {
    margin-top: 2px;
    font-size: 15px;
    font-weight: 600;
    color: var(--k-text-dark);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tool-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--k-text-dark);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tool-name {
    margin-top: 2px;
    font-size: 10px;
    line-height: 1.2;
    color: var(--k-text-light);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.server-kind {
    margin-top: 4px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--k-text-light);
}

.tool-section {
    border-top: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
}

.tool-panel-header {
    border-bottom: 0;
    padding-bottom: 10px;
}

.tool-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    padding: 0 14px 14px;
}

.tool-card {
    min-width: 0;
    min-height: 52px;
    padding: 8px 10px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 7px;
    background: color-mix(in srgb, var(--k-activity-bg), var(--k-page-bg) 18%);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    box-sizing: border-box;
    transition:
        border-color 0.18s ease,
        background-color 0.18s ease;
    cursor: pointer;
    outline: none;
}

.tool-card:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 62%);
    background: color-mix(
        in srgb,
        var(--k-color-primary),
        var(--k-activity-bg) 97%
    );
}

.tool-card:focus-visible {
    border-color: var(--k-color-primary);
    box-shadow: 0 0 0 2px
        color-mix(in srgb, var(--k-color-primary), transparent 76%);
}

.tool-card.busy {
    border-color: color-mix(in srgb, var(--el-color-warning), transparent 68%);
    background: color-mix(
        in srgb,
        var(--k-activity-bg),
        var(--el-color-warning) 4%
    );
}

.tool-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
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
    background: color-mix(in srgb, var(--k-activity-bg), transparent 22%);
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
    color: var(--k-text-dark);
    line-height: 1.4;
    word-break: break-word;
}

@media (max-width: 1680px) {
    .tool-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}

@media (max-width: 1320px) {
    .tool-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
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
    color: var(--k-text-dark);
    text-align: right;
    word-break: break-word;
}

.server-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding-right: 32px;
}

.error-box {
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--el-color-danger), transparent 95%);
    color: color-mix(in srgb, var(--el-color-danger), var(--k-text-dark) 36%);
    font-size: 11px;
    line-height: 1.5;
    word-break: break-word;
    overflow-wrap: anywhere;
}

.server-actions {
    position: absolute;
    right: 7px;
    bottom: 7px;
    display: flex;
    align-items: center;
}

.server-menu {
    width: 28px;
    height: 28px;
    color: var(--k-text-light);
}

.server-actions :deep(.neutral-outline.el-button) {
    --el-button-bg-color: transparent;
    --el-button-border-color: color-mix(
        in srgb,
        var(--k-color-divider),
        transparent 12%
    );
    --el-button-text-color: var(--k-text-dark);
    --el-button-hover-bg-color: color-mix(
        in srgb,
        var(--k-side-bg),
        var(--k-page-bg) 18%
    );
    --el-button-hover-border-color: color-mix(
        in srgb,
        var(--k-color-divider),
        transparent 0%
    );
    --el-button-hover-text-color: var(--k-text-dark);
    --el-button-active-bg-color: color-mix(
        in srgb,
        var(--k-side-bg),
        var(--k-page-bg) 26%
    );
    --el-button-active-border-color: color-mix(
        in srgb,
        var(--k-color-divider),
        transparent 0%
    );
    --el-button-active-text-color: var(--k-text-dark);
    --el-button-disabled-bg-color: color-mix(
        in srgb,
        var(--k-side-bg),
        transparent 10%
    );
    --el-button-disabled-border-color: color-mix(
        in srgb,
        var(--k-color-divider),
        transparent 24%
    );
    --el-button-disabled-text-color: var(--k-text-light);
}

.server-actions :deep(.danger-soft.el-button) {
    --el-button-bg-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 92%
    );
    --el-button-border-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 68%
    );
    --el-button-text-color: color-mix(
        in srgb,
        var(--el-color-danger),
        var(--k-text-dark) 22%
    );
    --el-button-hover-bg-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 86%
    );
    --el-button-hover-border-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 52%
    );
    --el-button-hover-text-color: var(--el-color-danger);
    --el-button-active-bg-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 82%
    );
    --el-button-active-border-color: color-mix(
        in srgb,
        var(--el-color-danger),
        transparent 44%
    );
    --el-button-active-text-color: var(--el-color-danger);
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
    grid-template-columns: minmax(0, 1fr) 280px;
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
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
    border-radius: 12px;
    background: color-mix(in srgb, var(--k-activity-bg), var(--k-page-bg) 16%);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
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
    background: color-mix(in srgb, var(--k-color-primary), white 82%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: color-mix(in srgb, var(--k-color-primary), var(--k-text-dark) 32%);
    flex-shrink: 0;
}

.preview-info {
    flex: 1;
    min-width: 0;
}

.preview-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
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
    color: var(--k-text-dark);
    word-break: break-all;
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 24%);
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 22%);
    line-height: 1.4;
}

.preview-note {
    font-size: 11px;
    line-height: 1.5;
    color: var(--k-text-light);
}

.json-error {
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--el-color-warning), transparent 92%);
    color: color-mix(in srgb, var(--el-color-warning), var(--k-text-dark) 32%);
    font-size: 12px;
    line-height: 1.6;
    word-break: break-word;
    overflow-wrap: anywhere;
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
    margin-bottom: 20px;
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

.tool-description-field :deep(.el-textarea__inner) {
    line-height: 1.6;
    color: var(--k-text-dark);
    background: color-mix(in srgb, var(--k-activity-bg), var(--k-page-bg) 35%);
}

.form-label {
    display: block;
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
}

@media (max-width: 768px) {
    .server-grid,
    .tool-grid {
        grid-template-columns: 1fr;
    }

    .panel-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .dialog-grid > .form-group,
    .dialog-grid > .form-span {
        flex-basis: 100%;
        max-width: none;
    }

    .server-card,
    .tool-card {
        width: 100%;
    }

    .json-layout {
        grid-template-columns: 1fr;
    }

    .meta-wide {
        flex-basis: 100%;
    }
}

.tooltip-trigger-wrapper {
    display: inline-flex;
}

.tooltip-trigger-wrapper :deep(.el-button.is-disabled),
.tooltip-trigger-wrapper :deep(.el-button.is-loading) {
    pointer-events: none;
}
</style>
