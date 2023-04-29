import { InjectData, createLogger, request } from '@dingyi222666/koishi-plugin-chathub';
import { SearchAdapter } from '../index';
import { Logger, Context, Quester } from 'koishi';
import { JSDOM } from 'jsdom';
import { writeFileSync } from 'fs';

const logger = createLogger("@dingyi222666/llm-search-service/adapters/bing-web");

export default class BingWebSearchAdapter implements SearchAdapter {

    constructor() {
    }

    async search(ctx: Context, query: string): Promise<InjectData[]> {
        try {
            const response = await request.fetch(
                `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
                {
                    headers: {
                        // windows 11 ua
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36 Edg/96.0.1054.34",

                    }
                }
            )

            const dom = new JSDOM(await response.text()).window.document;
            const main = dom.querySelector('#b_content');

            const searchResult: InjectData[] = [];
            const tobeRemoved = main.querySelectorAll(
                "script,noscript,style,meta,button,input,img,svg,canvas,header,footer,video,audio,embed,title[role='heading'],.b_ad,.b_adBottom,local-ads,.locTw,.b_rs,.b_attributi,.b_foot"
            );
            tobeRemoved.forEach((item) => item.remove());


            const results = dom.querySelectorAll('.b_algo')

            Array.from(results).map((result) => {
                result.querySelectorAll('span').forEach((span) => span.remove());
                result.querySelectorAll('.b_attribution').forEach((span) => span.remove());
                const data: InjectData = {
                    title: result.querySelector('h2').textContent,
                    data: result.querySelector('.b_caption').textContent,
                }
                //logger.debug(data)
                searchResult.push(data);
            });
            return searchResult
                .filter((item) => item.data.trim() !== "")
                .map((item) => {
                    item.data = item.data.trim()
                    return item
                })
            // .slice(0, topk);
        } catch (error) {
            logger.error(`Bing Web Search Error: ${error}`);
            return [];
        }
    }
}