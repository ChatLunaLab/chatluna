import { randomUUID } from 'crypto'
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { Context, Disposable, Time } from 'koishi'
import type {
    ConsoleMessage,
    Dialog,
    ElementHandle,
    HTTPRequest,
    Page,
    PuppeteerLifeCycleEvent,
    SerializedAXNode
} from 'puppeteer-core'
import type {} from 'koishi-plugin-puppeteer'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'

export class BrowserPage {
    snapshot?: BrowserSnapshot
    console: BrowserConsoleItem[] = []
    network: BrowserNetworkItem[] = []
    dialog?: Dialog

    private _disposers: (() => void)[] = []

    constructor(
        readonly id: number,
        readonly page: Page
    ) {
        const consoleHandler = (msg: ConsoleMessage) => {
            const loc = msg.location()
            this.console.push({
                type: msg.type(),
                text: msg.text(),
                url: loc.url,
                line: loc.lineNumber,
                time: new Date().toISOString()
            })
            this.console = this.console.slice(-200)
        }
        const requestFinished = async (req: HTTPRequest) => {
            this.network.push({
                method: req.method(),
                url: req.url(),
                type: req.resourceType(),
                status: (await req.response())?.status(),
                time: new Date().toISOString()
            })
            this.network = this.network.slice(-500)
        }
        const requestFailed = (req: HTTPRequest) => {
            this.network.push({
                method: req.method(),
                url: req.url(),
                type: req.resourceType(),
                failure: req.failure()?.errorText,
                time: new Date().toISOString()
            })
            this.network = this.network.slice(-500)
        }
        const dialogHandler = (dialog: Dialog) => {
            this.dialog = dialog
        }

        page.on('console', consoleHandler)
        page.on('requestfinished', requestFinished)
        page.on('requestfailed', requestFailed)
        page.on('dialog', dialogHandler)

        this._disposers.push(() => page.off('console', consoleHandler))
        this._disposers.push(() => page.off('requestfinished', requestFinished))
        this._disposers.push(() => page.off('requestfailed', requestFailed))
        this._disposers.push(() => page.off('dialog', dialogHandler))
    }

    async close() {
        for (const dispose of this._disposers) dispose()
        if (!this.page.isClosed()) await this.page.close()
    }
}

class BrowserSession {
    pages = new Map<number, BrowserPage>()
    selectedPageId?: number
    nextPageId = 1
    lastActionTime = Date.now()
}

export class BrowserManager {
    private _sessions = new Map<string, BrowserSession>()
    private _timer?: Disposable

    constructor(
        readonly ctx: Context,
        readonly config: BrowserManagerConfig
    ) {
        this._timer = ctx.setInterval(
            () => this.cleanupIdleSessions(),
            Time.minute
        )
        ctx.on('dispose', () => {
            this.closeAll().catch((err) => ctx.logger.error(err))
            this._timer?.()
        })
    }

    getSession(runConfig?: ChatLunaToolRunnable) {
        const key = getSessionKey(runConfig)
        const session = this._sessions.get(key) ?? new BrowserSession()
        session.lastActionTime = Date.now()
        this._sessions.set(key, session)
        return session
    }

    async open(input: BrowserOpenOptions, runConfig?: ChatLunaToolRunnable) {
        const session = this.getSession(runConfig)
        const prev = session.selectedPageId
        const current = prev ? session.pages.get(prev) : undefined
        const created = input.newPage || !current
        const page = created
            ? await this.createPage(session, input.background)
            : current

        try {
            await page.page.goto(input.url, {
                waitUntil: input.waitUntil ?? 'domcontentloaded',
                timeout: input.timeout ?? this.config.browserTimeout
            })
            session.selectedPageId = page.id
            await this.trimPages(session)
            return page
        } catch (err) {
            if (created) {
                await page.close().catch(() => undefined)
                session.pages.delete(page.id)
                session.selectedPageId = prev
            }
            throw err
        }
    }

    async navigate(
        input: BrowserNavigateOptions,
        runConfig?: ChatLunaToolRunnable
    ) {
        const page = this.getPage(runConfig, input.pageId)
        const opts = {
            waitUntil: input.waitUntil ?? 'domcontentloaded',
            timeout: input.timeout ?? this.config.browserTimeout
        }

        if (input.action === 'url') {
            await page.page.goto(input.url, opts)
        } else if (input.action === 'back') {
            await page.page.goBack(opts)
        } else if (input.action === 'forward') {
            await page.page.goForward(opts)
        } else {
            await page.page.reload(opts)
        }

        return page
    }

    getPage(runConfig?: ChatLunaToolRunnable, pageId?: number) {
        const session = this.getSession(runConfig)
        const id = pageId ?? session.selectedPageId
        if (id == null) throw new Error('No browser page is open')
        const page = session.pages.get(id)
        if (!page) throw new Error(`Browser page ${id} does not exist`)
        if (page.page.isClosed())
            throw new Error(`Browser page ${id} is closed`)
        session.selectedPageId = id
        return page
    }

    listPages(runConfig?: ChatLunaToolRunnable) {
        const session = this.getSession(runConfig)
        return [...session.pages.values()].map((item) => ({
            id: item.id,
            selected: item.id === session.selectedPageId,
            url: item.page.url()
        }))
    }

    selectPage(pageId: number, runConfig?: ChatLunaToolRunnable) {
        const session = this.getSession(runConfig)
        const page = session.pages.get(pageId)
        if (!page) throw new Error(`Browser page ${pageId} does not exist`)
        session.selectedPageId = pageId
        return page
    }

    async closePage(pageId: number, runConfig?: ChatLunaToolRunnable) {
        const session = this.getSession(runConfig)
        const page = session.pages.get(pageId)
        if (!page) throw new Error(`Browser page ${pageId} does not exist`)
        await page.close()
        session.pages.delete(pageId)
        session.selectedPageId = session.pages.keys().next().value
    }

    async readText(
        input: BrowserReadOptions,
        runConfig?: ChatLunaToolRunnable
    ) {
        const page = input.url
            ? await this.open(
                  {
                      url: input.url,
                      waitUntil: input.waitUntil,
                      timeout: input.timeout
                  },
                  runConfig
              )
            : this.getPage(runConfig, input.pageId)
        const text = await page.page.evaluate(
            readBrowserText,
            input.selector,
            input.includeLinks ?? false
        )
        return await this.formatOutput({
            name: 'browser-read-text',
            text,
            limit: input.maxLength
        })
    }

    async getHtml(input: BrowserReadOptions, runConfig?: ChatLunaToolRunnable) {
        const page = input.url
            ? await this.open({ url: input.url }, runConfig)
            : this.getPage(runConfig, input.pageId)
        const html = await page.page.evaluate(readBrowserHtml, input.selector)
        return await this.formatOutput({
            name: 'browser-html',
            text: html,
            limit: input.maxLength
        })
    }

    async getLinks(
        input: BrowserReadOptions,
        runConfig?: ChatLunaToolRunnable
    ) {
        const page = input.url
            ? await this.open({ url: input.url }, runConfig)
            : this.getPage(runConfig, input.pageId)
        const links = await page.page.evaluate(readBrowserLinks)
        return await this.formatOutput({
            name: 'browser-links',
            text: JSON.stringify(links, null, 2),
            limit: input.maxLength
        })
    }

    async summarize(
        input: BrowserReadOptions & { focus?: string },
        model: ChatLunaChatModel,
        runConfig?: ChatLunaToolRunnable
    ) {
        const page = input.url
            ? await this.open(
                  {
                      url: input.url,
                      waitUntil: input.waitUntil,
                      timeout: input.timeout
                  },
                  runConfig
              )
            : this.getPage(runConfig, input.pageId)
        const text = await page.page.evaluate(
            readBrowserText,
            input.selector,
            input.includeLinks ?? false
        )
        const summary = await model.invoke(
            createSummaryPrompt(text, input.focus),
            {
                temperature: 0
            }
        )
        const content = getMessageContent(summary.content)
        return await this.formatOutput({
            name: 'browser-summary',
            text: content,
            limit: input.maxLength
        })
    }

    async snapshot(
        page: BrowserPage,
        verbose = false
    ): Promise<BrowserSnapshot> {
        const raw = await page.page.accessibility.snapshot({
            interestingOnly: !verbose
        })
        if (!raw) throw new Error('Failed to create browser snapshot')
        const nodes = new Map<string, BrowserSnapshotNode>()
        let idx = 0
        const root = assignSnapshotIds(raw, nodes, () => `${page.id}_${idx++}`)
        page.snapshot = { root, nodes }
        return page.snapshot
    }

    async getElement(page: BrowserPage, uid: string) {
        if (!page.snapshot)
            throw new Error('No snapshot found. Use browser_snapshot first.')
        const node = page.snapshot.nodes.get(uid)
        if (!node) throw new Error(`Element uid ${uid} not found`)
        const handle = await node.elementHandle()
        if (!handle) throw new Error(`Element uid ${uid} no longer exists`)
        return handle as ElementHandle<Element>
    }

    async formatOutput(input: BrowserOutputOptions) {
        const limit = input.limit ?? this.config.browserOutputLimit
        if (input.text.length <= limit) return input.text

        const dir = resolve(this.ctx.baseDir, 'data/chatluna/browser-output')
        const file = join(
            dir,
            `${input.name}-${Date.now()}-${randomUUID()}.txt`
        )
        await mkdir(dir, { recursive: true })
        for (const item of await readdir(dir).catch(() => [])) {
            const old = join(dir, item)
            const info = await stat(old).catch(() => undefined)
            if (info?.isFile() && Date.now() - info.mtimeMs > Time.day) {
                await rm(old, { force: true })
            }
        }
        await writeFile(file, input.text, 'utf-8')
        return [
            `Output too large (${input.text.length} chars). Truncated preview below.`,
            `Full output saved to: ${file}`,
            '',
            input.text.slice(0, limit)
        ].join('\n')
    }

    async closeAll() {
        await Promise.all(
            [...this._sessions.values()].flatMap((session) =>
                [...session.pages.values()].map((page) => page.close())
            )
        )
        this._sessions.clear()
    }

    private async createPage(session: BrowserSession, background?: boolean) {
        const page = await this.ctx.puppeteer.page()
        if (!background) await page.bringToFront()
        const item = new BrowserPage(session.nextPageId++, page)
        session.pages.set(item.id, item)
        session.selectedPageId = item.id
        return item
    }

    private async trimPages(session: BrowserSession) {
        while (session.pages.size > this.config.browserMaxPages) {
            const id = session.pages.keys().next().value
            const page = session.pages.get(id)
            try {
                await page?.close()
            } catch (err) {
                this.ctx.logger.error(err)
            } finally {
                session.pages.delete(id)
            }
        }
    }

    private cleanupIdleSessions() {
        for (const [key, session] of this._sessions) {
            if (
                Date.now() - session.lastActionTime <=
                this.config.browserIdleTimeout
            ) {
                continue
            }
            for (const page of session.pages.values()) {
                page.close().catch((err) => this.ctx.logger.error(err))
            }
            this._sessions.delete(key)
        }
    }
}

function getSessionKey(runConfig?: ChatLunaToolRunnable) {
    const cfg = runConfig?.configurable
    return String(
        cfg?.conversationId ??
            cfg?.session?.channelId ??
            cfg?.session?.userId ??
            'default'
    )
}

function assignSnapshotIds(
    raw: SerializedAXNode,
    nodes: Map<string, BrowserSnapshotNode>,
    nextId: () => string
): BrowserSnapshotNode {
    const uid = nextId()
    const node = raw as BrowserSnapshotNode
    node.uid = uid
    node.children = (raw.children ?? []).map((child) =>
        assignSnapshotIds(child, nodes, nextId)
    )
    nodes.set(uid, node)
    return node
}

function createSummaryPrompt(text: string, focus?: string) {
    return `Text: ${text}

${focus ? `Focus: ${focus}\n` : ''}Summarize the page faithfully in the same language as the source text.
If a focus is provided and the page is unrelated, output exactly: [none].
Include important facts, numbers, names, and source links when present.`
}

// eslint-disable-next-line no-new-func
const readBrowserText = new Function(
    'selector',
    'includeLinks',
    String.raw`const root = selector
        ? document.querySelector(selector)
        : (document.querySelector('article, main, [role="main"]') ??
          document.body)
    if (!root) return ''

    const copy = root.cloneNode(true)
    copy.querySelectorAll(
        'script, style, noscript, svg, nav, header, footer'
    ).forEach((el) => el.remove())

    const lines = []
    function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent?.replace(/\s+/g, ' ').trim()
            if (text) lines.push(text)
            return
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return

        const el = node
        const tag = el.tagName.toLowerCase()
        if (/^h[1-6]$/.test(tag)) {
            lines.push(
                '\n' + '#'.repeat(Number(tag[1])) + ' ' + el.textContent?.trim()
            )
            return
        }
        if (tag === 'p' || tag === 'section' || tag === 'article')
            lines.push('\n')
        if (tag === 'li') lines.push('\n- ')
        if (tag === 'br') lines.push('\n')
        if (tag === 'pre') {
            lines.push(
                '\n\x60\x60\x60\n' + el.textContent?.trim() + '\n\x60\x60\x60\n'
            )
            return
        }
        if (tag === 'tr') lines.push('\n| ')
        if (tag === 'td' || tag === 'th') {
            lines.push((el.textContent ?? '').trim() + ' | ')
            return
        }

        for (const child of Array.from(el.childNodes)) walk(child)
    }

    walk(copy)

    if (includeLinks) {
        const links = Array.from(copy.querySelectorAll('a[href]'))
            .map((a) => {
                const text = a.textContent?.replace(/\s+/g, ' ').trim()
                const href = a.getAttribute('href')
                return text && href
                    ? \`- [\${text}](\${new URL(href, location.href).href})\`
                    : ''
            })
            .filter(Boolean)
            .slice(0, 30)
        if (links.length > 0) lines.push('\n\n## Links\n' + links.join('\n'))
    }

    return lines
        .join(' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()`
) as (selector?: string, includeLinks?: boolean) => string

// eslint-disable-next-line no-new-func
const readBrowserHtml = new Function(
    'selector',
    String.raw`return selector
        ? (document.querySelector(selector)?.outerHTML ?? '')
        : document.documentElement.outerHTML`
) as (selector?: string) => string

// eslint-disable-next-line no-new-func
const readBrowserLinks = new Function(
    String.raw`const current = new URL(location.href)
    const host = current.hostname
    const result = {
        sameSite: [],
        external: []
    }
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const text = a.textContent?.replace(/\s+/g, ' ').trim()
        if (!text) continue
        const url = new URL(a.getAttribute('href'), current.href)
        if (
            url.hash &&
            url.origin === current.origin &&
            url.pathname === current.pathname &&
            url.search === current.search
        ) {
            continue
        }
        const item = { text, url: url.href }
        if (url.hostname === host) result.sameSite.push(item)
        else result.external.push(item)
    }
    result.sameSite = result.sameSite.slice(0, 100)
    result.external = result.external.slice(0, 100)
    return result`
) as () => Record<string, { text: string; url: string }[]>

export interface BrowserManagerConfig {
    browserTimeout: number
    browserIdleTimeout: number
    browserMaxPages: number
    browserOutputLimit: number
}

export interface BrowserReadOptions {
    url?: string
    pageId?: number
    selector?: string
    includeLinks?: boolean
    maxLength?: number
    waitUntil?: PuppeteerLifeCycleEvent
    timeout?: number
}

export interface BrowserOpenOptions {
    url: string
    newPage?: boolean
    background?: boolean
    waitUntil?: PuppeteerLifeCycleEvent
    timeout?: number
}

export interface BrowserNavigateOptions {
    pageId?: number
    action: 'url' | 'back' | 'forward' | 'reload'
    url?: string
    waitUntil?: PuppeteerLifeCycleEvent
    timeout?: number
}

export interface BrowserOutputOptions {
    name: string
    text: string
    limit?: number
}

interface BrowserConsoleItem {
    type: string
    text: string
    url?: string
    line?: number
    time: string
}

interface BrowserNetworkItem {
    method: string
    url: string
    type: string
    status?: number
    failure?: string
    time: string
}

export interface BrowserSnapshotNode extends SerializedAXNode {
    uid: string
    children: BrowserSnapshotNode[]
}

export interface BrowserSnapshot {
    root: BrowserSnapshotNode
    nodes: Map<string, BrowserSnapshotNode>
}
