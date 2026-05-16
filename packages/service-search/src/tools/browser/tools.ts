import { mkdir, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { StructuredTool } from '@langchain/core/tools'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { ComputedRef } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type { ElementHandle, KeyInput } from 'puppeteer-core'
import z from 'zod'
import { BrowserManager, BrowserSnapshotNode } from './manager'

const PAGE_META = {
    source: 'extension',
    group: 'browser',
    tags: ['browser', 'web'],
    defaultAvailability: {
        enabled: true,
        main: true,
        chatluna: true,
        characterScope: 'all' as const
    }
}

const INPUT_META = {
    ...PAGE_META,
    tags: ['browser', 'web', 'input']
}

const DEBUG_META = {
    ...PAGE_META,
    tags: ['browser', 'web', 'debug']
}

const openSchema = z.object({
    url: z.string().describe('URL to open.'),
    newPage: z
        .boolean()
        .optional()
        .describe('Open in a new page instead of reusing the selected page.'),
    background: z.boolean().optional().describe('Open the page in background.'),
    waitUntil: z
        .enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2'])
        .optional()
        .describe('Navigation wait condition.'),
    timeout: z.number().optional().describe('Navigation timeout in ms.')
})

const pageIdSchema = z.object({
    pageId: z
        .number()
        .optional()
        .describe('Browser page id. Uses selected page if omitted.')
})

const readSchema = pageIdSchema.extend({
    url: z.string().optional().describe('URL to open before reading.'),
    selector: z.string().optional().describe('CSS selector to read from.'),
    includeLinks: z.boolean().optional().describe('Append important links.'),
    maxLength: z.number().optional().describe('Maximum returned text length.')
})

const snapshotSchema = pageIdSchema.extend({
    verbose: z
        .boolean()
        .optional()
        .describe('Include more accessibility nodes.')
})

const uidSchema = pageIdSchema.extend({
    uid: z.string().describe('Element uid from browser_snapshot.'),
    includeSnapshot: z
        .boolean()
        .optional()
        .describe('Return a new snapshot after the action.')
})

export function registerBrowserTools(
    plugin: ChatLunaPlugin,
    manager: BrowserManager,
    summaryModel: ComputedRef<ChatLunaChatModel | undefined>
) {
    const tools = [
        new BrowserOpenTool(manager),
        new BrowserListPagesTool(manager),
        new BrowserSelectPageTool(manager),
        new BrowserClosePageTool(manager),
        new BrowserNavigateTool(manager),
        new BrowserReadTextTool(manager),
        new BrowserGetHtmlTool(manager),
        new BrowserGetLinksTool(manager),
        new BrowserSummarizeTool(manager, summaryModel),
        new BrowserSnapshotTool(manager),
        new BrowserWaitForTool(manager),
        new BrowserScreenshotTool(manager),
        new BrowserClickTool(manager),
        new BrowserHoverTool(manager),
        new BrowserFillTool(manager),
        new BrowserFillFormTool(manager),
        new BrowserTypeTool(manager),
        new BrowserPressKeyTool(manager),
        new BrowserUploadFileTool(manager),
        new BrowserEvaluateTool(manager),
        new BrowserConsoleTool(manager),
        new BrowserNetworkTool(manager)
    ]

    for (const item of tools) {
        plugin.registerTool(item.name, {
            description: item.description,
            createTool: () => item,
            selector: () => true,
            meta:
                item.name.includes('click') ||
                item.name.includes('fill') ||
                item.name.includes('type') ||
                item.name.includes('key') ||
                item.name.includes('upload') ||
                item.name.includes('hover')
                    ? INPUT_META
                    : item.name.includes('evaluate') ||
                        item.name.includes('console') ||
                        item.name.includes('network')
                      ? DEBUG_META
                      : PAGE_META
        })
    }
}

class BrowserOpenTool extends StructuredTool {
    name = 'browser_open'
    description = 'Open a web page in the browser and select it.'
    schema = openSchema

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof openSchema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        if (!input.url) throw new Error('url is required')
        const page = await this.manager.open(
            Object.assign({}, input, { url: input.url }),
            cfg
        )
        return JSON.stringify(
            {
                pageId: page.id,
                title: await page.page.title(),
                url: page.page.url()
            },
            null,
            2
        )
    }
}

class BrowserListPagesTool extends StructuredTool {
    name = 'browser_list_pages'
    description = 'List browser pages in the current conversation.'
    schema = z.object({})

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(_, _runManager, cfg: ChatLunaToolRunnable) {
        return JSON.stringify(this.manager.listPages(cfg), null, 2)
    }
}

class BrowserSelectPageTool extends StructuredTool {
    name = 'browser_select_page'
    description = 'Select a browser page for later browser tools.'
    schema = z.object({ pageId: z.number().describe('Browser page id.') })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(input: { pageId: number }, _, cfg: ChatLunaToolRunnable) {
        const page = this.manager.selectPage(input.pageId, cfg)
        return `Selected browser page ${page.id}: ${page.page.url()}`
    }
}

class BrowserClosePageTool extends StructuredTool {
    name = 'browser_close_page'
    description = 'Close a browser page.'
    schema = z.object({ pageId: z.number().describe('Browser page id.') })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(input: { pageId: number }, _, cfg: ChatLunaToolRunnable) {
        await this.manager.closePage(input.pageId, cfg)
        return `Closed browser page ${input.pageId}`
    }
}

class BrowserNavigateTool extends StructuredTool {
    name = 'browser_navigate'
    description =
        'Navigate the selected browser page by URL, back, forward, or reload.'

    schema = pageIdSchema.extend({
        action: z.enum(['url', 'back', 'forward', 'reload']),
        url: z.string().optional().describe('Required when action is url.'),
        waitUntil: z
            .enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2'])
            .optional(),
        timeout: z.number().optional()
    })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        if (!input.action) throw new Error('action is required')
        const page = await this.manager.navigate(
            Object.assign({}, input, { action: input.action }),
            cfg
        )
        return JSON.stringify(
            { pageId: page.id, url: page.page.url() },
            null,
            2
        )
    }
}

class BrowserReadTextTool extends StructuredTool {
    name = 'browser_read_text'
    description = 'Read readable text from a URL or selected browser page.'
    schema = readSchema

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof readSchema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        return await this.manager.readText(input, cfg)
    }
}

class BrowserGetHtmlTool extends StructuredTool {
    name = 'browser_get_html'
    description = 'Get HTML from a URL or selected browser page.'
    schema = readSchema.omit({ includeLinks: true })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        return await this.manager.getHtml(input, cfg)
    }
}

class BrowserGetLinksTool extends StructuredTool {
    name = 'browser_get_links'
    description = 'Get structured links from a URL or selected browser page.'
    schema = readSchema.omit({ includeLinks: true, selector: true })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        return await this.manager.getLinks(input, cfg)
    }
}

class BrowserSummarizeTool extends StructuredTool {
    name = 'browser_summarize'
    description =
        'Summarize a URL or selected browser page in the source language.'

    schema = readSchema.extend({
        focus: z.string().optional().describe('Optional summary focus.')
    })

    constructor(
        private manager: BrowserManager,
        private model: ComputedRef<ChatLunaChatModel | undefined>
    ) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        return await this.manager.summarize(
            input,
            this.model.value ?? cfg.configurable.model,
            cfg
        )
    }
}

class BrowserSnapshotTool extends StructuredTool {
    name = 'browser_snapshot'
    description =
        'Take an accessibility snapshot with stable uids for browser input tools.'

    schema = snapshotSchema

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof snapshotSchema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        const snapshot = await this.manager.snapshot(page, input.verbose)
        return formatSnapshot(snapshot.root)
    }
}

class BrowserWaitForTool extends StructuredTool {
    name = 'browser_wait_for'
    description = 'Wait for text to appear on the selected browser page.'
    schema = pageIdSchema.extend({
        text: z.string().describe('Text to wait for.'),
        timeout: z.number().optional().describe('Timeout in ms.')
    })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        await page.page.waitForFunction(
            (text) => document.body?.innerText?.includes(text),
            { timeout: input.timeout ?? this.manager.config.browserTimeout },
            input.text
        )
        return `Text found: ${input.text}`
    }
}

class BrowserScreenshotTool extends StructuredTool {
    name = 'browser_screenshot'
    description =
        'Take a screenshot of the selected browser page or an element uid.'

    schema = pageIdSchema.extend({
        uid: z
            .string()
            .optional()
            .describe('Element uid from browser_snapshot.'),
        fullPage: z.boolean().optional().describe('Capture full page.'),
        filePath: z.string().optional().describe('Output image path.'),
        format: z.enum(['png', 'jpeg', 'webp']).optional()
    })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        const target = input.uid
            ? await this.manager.getElement(page, input.uid)
            : page.page
        const format = input.format ?? 'png'
        const data = await target.screenshot({
            type: format,
            fullPage: input.uid ? undefined : input.fullPage
        })
        const file = input.filePath
            ? resolve(input.filePath)
            : join(
                  resolve(
                      this.manager.ctx.baseDir,
                      'data/chatluna/browser-output'
                  ),
                  `screenshot-${Date.now()}.${format}`
              )
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, data)
        return `Screenshot saved to: ${file}`
    }
}

class BrowserClickTool extends StructuredTool {
    name = 'browser_click'
    description = 'Click an element uid from browser_snapshot.'
    schema = uidSchema.extend({ double: z.boolean().optional() })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        const el = await this.manager.getElement(page, input.uid)
        try {
            await el.click({ count: input.double ? 2 : 1 })
        } finally {
            await el.dispose()
        }
        return await actionResult(this.manager, page, input.includeSnapshot)
    }
}

class BrowserHoverTool extends StructuredTool {
    name = 'browser_hover'
    description = 'Hover an element uid from browser_snapshot.'
    schema = uidSchema

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof uidSchema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        const el = await this.manager.getElement(page, input.uid)
        try {
            await el.hover()
        } finally {
            await el.dispose()
        }
        return await actionResult(this.manager, page, input.includeSnapshot)
    }
}

class BrowserFillTool extends StructuredTool {
    name = 'browser_fill'
    description = 'Fill an input, textarea, select, checkbox, or radio by uid.'
    schema = uidSchema.extend({ value: z.string().describe('Value to fill.') })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        await fillElement(this.manager, page, input.uid, input.value)
        return await actionResult(this.manager, page, input.includeSnapshot)
    }
}

class BrowserFillFormTool extends StructuredTool {
    name = 'browser_fill_form'
    description = 'Fill multiple browser form elements at once.'
    schema = pageIdSchema.extend({
        elements: z.array(
            z.object({
                uid: z.string().describe('Element uid from browser_snapshot.'),
                value: z.string().describe('Value to fill.')
            })
        ),
        includeSnapshot: z.boolean().optional()
    })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        for (const item of input.elements) {
            await fillElement(this.manager, page, item.uid, item.value)
        }
        return await actionResult(this.manager, page, input.includeSnapshot)
    }
}

class BrowserTypeTool extends StructuredTool {
    name = 'browser_type'
    description = 'Type text using keyboard into the focused browser element.'
    schema = pageIdSchema.extend({
        text: z.string(),
        submitKey: z.string().optional()
    })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        await page.page.keyboard.type(input.text)
        if (input.submitKey) {
            await page.page.keyboard.press(input.submitKey as KeyInput)
        }
        return 'Typed text into the focused browser element'
    }
}

class BrowserPressKeyTool extends StructuredTool {
    name = 'browser_press_key'
    description = 'Press a key or key combination in the selected browser page.'
    schema = pageIdSchema.extend({ key: z.string() })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        const keys = input.key.split('+')
        const key = keys.pop()
        for (const item of keys) await page.page.keyboard.down(item as KeyInput)
        await page.page.keyboard.press(key as KeyInput)
        for (const item of keys.reverse()) {
            await page.page.keyboard.up(item as KeyInput)
        }
        return `Pressed key: ${input.key}`
    }
}

class BrowserUploadFileTool extends StructuredTool {
    name = 'browser_upload_file'
    description = 'Upload a file through an element uid from browser_snapshot.'
    schema = uidSchema.extend({ filePath: z.string() })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        const el = await this.manager.getElement(page, input.uid)
        try {
            await (el as ElementHandle<HTMLInputElement>).uploadFile(
                input.filePath
            )
        } finally {
            await el.dispose()
        }
        return await actionResult(this.manager, page, input.includeSnapshot)
    }
}

class BrowserEvaluateTool extends StructuredTool {
    name = 'browser_evaluate'
    description = 'Evaluate a JavaScript function in the selected browser page.'
    schema = pageIdSchema.extend({
        function: z
            .string()
            .describe('Function declaration, e.g. () => document.title.'),
        args: z
            .array(z.string())
            .optional()
            .describe('Element uids passed as args.')
    })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        const handles = []
        try {
            for (const uid of input.args ?? []) {
                handles.push(await this.manager.getElement(page, uid))
            }
            const result = await page.page.evaluate(
                async (fnText, ...args) => {
                    // eslint-disable-next-line no-new-func
                    const fn = new Function(`return (${fnText})`)()
                    return await fn(...args)
                },
                input.function,
                ...handles
            )
            return await this.manager.formatOutput({
                name: 'browser-evaluate',
                text: JSON.stringify(result, null, 2)
            })
        } finally {
            await Promise.all(handles.map((item) => item.dispose()))
        }
    }
}

class BrowserConsoleTool extends StructuredTool {
    name = 'browser_console'
    description = 'List recent console messages from the selected browser page.'
    schema = pageIdSchema.extend({
        levels: z.array(z.string()).optional(),
        limit: z.number().optional()
    })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        const rows = page.console
            .filter((item) => !input.levels || input.levels.includes(item.type))
            .slice(-(input.limit ?? 50))
        return await this.manager.formatOutput({
            name: 'browser-console',
            text: JSON.stringify(rows, null, 2)
        })
    }
}

class BrowserNetworkTool extends StructuredTool {
    name = 'browser_network'
    description = 'List recent network requests from the selected browser page.'
    schema = pageIdSchema.extend({
        types: z.array(z.string()).optional(),
        limit: z.number().optional()
    })

    constructor(private manager: BrowserManager) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        cfg: ChatLunaToolRunnable
    ) {
        const page = this.manager.getPage(cfg, input.pageId)
        const rows = page.network
            .filter((item) => !input.types || input.types.includes(item.type))
            .slice(-(input.limit ?? 80))
        return await this.manager.formatOutput({
            name: 'browser-network',
            text: JSON.stringify(rows, null, 2)
        })
    }
}

function formatSnapshot(node: BrowserSnapshotNode, depth = 0): string {
    const attrs = [`uid=${node.uid}`, node.role]
    if (node.name) attrs.push(`"${node.name}"`)
    const line = `${' '.repeat(depth * 2)}${attrs.filter(Boolean).join(' ')}`
    return [
        line,
        ...node.children.map((child) => formatSnapshot(child, depth + 1))
    ].join('\n')
}

async function actionResult(
    manager: BrowserManager,
    page: ReturnType<BrowserManager['getPage']>,
    includeSnapshot?: boolean
) {
    if (!includeSnapshot) return 'Browser action completed'
    const snapshot = await manager.snapshot(page)
    return formatSnapshot(snapshot.root)
}

async function fillElement(
    manager: BrowserManager,
    page: ReturnType<BrowserManager['getPage']>,
    uid: string,
    value: string
) {
    const el = await manager.getElement(page, uid)
    try {
        await el.evaluate((node, value) => {
            if (node instanceof HTMLInputElement) {
                if (node.type === 'checkbox' || node.type === 'radio') {
                    node.checked = value === 'true'
                } else {
                    node.value = value
                }
                node.dispatchEvent(new Event('input', { bubbles: true }))
                node.dispatchEvent(new Event('change', { bubbles: true }))
                return
            }
            if (
                node instanceof HTMLTextAreaElement ||
                node instanceof HTMLSelectElement
            ) {
                node.value = value
                node.dispatchEvent(new Event('input', { bubbles: true }))
                node.dispatchEvent(new Event('change', { bubbles: true }))
                return
            }
            ;(node as HTMLElement).innerText = value
            node.dispatchEvent(new Event('input', { bubbles: true }))
        }, value)
    } finally {
        await el.dispose()
    }
}
