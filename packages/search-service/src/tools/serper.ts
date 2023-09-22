import { SearchTool } from '..'
import { chathubFetch } from '@dingyi222666/koishi-plugin-chathub/lib/utils/request'

export default class SerperSearchTool extends SearchTool {
    async _call(arg: string): Promise<string> {
        let query: string

        try {
            query = JSON.parse(arg).keyword as string
        } catch (e) {
            query = arg
        }

        const res = await chathubFetch('https://google.serper.dev/search', {
            headers: {
                'X-API-KEY': this.config.serperApiKey,
                'Content-Type': 'application/json'
            },
            method: 'POST',
            body: JSON.stringify({
                q: query,
                gl: this.config.serperCountry ?? 'cn',
                hl: this.config.serperLocation ?? 'zh-cn'
            })
        })

        if (!res.ok) {
            throw new Error(
                `Got ${res.status} error from serper: ${res.statusText}`
            )
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json = (await res.json()) as any

        /*  if (json.knowledgeGraph?.description) {
            return JSON.stringify([{
                title: json.knowledgeGraph.title,
                description: json.knowledgeGraph.description,
                link: json.knowledgeGraph.descriptionLink
            }])
        } */

        if (json.organic && json.organic[0]?.snippet) {
            return JSON.stringify(
                json.organic
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .map((item: any) => {
                        return {
                            title: item.title,
                            description: item.snippet,
                            link: item.link
                        }
                    })
                    .slice(0, this.config.topK)
            )
        }

        return 'No good search result found'
    }
}
