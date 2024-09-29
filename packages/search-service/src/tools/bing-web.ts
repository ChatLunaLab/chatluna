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
            )}`,
            {
                waitUntil: 'networkidle2'
            }
        )
        const summaries = await page.evaluate(() => {
            const liElements = Array.from(
                document.querySelectorAll('#b_results > .b_algo')
            )

            return liElements.map((li) => {
                const abstractElement = li.querySelector('.b_caption > p')
                const linkElement = li.querySelector('a')
                const href = linkElement.getAttribute('href')
                const title = linkElement.textContent

                const imageElement = li.querySelector('img')
                const image = imageElement
                    ? imageElement.getAttribute('src')
                    : ''

                const description = abstractElement
                    ? abstractElement.textContent
                    : ''
                return { url: href, title, description, image }
            })
        })
        await page.close()

        return JSON.stringify(summaries.slice(0, this.config.topK))
    }
}
