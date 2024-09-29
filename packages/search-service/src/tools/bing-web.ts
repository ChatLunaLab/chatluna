import { SearchTool } from './base'

export default class BingWebSearchTool extends SearchTool {
    async _call(arg: string): Promise<string> {
        let query: string

        try {
            query = JSON.parse(arg).keyword as string
        } catch (e) {
            query = arg
        }

        const page = await this.ctx.puppeteer.page()
        await page.goto(
            `https://cn.bing.com/search?form=QBRE&q=${encodeURIComponent(
                query
            )}`
        )
        const summaries = await page.evaluate(() => {
            const liElements = Array.from(
                document.querySelectorAll('#b_results > .b_algo')
            )
            const firstFiveLiElements = liElements.slice(0, 5)
            return firstFiveLiElements.map((li) => {
                const abstractElement = li.querySelector('.b_caption > p')
                const linkElement = li.querySelector('a')
                const href = linkElement.getAttribute('href')
                const title = linkElement.textContent

                const description = abstractElement
                    ? abstractElement.textContent
                    : ''
                return { href, title, description }
            })
        })
        await page.close()

        return JSON.stringify(summaries.slice(0, this.config.topK))
    }
}
