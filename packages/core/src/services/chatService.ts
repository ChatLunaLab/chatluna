import { Service, Schema, Context, Dict, Logger, Awaitable, Computed } from "koishi";
import { EventListener, ConversationConfig, Conversation, UUID, Message, SimpleMessage, Disposed, SimpleConversation } from "../types"
import { v4 as uuidv4 } from 'uuid';
import { Config } from '../config';
import { ConversationCache } from '../cache';
import { createLogger } from '../utils/logger';

const logger = createLogger('@dingyi222666/chathub/chatService')

export class LLMChatService extends Service {

    private cacheOnMemory: Record<UUID, DefaultConversation>;
    private cacheOnDatabase: ConversationCache;

    private counter = 0
    private chatAdapters: Dict<LLMChatAdapter>;

    constructor(public ctx: Context, public config: Config) {
        super(ctx, "llmchat")
        this.cacheOnMemory = {}
        this.chatAdapters = {}

        this.cacheOnDatabase = new ConversationCache(ctx, config)

        logger.info('chatService started')
    }

    async createConversation(config: ConversationConfig): Promise<DefaultConversation> {
        const id = uuidv4()
        const adapter = this.selectAdapter(config)
        const conversation = this.putToMemory(() => new DefaultConversation(id, config, {}, adapter, adapter.config.conversationChatConcurrentMaxSize))

        this.listenConversation(conversation)
        await this.cacheOnDatabase.set(id, conversation.asSimpleConversation())

        return conversation
    }

    async queryConversation(id: UUID): Promise<DefaultConversation | null> {
        let conversation = this.cacheOnMemory[id]

        if (conversation) {
            await conversation.init(conversation.config)
            return conversation
        }

        const simpleConversation = await this.cacheOnDatabase.get(id)

        if (!simpleConversation) {
            return null
        }

        conversation = this.putToMemory(() => this.createDefaultConversation(simpleConversation))

        await conversation.init(conversation.config)

        return conversation
    }

    async clearConversation(id: UUID): Promise<void> {
        this.cacheOnMemory[id].clear()
        this.cacheOnMemory[id] = null
        await this.cacheOnDatabase.delete(id)
    }

    registerAdapter(adapter: LLMChatAdapter) {
        const id = this.counter++
        this.chatAdapters[id] = adapter

        logger.info(`register chat adapter ${adapter.label}`)

        return this.caller.collect('llmchat', () => {
            this.chatAdapters[id].dispose()
            return delete this.chatAdapters[id]
        })
    }

    private putToMemory(fn: () => DefaultConversation): DefaultConversation {
        const result = fn()
        this.cacheOnMemory[result.id] = result
        return result
    }

    public selectAdapter(config: ConversationConfig): LLMChatAdapter {
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

    public findAdapterByLabel(label: string) {
        return Object.values(this.chatAdapters)
            .filter(adapter => adapter.label === label)
    }


    private listenConversation(conversation: DefaultConversation) {
        conversation.on('all', async () => {
            await this.cacheOnDatabase.set(conversation.id, conversation.asSimpleConversation())
        })
    }

    private createDefaultConversation({ id, messages, config }: SimpleConversation): DefaultConversation {
        const adapter = this.ctx.llmchat.selectAdapter(config)
        const result = new DefaultConversation(id, config, messages, adapter, adapter.config.conversationChatConcurrentMaxSize)
        this.listenConversation(result)
        return result
    }

}

class DefaultConversation extends Conversation {
    id: UUID;

    config: ConversationConfig;
    latestMessages: [Message, Message] = [null, null]
    messages: Record<UUID, Message>;
    public supportInject = false
    public sender: string;


    private isInit = false;
    private logger = createLogger('@dingyi222666/chathub/conversation')
    private adapter: LLMChatAdapter;

    private conversationQueue: UUID[] = []
    private conversationLock = true

    private listeners: Map<number, EventListener> = new Map();

    constructor(id: UUID, config: ConversationConfig, messages: Record<UUID, Message>, adapter: LLMChatAdapter, public concurrentMaxSize: number) {
        super();
        this.id = id;
        this.config = config;
        this.messages = messages || {};
        this.adapter = adapter;
        this.supportInject = adapter.supportInject
        logger.info(`create conversation (id: ${this.id},adapter: ${this.adapter.label}), supportInject: ${this.supportInject}`)
    }

    private async getLock(maxSize: number = this.concurrentMaxSize): Promise<void> {
        while (this.conversationLock || this.conversationQueue.length > maxSize) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        this.conversationLock = true
        logger.info(`get lock for conversation ${this.id}`)
    }

    private releaseLock() {
        this.conversationLock = false
    }

    private async lockWithQueue(chatId: UUID) {
        this.conversationQueue.push(chatId)
        while (this.conversationQueue[0] !== chatId || this.conversationLock) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        if (this.conversationQueue[0] !== chatId) {
            throw new Error('lock error')
        }
        logger.info(`get lock for chat ${chatId}`)
    }

    private async releaseLockWithQueue(chatId: UUID) {
        if (this.conversationQueue[0] !== chatId) {
            throw new Error('release lock error')
        }
        this.conversationQueue.shift()
    }


    getAdpater(): LLMChatAdapter<LLMChatService.Config> {
        return this.adapter
    }

    async init(config: ConversationConfig): Promise<void> {
        if (this.isInit) return;

        try {
            const result = await this.adapter.init(config);
            await this.dispatchEvent('init')
            return result;
        } catch (error) {
            this.logger.error(`init conversation (id: ${this.id},adapter: ${this.adapter.label}) failed: ${error}`)
            throw error;
        } finally {
            this.releaseLock()
        }
    }

    async wait(fn: () => Promise<void>, lock: boolean): Promise<void> {
        const id = uuidv4();

        await this.lockWithQueue(id)
        if (lock) {
            await this.getLock(0)
        }

        await fn()
    }

    async clear(): Promise<void> {
        // wait for all chat finish
        await this.getLock(0)
        this.messages = {};
        this.latestMessages = [null, null];
        this.adapter.clear()
        await this.dispatchEvent('clear')
        this.releaseLock()
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

        // copy lastest messages
        const oldLatestMessages = [...this.latestMessages];

        this.messages[id] = newMessage;
        this.latestMessages[0] = newMessage;

        await this.lockWithQueue(id)

        await this.dispatchEvent('send', newMessage)

        let replySimpleMessage: Message

        try {
            replySimpleMessage = await this.adapter.ask(this, newMessage)
        } catch (error) {

            // rollback message
            delete this.messages[id]
            this.latestMessages = [oldLatestMessages[0], oldLatestMessages[1]];

            await this.releaseLockWithQueue(id)

            throw error
        }

        if ((replySimpleMessage.content == null ||
            replySimpleMessage.content.length === 0) && replySimpleMessage.additionalReplyMessages != null && replySimpleMessage.additionalReplyMessages.length > 0) {

            // rollback message
            delete this.messages[id]
            this.latestMessages = [oldLatestMessages[0], oldLatestMessages[1]];
            await this.releaseLockWithQueue(id)
            return replySimpleMessage;
        }

        if (replySimpleMessage.id == null) {
            replySimpleMessage.id = uuidv4()
        }

        if (replySimpleMessage.time == null) {
            replySimpleMessage.time = Date.now()
        }

        if (replySimpleMessage.parentId == null) {
            replySimpleMessage.parentId = id
        }

        const replyMessage: Message = {
            ...replySimpleMessage
        }

        replyMessage.role = "model"


        this.latestMessages[1] = replyMessage;
        this.messages[replyMessage.id] = replyMessage;

        await this.dispatchEvent('receive', replyMessage)

        await this.releaseLockWithQueue(id)
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
        isDefault?: boolean,
        conversationChatConcurrentMaxSize?: number,
        chatTimeLimit?: Computed<Awaitable<number>>,
        timeout?: number,
    }

    export const createConfig: ({ label }: Config) => Schema<Config> = ({ label }) =>
        Schema.object({
            isDefault: Schema.boolean().default(false).description('是否设置为默认的模型适配器'),
            label: Schema.string().default(label).description('LLM支持服务的标签，可用于指令切换调用'),
            conversationChatConcurrentMaxSize: Schema.number().default(2).description('会话中最大并发聊天数'),
            chatTimeLimit: Schema.union([
                Schema.natural(),
                Schema.any().hidden(),
            ]).role('computed').default(10).description('每小时的调用限额(次数)'),
            timeout: Schema.number().description("请求超时时间(ms)").default(200 * 1000),
        }).description('全局设置')


    export const Config = createConfig({ label: 'default' })

    export const using = ['cache']


}

export abstract class LLMChatAdapter<Config extends LLMChatService.Config = LLMChatService.Config> {

    static using = ['llmchat']

    label: string;

    abstract supportInject: boolean

    constructor(public ctx: Context, public config: Config) {
        this.label = config.label
        const disposed = ctx.llmchat.registerAdapter(this)

        ctx.on('dispose', () => {
            disposed()
        })
    }

    abstract init(config: ConversationConfig): Promise<void>

    abstract ask(conversation: Conversation, message: Message): Promise<Message>

    dispose() { }

    clear() { }
}

function getEventFlag(event: Conversation.Events) {
    return event === 'init' ? 1 : event === 'send' ? 2 : event === 'receive' ? 3 : event === 'clear' ? 4 : event === 'retry' ? 5 : event === 'all' ? 6 : 0
}

declare module 'koishi' {
    interface Context {
        llmchat: LLMChatService;
    }
}



