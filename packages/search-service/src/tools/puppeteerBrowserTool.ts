/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { Context } from 'koishi'
import type { Page } from 'puppeteer-core'
import type {} from 'koishi-plugin-puppeteer'
import { BaseLanguageModel } from '@langchain/core/language_models/base'
import { Embeddings } from '@langchain/core/embeddings'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { logger } from '../index'

export interface PuppeteerBrowserToolOptions {
    timeout?: number
    idleTimeout?: number
}

export class PuppeteerBrowserTool extends Tool {
    name = 'puppeteer_browser'
    description = `A tool to browse web pages using Puppeteer.
    Input should be in the format: 'action params'.
    Available actions:
    - open [url]: Open a web page (default action if no action specified)
    - summarize [search_text?]: Summarize the current page, optionally with a search text
    - select [selector]: Select content from a specific div
    - scroll [pixels]: Scroll the page by a number of pixels
    - previous: Go to the previous page
    - get-html: Get the HTML content of the current page
    - get-visible-div: Get the source code of visible divs
    - get-structured-urls: Get structured URLs from the current page
    Example: 'open https://example.com' or just 'https://example.com'`

    private page: Page | null = null
    private lastActionTime: number = Date.now()
    private readonly timeout: number = 30000 // 30 seconds timeout
    private readonly idleTimeout: number = 300000 // 5 minutes idle timeout
    private model: BaseLanguageModel
    private embeddings: Embeddings
    private ctx: Context

    constructor(
        ctx: Context,
        model: BaseLanguageModel,
        embeddings: Embeddings,
        options: PuppeteerBrowserToolOptions = {}
    ) {
        super()

        this.ctx = ctx
        this.model = model
        this.embeddings = embeddings
        this.timeout = options.timeout || this.timeout
        this.idleTimeout = options.idleTimeout || this.idleTimeout
        this.startIdleTimer()
    }

    async _call(input: string): Promise<string> {
        try {
            let action: string
            let params: string[]

            if (input.includes(' ')) {
                ;[action, ...params] = input.split(' ')
            } else {
                action = 'open'
                params = [input]
            }

            this.lastActionTime = Date.now()

            switch (action) {
                case 'open':
                    return await this.openPage(params[0])
                case 'summarize':
                    return await this.summarizePage(params[0])
                case 'select':
                    return await this.selectDiv(params[0])
                case 'scroll':
                    return await this.scrollPage(parseInt(params[0]))
                case 'previous':
                    return await this.goToPreviousPage()
                case 'get-html':
                    return await this.getHtml()
                case 'get-visible-div':
                    return await this.getVisibleDivs()
                case 'get-structured-urls':
                    return await this.getStructuredUrls()
                default:
                    return 'Unknown action. Available actions: open, summarize, select, scroll, previous, get-html, get-visible-div, get-structured-urls'
            }
        } catch (error) {
            if (error instanceof Error) {
                return `Error: ${error.message}`
            }
            return 'An unknown error occurred'
        }
    }

    private async initBrowser() {
        try {
            if (!this.page) {
                const puppeteer = this.ctx.puppeteer
                if (!puppeteer) {
                    throw new Error('Puppeteer service is not available')
                }
                this.page = await puppeteer.browser.newPage()
            }
        } catch (error) {
            logger.error(`Error initializing browser: ${error.message}`)
            throw error
        }
    }

    private async openPage(url: string): Promise<string> {
        try {
            await this.initBrowser()
            await this.page!.goto(url, {
                waitUntil: 'networkidle0',
                timeout: this.timeout
            })
            return 'Page opened successfully'
        } catch (error) {
            logger.error(`Error opening page ${url}: ${error.message}`)
            return `Error opening page: ${error.message}`
        }
    }

    private async summarizePage(searchText?: string): Promise<string> {
        try {
            if (!this.page) return 'No page is open'
            const text = await this.page.evaluate(this.getText)
            return this.summarizeText(text, searchText)
        } catch (error) {
            logger.error(`Error summarizing page: ${error.message}`)
            return `Error summarizing page: ${error.message}`
        }
    }

    private getText = (): string => {
        const baseUrl = window.location.href
        let text = ''

        const processNode = (node: Node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                text += ' ' + node.textContent?.trim()
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element
                if (element.tagName.toLowerCase() === 'a') {
                    const href = element.getAttribute('href')
                    if (href) {
                        const fullUrl = new URL(href, baseUrl).toString()
                        text += ` [${element.textContent}](${fullUrl})`
                    } else {
                        text += ' ' + element.textContent
                    }
                } else if (
                    element.tagName.toLowerCase() !== 'script' &&
                    element.tagName.toLowerCase() !== 'style'
                ) {
                    for (const child of element.childNodes) {
                        processNode(child)
                    }
                }
            }
        }

        processNode(document.body)
        return text.trim().replace(/\s+/g, ' ')
    }

    private async summarizeText(
        text: string,
        searchText?: string
    ): Promise<string> {
        try {
            const textSplitter = new RecursiveCharacterTextSplitter({
                chunkSize: 2000,
                chunkOverlap: 200
            })
            const texts = await textSplitter.splitText(text)

            const docs = texts.map(
                (pageContent) =>
                    new Document({
                        pageContent,
                        metadata: []
                    })
            )

            const vectorStore = await MemoryVectorStore.fromDocuments(
                docs,
                this.embeddings
            )
            const results = await vectorStore.similaritySearch(
                searchText || '',
                5
            )
            const context = results.map((res) => res.pageContent).join('\n')

            const input = `Text:${context}\n\nI need a summary from the above text${searchText ? ` focusing on "${searchText}"` : ''}, you need provide up to 5 markdown links from within that would be of interest (always including URL and text). Please ensure that the linked information is all within the text and that you do not falsely generate any information. Need output to Chinese. Links should be provided, if present, in markdown syntax as a list under the heading "Relevant Links:".`

            const summary = await this.model.invoke(input)
            return summary.content
        } catch (error) {
            logger.error(`Error summarizing text: ${error.message}`)
            return `Error summarizing text: ${error.message}`
        }
    }

    private async selectDiv(selector: string): Promise<string> {
        try {
            if (!this.page) return 'No page is open'
            const content = await this.page.evaluate((sel) => {
                const element = document.querySelector(sel)
                return element ? element.textContent : 'Element not found'
            }, selector)
            return content || 'No content found'
        } catch (error) {
            logger.error(`Error selecting div: ${error.message}`)
            return `Error selecting div: ${error.message}`
        }
    }

    private async scrollPage(pixels: number): Promise<string> {
        try {
            if (!this.page) return 'No page is open'
            await this.page.evaluate((px) => window.scrollBy(0, px), pixels)
            return `Scrolled ${pixels} pixels`
        } catch (error) {
            logger.error(`Error scrolling page: ${error.message}`)
            return `Error scrolling page: ${error.message}`
        }
    }

    private async goToPreviousPage(): Promise<string> {
        try {
            if (!this.page) return 'No page is open'
            await this.page.goBack({
                waitUntil: 'networkidle0',
                timeout: this.timeout
            })
            return 'Navigated to previous page'
        } catch (error) {
            logger.error(`Error navigating to previous page: ${error.message}`)
            return `Error navigating to previous page: ${error.message}`
        }
    }

    private async getHtml(): Promise<string> {
        try {
            if (!this.page) return 'No page is open'
            return await this.page.content()
        } catch (error) {
            logger.error(`Error getting HTML: ${error.message}`)
            return `Error getting HTML: ${error.message}`
        }
    }

    private async getVisibleDivs(): Promise<string> {
        try {
            if (!this.page) return 'No page is open'
            return await this.page.evaluate(() => {
                const visibleDivs = Array.from(
                    document.querySelectorAll('div')
                ).filter((div) => {
                    const style = window.getComputedStyle(div)
                    return (
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        div.offsetWidth > 0 &&
                        div.offsetHeight > 0
                    )
                })
                return visibleDivs.map((div) => div.outerHTML).join('\n')
            })
        } catch (error) {
            logger.error(`Error getting visible divs: ${error.message}`)
            return `Error getting visible divs: ${error.message}`
        }
    }

    private async getStructuredUrls(): Promise<string> {
        try {
            if (!this.page) return 'No page is open'
            return await this.page.evaluate(() => {
                const urlStructure: { [key: string]: string[] } = {
                    search: [],
                    navigation: [],
                    external: [],
                    other: []
                }

                const currentHost = window.location.hostname

                document.querySelectorAll('a').forEach((a) => {
                    const href = a.href
                    if (!href) return

                    const url = new URL(href)
                    const linkText = a.textContent?.trim() || ''

                    if (url.hostname === currentHost) {
                        if (
                            url.pathname.includes('search') ||
                            url.search.includes('q=')
                        ) {
                            urlStructure.search.push(`${linkText}: ${href}`)
                        } else if (
                            a.closest('nav') ||
                            a.matches('header a, footer a')
                        ) {
                            urlStructure.navigation.push(`${linkText}: ${href}`)
                        } else {
                            urlStructure.other.push(`${linkText}: ${href}`)
                        }
                    } else {
                        urlStructure.external.push(`${linkText}: ${href}`)
                    }
                })

                return JSON.stringify(urlStructure, null, 2)
            })
        } catch (error) {
            logger.error(`Error getting structured URLs: ${error.message}`)
            return `Error getting structured URLs: ${error.message}`
        }
    }

    private startIdleTimer() {
        setInterval(() => {
            if (Date.now() - this.lastActionTime > this.idleTimeout) {
                this.closeBrowser()
            }
        }, 60000) // Check every minute
    }

    private async closeBrowser() {
        try {
            if (this.page) {
                await this.page.close()
                this.page = null
            }
        } catch (error) {
            logger.error(`Error closing browser: ${error.message}`)
        }
    }
}
