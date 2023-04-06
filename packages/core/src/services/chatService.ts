import { Service, Schema, Context, Dict, Logger } from "koishi";
import { CacheTable } from "@koishijs/cache"
import { EventListener, InjectData, ConversationConfig, Conversation, UUID, Message, SimpleMessage, Disposed } from "../types"
import { v4 as uuidv4 } from 'uuid';


export abstract class LLMChatService extends Service {
    abstract createConversation(config: ConversationConfig): Promise<Conversation>;
    abstract queryConversation(id: UUID): Promise<Conversation>;
    abstract clearConversation(id: UUID): Promise<void>;
}

class DefaultConversation implements Conversation {
    id: UUID;

    config: ConversationConfig;
    latestMessages: [Message, Message] = [null, null]
    messages: Record<UUID, Message>;

    private logger = new Logger('@dingyi222666/koishi-plugin-chathub-conversation')
    private adapter: LLMChatAdapter;
    private listeners: Map<number, EventListener> = new Map();


    constructor(id: UUID, config: ConversationConfig, messages: Record<UUID, Message>, adapter: LLMChatAdapter) {
        this.id = id;
        this.config = config;
        this.messages = messages || {};
        this.adapter = adapter;
    }

    async init(config: ConversationConfig): Promise<void> {
        try {
            const result = await this.adapter.init(config);
            this.dispatchEvent('init')
            return result;
        } catch (error) {
            this.logger.error(`init conversation (id: ${this.id},adapter: ${this.adapter.name}) failed: ${error}`)
        }
    }

    clear(): void {
        this.messages = {};
        this.latestMessages = [null, null];
        this.dispatchEvent('clear')
    }

    async ask(message: SimpleMessage): Promise<Message> {
        // uuid

        const id = uuidv4();
        const time = Date.now();
        const newMessage: Message = {
            ...message,
            id,
            time
        }

        this.messages[id] = newMessage;
        this.latestMessages[0] = newMessage;
        this.dispatchEvent('send', newMessage)

        const replyMessage = await this.adapter.ask(this, newMessage)

        this.latestMessages[1] = replyMessage;
        this.messages[id] = replyMessage;
        this.dispatchEvent('receive', replyMessage)

        return replyMessage;
    }

    continue(): Promise<Message> {
        const askMessage: SimpleMessage = {
            content: 'continue',
            role: 'user'
        }
        return this.ask(askMessage)
    }

    retry(): Promise<Message> {
        const [askMessage, replyMessage] = this.latestMessages

        this.dispatchEvent('retry')

        if (replyMessage) {
            this.messages[replyMessage.id] = null
        }
        this.messages[askMessage.id] = null

        return this.ask(askMessage)
    }

    private dispatchEvent(event: Conversation.Events, message?: Message) {
        const eventFlag = getEventFlag(event)
        for (const [packNumber, listener] of this.listeners) {
            if (packNumber >> 4 !== eventFlag) {
                continue
            }
            listener(this, message)
        }
    }

    on(event: Conversation.Events, listener: EventListener): Disposed {
        const id = this.listeners.size + 1
        const eventFlag = getEventFlag(event)
        const packNumber = (eventFlag << 4) + id
        this.listeners.set(packNumber, listener)
        return () => {
            this.listeners.delete(packNumber)
        }
    }
}

export namespace LLMChatService {
    export interface Config {
        label: string;
        isDefault: boolean;
    }

    export const Config = Schema.object({
        isDefault: Schema.boolean().default(false).description('是否设置为默认的LLM支持服务'),
        label: Schema.string().default('LLMChatService').description('LLM支持服务的标签，可用于指令切换调用'),
    }).description('全局设置')
}

export interface LLMChatAdapter {

    name: string;

    init(config: ConversationConfig): Promise<void>

    ask(conversation: Conversation, message: SimpleMessage): Promise<Message>

}

function getEventFlag(event: Conversation.Events) {
    return event === 'init' ? 1 : event === 'send' ? 2 : event === 'receive' ? 3 : event === 'clear' ? 4 : event === 'retry' ? 5 : 0
}

declare module 'koishi' {
    interface Context {
        llmchat: LLMChatService;
    }
}



