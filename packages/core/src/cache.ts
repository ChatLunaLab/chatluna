import { Context, Time } from 'koishi'
import type { Tables } from '@koishijs/cache'
import { Config } from './config'

export class Cache<K extends keyof Tables, T extends Tables[K]> {
    private _cache: DatabaseCache

    constructor(
        ctx: Context,
        public readonly config: Config,
        public readonly tableName: K
    ) {
        this._cache = new DatabaseCache(ctx)
    }

    get<E extends keyof Tables>(tableName: E, id: string): Promise<Tables[E]>
    get(id: string): Promise<T>

    get(tableNameOrId: string, id?: string): Promise<Tables[K]> {
        if (typeof id === 'string') {
            return this._cache.get(tableNameOrId, id)
        }
        return this._cache.get(this.tableName, tableNameOrId)
    }

    set<E extends keyof Tables, R extends Tables[E]>(
        tableName: E,
        id: string,
        value: R
    ): Promise<void>

    set(id: string, value: T): Promise<void>

    set(
        tableNameOrId: string,
        idOrValue: string | T,
        value?: T
    ): Promise<void> {
        if (value != null) {
            return this._cache.set(tableNameOrId, idOrValue as string, value)
        }
        return this._cache.set(this.tableName, tableNameOrId, idOrValue as T)
    }

    delete<E extends keyof Tables>(tableName: E, id: string): Promise<void>
    delete(id: string): Promise<void>

    delete(tableNameOrId: string, id?: string): Promise<void> {
        if (typeof id === 'string') {
            return this._cache.delete(tableNameOrId, id)
        }
        return this._cache.delete(this.tableName, tableNameOrId)
    }

    clear<E extends keyof Tables>(tableName: E): Promise<void>
    clear(): Promise<void>

    async clear(tableName?: string): Promise<void> {
        if (tableName) {
            await this._cache.clear(tableName)
        } else {
            await this._cache.clear(this.tableName)
        }
    }
}

declare module '@koishijs/cache' {
    interface Tables {
        'chathub/keys': string
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

// https://github.com/koishijs/cache/blob/main/packages/database/src/index.ts
class DatabaseCache {
    constructor(public ctx: Context) {
        ctx.model.extend(
            'cache',
            {
                table: 'string(63)',
                key: 'string(63)',
                value: 'text',
                expire: 'timestamp'
            },
            {
                primary: ['table', 'key']
            }
        )

        ctx.setInterval(async () => {
            await ctx.database.remove('cache', { expire: { $lt: new Date() } })
        }, 10 * Time.minute)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private encode(data: any): string {
        return JSON.stringify(data)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private decode(record: string): any {
        return JSON.parse(record)
    }

    async clear(table: string) {
        await this.ctx.database.remove('cache', { table })
    }

    async get(table: string, key: string) {
        const [entry] = await this.ctx.database.get('cache', { table, key }, [
            'expire',
            'value'
        ])
        if (!entry) return
        if (entry.expire && +entry.expire < Date.now()) return
        return this.decode(entry.value)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async set(table: string, key: string, value: any, maxAge?: number) {
        const expire = maxAge ? new Date(Date.now() + maxAge) : null
        await this.ctx.database.upsert('cache', [
            {
                table,
                key,
                value: this.encode(value),
                expire
            }
        ])
    }

    async delete(table: string, key: string) {
        await this.ctx.database.remove('cache', { table, key })
    }

    async *keys(table: string) {
        const entries = await this.ctx.database.get('cache', { table }, [
            'expire',
            'key'
        ])
        yield* entries
            .filter((entry) => !entry.expire || +entry.expire > Date.now())
            .map((entry) => entry.key)
    }

    async *values(table: string) {
        const entries = await this.ctx.database.get('cache', { table }, [
            'expire',
            'value'
        ])
        yield* entries
            .filter((entry) => !entry.expire || +entry.expire > Date.now())
            .map((entry) => this.decode(entry.value))
    }

    async *entries(table: string) {
        const entries = await this.ctx.database.get('cache', { table }, [
            'expire',
            'key',
            'value'
        ])
        yield* entries
            .filter((entry) => !entry.expire || +entry.expire > Date.now())
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((entry) => [entry.key, this.decode(entry.value)] as any)
    }
}
