import { Context } from 'koishi'
import type { Tables } from '@koishijs/cache'
import { Config } from './config'
export declare class Cache<K extends keyof Tables, T extends Tables[K]> {
    readonly config: Config
    readonly tableName: K
    private _cache
    constructor(ctx: Context, config: Config, tableName: K)
    get<E extends keyof Tables>(tableName: E, id: string): Promise<Tables[E]>
    get(id: string): Promise<T>
    set<E extends keyof Tables, R extends Tables[E]>(
        tableName: E,
        id: string,
        value: R
    ): Promise<void>

    set(id: string, value: T): Promise<void>
    delete<E extends keyof Tables>(tableName: E, id: string): Promise<void>
    delete(id: string): Promise<void>
    clear<E extends keyof Tables>(tableName: E): Promise<void>
    clear(): Promise<void>
}
declare module '@koishijs/cache' {
    interface Tables {
        'chatluna/keys': string
    }
}
declare module 'koishi' {
    interface Tables {
        cache: CacheEntry
    }
}
interface CacheEntry {
    table: string
    key: string
    value: string
    expire: Date
}
export {}
