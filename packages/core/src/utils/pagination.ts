import { CacheMap } from './queue'

export class Pagination<T> {
    private _cacheMap = new CacheMap<T[]>()

    constructor(private input: PaginationInput<T>) {
        input.equalFunction = input.equalFunction || ((a, b) => a === b)
        input.formatString.pages = input.formatString.pages ?? '\n当前为第 {page} / {total} 页'
        input.page = input.page ?? 1
        input.limit = input.limit ?? 5
    }

    async push(items: T[], key: string = 'default') {
        await this._cacheMap.set(key, items, (a, b) => {
            if (a.length !== b.length) return false
            const sortedA = a.sort()
            const sortedB = b.sort()

            return sortedA.every((value, index) => this.input.equalFunction(value, sortedB[index]))
        })
    }

    async getPage(
        page: number = this.input.page,
        limit: number = this.input.limit,
        key: string = 'default'
    ) {
        const items = await this._cacheMap.get(key)

        return items.slice((page - 1) * limit, Math.min(items.length, page * limit))
    }

    async getFormattedPage(
        page: number = this.input.page,
        limit: number = this.input.limit,
        key: string = 'default'
    ) {
        const items = await this.getPage(page, limit, key)

        const buffer = [this.input.formatString.top]

        for (const item of items) {
            buffer.push(this.input.formatItem(item))
            buffer.push('\n')
        }

        buffer.push(this.input.formatString.bottom)

        const formattedPageString = this.input.formatString.pages
            .replaceAll('{page}', page.toString())
            .replaceAll('{total}', Math.ceil(items.length / limit).toString())

        buffer.push(formattedPageString)

        return buffer.join('\n')
    }
}

export interface PaginationInput<T> {
    page?: number
    limit?: number
    equalFunction?: (value1: T, value2: T) => boolean
    formatItem(item: T): string
    formatString: {
        top: string
        bottom: string
        pages?: string
    }
}
