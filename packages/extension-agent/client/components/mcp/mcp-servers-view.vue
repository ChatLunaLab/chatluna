<template>
    <div class="servers-view">
        <div class="catalog-section">
            <div class="catalog-controls">
                <div class="section-title">服务器</div>
                <div class="catalog-actions">
                    <el-button
                        :loading="reloading"
                        :icon="RefreshRight"
                        @click="reloadMcp"
                    >
                        重新加载
                    </el-button>
                    <el-button type="primary" :icon="Plus" @click="openCreate">
                        添加服务器
                    </el-button>
                </div>
            </div>

            <div
                v-if="servers.length > 0"
                class="card-list server-grid"
                :class="{ compact: props.compactMode }"
            >
                <div
                    v-for="item in servers"
                    :key="item.name"
                    class="server-card"
                    :class="{
                        busy: item.updating,
                        centered: props.hideDesc,
                        selected: selectedServerName === item.name
                    }"
                    role="button"
                    tabindex="0"
                    @click="selectedServerName = item.name"
                    @keydown.enter.prevent="selectedServerName = item.name"
                    @keydown.space.prevent="selectedServerName = item.name"
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
                                <div
                                    v-if="
                                        !props.hideDesc && item.status?.version
                                    "
                                    class="server-sub"
                                >
                                    v{{ item.status.version }}
                                </div>
                            </div>
                        </div>

                        <div class="server-controls">
                            <div class="server-state" :class="stateClass(item)">
                                <span class="state-dot" />
                                <span>
                                    {{
                                        stateLabel(
                                            item.updating
                                                ? 'reconnecting'
                                                : item.status?.state
                                        )
                                    }}
                                </span>
                            </div>
                            <el-switch
                                :model-value="item.tools.some((t) => t.enabled)"
                                :loading="serverToolsBusy[item.name]"
                                :disabled="
                                    serverToolsBusy[item.name] ||
                                    item.updating ||
                                    item.tools.length === 0 ||
                                    item.tools.some((t) => t.updating)
                                "
                                @click.stop
                                @change="toggleServerTools(item.name)"
                            />
                        </div>
                    </div>

                    <div class="server-meta">
                        <div class="meta-chips">
                            <el-tag size="small" effect="plain" type="info">
                                传输 {{ item.kind }}
                            </el-tag>
                            <el-tag size="small" effect="plain" type="success">
                                工具 {{ item.tools.length }}
                            </el-tag>
                            <el-tag size="small" effect="plain" type="warning">
                                超时 {{ item.server.timeout ?? 60 }}s
                            </el-tag>
                            <el-tag
                                v-if="item.status?.attempts"
                                size="small"
                                effect="plain"
                                type="danger"
                            >
                                重试 {{ item.status.attempts }}/{{
                                    item.status.maxAttempts ?? 5
                                }}
                            </el-tag>
                        </div>
                    </div>

                    <div v-if="item.status?.error" class="error-box">
                        {{ item.status.error }}
                    </div>

                    <div class="server-footer">
                        <el-dropdown
                            trigger="click"
                            @command="(cmd) => onServerMenu(cmd, item)"
                        >
                            <el-button
                                class="more-btn"
                                text
                                :icon="More"
                                @click.stop
                            />
                            <template #dropdown>
                                <el-dropdown-menu>
                                    <el-dropdown-item
                                        command="toggle-tools"
                                        :disabled="
                                            serverToolsBusy[item.name] ||
                                            item.updating ||
                                            item.tools.length === 0 ||
                                            item.tools.some((t) => t.updating)
                                        "
                                    >
                                        {{
                                            item.tools.some((t) => t.enabled)
                                                ? '禁用全部工具'
                                                : '启用全部工具'
                                        }}
                                    </el-dropdown-item>
                                    <el-dropdown-item
                                        command="edit"
                                        :disabled="item.updating"
                                    >
                                        编辑
                                    </el-dropdown-item>
                                    <el-dropdown-item
                                        command="reconnect"
                                        :disabled="item.updating"
                                    >
                                        {{ item.updating ? '重连中' : '重连' }}
                                    </el-dropdown-item>
                                    <el-dropdown-item
                                        command="remove"
                                        divided
                                        :disabled="item.updating"
                                    >
                                        删除
                                    </el-dropdown-item>
                                </el-dropdown-menu>
                            </template>
                        </el-dropdown>
                    </div>
                </div>
            </div>

            <div v-else class="empty-state">
                <el-empty description="还没有 MCP 服务器，先添加一个。" />
            </div>
        </div>

        <div class="catalog-section">
            <div class="catalog-controls tools-controls">
                <div class="section-title">
                    工具{{
                        selectedServerName ? ` · ${selectedServerName}` : ''
                    }}
                </div>
            </div>

            <div
                v-if="visibleTools.length > 0"
                class="card-list tool-grid"
                :class="{ compact: props.compactMode }"
            >
                <div
                    v-for="item in visibleTools"
                    :key="item.name"
                    class="tool-card"
                    :class="{ busy: item.updating, centered: props.hideDesc }"
                    role="button"
                    tabindex="0"
                    @click="openTool(item)"
                    @keydown.enter.prevent="openTool(item)"
                    @keydown.space.prevent="openTool(item)"
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

                            <div class="tool-copy">
                                <div class="tool-title">
                                    {{ item.title || item.name }}
                                </div>
                                <div v-if="!props.hideDesc" class="tool-name">
                                    {{ item.server }}
                                </div>
                            </div>
                        </div>

                        <el-switch
                            :model-value="item.enabled"
                            :loading="item.updating"
                            :disabled="item.updating"
                            @click.stop
                            @change="
                                (value) => toggleTool(item, value as boolean)
                            "
                        />
                    </div>

                    <div v-if="!props.hideDesc" class="tool-description">
                        {{ item.description || '这个工具暂时没有说明。' }}
                    </div>
                </div>
            </div>

            <div v-else class="empty-state empty-tools">
                <el-empty
                    :description="
                        selectedServerName
                            ? '该服务器当前没有可用工具。'
                            : '请先添加一个 MCP 服务器。'
                    "
                />
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
                                    <span class="field-label">
                                        工具调用超时
                                    </span>
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

                <div class="form-group">
                    <label class="form-label">来源服务器</label>
                    <el-input :model-value="toolForm.server" disabled />
                </div>

                <div class="form-span">
                    <label class="form-label">工具描述</label>
                    <el-input
                        :model-value="toolForm.description || '暂无工具描述'"
                        type="textarea"
                        :rows="4"
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
    Connection,
    Plus,
    RefreshRight,
    Tools,
    Menu,
    Document,
    More
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
    server: '',
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

const visibleTools = computed(() =>
    tools.value.filter((tool) => tool.server === selectedServerName.value)
)

watch(
    servers,
    (value) => {
        if (!value.some((server) => server.name === selectedServerName.value)) {
            selectedServerName.value = value[0]?.name ?? ''
        }
    },
    { immediate: true }
)

function stateClass(item: {
    updating: boolean
    status?: { state?: McpServerState }
}) {
    const state = item.updating ? 'reconnecting' : item.status?.state
    if (state === 'connected') return 'is-connected'
    if (state === 'connecting' || state === 'reconnecting') return 'is-pending'
    if (state === 'error') return 'is-error'
    return 'is-idle'
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

function onServerMenu(
    command: string,
    item: {
        name: string
        updating: boolean
        tools: { enabled: boolean; updating?: boolean }[]
    }
) {
    if (command === 'toggle-tools') {
        toggleServerTools(item.name)
        return
    }

    if (command === 'edit') {
        openEdit(item.name)
        return
    }

    if (command === 'reconnect') {
        reconnect(item.name)
        return
    }

    if (command === 'remove') {
        removeServer(item.name)
    }
}

function openTool(item: McpToolInfo) {
    toolForm.name = item.name
    toolForm.server = item.server
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
    gap: 24px;
    min-width: 0;
}

.catalog-section {
    min-width: 0;
}

.catalog-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    min-width: 0;
    flex-wrap: wrap;
}

.tools-controls {
    justify-content: flex-start;
}

.section-title {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--k-text-dark);
    min-width: 0;
}

.catalog-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
    margin-left: auto;
}

.catalog-actions :deep(.el-button) {
    margin: 0;
}

.card-list {
    --card-cols: 3;
    display: grid;
    grid-template-columns: repeat(var(--card-cols), minmax(0, 1fr));
    gap: 16px;
    box-sizing: border-box;
}

.server-grid,
.server-grid.compact {
    --card-cols: 3;
}

.tool-grid {
    --card-cols: 5;
}

.tool-grid.compact {
    --card-cols: 4;
}

.server-card,
.tool-card {
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    border-radius: 12px;
    background: color-mix(in srgb, var(--k-activity-bg), var(--k-page-bg) 16%);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    transition: border-color 0.2s ease;
    min-width: 0;
    overflow: hidden;
}

.server-card:hover,
.tool-card:hover {
    border-color: color-mix(in srgb, var(--k-color-primary), transparent 40%);
}

.server-card.selected {
    border-color: var(--k-color-primary);
    box-shadow: 0 0 0 1px var(--k-color-primary);
}

.server-card.busy,
.tool-card.busy {
    border-color: color-mix(in srgb, var(--el-color-warning), transparent 68%);
    background: color-mix(
        in srgb,
        var(--k-activity-bg),
        var(--el-color-warning) 4%
    );
}

.server-head,
.tool-top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
}

.server-card.centered .server-head {
    align-items: center;
    min-height: 34px;
}

.tool-card.centered .tool-top {
    align-items: center;
    min-height: 34px;
}

.server-brand,
.tool-brand {
    display: flex;
    gap: 10px;
    min-width: 0;
    flex: 1 1 auto;
}

.server-card.centered .server-brand,
.tool-card.centered .tool-brand {
    align-items: center;
}

.server-icon,
.tool-icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--k-side-bg), var(--k-color-primary) 8%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: color-mix(in srgb, var(--k-text-dark), var(--k-color-primary) 36%);
    flex-shrink: 0;
    overflow: hidden;
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

.server-card.centered .server-copy,
.tool-card.centered .tool-copy {
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.server-title,
.tool-name,
.server-sub {
    font-size: 12px;
    color: var(--k-text-light);
    line-height: 1.45;
}

.server-name,
.tool-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--k-text-dark);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.server-state {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    flex: 0 0 auto;
    font-size: 12px;
    line-height: 1.4;
    color: var(--k-text-light);
    white-space: nowrap;
}

.state-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--k-text-light), transparent 20%);
    flex: 0 0 auto;
}

.server-state.is-connected {
    color: var(--el-color-success);
}

.server-state.is-connected .state-dot {
    background: var(--el-color-success);
}

.server-state.is-pending {
    color: var(--el-color-warning);
}

.server-state.is-pending .state-dot {
    background: var(--el-color-warning);
}

.server-state.is-error {
    color: var(--el-color-danger);
}

.server-state.is-error .state-dot {
    background: var(--el-color-danger);
}

.tool-description {
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
    word-break: break-word;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.tool-grid.compact .tool-description {
    -webkit-line-clamp: 3;
}

.server-meta {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
}

.meta-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
}

.meta-chips :deep(.el-tag) {
    border-radius: 6px;
}

.server-controls {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
}

.server-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: auto;
}

.more-btn {
    --el-button-text-color: var(--k-text-light);
    --el-button-hover-text-color: var(--k-text-dark);
    padding: 4px;
    min-height: 28px;
    min-width: 28px;
}

.more-btn :deep(.el-icon) {
    transform: rotate(90deg);
}

.tool-card {
    cursor: pointer;
}

@media (max-width: 1680px) {
    .server-grid,
    .server-grid.compact {
        --card-cols: 3;
    }

    .tool-grid {
        --card-cols: 5;
    }

    .tool-grid.compact {
        --card-cols: 4;
    }
}

@media (max-width: 1320px) {
    .server-grid {
        --card-cols: 2;
    }

    .server-grid.compact {
        --card-cols: 2;
    }

    .tool-grid {
        --card-cols: 3;
    }

    .tool-grid.compact {
        --card-cols: 2;
    }
}

.error-box {
    padding: 8px 10px;
    border-radius: 8px;
    border-left: 3px solid var(--el-color-danger);
    background: color-mix(in srgb, var(--el-color-danger), transparent 94%);
    color: var(--el-color-danger);
    font-size: 12px;
    line-height: 1.45;
    word-break: break-word;
    overflow-wrap: anywhere;
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
    .card-list,
    .card-list.compact,
    .tool-grid,
    .tool-grid.compact {
        --card-cols: 1;
        grid-template-columns: 1fr;
    }

    .catalog-controls {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        width: 100%;
    }

    .catalog-actions {
        width: 100%;
        margin-left: 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
    }

    .catalog-actions :deep(.el-button) {
        width: 100%;
        min-width: 0;
        margin: 0;
        justify-content: center;
    }

    .dialog-grid > .form-group,
    .dialog-grid > .form-span {
        flex-basis: 100%;
        max-width: none;
    }

    .server-card,
    .tool-card {
        width: 100%;
        min-width: 0;
    }

    .json-layout {
        grid-template-columns: 1fr;
    }

    .server-head {
        flex-direction: column;
        gap: 10px;
    }

    .server-state {
        width: 100%;
        justify-content: flex-start;
    }
}

.tooltip-trigger-wrapper :deep(.el-button.is-disabled),
.tooltip-trigger-wrapper :deep(.el-button.is-loading) {
    pointer-events: none;
}
</style>
