export class Pagination<T> {
    private _cacheMap: Record<string, T[]> = {}

    constructor(private input: PaginationInput<T>) {
        input.formatString.pages = input.formatString.pages ?? '\n当前为第 {page} / {total} 页'
        input.page = input.page ?? 1
        input.limit = input.limit ?? 5
    }

    async push(items: T[], key: string = 'default') {
        this._cacheMap[key] = items
    }

    async getPage(
        page: number = this.input.page,
        limit: number = this.input.limit,
        key: string = 'default'
    ) {
        const items = this._cacheMap[key]

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
        }

        buffer.push(this.input.formatString.bottom)

        const total = Math.ceil(items.length / limit)

        const formattedPageString = this.input.formatString.pages
            .replaceAll('{page}', Math.min(total, page).toString())
            .replaceAll('{total}', total.toString())

        buffer.push(formattedPageString)

        return buffer.join('\n')
    }
}

export interface PaginationInput<T> {
    page?: number
    limit?: number

    formatItem(item: T): string
    formatString: {
        top: string
        bottom: string
        pages?: string
    }
}
