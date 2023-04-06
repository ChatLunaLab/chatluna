import { CacheTable } from '@koishijs/cache';
import { Conversation, SimpleConversation, UUID } from './types';
import { Context, Logger } from 'koishi';
import { LLMChatService } from './services/chatService';
import { Config } from './config';


declare module '@koishijs/cache' {
    interface Tables {
        'chathub/conversations': SimpleConversation
    }
}


export class ConversationCache {
    private cache: CacheTable<SimpleConversation>

    constructor(ctx: Context, public config: Config) {
        this.cache = ctx.cache('chathub/conversations')
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
