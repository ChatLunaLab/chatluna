import { CacheTable, Tables } from '@koishijs/cache';
import { Context } from 'koishi';
import { Config } from '../config';

export class Cache<K extends keyof Tables, T extends Tables[K]> {
    private cache: CacheTable<T>

    constructor(ctx: Context, public readonly config: Config, public readonly tableName: K) {
        this.cache = new CacheTable(ctx, tableName)
    }

    async get(id: string): Promise<T> {
        return this.cache.get(id);
    }

    async set(id: string, value: T, maxAge: number = this.config.expireTime * 60 * 1000): Promise<void> {
        // 单位分钟
        return await this.cache.set(id, value, maxAge);
    }

    async delete(id: string): Promise<void> {
        await this.cache.delete(id);
    }

    async clear(): Promise<void> {
        await this.cache.clear();
    }
}
