import { SearchTool } from './base'

export default class TavilySearchTool extends SearchTool {
    async _call(arg: string): Promise<string> {
        let query: string

        try {
            query = JSON.parse(arg).keyword as string
        } catch (e) {
            query = arg
        }

        const body = {
            query,
            api_key: this.config.tavilyApiKey,
            search_depth: 'basic',
            include_images: true,
            include_image_descriptions: true,
            max_results: this.config.topK
        }

        const response = await this._plugin.fetch(
            'https://api.tavily.com/search',
            {
                method: 'POST',
                body: JSON.stringify(body),
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
                }
            }
        )

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
