import { RenderMessage, RenderOptions, SimpleMessage } from '../types';
import { Renderer } from '../render';
import { marked } from 'marked';
import { createLogger } from '../utils/logger';
import qrcode from "qrcode"
import hijs from "highlight.js"
import katex from "katex"
import { request } from '../utils/request';
import { readFileSync, writeFileSync } from 'fs';
import { Context, h } from 'koishi';
import "koishi-plugin-puppeteer"
import { Config } from '../config';

const logger = createLogger("@dingyi222666/chathub/renderer/image")

export default class ImageRenderer extends Renderer {

    async render(message: SimpleMessage, options: RenderOptions): Promise<RenderMessage> {

        const markdownText = message.content
        const page = await this.ctx.puppeteer.page();

        const templateHtmlPath = __dirname + "/../../dist/template.html";
        const outTemplateHtmlPath = __dirname + "/../../dist/out.html";
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
        const renderer = new marked.Renderer();

        const replacer = (((blockRegex, inlineRegex) => (text) => {
            text = text.replace(blockRegex, (match, expression) => {
                return katex.renderToString(expression, { displayMode: true });
            });

            text = text.replace(inlineRegex, (match, expression) => {
                return katex.renderToString(expression, { displayMode: false });
            });

            return text;
        })(/\$\$([\s\S]+?)\$\$/g, /\$([^\n\s]+?)\$/g));

        const replaceTypes = ["listitems", "paragraph", "tablecell", "text"];
        replaceTypes.forEach(type => {
            const original = renderer[type];
            renderer[type] = (...args) => {
                args[0] = replacer(args[0]);
                return original(...args);
            };
        });

        renderer.code = (code, lang, escaped) => {
            return `<pre><code class="hljs">${hijs.highlightAuto(code).value}</code></pre>`
        }


        return marked.parse(text, {
            gfm: true,
            //latex support
            renderer: renderer
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


        logger.debug("qrcode data url: " + qrcodeDataURL)

        return qrcodeDataURL;
    }


}