import { CacheTable } from '@koishijs/cache';
import { Conversation, SimpleConversation, UUID } from './types';
import { Context, Logger } from 'koishi';
import { LLMChatService } from './services/chatService';
import { Config } from './config';
import * as flatted from 'flatted';

declare module '@koishijs/cache' {
    interface Tables {
        'chathub/conversations': SimpleConversation,
        'chathub/conversationIds': UUID,
        'chathub/chatTimeLimit': ChatLimit
    }
}

const logger = new Logger('@dingyi222666/chathub/cache')

export class ConversationCache {
    // 全部存储？或许可以考虑其他方案
    private cache: CacheTable<SimpleConversation>

    constructor(ctx: Context, public config: Config) {
        this.cache = new CacheTable(ctx, 'chathub/conversations')
    }

    async get(id: UUID): Promise<SimpleConversation> {
        return this.cache.get(id);
    }

    async set(id: UUID, value: SimpleConversation): Promise<void> {
        // 单位分钟
        return await this.cache.set(id, value, this.config.expireTime * 60 * 1000);
    }

    async delete(id: UUID): Promise<void> {
        await this.cache.delete(id);
    }

    async clear(): Promise<void> {
        await this.cache.clear();
    }
}

export class ConversationIdCache {
    private cache: CacheTable<UUID>

    constructor(ctx: Context, public config: Config) {
        this.cache = new CacheTable(ctx, 'chathub/conversationIds')
    }

    async get(id: string): Promise<UUID> {
        return this.cache.get(id);
    }

    async set(id: string, value: UUID): Promise<void> {
        // 单位分钟
        return await this.cache.set(id, value, this.config.expireTime * 60 * 1000);
    }

    async delete(id: string): Promise<void> {
        await this.cache.delete(id);
    }

    async clear(): Promise<void> {
        await this.cache.clear();
    }

    async getConversationId(id: string): Promise<UUID> {
        return await this.get(id)
    }

}


export class ChatLimitCache {
    private cache: CacheTable<ChatLimit>

    constructor(ctx: Context, public config: Config) {
        this.cache = new CacheTable(ctx, 'chathub/chatTimeLimit')
    }

    async get(id: string): Promise<ChatLimit> {
        return this.cache.get(id);
    }


    async set(id: string, value: ChatLimit): Promise<void> {
        // 单位分钟，目标单位是毫秒
        return await this.cache.set(id, value, this.config.expireTime * 60 * 1000);
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