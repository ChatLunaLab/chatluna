import { RenderMessage, RenderOptions, Message } from '../types';
import { Renderer } from '../render';
import { marked } from 'marked';
import { createLogger } from '../llm-core/utils/logger';
import { request } from '../llm-core/utils/request';
import { readFileSync, writeFileSync } from 'fs';
import { Context, h } from 'koishi';
import { Config } from '../config';
import type { } from "koishi-plugin-puppeteer"
import markedKatex from "marked-katex-extension";
import qrcode from "qrcode"
import hijs from "highlight.js"


const logger = createLogger("@dingyi222666/chathub/renderer/mixed-image")

export default class MixedImageRenderer extends Renderer {

    constructor(protected readonly ctx: Context, protected readonly config: Config) {
        super(ctx, config);

        marked.use(markedKatex({
            throwOnError: false,
            displayMode: false,
            output: 'html'
        }));
    }


    async render(message: Message, options: RenderOptions): Promise<RenderMessage> {

        const elements: h[] = []
        const content = message.text

        //step 1: lex markdown

        const tokens = marked.lexer(content)

        //step 2: match text
        const matchedTexts = this._matchText(tokens)

        //step 3: merge the same type text

        const mergedMatchedTexts: MatchedText[] = []


        for (let i = 0; i < matchedTexts.length; i++) {
            const lastMatchedText = mergedMatchedTexts[mergedMatchedTexts.length - 1]

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

        logger.debug(`mergedMatchedTexts: ${JSON.stringify(mergedMatchedTexts)}`)

        // step 4: render markdown to image

        for (const matchedText of mergedMatchedTexts) {
            if (matchedText.type === "markdown") {
                const image = await this._renderMarkdownToImage(matchedText.text)

                const element = h.image(image, "image/png")

                if (options.split) {
                    elements.push(h("message", element))
                } else {
                    elements.push(element)
                }

            } else {

                if (options.split) {
                    // 自分段逻辑
                    matchedText.text.split("\n\n").forEach(text => {
                        elements.push(h("message", h.text(text)))
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

    private _matchText(tokens: marked.Token[]): MatchedText[] {
        const currentMatchedTexts: MatchedText[] = []

        for (const token of tokens) {
            if (token.type === "text" || token.type === "del" || token.type === "br"
            ) {
                currentMatchedTexts.push({
                    type: "text",
                    text: token.raw
                })
            } else if (token.type === "code" || token.type === "image" || token.type === "html" || token.type === "table") {
                currentMatchedTexts.push({
                    type: "markdown",
                    text: token.raw
                })
            } else if (token.type === "paragraph") {
                const matchedTexts = this._matchText(token.tokens)
                currentMatchedTexts.push(...matchedTexts)
            } else if (token.type === "space") {
                const currentMatchedText = currentMatchedTexts[currentMatchedTexts.length - 1]
                currentMatchedText.text = currentMatchedText.text + token.raw
            } else {
                currentMatchedTexts.length = 0

                currentMatchedTexts.push({
                    type: "markdown",
                    text: tokens.map(token => token.raw).join("")
                })

                break
            }
        }
        return currentMatchedTexts
    }


    private async _renderMarkdownToImage(markdownText: string): Promise<Buffer> {

        const page = await this.ctx.puppeteer.page();

        const templateHtmlPath = __dirname + "/../../resources/template.html";
        const outTemplateHtmlPath = __dirname + "/../../resources/out.html";
        const templateHtml = readFileSync(templateHtmlPath).toString();

        const qrcode = await this._textToQrcode(markdownText);

        // ${content} => markdownText'
        const outTemplateHtml = templateHtml.replace("${content}", this._renderMarkdownToHtml(markdownText)).replace("${qr_data}", qrcode);

        writeFileSync(outTemplateHtmlPath, outTemplateHtml)

        await page.goto("file://" + outTemplateHtmlPath,
            {
                waitUntil: "networkidle0",
                timeout: 20 * 1000
            })

        const app = await page.$("body");
        // screenshot

        const clip = await app.boundingBox();
        const result = await page.screenshot({ clip });

        await page.close()

        return result
    }

    private _renderMarkdownToHtml(text: string): string {
        return marked.parse(text, {
            gfm: true,
            //latex support
            highlight: (code, lang, escaped) => {
                return `<pre><code class="hljs">${hijs.highlightAuto(code, [lang]).value}</code></pre>`
            }
        })
    }

    private async _textToQrcode(markdownText: string): Promise<string> {
        const response = await request.fetch("https://pastebin.mozilla.org/api/", {
            method: "POST",
            body: new URLSearchParams({
                expires: "86400",
                format: "url",
                lexer: "_markdown",
                content: markdownText
            }),
        })

        const url = await response.text();

        logger.debug("pastebin url: " + url)

        const qrcodeDataURL = await (new Promise<string>((resolve, reject) => {
            qrcode.toDataURL(url, { errorCorrectionLevel: "H" }, (err, url) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(url)
                }
            })
        }));

        return qrcodeDataURL;
    }


}

interface MatchedText {
    type: "text" | "markdown"
    text: string
}

