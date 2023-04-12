import { InjectData, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import { SearchAdapter } from '../index';
import { Logger, Context, Quester } from 'koishi';
import { JSDOM } from 'jsdom';

const logger = createLogger("@dingyi222666/llm-search-service/adapters/bing-web");

export default class BingWebSearchAdapter implements SearchAdapter {

    constructor() {
    }

    async search(ctx: Context, query: string): Promise<InjectData[]> {
        try {
            const response = await ctx.http.get(
                `https://www.bing.com/search?q=${encodeURIComponent(query)}`
                
            )

            const dom = new JSDOM(response).window.document;
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
                searchResult.push({
                    title: result.querySelector('h2').textContent,
                    data: result.querySelector('.b_caption').textContent,
                })
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