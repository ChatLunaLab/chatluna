import { Service, Schema, Context, Dict, Logger } from "koishi";
import { EventListener, ConversationConfig, Conversation, UUID, Message, SimpleMessage, Disposed, SimpleConversation } from "../types"
import { v4 as uuidv4 } from 'uuid';
import { Config } from '../config';
import { ConversationCache } from '../cache';


export class LLMChatService extends Service {

    private cacheOnMemory: Record<UUID, DefaultConversation>;
    private cacheOnDatabase: ConversationCache;
    private logger = new Logger('@dingyi222666/koishi-plugin-chathub-chatService')
    private counter = 0
    private chatAdapters: Dict<LLMChatAdapter>;

    constructor(public ctx: Context, public config: Config) {
        super(ctx, "llm-chat")
        this.cacheOnMemory = {}
        this.chatAdapters = {}
        this.cacheOnDatabase = new ConversationCache(ctx, config)

        this.logger.info('chatService started')
    }

    async createConversation(config: ConversationConfig): Promise<DefaultConversation> {
        const id = uuidv4()
        const conversation = this.putToMemory(() => new DefaultConversation(id, config, {}, this.selectAdapter(config)))
        await this.cacheOnDatabase.set(id, conversation)
        return conversation
    }

    async queryConversation(id: UUID): Promise<DefaultConversation | null> {
        const conversation = this.cacheOnMemory[id]

        if (conversation) return conversation

        const simpleConversation = await this.cacheOnDatabase.get(id)

        if (!simpleConversation) {
            return null
        }

        return this.putToMemory(() => this.createDefaultConversation(simpleConversation))
    }

    async clearConversation(id: UUID): Promise<void> {
        this.cacheOnMemory[id].clear()
        this.cacheOnMemory[id] = null
        await this.cacheOnDatabase.delete(id)
    }

    registerAdapter(adapter: LLMChatAdapter) {
        const id = this.counter++
        this.chatAdapters[id] = adapter

        this.logger.info(`register chat adapter ${adapter.label}`)

        return this.caller.collect('llminject', () => {
            this.chatAdapters[id].dispose()
            return delete this.chatAdapters[id]
        })
    }

    private putToMemory(fn: () => DefaultConversation): DefaultConversation {
        const result = fn()
        this.cacheOnMemory[result.id] = result
        return result
    }

    private selectAdapter(config: ConversationConfig): LLMChatAdapter {
        const selectedAdapterLabel = config.adapterLabel
        const adapters = Object.values(this.chatAdapters)
            .filter(adapter => {
                if (selectedAdapterLabel) {
                    return adapter.label === selectedAdapterLabel
                }
                return adapter.config.isDefault
            })

        if (adapters.length === 0)
            throw new Error(`no adapter found for ${selectedAdapterLabel}`)

        if (adapters.length > 1)
            throw new Error(`multiple adapters found for ${selectedAdapterLabel}, you should specify the adapterLabel or only set one adapter as default`)

        return adapters[0]

    }

    private createDefaultConversation({ id, messages, config }: SimpleConversation): DefaultConversation {
        const result = new DefaultConversation(id, config, messages, this.ctx.llmchat.selectAdapter(config))

        result.on('all', async () => {
            await this.cacheOnDatabase.set(id, result.asSimpleConversation())
        })

        return result
    }

}

class DefaultConversation extends Conversation {
    id: UUID;

    config: ConversationConfig;
    latestMessages: [Message, Message] = [null, null]
    messages: Record<UUID, Message>;
    public sender: string;

    private isInit = false;
    private logger = new Logger('@dingyi222666/koishi-plugin-chathub-conversation')
    private adapter: LLMChatAdapter;
    private listeners: Map<number, EventListener> = new Map();


    constructor(id: UUID, config: ConversationConfig, messages: Record<UUID, Message>, adapter: LLMChatAdapter) {
        super();
        this.id = id;
        this.config = config;
        this.messages = messages || {};
        this.adapter = adapter;
    }

    async init(config: ConversationConfig): Promise<void> {
        if (this.isInit) return;
        try {
            const result = await this.adapter.init(config);
            await this.dispatchEvent('init')
            return result;
        } catch (error) {
            this.logger.error(`init conversation (id: ${this.id},adapter: ${this.adapter.label}) failed: ${error}`)
        }
    }

    async clear(): Promise<void> {
        this.messages = {};
        this.latestMessages = [null, null];
        await this.dispatchEvent('clear')
    }

    async ask(message: SimpleMessage): Promise<Message> {
        // uuid

        const id = uuidv4();
        const time = Date.now();
        const newMessage: Message = {
            ...message,
            parentId: this.latestMessages[1]?.id,
            id,
            time
        }

        this.messages[id] = newMessage;
        this.latestMessages[0] = newMessage;
        await this.dispatchEvent('send', newMessage)

        const replySimpleMessage = await this.adapter.ask(this, newMessage)

        const replyMessage: Message = {
            ...replySimpleMessage,
            id: uuidv4(),
            time: Date.now(),
            parentId: id
        }


        this.latestMessages[1] = replyMessage;
        this.messages[id] = replyMessage;

        await this.dispatchEvent('receive', replyMessage)

        return replyMessage;
    }

    continue(): Promise<Message> {
        const askMessage: SimpleMessage = {
            content: 'continue',
            role: 'user'
        }
        return this.ask(askMessage)
    }

    async retry(): Promise<Message> {
        const [askMessage, replyMessage] = this.latestMessages

        await this.dispatchEvent('retry')
        this.latestMessages[1] = this.messages[askMessage.parentId]
        this.latestMessages[0] = this.messages[this.latestMessages[1].parentId]
        if (replyMessage) {
            this.messages[replyMessage.id] = null
        }

        this.messages[askMessage.id] = null

        return this.ask(askMessage)
    }

    private async dispatchEvent(event: Conversation.Events, message?: Message) {
        const eventFlag = getEventFlag(event)
        for (const [packNumber, listener] of this.listeners) {
            const unpackFlag = packNumber >> 4
            if (unpackFlag !== eventFlag && unpackFlag !== 6) {
                continue
            }
            await listener(this, message)
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


    export const createConfig: ({ label }) => Schema<Config> = ({ label }) =>
        Schema.object({
            isDefault: Schema.boolean().default(false).description('是否设置为默认的LLM支持服务'),
            label: Schema.string().default(label).description('LLM支持服务的标签，可用于指令切换调用')
        }).description('全局设置')


    export const Config = createConfig({ label: 'default' })

    export const using = ['cache']


}

export abstract class LLMChatAdapter<Config extends LLMChatService.Config = LLMChatService.Config> {

    static using = ['llmchat']

    label: string;

    constructor(public ctx: Context, public config: Config) {
        ctx.llmchat.registerAdapter(this)
        this.label = config.label
    }

    abstract init(config: ConversationConfig): Promise<void>

    abstract ask(conversation: Conversation, message: Message): Promise<SimpleMessage>

    dispose() {}
}

function getEventFlag(event: Conversation.Events) {
    return event === 'init' ? 1 : event === 'send' ? 2 : event === 'receive' ? 3 : event === 'clear' ? 4 : event === 'retry' ? 5 : event === 'all' ? 6 : 0
}

declare module 'koishi' {
    interface Context {
        llmchat: LLMChatService;
    }
}



