<template>
    <div class="files-panel">
        <div class="panel-grid">
            <div class="work-panel">
                <div class="section-title">Files</div>
                <div class="section-copy">
                    通过 Computer backend
                    浏览文件、读取内容，并查看当前可预览端口。
                </div>

                <div class="controls-box">
                    <div class="field-group">
                        <label>读取路径</label>
                        <div class="inline-row">
                            <el-input
                                v-model="filePath"
                                placeholder="输入绝对路径或工作区路径"
                            />
                            <el-button :loading="reading" @click="readFile">
                                读取
                            </el-button>
                        </div>
                    </div>

                    <div class="field-group">
                        <label>搜索文件</label>
                        <div class="inline-row two-inputs">
                            <el-input
                                v-model="searchPattern"
                                placeholder="**/*.ts"
                            />
                            <el-input
                                v-model="searchRoot"
                                placeholder="搜索目录，可留空"
                            />
                            <el-button
                                :loading="searching"
                                @click="searchFiles"
                            >
                                搜索
                            </el-button>
                        </div>
                    </div>
                </div>

                <div v-if="matches.length > 0" class="matches-box">
                    <div class="box-title">搜索结果</div>
                    <div class="match-list">
                        <button
                            v-for="item in matches"
                            :key="item"
                            class="match-item"
                            @click="openMatch(item)"
                        >
                            {{ item }}
                        </button>
                    </div>
                </div>

                <div class="content-box">
                    <div class="box-head">
                        <div class="box-title">文件内容 / 目录结果</div>
                        <span class="box-meta">
                            {{ filePath || '尚未选择路径' }}
                        </span>
                    </div>
                    <pre class="content-pre">{{
                        content || '读取后会在这里显示内容。'
                    }}</pre>
                </div>
            </div>

            <div class="preview-panel">
                <div class="section-title">Preview</div>
                <div class="section-copy">
                    这里列出当前 backend 检测到的监听端口，并通过 ChatLuna
                    代理加载页面预览。
                </div>

                <div class="controls-box">
                    <div class="inline-row">
                        <el-button
                            :loading="portsLoading"
                            @click="refreshPorts"
                        >
                            刷新端口
                        </el-button>
                        <span class="box-meta">{{ ports.length }} ports</span>
                    </div>
                </div>

                <div v-if="ports.length > 0" class="ports-box">
                    <button
                        v-for="item in ports"
                        :key="`${item.port}:${item.state}`"
                        class="port-item"
                        @click="openPreview(item.port)"
                    >
                        <span>{{ item.port }}</span>
                        <span>{{ item.state }}</span>
                    </button>
                </div>

                <div v-if="previewUrl" class="frame-box">
                    <iframe :src="previewUrl" class="preview-frame" />
                </div>
                <div v-else class="frame-placeholder">
                    选择一个监听端口后，这里会显示页面预览。
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import type { ComputerConfig, ComputerStatus } from '../../../src/types'

const props = defineProps<{
    config: ComputerConfig
    status: ComputerStatus
}>()

const filePath = ref(props.config.local.scopePath || '/workspace')
const searchPattern = ref('**/*.ts')
const searchRoot = ref(props.config.local.scopePath || '')
const content = ref('')
const matches = ref<string[]>([])
const reading = ref(false)
const searching = ref(false)
const portsLoading = ref(false)
const ports = ref<
    Array<{
        port: number
        state: 'listening' | 'established'
        process?: string
    }>
>([])
const previewUrl = ref('')

watch(
    () => props.config.defaultProvider,
    () => {
        previewUrl.value = ''
        ports.value = []
    }
)

async function readFile() {
    if (!filePath.value.trim()) {
        return
    }

    try {
        reading.value = true
        content.value = await send('chatluna-agent/readComputerFile', {
            path: filePath.value.trim(),
            backend: props.config.defaultProvider,
            limit: 400
        })
    } catch {
        ElMessage.error('读取文件失败')
    } finally {
        reading.value = false
    }
}

async function searchFiles() {
    try {
        searching.value = true
        matches.value = await send('chatluna-agent/globComputerFiles', {
            pattern: searchPattern.value.trim(),
            path: searchRoot.value.trim() || undefined,
            backend: props.config.defaultProvider
        })
    } catch {
        ElMessage.error('搜索文件失败')
    } finally {
        searching.value = false
    }
}

function openMatch(item: string) {
    filePath.value = item
    readFile()
}

async function refreshPorts() {
    try {
        portsLoading.value = true
        ports.value = await send('chatluna-agent/listComputerPorts', {
            backend: props.config.defaultProvider
        })
    } catch {
        ElMessage.error('读取端口列表失败')
    } finally {
        portsLoading.value = false
    }
}

async function openPreview(port: number) {
    try {
        const desktop = await send('chatluna-agent/getComputerDesktop', {
            backend: props.config.defaultProvider
        })
        previewUrl.value = await send(
            'chatluna-agent/getComputerPreviewUrl',
            desktop.sessionId,
            port
        )
    } catch {
        ElMessage.error('打开预览失败')
    }
}
</script>

<style scoped>
.files-panel {
    padding: 18px 0 0;
}

.panel-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
    gap: 16px;
}

.work-panel,
.preview-panel,
.controls-box,
.matches-box,
.content-box,
.frame-box,
.frame-placeholder {
    border-radius: 12px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 24%);
    background: color-mix(
        in srgb,
        var(--k-page-bg),
        var(--k-color-surface-1) 20%
    );
}

.work-panel,
.preview-panel {
    padding: 16px;
}

.section-title,
.box-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--k-color-text);
}

.section-copy,
.box-meta,
label,
.content-pre {
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.7;
    color: var(--k-text-light);
}

.controls-box,
.matches-box,
.content-box,
.frame-box,
.frame-placeholder {
    margin-top: 14px;
    padding: 14px;
}

.field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.field-group + .field-group {
    margin-top: 12px;
}

.inline-row {
    display: flex;
    gap: 8px;
    align-items: center;
}

.inline-row :deep(.el-input) {
    flex: 1;
}

.two-inputs :deep(.el-input) {
    flex: 1;
}

.match-list,
.ports-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
}

.match-item,
.port-item {
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 24%);
    background: color-mix(
        in srgb,
        var(--k-page-bg),
        var(--k-color-surface-1) 18%
    );
    color: var(--k-color-text);
    text-align: left;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    gap: 12px;
}

.box-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
}

.content-pre {
    margin: 10px 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 420px;
    overflow: auto;
    font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
}

.preview-frame {
    width: 100%;
    height: 420px;
    border: 0;
    border-radius: 8px;
    background: #fff;
}

.frame-placeholder {
    color: var(--k-text-light);
}

@media (max-width: 1080px) {
    .panel-grid {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 768px) {
    .inline-row {
        flex-direction: column;
        align-items: stretch;
    }
}
</style>
