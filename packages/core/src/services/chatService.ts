import { Service, Schema, Context, Dict, Logger, Awaitable, Computed } from "koishi";
import {
    EventListener,
    ConversationConfig,
    Conversation,
    UUID,
    Message,
    SimpleMessage,
    Disposed,
    SimpleConversation
} from "../types"
import { v4 as uuidv4 } from 'uuid';
import { Config } from '../config';
import { Cache } from '../cache';
import { createLogger } from '../utils/logger';

const logger = createLogger('@dingyi222666/chathub/chatService')

export class LLMChatService extends Service {

    private cacheOnMemory: Record<UUID, DefaultConversation>;
    private cacheOnDatabase: Cache<'chathub/conversations', SimpleConversation>;

    private counter = 0
    private chatAdapters: Dict<LLMChatAdapter>;

    constructor(public ctx: Context, public config: Config) {
        super(ctx, "llmchat")
        this.cacheOnMemory = {}
        this.chatAdapters = {}

        this.cacheOnDatabase = new Cache(ctx, config, 'chathub/conversations')

        logger.debug('chatService started')
    }

    async createConversation(config: ConversationConfig): Promise<DefaultConversation> {
        const id = uuidv4()
        const adapter = () => this.selectAdapter(config)
        const conversation = this.putToMemory(() => new DefaultConversation({
            id, config
        }, adapter))

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
        await this.cacheOnMemory[id].clear()
        this.cacheOnMemory[id] = null
        await this.cacheOnDatabase.delete(id)
    }

    registerAdapter(adapter: LLMChatAdapter) {

        this.chatAdapters[adapter.label] = adapter

        logger.debug(`register chat adapter ${adapter.label}`)
        logger.debug(`adapter list: ${Object.values(this.chatAdapters).map(adapter => adapter.label).join(', ')}`)

        return this.caller.collect('llmchat', () => {
            this.chatAdapters[adapter.label].dispose()
            return delete this.chatAdapters[adapter.label]
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

        if (adapters.length === 0) {
            if (selectedAdapterLabel !== undefined) {
                throw new Error(`no adapter found for ${selectedAdapterLabel}`)
            } else {
                throw new Error(`adapterLabel is required, you need to set an adapter to the default adapter`)
            }
        }

        if (adapters.length > 1)
            throw new Error(`multiple adapters found for ${selectedAdapterLabel}, you should specify the adapterLabel or only set one adapter as default`)

        return adapters[0]
    }

    public findAdapterByLabel(label: string) {
        return Object.values(this.chatAdapters)
            .filter(adapter => adapter.label === label)
    }

    public getAllAdapters() {
        return Object.values(this.chatAdapters)
    }

    private listenConversation(conversation: DefaultConversation) {
        conversation.on('all', async () => {
            await this.cacheOnDatabase.set(conversation.id, conversation.asSimpleConversation())
        })
    }

    private createDefaultConversation(simpleConversation: SimpleConversation): DefaultConversation {
        const adapter = () => this.ctx.llmchat.selectAdapter(simpleConversation.config)
        const result = new DefaultConversation(simpleConversation, adapter)
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

    concurrentMaxSize: number


    private isInit = false;
    private logger = createLogger('@dingyi222666/chathub/conversation')
    private adapter: LLMChatAdapter;

    private conversationQueue: UUID[] = []
    private conversationLock = false

    private listeners: Map<number, EventListener> = new Map();


    //最大败笔之一，把adapter放对话里，脑子抽了妈的
    //暂时先每次都selectAdapter吧。。。
    constructor(simpleConverstaion: SimpleConversation, private readonly adapterResolver: () => LLMChatAdapter) {
        super();

        const { id, config, messages, latestMessages } = simpleConverstaion
        this.id = id;
        this.config = config;
        this.messages = messages || {};
        this.latestMessages = latestMessages || this.latestMessages
        this.adapter = this.adapterResolver()
        this.concurrentMaxSize = this.adapter.config.conversationChatConcurrentMaxSize
        this.supportInject = this.adapter.supportInject

        logger.debug(`create conversation (id: ${this.id},adapter: ${this.adapter.label}), supportInject: ${this.supportInject}`)


        this.on("before-send", async () => {
            //总是新建一个adapter，因为adapter是有状态的
            //TODO: 1.x直接把这坨答辩给重构了
            const oldAdapter = this.adapter
            this.adapter = this.adapterResolver()
            if (oldAdapter !== this.adapter) {
                this.concurrentMaxSize = this.adapter.config.conversationChatConcurrentMaxSize
                this.isInit = false
                await this.init(this.config)
            }

        })
    }

    private async getLock(maxSize: number = this.concurrentMaxSize): Promise<void> {
        while (this.conversationLock || this.conversationQueue.length > maxSize) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        this.conversationLock = true
        logger.debug(`get lock for conversation ${this.id}`)
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
        logger.debug(`get lock for chat ${chatId}`)
    }

    private async releaseLockWithQueue(chatId: UUID) {
        if (this.conversationQueue[0] !== chatId) {
            throw new Error('release lock error')
        }
        this.conversationQueue.shift()
    }


    getAdapter(): LLMChatAdapter<LLMChatService.Config> {
        return this.adapter
    }

    async init(config: ConversationConfig): Promise<void> {
        await this.getLock(0)

        if (this.isInit) {
            this.releaseLock()
            return
        }

        try {
            const result = await this.adapter.init(this, config);
            await this.dispatchEvent('init')
            this.isInit = true;
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

        await this.releaseLockWithQueue(id)

        if (lock) {
            this.releaseLock()
        }
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
        // 什么为了屎山代码妥协的设计？
        await this.dispatchEvent('before-send')

        const id = uuidv4();

        await this.lockWithQueue(id)

        const time = Date.now();
        const newMessage: Message = {
            ...message,
            parentId: this.latestMessages[1]?.id,
            id,
            time
        }

        // copy latest messages
        const oldLatestMessages = [...this.latestMessages];

        this.messages[id] = newMessage;
        this.latestMessages[0] = newMessage;

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
            label: Schema.string().default(label).description('适配器服务的标签，可用于指令切换调用'),
            conversationChatConcurrentMaxSize: Schema.number().min(0).max(4).default(0).description('会话中最大并发聊天数'),
            chatTimeLimit: Schema.union([
                Schema.natural(),
                Schema.any().hidden(),
            ]).role('computed').default(20).description('每小时的调用限额(次数)'),
            timeout: Schema.number().description("请求超时时间(ms)").default(200 * 1000),
        }).description('全局设置')


    export const Config = createConfig({ label: 'default' })

    export const using = ['cache']


}

export abstract class LLMChatAdapter<Config extends LLMChatService.Config = LLMChatService.Config> {

    static using = ['llmchat']

    label: string;

    abstract supportInject: boolean

    description: string

    protected constructor(protected ctx: Context, public config: Config) {
        this.label = config.label
        this.description = "please set description"
        const disposed = ctx.llmchat.registerAdapter(this)

        ctx.on('dispose', async () => {
            disposed()
        })

        ctx.llmchat.caller
    }

    abstract init(conversation: Conversation, config: ConversationConfig): Promise<void>

    abstract ask(conversation: Conversation, message: Message): Promise<Message>


    dispose() {
    }

    async clear() {
    }
}

function getEventFlag(event: Conversation.Events) {
    return event === 'init' ? 1 : event === 'send' ? 2 : event === 'receive' ? 3 : event === 'clear' ? 4 : event === 'retry' ? 5 : event === 'all' ? 6 : event === 'before-send' ? 7 : 0
}

declare module 'koishi' {
    interface Context {
        llmchat: LLMChatService;
    }
}



