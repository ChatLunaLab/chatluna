import { SearchTool } from '..';
import { z } from "zod";
import { request } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request"
import { JSDOM } from "jsdom"
import { writeFileSync } from 'fs';
import { SearchResult } from '../types';

export default class SerperSearchTool extends SearchTool {

    async _call(arg: z.infer<typeof this.schema>): Promise<string> {

        let query: string

        try {
            query = JSON.parse(arg).keyword as string
        } catch (e) {
            query = arg
        }

        const res = await request.fetch("https://google.serper.dev/search", {
            headers: {
                'X-API-KEY': this.config.serperApiKey,
                'Content-Type': 'application/json'
            },
            method: "POST",
            body: JSON.stringify({
                "q": query,
                "gl": this.config.serperCountry ?? "cn",
                "hl": this.config.serperLocation ?? "zh-cn"
            })
        });

        if (!res.ok) {
            throw new Error(`Got ${res.status} error from serper: ${res.statusText}`);
        }

        const json = (await res.json()) as any

      /*   if (json.answerBox?.answer) {
            return json.answerBox.answer;
        }

        if (json.answerBox?.snippet) {
            return json.answerBox.snippet;
        }

        if (json.answerBox?.snippet_highlighted_words) {
            return json.answerBox.snippet_highlighted_words[0];
        }

        if (json.sportsResults?.game_spotlight) {
            return json.sportsResults.game_spotlight;
        } */

        if (json.knowledgeGraph?.description) {
            return JSON.stringify([{
                title: json.knowledgeGraph.title,
                description: json.knowledgeGraph.description,
                link: json.knowledgeGraph.descriptionLink
            }])
        }

        if (json.organic && json.organic[0]?.snippet) {
            return JSON.stringify(
                json.organic.map((item: any) => {
                    return {
                        title: item.title,
                        description: item.snippet,
                        link: item.link
                    }
                }).slice(0, this.config.topK)
            )
        }

        return "No good search result found";
    }

}



