import { RenderMessage, RenderOptions, SimpleMessage } from '../types';
import { Renderer } from '../render';
import { marked } from 'marked';
import { createLogger } from '../utils/logger';
import { request } from '../utils/request';
import { readFileSync, writeFileSync } from 'fs';
import { Context, h } from 'koishi';
import { Config } from '../config';
import type {} from "koishi-plugin-puppeteer"
import markedKatex from "marked-katex-extension";
import qrcode from "qrcode"
import hijs from "highlight.js"


const logger = createLogger("@dingyi222666/chathub/renderer/image")

export default class ImageRenderer extends Renderer {

    constructor(protected readonly ctx: Context, protected readonly config: Config) {
        super(ctx, config);

        marked.use(markedKatex({
            throwOnError: false,
            displayMode: false,
            output: 'html'
        }));
    }

    async render(message: SimpleMessage, options: RenderOptions): Promise<RenderMessage> {

        const markdownText = message.content
        const page = await this.ctx.puppeteer.page();

        const templateHtmlPath = __dirname + "/../../resources/template.html";
        const outTemplateHtmlPath = __dirname + "/../../resources/out.html";
        const templateHtml = readFileSync(templateHtmlPath).toString();

        const qrcode = await this.getQrcode(markdownText);

        // ${content} => markdownText'
        const outTemplateHtml = templateHtml.replace("${content}", this.renderMarkdownToHtml(markdownText)).replace("${qr_data}", qrcode);

        writeFileSync(outTemplateHtmlPath, outTemplateHtml)

        await page.goto("file://" + outTemplateHtmlPath,
            {
                waitUntil: "networkidle0",
                timeout: 20 * 1000
            })

        const app = await page.$("body");
        // screenshot

        const clip = await app.boundingBox();
        const screenshot = await page.screenshot({ clip });

        return {
            element: h.image(screenshot, "image/png")
        }
    }

    private renderMarkdownToHtml(text: string): string {
        return marked.parse(text, {
            gfm: true,
            //latex support
            highlight: (code, lang, escaped) => {
                return `<pre><code class="hljs">${hijs.highlightAuto(code,[lang]).value}</code></pre>`
            }
        })
    }

    private async getQrcode(markdownText: string): Promise<string> {
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