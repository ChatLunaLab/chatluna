<template>
    <div class="configuration-panel" :class="{ compact: props.compactMode }">
        <section class="backend-card">
            <div class="backend-head">
                <div class="backend-intro">
                    <div class="backend-title-row">
                        <div class="backend-title">E2B 沙箱</div>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="tagType(props.status.backends.e2b.state)"
                        >
                            {{ stateLabel(props.status.backends.e2b.state) }}
                        </el-tag>
                        <el-tag
                            v-if="props.config.defaultProvider === 'e2b'"
                            size="small"
                            effect="plain"
                        >
                            默认
                        </el-tag>
                        <el-tag size="small" effect="plain">
                            {{ props.status.backends.e2b.sessionCount }}
                            个活跃会话
                        </el-tag>
                    </div>
                    <div v-if="!props.hideDesc" class="backend-copy">
                        云端隔离沙箱，支持桌面和 GUI，适合需要完整隔离的任务。
                    </div>
                    <div
                        v-if="props.status.backends.e2b.error"
                        class="backend-error"
                    >
                        {{ props.status.backends.e2b.error }}
                    </div>
                </div>

                <div class="backend-actions">
                    <el-button text @click="openGuide('e2b')">
                        如何配置
                    </el-button>
                    <el-button
                        class="test-link"
                        plain
                        :loading="props.testing.e2b"
                        @click="emit('test', 'e2b')"
                    >
                        测试连接
                    </el-button>
                    <el-button
                        :type="props.config.e2b.enabled ? 'danger' : 'success'"
                        @click="setE2BEnabled(!props.config.e2b.enabled)"
                    >
                        {{ props.config.e2b.enabled ? '禁用' : '启用' }}
                    </el-button>
                </div>
            </div>

            <div class="backend-body">
                <BackendE2B :config="props.config.e2b" @update="updateE2B" />
            </div>
        </section>

        <section class="backend-card">
            <div class="backend-head">
                <div class="backend-intro">
                    <div class="backend-title-row">
                        <div class="backend-title">远程终端</div>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="
                                tagType(
                                    props.status.backends['open-terminal'].state
                                )
                            "
                        >
                            {{
                                stateLabel(
                                    props.status.backends['open-terminal'].state
                                )
                            }}
                        </el-tag>
                        <el-tag
                            v-if="
                                props.config.defaultProvider === 'open-terminal'
                            "
                            size="small"
                            effect="plain"
                        >
                            默认
                        </el-tag>
                        <el-tag size="small" effect="plain">
                            {{
                                props.status.backends['open-terminal']
                                    .sessionCount
                            }}
                            个活跃会话
                        </el-tag>
                    </div>
                    <div v-if="!props.hideDesc" class="backend-copy">
                        接入已部署的远程执行服务，适合复用现有的执行节点。
                    </div>
                    <div
                        v-if="props.status.backends['open-terminal'].error"
                        class="backend-error"
                    >
                        {{ props.status.backends['open-terminal'].error }}
                    </div>
                </div>

                <div class="backend-actions">
                    <el-button text @click="openGuide('open-terminal')">
                        如何配置
                    </el-button>
                    <el-button
                        class="test-link"
                        plain
                        :loading="props.testing['open-terminal']"
                        @click="emit('test', 'open-terminal')"
                    >
                        测试连接
                    </el-button>
                    <el-button
                        :type="
                            props.config.openTerminal.enabled
                                ? 'danger'
                                : 'success'
                        "
                        @click="
                            setOpenTerminalEnabled(
                                !props.config.openTerminal.enabled
                            )
                        "
                    >
                        {{
                            props.config.openTerminal.enabled ? '禁用' : '启用'
                        }}
                    </el-button>
                </div>
            </div>

            <div class="backend-body">
                <BackendOpenTerminal
                    :config="props.config.openTerminal"
                    @update="updateOpenTerminal"
                />
            </div>
        </section>

        <section class="backend-card">
            <div class="backend-head">
                <div class="backend-intro">
                    <div class="backend-title-row">
                        <div class="backend-title">本地环境</div>
                        <el-tag size="small" effect="plain" type="danger">
                            高风险
                        </el-tag>
                        <el-tag
                            size="small"
                            effect="plain"
                            :type="tagType(props.status.backends.local.state)"
                        >
                            {{ stateLabel(props.status.backends.local.state) }}
                        </el-tag>
                        <el-tag
                            v-if="props.config.defaultProvider === 'local'"
                            size="small"
                            effect="plain"
                        >
                            默认
                        </el-tag>
                        <el-tag size="small" effect="plain">
                            {{ props.status.backends.local.sessionCount }}
                            个活跃会话
                        </el-tag>
                    </div>
                    <div v-if="!props.hideDesc" class="backend-copy">
                        直接在宿主机执行，终端能力风险很高，只建议在完全信任当前模型和工作目录时启用。
                    </div>
                    <div
                        v-if="props.status.backends.local.error"
                        class="backend-error"
                    >
                        {{ props.status.backends.local.error }}
                    </div>
                </div>

                <div class="backend-actions">
                    <el-button text @click="openGuide('local')">
                        如何配置
                    </el-button>
                    <el-button
                        class="test-link"
                        plain
                        :loading="props.testing.local"
                        @click="emit('test', 'local')"
                    >
                        测试连接
                    </el-button>
                    <el-button
                        :type="
                            props.config.local.enabled ? 'danger' : 'success'
                        "
                        @click="setLocalEnabled(!props.config.local.enabled)"
                    >
                        {{ props.config.local.enabled ? '禁用' : '启用' }}
                    </el-button>
                </div>
            </div>

            <div class="backend-body">
                <BackendLocal
                    :config="props.config.local"
                    @update="updateLocal"
                />
            </div>
        </section>

        <StatusPanel
            :compact-mode="props.compactMode"
            :hide-desc="props.hideDesc"
            :status="props.status"
        />

        <el-dialog
            v-model="guideOpen"
            :title="`${guide.title} 如何配置`"
            width="min(860px, calc(100vw - 32px))"
            destroy-on-close
        >
            <div class="guide-dialog">
                <div class="guide-intro">{{ guide.intro }}</div>

                <div v-if="guide.warn" class="guide-warn">
                    {{ guide.warn }}
                </div>

                <section
                    v-for="section in guide.sections"
                    :key="section.title"
                    class="guide-section"
                >
                    <div class="guide-section-title">
                        {{ section.title }}
                    </div>

                    <ol v-if="section.steps" class="guide-list">
                        <li v-for="item in section.steps" :key="item">
                            {{ item }}
                        </li>
                    </ol>

                    <ul
                        v-if="section.items"
                        class="guide-list guide-list-bullet"
                    >
                        <li v-for="item in section.items" :key="item">
                            {{ item }}
                        </li>
                    </ul>

                    <pre
                        v-if="section.code"
                        class="guide-code"
                    ><code>{{ section.code }}</code></pre>
                </section>

                <section v-if="guide.links.length > 0" class="guide-section">
                    <div class="guide-section-title">参考文档</div>
                    <div class="guide-links">
                        <el-link
                            v-for="link in guide.links"
                            :key="link.href"
                            :href="link.href"
                            target="_blank"
                            rel="noreferrer"
                            type="primary"
                        >
                            {{ link.label }}
                        </el-link>
                    </div>
                </section>
            </div>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import BackendE2B from './config-backends/backend-e2b.vue'
import BackendLocal from './config-backends/backend-local.vue'
import BackendOpenTerminal from './config-backends/backend-open-terminal.vue'
import StatusPanel from './status-panel.vue'
import type {
    ComputerBackendType,
    ComputerConfig,
    ComputerStatus,
    E2BBackendConfig,
    LocalBackendConfig,
    OpenTerminalBackendConfig
} from '../../../src/types'

const props = defineProps<{
    config: ComputerConfig
    compactMode?: boolean
    hideDesc?: boolean
    status: ComputerStatus
    testing: Record<ComputerBackendType, boolean>
}>()

const emit = defineEmits<{
    'update:config': [value: ComputerConfig]
    test: [value: ComputerBackendType]
}>()

interface GuideSection {
    title: string
    steps?: string[]
    items?: string[]
    code?: string
}

interface GuideLink {
    label: string
    href: string
}

interface GuideContent {
    title: string
    intro: string
    warn?: string
    sections: GuideSection[]
    links: GuideLink[]
}

const guideOpen = ref(false)
const guideType = ref<ComputerBackendType>('e2b')

const guide = computed<GuideContent>(() => {
    if (guideType.value === 'local') {
        return {
            title: 'Local 本地环境',
            intro: 'Local 会直接在宿主机上读写文件并执行终端命令，适合你明确知道工作目录、命令边界和风险的时候使用。',
            warn: '建议保持默认关闭。优先把 scopePath 收紧到单个项目目录，并保留按需审批。',
            sections: [
                {
                    title: '推荐配置顺序',
                    steps: [
                        '先把“作用域路径”设置为单个项目的绝对路径，只给 Agent 它必须访问的目录。',
                        '把“沙箱模式”设为“只读”，只有在确实需要改文件时再切到“工作区可写”。',
                        '把“审批模式”保留为“按需审批”，这样高风险命令还需要人工确认。',
                        '把“网络策略”设为“阻止”，只有明确需要联网下载或调用外部服务时再放开。',
                        '如果只允许一小部分命令，就填写“允许的命令”；如果只是排除危险命令，就填写“禁止的命令”。',
                        '设置完成后先点“测试连接”，确认没问题再启用。'
                    ]
                },
                {
                    title: '字段怎么填',
                    items: [
                        '作用域路径：必填绝对路径，建议直接指向你的仓库根目录。',
                        '可写根目录：仅当需要写 scopePath 之外的路径时再加。',
                        '只读根目录 / 禁止访问目录：用来进一步收紧访问边界。',
                        '首选终端：一般保持“自动检测”即可。',
                        '命令超时：保守值可以先用 0.5 分钟。',
                        '忽略模式：把 node_modules、dist、缓存目录排除掉，能减少误读和误改。'
                    ],
                    code: [
                        '推荐起步配置',
                        '作用域路径: /path/to/project 或 C:\\repo\\project',
                        '沙箱模式: read-only',
                        '审批模式: on-request',
                        '首选终端: auto',
                        '命令超时: 0.5',
                        '网络策略: block'
                    ].join('\n')
                }
            ],
            links: []
        }
    }

    if (guideType.value === 'open-terminal') {
        return {
            title: 'open-terminal 远程终端',
            intro: 'open-terminal 更适合把执行环境放到远端机器或容器里，ChatLuna 只需要连接它暴露出的 HTTP API。',
            warn: '官方文档推荐优先使用 Docker。裸机模式会直接在远端宿主机上执行命令，风险明显更高。',
            sections: [
                {
                    title: '最快启动方式',
                    steps: [
                        '用 Docker 启动 open-terminal，并显式设置 API Key。',
                        '启动后把“基础 URL”填成你的服务地址，例如 http://localhost:8000。',
                        '把“API 密钥”填成 env:OPEN_TERMINAL_API_KEY 或直接填密钥。',
                        '如果服务跑在 Docker 里，把“部署模式”设为 Docker；如果是 pip/uvx 裸机启动，就选裸机。',
                        '配置完成后先点“测试连接”，确认通了再启用。'
                    ],
                    code: [
                        'docker run -d --name open-terminal --restart unless-stopped \\',
                        '  -p 8000:8000 \\',
                        '  -v open-terminal:/home/user \\',
                        '  -e OPEN_TERMINAL_API_KEY=your-secret-key \\',
                        '  -e OPEN_TERMINAL_BINARY_MIME_PREFIXES=image,audio,video,application/pdf,application/zip,application/vnd.openxmlformats-officedocument.,application/octet-stream \\',
                        '  ghcr.io/open-webui/open-terminal'
                    ].join('\n')
                },
                {
                    title: '表单字段建议',
                    items: [
                        '基础 URL：填写 open-terminal 对外地址，通常是 http://host:8000。',
                        'API 密钥：推荐使用 env:OPEN_TERMINAL_API_KEY，便于统一管理。',
                        '部署模式：按真实部署情况选 Docker / 裸机 / 未知。',
                        '用户隔离：只有你明确启用了 open-terminal 的 multi-user 模式时再打开；这个开关主要是配置标记，不会替代底层隔离。',
                        '如果你需要每个用户更强隔离，官方 README 也建议考虑每用户单独容器的方案。'
                    ],
                    code: [
                        '基础 URL: http://localhost:8000',
                        'API 密钥: env:OPEN_TERMINAL_API_KEY',
                        '部署模式: docker',
                        '用户隔离: false'
                    ].join('\n')
                },
                {
                    title: '裸机启动示例',
                    steps: [
                        '如果不用 Docker，可以用 uvx 或 pip 安装后直接启动。',
                        '这种模式下命令会直接以当前用户权限运行，请只在可信机器上使用。'
                    ],
                    code: [
                        'uvx open-terminal run --host 0.0.0.0 --port 8000 --api-key your-secret-key',
                        '',
                        'pip install open-terminal',
                        'open-terminal run --host 0.0.0.0 --port 8000 --api-key your-secret-key'
                    ].join('\n')
                }
            ],
            links: [
                {
                    label: 'open-terminal README',
                    href: 'https://github.com/open-webui/open-terminal'
                },
                {
                    label: 'open-terminal API Docs 说明',
                    href: 'https://github.com/open-webui/open-terminal#api-docs'
                }
            ]
        }
    }

    return {
        title: 'E2B 沙箱',
        intro: 'E2B 适合做默认电脑后端：隔离好、开箱即用，还能在需要时扩展到桌面流和 GUI 自动化。',
        warn: '没有桌面需求时，把“桌面模板”留空即可；只有要用桌面流和截图时，才需要单独准备 desktop template。',
        sections: [
            {
                title: '基础配置步骤',
                steps: [
                    '先在 E2B 创建账号，并从 Dashboard 的 Keys 页面生成 API Key。',
                    '把“API 密钥”填成 env:E2B_API_KEY，或直接填入你的密钥。',
                    '普通文件和终端任务直接把“模板”保持为 base 即可。',
                    '如果你需要桌面能力，再去构建一个 desktop template，并把模板名填到“桌面模板”。',
                    '“超时时间”建议先保留 5 分钟；“保持连接”适合连续任务复用同一个沙箱。',
                    '配置完先点“测试连接”，通过后再启用。'
                ]
            },
            {
                title: '没有桌面需求时的推荐值',
                code: [
                    'API 密钥: env:E2B_API_KEY',
                    '模板: base',
                    '桌面模板: 留空',
                    '超时时间: 5',
                    '保持连接: true'
                ].join('\n')
            },
            {
                title: '需要桌面时怎么填',
                items: [
                    'E2B Desktop 文档给了完整的 desktop template 示例，构建完成后可以直接用模板名，例如 desktop。',
                    '填了“桌面模板”后，这个后端才会暴露桌面流、截图和桌面操作能力。',
                    '如果你只是让 Agent 跑 bash、读写文件、搜索代码，不需要额外开启桌面模板。'
                ],
                code: [
                    'API 密钥: env:E2B_API_KEY',
                    '模板: base',
                    '桌面模板: desktop',
                    '超时时间: 5',
                    '保持连接: true'
                ].join('\n')
            }
        ],
        links: [
            {
                label: 'E2B Quickstart',
                href: 'https://e2b.dev/docs/quickstart'
            },
            {
                label: 'E2B Desktop / Computer Use',
                href: 'https://e2b.dev/docs/use-cases/computer-use'
            },
            {
                label: 'E2B Desktop Template 示例',
                href: 'https://e2b.dev/docs/template/examples/desktop'
            }
        ]
    }
})

function openGuide(type: ComputerBackendType) {
    guideType.value = type
    guideOpen.value = true
}

function updateLocal(value: LocalBackendConfig) {
    emit('update:config', {
        ...props.config,
        local: value
    })
}

function setLocalEnabled(value: boolean) {
    updateLocal({
        ...props.config.local,
        enabled: value
    })
}

function updateE2B(value: E2BBackendConfig) {
    emit('update:config', {
        ...props.config,
        e2b: value
    })
}

function setE2BEnabled(value: boolean) {
    updateE2B({
        ...props.config.e2b,
        enabled: value
    })
}

function updateOpenTerminal(value: OpenTerminalBackendConfig) {
    emit('update:config', {
        ...props.config,
        openTerminal: value
    })
}

function setOpenTerminalEnabled(value: boolean) {
    updateOpenTerminal({
        ...props.config.openTerminal,
        enabled: value
    })
}

function stateLabel(state: ComputerStatus['backends']['local']['state']) {
    if (state === 'connected') return '已连接'
    if (state === 'connecting') return '连接中'
    if (state === 'idle') return '就绪'
    if (state === 'error') return '错误'
    return '未支持'
}

function tagType(state: ComputerStatus['backends']['local']['state']) {
    if (state === 'connected') return 'success'
    if (state === 'idle') return 'info'
    if (state === 'error') return 'danger'
    return 'warning'
}
</script>

<style scoped>
.configuration-panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.configuration-panel.compact {
    gap: 16px;
}

.backend-card {
    border: 1px solid var(--k-color-divider);
    border-radius: 8px;
    background: var(--k-card-bg);
    overflow: hidden;
    transition: border-color 0.2s ease;
    box-sizing: border-box;
}

.backend-card:hover {
    border-color: color-mix(
        in srgb,
        var(--k-color-divider),
        var(--k-text-light) 20%
    );
}

.backend-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 20px;
    padding: 20px 24px;
    border-bottom: 1px solid var(--k-color-divider);
}

.configuration-panel.compact .backend-head {
    gap: 16px;
    padding: 16px 20px;
}

.backend-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
}

.backend-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--k-text-dark);
    letter-spacing: -0.01em;
}

.backend-copy,
.backend-error {
    font-size: 13px;
    line-height: 1.65;
}

.backend-copy {
    color: var(--k-text-light);
}

.backend-error {
    margin-top: 8px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--el-color-danger), transparent 92%);
    border-left: 2px solid var(--el-color-danger);
    border-radius: 4px;
    color: var(--el-color-danger);
}

.backend-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
}

.backend-actions :deep(.test-link.el-button) {
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

.backend-body {
    padding: 24px;
}

.configuration-panel.compact .backend-body {
    padding: 20px;
}

.guide-dialog {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-height: min(70vh, 720px);
    overflow: auto;
    padding-right: 4px;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--k-color-divider), #71717a 40%)
        transparent;
}

.guide-dialog::-webkit-scrollbar {
    width: 10px;
}

.guide-dialog::-webkit-scrollbar-track {
    background: transparent;
}

.guide-dialog::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--k-color-divider), #71717a 40%);
    border-radius: 10px;
    border: 2px solid transparent;
    background-clip: content-box;
}

.guide-dialog::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--k-color-divider), #52525b 58%);
    background-clip: content-box;
}

.guide-intro,
.guide-warn,
.guide-list {
    font-size: 13px;
    line-height: 1.75;
}

.guide-intro {
    color: var(--k-text-normal);
}

.guide-warn {
    padding: 10px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--el-color-warning), transparent 90%);
    color: color-mix(in srgb, var(--k-text-dark), var(--el-color-warning) 34%);
}

.guide-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.guide-section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.guide-list {
    margin: 0;
    padding-left: 20px;
    color: var(--k-text-light);
}

.guide-list-bullet {
    list-style: disc;
}

.guide-code {
    margin: 0;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 20%);
    background: color-mix(in srgb, var(--k-side-bg), var(--k-page-bg) 30%);
    color: var(--k-text-dark);
    font-size: 12px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
}

.guide-links {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
}

:deep(.backend-form) {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.configuration-panel.compact :deep(.backend-form) {
    gap: 20px;
}

:deep(.backend-form .section) {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.configuration-panel.compact :deep(.backend-form .section) {
    gap: 12px;
}

:deep(.backend-form .form-grid) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
}

:deep(.backend-form .form-cell-full) {
    grid-column: 1 / -1;
}

:deep(.backend-form .section-title) {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
    letter-spacing: -0.01em;
    margin-bottom: 4px;
}

:deep(.backend-form .section-copy) {
    margin-top: -8px;
    font-size: 13px;
    line-height: 1.65;
    color: var(--k-text-light);
}

:deep(.backend-form .el-form-item) {
    margin-bottom: 0;
}

:deep(.backend-form .el-form-item__label) {
    padding-bottom: 6px;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.5;
    color: var(--k-text-normal);
}

:deep(.backend-form .el-form-item__content) {
    min-width: 0;
}

:deep(.backend-form .el-input),
:deep(.backend-form .el-select),
:deep(.backend-form .el-input-number) {
    width: 100%;
}

:deep(.backend-form .el-alert) {
    --el-alert-padding: 14px 16px;
    --el-alert-border-radius-base: 6px;
}

@media (max-width: 991px) {
    :deep(.backend-form .form-grid) {
        grid-template-columns: 1fr;
    }

    :deep(.backend-form .form-cell-full) {
        grid-column: auto;
    }
}

@media (max-width: 768px) {
    .backend-head {
        grid-template-columns: 1fr;
        padding: 16px 20px;
    }

    .backend-actions {
        justify-content: flex-start;
    }

    .backend-body {
        padding: 20px;
    }
}
</style>
