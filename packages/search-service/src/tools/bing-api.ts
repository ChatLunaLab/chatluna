import { SearchTool } from '..';
import { z } from "zod";
import { request } from "@dingyi222666/koishi-plugin-chathub/lib/utils/request"

export default class BingAISearchTool extends SearchTool {

    async _call(arg: string): Promise<string> {

        let query: string

        try {
            query = JSON.parse(arg).keyword as string
        } catch (e) {
            query = arg
        }

        const searchUrl = new URL("https://api.bing.microsoft.com/v7.0/search");

        const headers = {
            "Ocp-Apim-Subscription-Key": this.config.bingSearchApiKey,
            "Ocp-Apim-Subscription-Region": this.config.azureLocation ?? "global",
        };
        const params = {
            q: query,
            responseFilter: "Webpages",
            count: this.config.topK.toString()
        };

        Object.entries(params).forEach(([key, value]) => {
            searchUrl.searchParams.append(key, value);
        });

        const response = await request.fetch(searchUrl, { headers });

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }

        const res: any = await response.json()
        const results = res.webPages.value;

        if (results.length === 0) {
            return "No good results found.";
        }

        const snippets = results
            .map((item: any) => {
                return {
                    title: item.name,
                    description: item.snippet,
                    link: item.url
                }
            })


        return JSON.stringify(snippets);
    }

}



