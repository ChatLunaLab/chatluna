<template>
    <div class="files-panel">
        <div class="explorer-shell">
            <div class="command-bar">
                <div class="command-actions">
                    <button
                        type="button"
                        class="icon-button"
                        :disabled="!canGoBack"
                        @click="goBack"
                    >
                        <el-icon><ArrowLeft /></el-icon>
                    </button>
                    <button
                        type="button"
                        class="icon-button"
                        :disabled="!canGoForward"
                        @click="goForward"
                    >
                        <el-icon><ArrowRight /></el-icon>
                    </button>
                    <button
                        type="button"
                        class="icon-button"
                        :disabled="!canGoUp"
                        @click="goUp"
                    >
                        <el-icon><Top /></el-icon>
                    </button>
                    <button
                        type="button"
                        class="icon-button"
                        @click="refreshFolder"
                    >
                        <el-icon><RefreshRight /></el-icon>
                    </button>
                </div>

                <form class="address-form" @submit.prevent="applyPath">
                    <el-input
                        v-model="pathInput"
                        class="address-input"
                        placeholder="/"
                    >
                        <template #prefix>
                            <el-icon><FolderOpened /></el-icon>
                        </template>
                    </el-input>
                    <button type="submit" class="action-button">打开</button>
                </form>

                <div class="search-tools">
                    <el-input
                        v-model="search"
                        clearable
                        class="search-input"
                        placeholder="搜索当前目录，支持 * 通配符"
                        @clear="clearSearch"
                        @keyup.enter="searchFiles"
                    >
                        <template #prefix>
                            <el-icon><Search /></el-icon>
                        </template>
                    </el-input>
                    <button
                        type="button"
                        class="action-button"
                        :disabled="searching"
                        @click="searchFiles"
                    >
                        搜索
                    </button>
                </div>
            </div>

            <div
                ref="bodyRef"
                :class="['explorer-body', { resizing }]"
                :style="bodyStyle"
            >
                <section class="browser-panel">
                    <div class="panel-head">
                        <div>
                            <div class="panel-title">
                                {{ keyword ? '搜索结果' : '当前目录' }}
                            </div>
                            <div class="panel-copy">
                                {{ backendLabel }} · {{ currentDir }} ·
                                {{ items.length }} 项
                            </div>
                        </div>

                        <button
                            v-if="keyword"
                            type="button"
                            class="text-button"
                            @click="clearSearch"
                        >
                            清空搜索
                        </button>
                    </div>

                    <div class="crumb-bar">
                        <template
                            v-for="(item, idx) in crumbs"
                            :key="item.path"
                        >
                            <button
                                type="button"
                                class="crumb-item"
                                :class="{ active: item.path === currentDir }"
                                @click="openDir(item.path)"
                            >
                                {{ item.label }}
                            </button>
                            <span
                                v-if="idx < crumbs.length - 1"
                                class="crumb-divider"
                            >
                                /
                            </span>
                        </template>
                    </div>

                    <div class="list-head">
                        <span>名称</span>
                        <span>类型</span>
                        <span class="cell-place">位置</span>
                    </div>

                    <div class="list-body" v-loading="loading || searching">
                        <button
                            v-for="item in items"
                            :key="item.path"
                            type="button"
                            class="list-row"
                            :class="{ active: selectedPath === item.path }"
                            @click="activateRow(item)"
                        >
                            <span class="cell-name">
                                <el-icon class="item-icon">
                                    <FolderOpened v-if="item.isDir" />
                                    <Document v-else />
                                </el-icon>
                                <span class="item-name">{{ item.name }}</span>
                            </span>
                            <span class="cell-copy">{{ item.kind }}</span>
                            <span class="cell-copy cell-place">
                                {{ item.place }}
                            </span>
                        </button>

                        <div
                            v-if="!items.length && !(loading || searching)"
                            class="empty-state"
                        >
                            <div class="empty-title">
                                {{
                                    keyword
                                        ? '没有找到匹配文件'
                                        : '当前目录为空'
                                }}
                            </div>
                            <div class="empty-copy">
                                {{
                                    keyword
                                        ? '试试更短的关键字，或输入 *.ts 这样的通配符。'
                                        : '点击文件夹进入下一层，或直接在顶部输入路径。'
                                }}
                            </div>
                        </div>
                    </div>
                </section>

                <button
                    type="button"
                    class="panel-splitter"
                    title="拖动调整宽度"
                    @dblclick="resetPanels"
                    @pointerdown="startResize"
                >
                    <span class="splitter-line" />
                </button>

                <section class="viewer-panel">
                    <div class="tabs-bar">
                        <div class="tabs-scroll">
                            <div
                                v-for="item in tabs"
                                :key="item.key"
                                class="viewer-tab"
                                :class="{ active: item.key === activeKey }"
                            >
                                <button
                                    type="button"
                                    class="viewer-tab-trigger"
                                    @click="activeKey = item.key"
                                >
                                    <span class="viewer-tab-label">
                                        {{ item.title }}
                                    </span>
                                    <span class="viewer-tab-meta">
                                        {{
                                            item.kind === 'image'
                                                ? 'image'
                                                : item.lang
                                        }}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    class="viewer-tab-close"
                                    @click="closeTab(item.key)"
                                >
                                    <el-icon :size="12"><Close /></el-icon>
                                </button>
                            </div>
                        </div>

                        <div class="tabs-actions">
                            <button
                                v-if="activeTab"
                                type="button"
                                class="icon-button tabs-icon"
                                title="刷新标签"
                                @click="reloadActiveTab"
                            >
                                <el-icon><RefreshRight /></el-icon>
                            </button>
                            <button
                                v-if="tabs.length > 0"
                                type="button"
                                class="icon-button tabs-icon"
                                title="关闭全部"
                                @click="closeAllTabs"
                            >
                                <el-icon><Close /></el-icon>
                            </button>
                        </div>
                    </div>

                    <div v-if="activeTab" class="viewer-head">
                        <div class="viewer-path">{{ activeTab.path }}</div>
                        <div class="viewer-actions">
                            <a
                                v-if="
                                    activeTab.kind === 'image' && activeTab.url
                                "
                                :href="activeTab.url"
                                :download="activeTab.title"
                                class="text-link"
                                target="_blank"
                                rel="noreferrer"
                            >
                                下载
                            </a>
                            <span class="viewer-badge">
                                {{
                                    activeTab.kind === 'image'
                                        ? 'image'
                                        : activeTab.lang
                                }}
                            </span>
                        </div>
                    </div>

                    <div class="viewer-body" v-loading="activeTab?.loading">
                        <div
                            v-if="activeTab && activeTab.kind === 'image'"
                            class="image-stage"
                        >
                            <img
                                v-if="activeTab.url"
                                :src="activeTab.url"
                                :alt="activeTab.title"
                                class="image-preview"
                            />
                            <div v-else class="empty-state viewer-empty">
                                <div class="empty-title">图片暂时无法显示</div>
                                <div class="empty-copy">
                                    可以刷新标签重试，或者切换到其他文件继续浏览。
                                </div>
                            </div>
                        </div>
                        <code-editor
                            v-else-if="activeTab"
                            :model-value="activeTab.content"
                            :language="activeTab.lang"
                            :readonly="true"
                            :min-height="400"
                            placeholder="当前文件为空。"
                        />
                        <div v-else class="empty-state viewer-empty">
                            <div class="empty-title">打开文件开始预览</div>
                            <div class="empty-copy">
                                左侧列表高度已限制，可独立滚动；中间拖拽条可以调节左右区域宽度。
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    ArrowLeft,
    ArrowRight,
    Close,
    Document,
    FolderOpened,
    RefreshRight,
    Search,
    Top
} from '@element-plus/icons-vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import CodeEditor from '../shared/code-editor.vue'
import type { ComputerConfig, ComputerStatus } from '../../../src/types'

interface FileRow {
    name: string
    path: string
    isDir: boolean
    kind: string
    place: string
}

interface FileTab {
    key: string
    title: string
    path: string
    kind: 'text' | 'image'
    lang: string
    content: string
    url: string
    loading: boolean
}

function clean(path: string) {
    const next = path.replaceAll('\\', '/')
    if (next === '/' || /^[A-Za-z]:\/$/.test(next)) {
        return next
    }

    return next.replace(/\/+$/, '')
}

function upOf(path: string) {
    const next = clean(path)
    const idx = next.lastIndexOf('/')
    if (idx < 1) {
        return next.startsWith('/') ? '/' : next
    }
    if (idx === 2 && /^[A-Za-z]:\//.test(next)) {
        return next.slice(0, 3)
    }

    return next.slice(0, idx)
}

function kindOf(path: string) {
    const ext = path.split('.').pop()?.toLowerCase()
    if (!ext || ext.includes('/')) {
        return '文件'
    }
    if (ext === 'md') {
        return 'Markdown 文件'
    }
    if (ext === 'json') {
        return 'JSON 文件'
    }
    if (ext === 'yml' || ext === 'yaml') {
        return 'YAML 文件'
    }
    if (imageOf(path)) {
        return '图片'
    }

    return `${ext.toUpperCase()} 文件`
}

function langOf(path: string) {
    const ext = path.split('.').pop()?.toLowerCase()
    if (!ext) {
        return 'plaintext'
    }

    const map: Record<string, string> = {
        json: 'json',
        md: 'markdown',
        yaml: 'yaml',
        yml: 'yaml',
        js: 'javascript',
        mjs: 'javascript',
        cjs: 'javascript',
        ts: 'typescript',
        mts: 'typescript',
        cts: 'typescript',
        tsx: 'typescript',
        jsx: 'javascript',
        py: 'python',
        sh: 'shell',
        bash: 'shell'
    }

    return map[ext] || 'plaintext'
}

function imageOf(path: string) {
    const ext = path.split('.').pop()?.toLowerCase()
    return [
        'png',
        'jpg',
        'jpeg',
        'gif',
        'webp',
        'bmp',
        'svg',
        'ico',
        'avif'
    ].includes(ext || '')
}

function mimeOf(path: string) {
    const ext = path.split('.').pop()?.toLowerCase()
    const map: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
        avif: 'image/avif'
    }

    return map[ext || ''] || 'application/octet-stream'
}

function textOf(raw: string) {
    const lines = raw.split('\n')
    if (/^\(Showing lines .*\)$/.test(lines[lines.length - 1] || '')) {
        lines.pop()
        if (lines[lines.length - 1] === '') {
            lines.pop()
        }
    }

    return lines.map((line) => line.replace(/^\d+:\s/, '')).join('\n')
}

function rowsOf(list: string[], base: string) {
    const root = clean(base)

    return list
        .map((item) => item.replace(/\r$/, ''))
        .filter(Boolean)
        .map((item) => {
            const full = item.replaceAll('\\', '/')
            const isDir = full.endsWith('/')
            const path = isDir ? clean(full.slice(0, -1)) : clean(full)
            const name = path.split('/').pop() || path
            const parent = path.includes('/') ? upOf(path) : root
            const place =
                parent === root
                    ? '当前目录'
                    : root === '/'
                      ? parent.slice(1)
                      : parent.startsWith(root + '/')
                        ? parent.slice(root.length + 1)
                        : parent

            return {
                name,
                path,
                isDir,
                kind: isDir ? '文件夹' : kindOf(path),
                place
            }
        })
        .sort((a, b) => {
            if (a.isDir !== b.isDir) {
                return a.isDir ? -1 : 1
            }

            return a.name.localeCompare(b.name, 'zh-CN')
        })
}

const props = defineProps<{
    config: ComputerConfig
    status: ComputerStatus
}>()

const bodyRef = ref<HTMLElement>()
const currentDir = ref('')
const pathInput = ref('/')
const search = ref('')
const items = ref<FileRow[]>([])
const tabs = ref<FileTab[]>([])
const activeKey = ref('')
const selectedPath = ref('')
const loading = ref(false)
const searching = ref(false)
const resizing = ref(false)
const browserSize = ref(38)
const history = ref<string[]>([])
const historyIndex = ref(-1)

const rootPath = computed(() => clean(props.config.local.scopePath || '/'))
const rootLabel = computed(() => {
    const parts = rootPath.value.split('/').filter(Boolean)
    return parts[parts.length - 1] || rootPath.value
})
const keyword = computed(() => search.value.trim())
const backendLabel = computed(() => {
    if (props.config.defaultProvider === 'local') {
        return 'Local'
    }
    if (props.config.defaultProvider === 'e2b') {
        return 'E2B'
    }

    return 'open-terminal'
})
const activeTab = computed(() =>
    tabs.value.find((item) => item.key === activeKey.value)
)
const canGoBack = computed(() => historyIndex.value > 0)
const canGoForward = computed(
    () =>
        historyIndex.value > -1 && historyIndex.value < history.value.length - 1
)
const canGoUp = computed(() => currentDir.value !== rootPath.value)
const bodyStyle = computed(() => ({
    '--browser-size': `${browserSize.value}%`
}))
const crumbs = computed(() => {
    const list = [
        {
            label: rootLabel.value,
            path: rootPath.value
        }
    ]

    if (currentDir.value === rootPath.value) {
        return list
    }

    const rest =
        rootPath.value === '/'
            ? currentDir.value.slice(1)
            : currentDir.value.startsWith(rootPath.value + '/')
              ? currentDir.value.slice(rootPath.value.length + 1)
              : ''
    let path = rootPath.value

    for (const item of rest.split('/').filter(Boolean)) {
        path = path === '/' ? `/${item}` : `${path}/${item}`
        list.push({
            label: item,
            path
        })
    }

    return list
})

watch(
    [() => props.config.defaultProvider, rootPath],
    async () => {
        currentDir.value = rootPath.value
        pathInput.value = rootPath.value
        search.value = ''
        items.value = []
        tabs.value = []
        activeKey.value = ''
        selectedPath.value = ''
        history.value = []
        historyIndex.value = -1
        browserSize.value = 38
        await loadDir(rootPath.value, 'push')
    },
    { immediate: true }
)

onBeforeUnmount(() => {
    stopResize()
})

async function readDir(dir: string) {
    const raw = await send('chatluna-agent/readComputerFile', {
        path: dir,
        backend: props.config.defaultProvider
    })

    return rowsOf(raw.split('\n'), dir)
}

async function loadDir(dir: string, mode: 'push' | 'silent' = 'push') {
    try {
        loading.value = true
        const path = clean(dir || rootPath.value)
        const list = await readDir(path)
        currentDir.value = path
        pathInput.value = path
        items.value = list
        selectedPath.value = ''

        if (mode === 'push' && history.value[historyIndex.value] !== path) {
            history.value = history.value.slice(0, historyIndex.value + 1)
            history.value.push(path)
            historyIndex.value = history.value.length - 1
        }
    } catch {
        ElMessage.error('读取目录失败')
    } finally {
        loading.value = false
    }
}

async function applyPath() {
    search.value = ''
    await loadDir(pathInput.value || rootPath.value, 'push')
}

async function openDir(dir: string) {
    search.value = ''
    await loadDir(dir, 'push')
}

async function clearSearch() {
    search.value = ''
    await loadDir(currentDir.value, 'silent')
}

async function searchFiles() {
    if (!keyword.value) {
        await loadDir(currentDir.value, 'silent')
        return
    }

    try {
        searching.value = true
        const pattern =
            keyword.value.includes('*') ||
            keyword.value.includes('?') ||
            keyword.value.includes('[')
                ? keyword.value
                : `**/*${keyword.value}*`
        const matches = await send('chatluna-agent/globComputerFiles', {
            pattern,
            path: currentDir.value,
            backend: props.config.defaultProvider
        })
        items.value = rowsOf(matches, currentDir.value)
        selectedPath.value = ''
    } catch {
        ElMessage.error('搜索文件失败')
    } finally {
        searching.value = false
    }
}

async function activateRow(item: FileRow) {
    selectedPath.value = item.path
    if (item.isDir) {
        await openDir(item.path)
        return
    }

    await openFile(item.path)
}

async function goBack() {
    if (!canGoBack.value) {
        return
    }

    search.value = ''
    historyIndex.value -= 1
    await loadDir(history.value[historyIndex.value], 'silent')
}

async function goForward() {
    if (!canGoForward.value) {
        return
    }

    search.value = ''
    historyIndex.value += 1
    await loadDir(history.value[historyIndex.value], 'silent')
}

async function goUp() {
    if (!canGoUp.value) {
        return
    }

    search.value = ''
    const path = upOf(currentDir.value)
    await loadDir(
        path.startsWith(rootPath.value) || rootPath.value === '/'
            ? path
            : rootPath.value,
        'push'
    )
}

async function refreshFolder() {
    if (keyword.value) {
        await searchFiles()
        return
    }

    await loadDir(currentDir.value, 'silent')
}

async function openFile(path: string) {
    const file = clean(path)
    const old = tabs.value.find((item) => item.path === file)
    if (old) {
        activeKey.value = old.key
        return
    }

    const tab: FileTab = {
        key: `file-${Date.now()}-${tabs.value.length + 1}`,
        title: file.split('/').pop() || file,
        path: file,
        kind: imageOf(file) ? 'image' : 'text',
        lang: langOf(file),
        content: '',
        url: '',
        loading: true
    }

    tabs.value.push(tab)
    activeKey.value = tab.key

    try {
        if (tab.kind === 'image') {
            const data = await send('chatluna-agent/readComputerFileAsset', {
                path: file,
                backend: props.config.defaultProvider
            })
            tab.url = `data:${mimeOf(file)};base64,${data}`
            return
        }

        const raw = await send('chatluna-agent/readComputerFile', {
            path: file,
            backend: props.config.defaultProvider,
            limit: 400
        })
        tab.content = textOf(raw)
    } catch {
        closeTab(tab.key)
        ElMessage.error('读取文件失败')
    } finally {
        tab.loading = false
    }
}

async function reloadActiveTab() {
    if (!activeTab.value) {
        return
    }

    try {
        activeTab.value.loading = true
        if (activeTab.value.kind === 'image') {
            const data = await send('chatluna-agent/readComputerFileAsset', {
                path: activeTab.value.path,
                backend: props.config.defaultProvider
            })
            activeTab.value.url = `data:${mimeOf(activeTab.value.path)};base64,${data}`
            return
        }

        const raw = await send('chatluna-agent/readComputerFile', {
            path: activeTab.value.path,
            backend: props.config.defaultProvider,
            limit: 400
        })
        activeTab.value.content = textOf(raw)
    } catch {
        ElMessage.error('刷新文件失败')
    } finally {
        activeTab.value.loading = false
    }
}

function closeTab(key: string) {
    const idx = tabs.value.findIndex((item) => item.key === key)
    if (idx < 0) {
        return
    }

    tabs.value.splice(idx, 1)
    if (activeKey.value !== key) {
        return
    }

    const next = tabs.value[idx] || tabs.value[idx - 1]
    activeKey.value = next?.key || ''
}

function closeAllTabs() {
    tabs.value = []
    activeKey.value = ''
}

function startResize(event: PointerEvent) {
    if (!bodyRef.value || window.innerWidth <= 1200) {
        return
    }

    event.preventDefault()
    resizing.value = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    resizePanels(event)
    window.addEventListener('pointermove', resizePanels)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
}

function resizePanels(event: PointerEvent) {
    if (!resizing.value || !bodyRef.value) {
        return
    }

    const rect = bodyRef.value.getBoundingClientRect()
    const next = ((event.clientX - rect.left) / rect.width) * 100
    browserSize.value = Math.min(62, Math.max(28, next))
}

function stopResize() {
    resizing.value = false
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    window.removeEventListener('pointermove', resizePanels)
    window.removeEventListener('pointerup', stopResize)
    window.removeEventListener('pointercancel', stopResize)
}

function resetPanels() {
    browserSize.value = 38
}
</script>

<style scoped>
.files-panel {
    padding: 18px 0 0;
}

.explorer-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 620px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 14%);
    border-radius: 14px;
    background: var(--k-page-bg);
    overflow: hidden;
}

.command-bar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) minmax(260px, 320px);
    gap: 12px;
    align-items: center;
    padding: 14px 16px;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
    background: var(--k-page-bg);
}

.command-actions,
.tabs-actions,
.viewer-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

.address-form,
.search-tools {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    min-width: 0;
}

.address-input :deep(.el-input__wrapper),
.search-input :deep(.el-input__wrapper) {
    border-radius: 10px;
    background: color-mix(in srgb, var(--k-page-bg), var(--k-side-bg) 6%);
    box-shadow: inset 0 0 0 1px
        color-mix(in srgb, var(--k-color-divider), transparent 12%);
}

.address-input :deep(.el-input__wrapper.is-focus),
.search-input :deep(.el-input__wrapper.is-focus) {
    box-shadow: inset 0 0 0 1px var(--k-color-primary);
}

.icon-button,
.action-button,
.text-button,
.text-link,
.crumb-item,
.list-row,
.viewer-tab-trigger,
.viewer-tab-close,
.panel-splitter {
    font: inherit;
}

.icon-button,
.action-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 34px;
    border: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 12%);
    border-radius: 9px;
    background: var(--k-page-bg);
    color: var(--k-text-dark);
    cursor: pointer;
    transition:
        border-color 0.16s ease,
        background-color 0.16s ease,
        color 0.16s ease;
}

.icon-button {
    width: 34px;
}

.action-button {
    min-width: 64px;
    padding: 0 12px;
}

.icon-button:hover,
.action-button:hover,
.text-button:hover,
.text-link:hover,
.crumb-item:hover,
.viewer-tab-close:hover {
    background: color-mix(in srgb, var(--k-activity-bg), transparent 8%);
}

.icon-button:disabled,
.action-button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.explorer-body {
    display: grid;
    grid-template-columns: minmax(320px, var(--browser-size)) 12px minmax(
            0,
            1fr
        );
    min-height: 0;
}

.explorer-body.resizing {
    cursor: col-resize;
}

.browser-panel,
.viewer-panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--k-page-bg);
}

.browser-panel {
    align-self: start;
}

.panel-head,
.viewer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
}

.panel-head,
.crumb-bar,
.list-head,
.tabs-bar,
.viewer-head {
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 18%);
}

.panel-title,
.empty-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--k-text-dark);
}

.panel-copy,
.cell-copy,
.empty-copy,
.viewer-path,
.viewer-tab-meta,
.text-link {
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-light);
}

.panel-copy {
    margin-top: 4px;
}

.text-button,
.text-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-decoration: none;
    cursor: pointer;
}

.crumb-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    overflow: auto;
    padding: 0 16px;
    background: var(--k-page-bg);
}

.crumb-item {
    flex-shrink: 0;
    max-width: 180px;
    padding: 6px 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--k-text-dark);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.crumb-item.active {
    background: color-mix(in srgb, var(--k-color-primary), transparent 90%);
    color: var(--k-color-primary);
}

.crumb-divider {
    flex-shrink: 0;
    color: var(--k-text-light);
}

.list-head,
.list-row {
    display: grid;
    grid-template-columns: minmax(0, 1.8fr) 128px 160px;
    gap: 12px;
    align-items: center;
}

.list-head {
    padding: 10px 16px;
    font-size: 12px;
    color: var(--k-text-light);
    background: var(--k-page-bg);
}

.list-body {
    position: relative;
    min-height: 240px;
    max-height: clamp(260px, 44vh, 420px);
    overflow: auto;
}

.list-row {
    width: 100%;
    min-height: 42px;
    padding: 0 16px;
    border: 0;
    border-bottom: 1px solid
        color-mix(in srgb, var(--k-color-divider), transparent 24%);
    background: transparent;
    color: var(--k-text-dark);
    text-align: left;
    cursor: pointer;
}

.list-row.active {
    background: color-mix(in srgb, var(--k-color-primary), transparent 92%);
}

.cell-name {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}

.item-icon {
    color: color-mix(in srgb, var(--k-color-primary), var(--k-text-dark) 50%);
}

.item-name,
.viewer-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.panel-splitter {
    position: relative;
    width: 12px;
    min-width: 12px;
    padding: 0;
    border: 0;
    background: var(--k-page-bg);
    cursor: col-resize;
    touch-action: none;
}

.panel-splitter::before {
    content: '';
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--k-color-divider), transparent 76%);
}

.splitter-line {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 4px;
    height: 64px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--k-color-divider), transparent 20%);
    transform: translate(-50%, -50%);
    transition: background-color 0.16s ease;
}

.panel-splitter:hover .splitter-line,
.explorer-body.resizing .splitter-line {
    background: color-mix(in srgb, var(--k-color-primary), transparent 24%);
}

.tabs-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 10px;
    background: var(--k-page-bg);
}

.tabs-scroll {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    flex: 1;
    min-width: 0;
    overflow: auto;
    min-height: 48px;
}

.tabs-icon {
    width: 30px;
    min-width: 30px;
    height: 30px;
    padding: 0;
}

.viewer-tab {
    display: inline-flex;
    align-items: center;
    max-width: 240px;
    border: 1px solid transparent;
    border-bottom: 0;
    border-radius: 10px 10px 0 0;
    background: transparent;
}

.viewer-tab.active {
    border-color: color-mix(in srgb, var(--k-color-divider), transparent 10%);
    background: var(--k-page-bg);
}

.viewer-tab-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    padding: 9px 6px 9px 12px;
    border: 0;
    background: transparent;
    color: var(--k-text-dark);
    cursor: pointer;
}

.viewer-tab-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    margin-right: 4px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--k-text-light);
    cursor: pointer;
}

.viewer-badge {
    flex-shrink: 0;
    padding: 3px 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--k-color-primary), transparent 90%);
    color: var(--k-color-primary);
    font-size: 11px;
}

.viewer-body {
    position: relative;
    flex: 1;
    min-height: 360px;
    background: var(--k-page-bg);
}

.viewer-body :deep(.code-editor) {
    height: 100%;
    border: 0;
    border-radius: 0;
}

.image-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 360px;
    height: 100%;
    padding: 20px;
    overflow: auto;
}

.image-preview {
    display: block;
    max-width: 100%;
    max-height: 420px;
    object-fit: contain;
    border-radius: 10px;
    background: var(--k-page-bg);
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 220px;
    padding: 32px;
    text-align: center;
}

.viewer-empty {
    height: 100%;
}

.empty-copy {
    max-width: 340px;
    margin-top: 6px;
}

.icon-button:focus-visible,
.action-button:focus-visible,
.text-button:focus-visible,
.text-link:focus-visible,
.crumb-item:focus-visible,
.list-row:focus-visible,
.panel-splitter:focus-visible,
.viewer-tab-trigger:focus-visible,
.viewer-tab-close:focus-visible {
    outline: 2px solid
        color-mix(in srgb, var(--k-color-primary), transparent 40%);
    outline-offset: 2px;
}

@media (max-width: 1200px) {
    .explorer-body {
        grid-template-columns: 1fr;
    }

    .panel-splitter {
        display: none;
    }

    .browser-panel {
        align-self: stretch;
        border-bottom: 1px solid
            color-mix(in srgb, var(--k-color-divider), transparent 18%);
    }
}

@media (max-width: 980px) {
    .command-bar {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 720px) {
    .address-form,
    .search-tools {
        grid-template-columns: 1fr;
    }

    .list-head,
    .list-row {
        grid-template-columns: minmax(0, 1fr) 92px;
    }

    .cell-place {
        display: none;
    }

    .tabs-bar,
    .panel-head,
    .viewer-head {
        flex-direction: column;
        align-items: stretch;
    }

    .tabs-actions,
    .viewer-actions {
        justify-content: flex-end;
    }

    .tabs-actions {
        padding-bottom: 10px;
    }
}
</style>
