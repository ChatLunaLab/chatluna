export declare class Pagination<T> {
    private input
    private _cacheMap
    constructor(input: PaginationInput<T>)
    push(items: T[], key?: string): Promise<void>
    getPage(page?: number, limit?: number, key?: string): Promise<T[]>
    formatItems(
        items: T[],
        page?: number,
        limit?: number,
        total?: number
    ): Promise<string>

    getFormattedPage(
        page?: number,
        limit?: number,
        key?: string
    ): Promise<string>

    searchPage(
        find: (value: T) => boolean,
        page?: number,
        limit?: number,
        key?: string
    ): Promise<string>

    updateFormatString(formatString: PaginationInput<T>['formatString']): void
    updateFormatItem(formatItem: PaginationInput<T>['formatItem']): void
    getTotalPages(key?: string): number
    hasPage(page: number, key?: string): boolean
}
export interface PaginationInput<T> {
    page?: number
    limit?: number
    formatItem(item: T): Promise<string> | string
    formatString: {
        top: string
        bottom: string
        pages: string
    }
}
