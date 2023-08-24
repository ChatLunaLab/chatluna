import {  Tables } from '@koishijs/cache';
import { Context } from 'koishi';
import { Config } from './config';

export class Cache<K extends keyof Tables, T extends Tables[K]> {
   
    constructor(private ctx: Context, public readonly config: Config, public readonly tableName: K) {}

     get(id: string): Promise<T> {
        return this.ctx.cache.get(this.tableName, id);
    }

     set(id: string, value: T): Promise<void> {
        // 单位分钟
        return  this.ctx.cache.set(this.tableName,id, value);
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