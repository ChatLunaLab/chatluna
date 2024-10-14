/* eslint-disable no-template-curly-in-string */
/* eslint-disable n/no-path-concat */
import { marked, Token } from 'marked'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { readFileSync, writeFileSync } from 'fs'
import { Context, h, Logger, Schema } from 'koishi'
import markedKatex from 'marked-katex-extension'
import qrcode from 'qrcode'
import hljs from 'highlight.js'
import { markedHighlight } from 'marked-highlight'
import { chatLunaFetch } from 'koishi-plugin-chatluna/utils/request'
import type { Page } from 'puppeteer-core'
import { fileURLToPath } from 'url'
import { runAsyncTimeout } from 'koishi-plugin-chatluna/utils/promise'
import {
    Message,
    Renderer,
    RenderMessage,
    RenderOptions
} from 'koishi-plugin-chatluna'
import type {} from 'koishi-plugin-puppeteer'

let logger: Logger

export class MixedImageRenderer extends Renderer {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private __page: Page

    constructor(protected readonly ctx: Context) {
        super(ctx)
        logger = createLogger(ctx)

        marked.use(
            markedKatex({
                throwOnError: false,
                displayMode: false,
                output: 'html'
            }),
            markedHighlight({
                //  langPrefix: 'hljs language-',
                highlight(code, lang) {
                    return `<pre><code class="hljs">${
                        hljs.highlightAuto(code, [lang]).value
                    }</code></pre>`
                }
            })
        )

        ctx.on('dispose', async () => {
            await this.__page.close()
        })
    }

    private async _page() {
        if (!this.__page) {
            this.__page = await this.ctx.puppeteer.page()
        }

        return this.__page
    }

    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        const elements: h[] = []
        const content = message.content

        // step 1: lex markdown

        const tokens = marked.lexer(content)

        // step 2: match text
        const matchedTexts = this._matchText(tokens)

        // step 3: merge the same type text

        const mergedMatchedTexts: MatchedText[] = []

        for (let i = 0; i < matchedTexts.length; i++) {
            const lastMatchedText =
                mergedMatchedTexts[mergedMatchedTexts.length - 1]

            const currentMatchedText = matchedTexts[i]

            if (lastMatchedText?.type === currentMatchedText.type) {
                mergedMatchedTexts.pop()
                mergedMatchedTexts.push({
                    type: currentMatchedText.type,
                    text: lastMatchedText.text + currentMatchedText.text
                })
            } else {
                mergedMatchedTexts.push(currentMatchedText)
            }
        }

        logger.debug(
            `mergedMatchedTexts: ${JSON.stringify(mergedMatchedTexts)}`
        )

        // step 4: render markdown to image

        for (const matchedText of mergedMatchedTexts) {
            if (matchedText.type === 'markdown') {
                const image = await this._renderMarkdownToImage(
                    matchedText.text
                )

                const element = h.image(image, 'image/png')

                if (options.split) {
                    elements.push(h('message', element))
                } else {
                    elements.push(element)
                }
            } else {
                if (options.split) {
                    // 自分段逻辑
                    matchedText.text.split('\n\n').forEach((text) => {
                        elements.push(h('message', h.text(text)))
                    })
                } else {
                    elements.push(h.text(matchedText.text))
                }
            }
        }

        return {
            element: elements
        }
    }

    private _matchText(tokens: Token[]): MatchedText[] {
        const currentMatchedTexts: MatchedText[] = []

        for (const token of tokens) {
            if (
                token.type === 'text' ||
                token.type === 'del' ||
                token.type === 'br'
            ) {
                currentMatchedTexts.push({
                    type: 'text',
                    text: token.raw
                })
            } else if (
                token.type === 'code' ||
                token.type === 'image' ||
                token.type === 'html' ||
                token.type === 'table'
            ) {
                currentMatchedTexts.push({
                    type: 'markdown',
                    text: token.raw
                })
            } else if (token.type === 'paragraph') {
                const matchedTexts = this._matchText(token.tokens)
                currentMatchedTexts.push(...matchedTexts)
            } else if (token.type === 'space') {
                const currentMatchedText =
                    currentMatchedTexts[currentMatchedTexts.length - 1]
                currentMatchedText.text = currentMatchedText.text + token.raw
            } else {
                currentMatchedTexts.length = 0

                currentMatchedTexts.push({
                    type: 'markdown',
                    text: tokens.map((token) => token.raw).join('')
                })

                break
            }
        }
        return currentMatchedTexts
    }

    private async _renderMarkdownToImage(
        markdownText: string
    ): Promise<Buffer> {
        const page = await this._page()

        const dirname =
            __dirname?.length > 0 ? __dirname : fileURLToPath(import.meta.url)
        const templateHtmlPath = dirname + '/../resources/template.html'
        const outTemplateHtmlPath = dirname + '/../resources/out.html'
        const templateHtml = readFileSync(templateHtmlPath).toString()

        const qrcode = await runAsyncTimeout(
            this._textToQrcode(markdownText),
            7500,
            ''
        )

        // ${content} => markdownText'
        // eslint-disable-next-line no-template-curly-in-string
        const outTemplateHtml = templateHtml
            .replace(
                '${content}',
                await this._renderMarkdownToHtml(markdownText)
            )
            .replace('${qr_data}', qrcode)

        writeFileSync(outTemplateHtmlPath, outTemplateHtml)

        await page.reload()
        await page.goto('file://' + outTemplateHtmlPath, {
            waitUntil: 'networkidle0',
            timeout: 40 * 1000
        })

        const app = await page.$('body')
        // screenshot

        const clip = await app.boundingBox()
        const result = await page.screenshot({ clip })

        return result
    }

    private async _renderMarkdownToHtml(text: string) {
        return await marked.parse(text, {
            gfm: true
        })
    }

    private async _textToQrcode(markdownText: string): Promise<string> {
        const response = await chatLunaFetch(
            'https://prod.pastebin.prod.webservices.mozgcp.net/api/',
            {
                method: 'POST',
                body: new URLSearchParams({
                    expires: '604800',
                    format: 'url',
                    lexer: '_markdown',
                    content: markdownText
                })
            }
        )

        const url = await response.text()
        logger.debug('pastebin url: ' + url)

        const qrcodeDataURL = await new Promise<string>((resolve, reject) => {
            qrcode.toDataURL(url, { errorCorrectionLevel: 'H' }, (err, url) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(url)
                }
            })
        })

        return qrcodeDataURL
    }

    schema = Schema.const('mixed-image').i18n({
        'zh-CN': '同时输出图片和文本',
        'en-US': 'Output both image and text'
    })
}

interface MatchedText {
    type: 'text' | 'markdown'
    text: string
}
