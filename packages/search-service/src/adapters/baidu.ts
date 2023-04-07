import { InjectData } from '@dingyi222666/koishi-plugin-chathub';
import { SearchAdapter } from '../index';
import { Logger, Context, Quester } from 'koishi';
import { JSDOM } from 'jsdom';
import { lookup } from 'dns';

const logger = new Logger("@dingyi222666/llm-search-service/adapters/baidu");

export default class BiaduSearchAdapter implements SearchAdapter {

    constructor() {
    }

    async search(ctx: Context, query: string): Promise<InjectData[]> {
        try {

            const response = await ctx.http.get<Quester.AxiosResponse>(
                "https://www.baidu.com/s",
                {
                    params: {
                        wd: query,
                    },
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36",
                        Referer:
                            "https://www.baidu.com/s?ie=utf-8&f=8&rsv_bp=1&rsv_idx=2&ch=&tn=baiduhome_pg&bar=&wd=123&oq=123&rsv_pq=896f886f000184f4&rsv_t=fdd2CqgBgjaepxfhicpCfrqeWVSXu9DOQY5WyyWqQYmsKOC%2Fl286S248elzxl%2BJhOKe2&rqlang=cn",
                        Accept:
                            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
                        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
                        "Sec-Fetch-Mode": "navigate",
                        Connection: "Keep-Alive",
                    },
                }
            )


            const body = String(response)

            const dom = new JSDOM(body).window.document;

            const main = dom.querySelector("#content_left");

            if (main === null) {
                return [];
            }

            const searchResult: InjectData[] = [];
            const tobeRemoved = main.querySelectorAll(
                "script,noscript,style,meta,button,input,img,svg,canvas,header,footer,video,audio,embed"
            );
            tobeRemoved.forEach((item) => item.remove());

            for (let item of main.children) {
                const desc = item.querySelector(".content-right_8Zs40");
                if (desc === null) {
                    continue;
                }
                const title = item.querySelector(".c-title");
                const descContent = desc.textContent.trim();
                if (descContent === "") {
                    continue;
                }
                searchResult.push({
                    title: title?.textContent?.trim() ?? "",
                    data: descContent,
                })
            }
            return searchResult
        } catch (error) {
            logger.error(`Baidu search error: ${error}`)
            return [];
        }

    }
}

