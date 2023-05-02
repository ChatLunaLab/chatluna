import { CacheTable, Tables } from '@koishijs/cache';
import { ConversationId, SimpleConversation } from './types';
import { Context } from 'koishi'; import { Config } from './config';
import { createLogger } from './utils/logger'


declare module '@koishijs/cache' {
    interface Tables {
        'chathub/conversations': SimpleConversation,
        'chathub/conversationIds': ConversationId[],
        'chathub/chatTimeLimit': ChatLimit
        'chathub/keys': string
    }
}

const logger = createLogger('@dingyi222666/chathub/cache')

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


export interface ChatLimit {
    time: number,
    count: number
}