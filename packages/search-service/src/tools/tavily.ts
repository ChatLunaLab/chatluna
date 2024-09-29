import { SearchTool } from './base'

export default class TavilySearchTool extends SearchTool {
    async _call(arg: string): Promise<string> {
        let query: string

        try {
            query = JSON.parse(arg).keyword as string
        } catch (e) {
            query = arg
        }

        const searchUrl = new URL('https://api.tavily.com/search')

        const params = {
            api_key: this.config.tavilyApiKey,
            query,
            search_depth: 'basic',
            include_answer: false,
            include_images: true,
            include_image_descriptions: true,
            include_raw_content: false,
            max_results: this.config.topK,
            include_domains: [],
            exclude_domains: []
        }

        const response = await this._plugin.fetch(searchUrl, {
            method: 'POST',
            body: JSON.stringify(params)
        })

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`)
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = (await response.json()) as {
            images?: {
                url: string
                description: string
            }[]
            results: {
                title: string
                content: string
                url: string
            }[]
        }

        const results = res.results

        const images = res.images

        if (results.length === 0) {
            return 'No good results found.'
        }

        const formattedResults = res.results.map((r) => ({
            title: r.title,
            description: r.content,
            url: r.url
        }))

        const formattedImages = (images ?? []).map((img) => ({
            title: 'Image',
            description: img.description,
            url: img.url
        }))

        return JSON.stringify([...formattedResults, ...formattedImages])
    }
}
