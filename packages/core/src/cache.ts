import {  Tables } from '@koishijs/cache';
import { Context } from 'koishi';
import { Config } from './config';

export class Cache<K extends keyof Tables, T extends Tables[K]> {
   
    constructor(private ctx: Context, public readonly config: Config, public readonly tableName: K) {}

    async get(id: string): Promise<T> {
        return this.ctx.cache.get(this.tableName, id);
    }

    async set(id: string, value: T, maxAge: number = this.config.expireTime * 60 * 1000): Promise<void> {
        // 单位分钟
        return await this.ctx.cache.set(this.tableName,id, value, maxAge);
    }

    async delete(id: string): Promise<void> {
        await this.ctx.cache.delete(this.tableName, id);
    }

    async clear(): Promise<void> {
        await this.ctx.cache.clear(this.tableName);
    }
}

declare module '@koishijs/cache' {
    interface Tables {
        'chathub/keys': string
    }
}