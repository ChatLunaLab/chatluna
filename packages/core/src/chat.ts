import { Context, Disposable, Fragment, Logger, Next, Session, h } from 'koishi';
import { Config } from './config';
import { Conversation, ConversationConfig, ConversationId, InjectData, UUID } from './types';
import { ChatLimitCache, ConversationIdCache } from './cache';
import { createLogger } from './logger';

const logger = createLogger('@dingyi222666/chathub/chat')

let lastChatTime = 0

export class Chat {

    private senderIdToChatSessionId: Record<string, ConversationId[]> = {}

    private conversationIdCache: ConversationIdCache


    constructor(public context: Context, public config: Config) {
        this.conversationIdCache = new ConversationIdCache(context, config)
    }

    async measureTime<T>(fn: () => Promise<T>, timeFn: (time: number) => void): Promise<T> {
        const start = Date.now()
        const result = await fn()
        const end = Date.now()
        timeFn(end - start)
        return result
    }

    private async getConversationIds(senderId: string): Promise<ConversationId[]> {
        const conversationId = senderId in this.senderIdToChatSessionId ? this.senderIdToChatSessionId[senderId] : await this.conversationIdCache.get(senderId)

        if (conversationId) {
            return conversationId
        }

        return []
    }

    private async setConversationId(senderId: string, conversationId: UUID, conversationConfig: ConversationConfig) {
        const sessions = await this.getConversationIds(senderId)

        const conversationAdapterLabel = conversationConfig.adapterLabel

        const convesrsationIdInMemory = sessions.find((session) => session.adapterLabel === conversationAdapterLabel) ?? {
            id: conversationId,
            adapterLabel: conversationAdapterLabel
        }

        convesrsationIdInMemory.adapterLabel = conversationAdapterLabel
        convesrsationIdInMemory.id = conversationId
        sessions.push(convesrsationIdInMemory)
        this.conversationIdCache.set(senderId, sessions)
        await this.conversationIdCache.set(senderId, sessions)
    }

    private async injectData(message: string, config: Config): Promise<InjectData[] | null> {

        if (this.context.llminject == null || config.injectData == false) {
            return null
        }

        //分词？算了先直接搜就好了

        const llmInjectService = this.context.llminject

        return llmInjectService.search(message)
    }


    async resolveConversation(senderId: string, conversationConfig: ConversationConfig): Promise<Conversation> {
        const chatService = this.context.llmchat

        let conversation: Conversation
        const conversationIds = await this.getConversationIds(senderId)
        let conversationId = this.selectConverstaionId(conversationIds, conversationConfig.adapterLabel == "empty" ? null : conversationConfig.adapterLabel)

        if (conversationId == null) {
            // 现在就选择一个adapter，不然下次可能会换别的
            if (conversationConfig.adapterLabel == "empty" || conversationConfig.adapterLabel == null) {
                //设置为null，不然会按照label去选择adapter
                conversationConfig.adapterLabel = null
                const adapter = this.context.llmchat.selectAdapter(conversationConfig)
                conversationConfig.adapterLabel = adapter.label
            }

            conversation = await chatService.createConversation(conversationConfig)

        } else {
            conversation = await chatService.queryConversation(conversationId.id)
        }

        return conversation
    }

    async chat(message: string, config: Config, senderId: string, senderName: string, needInjectData: boolean = true, conversationConfig: ConversationConfig = createConversationConfigWithLabelAndPrompts(config, "empty", [config.botIdentity])): Promise<Fragment[]> {

        const conversation = await this.resolveConversation(senderId, conversationConfig)
        await this.setConversationId(senderId, conversation.id, conversationConfig)

        await this.measureTime(async () => {
            await conversation.init(conversationConfig)
        }, (time) => {
            logger.debug(`init conversation ${conversation.id} cost ${time}ms`)
        })


        let injectData: InjectData[] | null = null
        if (conversation.supportInject && needInjectData) {
            injectData = await this.measureTime(() => this.injectData(message, config), (time) => {
                logger.debug(`inject data cost ${time}ms`)
            })
        }

        const response = await this.measureTime(() => conversation.ask({
            role: 'user',
            content: message,
            inject: injectData,
            sender: senderName
        }), (time) => {
            logger.debug(`chat cost ${time}ms`)
        })

        logger.debug(`chat result: ${response.content}`)


        const result: Fragment[] = []

        result.push(h('p', response.content))

        if (response.additionalReplyMessages) {
            result.push(...response.additionalReplyMessages.map((message) => h('p', message)))
        }

        return result
    }



    async clearAll(senderId: string) {
        const chatService = this.context.llmchat

        const conversationIds = await this.getConversationIds(senderId)

        if (conversationIds === null) {
            //没创建就算了
            return
        }

        for (const conversationId of conversationIds) {
            const conversation = await chatService.queryConversation(conversationId.id)
            await conversation.clear()
        }
    }

    async clear(senderId: string, adapterLabel?: string) {

        const conversation = await this.selectConverstaion(senderId, adapterLabel)

        const size = Object.keys(conversation.messages).length


        // conversation.config = createConversationConfigWithLabelAndPrompts(this.config, adapterLabel, [this.config.botIdentity])
        await conversation.clear()

        return size
    }

    async setBotIdentity(senderId: string, persona: string = this.config.botIdentity, adapterLabel?: string) {

        const conversation = await this.selectConverstaion(senderId)

        await conversation.clear()

        conversation.config = createConversationConfigWithLabelAndPrompts(this.config, adapterLabel, [persona])
    }


    async withChatLimit<T>(fn: () => Promise<T>, chat: Chat, chatLimitCache: ChatLimitCache, session: Session, senderId: string, config: Config, conversationConfig: ConversationConfig = createConversationConfigWithLabelAndPrompts(config, "empty", [config.botIdentity]),): Promise<T> {
        const conversation = await chat.resolveConversation(senderId, conversationConfig)
        const chatLimitRaw = conversation.getAdpater().config.chatTimeLimit
        const chatLimitComputed = await session.resolve(chatLimitRaw)

        let chatLimitOnDataBase = await chatLimitCache.get(conversation.id + "-" + senderId)

        if (chatLimitOnDataBase) {
            // 如果大于1小时的间隔，就重置
            if (Date.now() - chatLimitOnDataBase.time > 1000 * 60 * 60) {
                chatLimitOnDataBase = {
                    time: Date.now(),
                    count: 0
                }
            } else {
                // 用满了
                if (chatLimitOnDataBase.count >= chatLimitComputed) {
                    const time = Math.ceil((1000 * 60 * 60 - (Date.now() - chatLimitOnDataBase.time)) / 1000 / 60)
                    session.send(`你已经聊了${chatLimitOnDataBase.count}次了,超过了限额，休息一下吧（请${time}分钟后再试）`)

                    return null
                }
            }
        } else {
            chatLimitOnDataBase = {
                time: Date.now(),
                count: 0
            }
        }

        // 先保存一次
        await chatLimitCache.set(conversation.id + "-" + senderId, chatLimitOnDataBase)

        const runResult = await fn()

        if (runResult !== null) {
            chatLimitOnDataBase.count++
            await chatLimitCache.set(conversation.id + "-" + senderId, chatLimitOnDataBase)
            return runResult
        }

        return null

    }

    private async selectConverstaion(senderId: string, adapterLabel?: string): Promise<Conversation> {
        const chatService = this.context.llmchat


        const conversationIds = await this.getConversationIds(senderId)

        if (conversationIds === null) {
            //没创建就算了
            return
        }

        const conversationId = this.selectConverstaionId(conversationIds, adapterLabel)

        const conversation = await chatService.queryConversation(conversationId.id)

        return conversation
    }

    private selectConverstaionId(conversationIds: ConversationId[], adapterLabel?: string): ConversationId {
        if (adapterLabel == null) {
            adapterLabel = this.context.llmchat.selectAdapter({}).label
        }

        return conversationIds.find((conversationId) => conversationId.adapterLabel === adapterLabel)
    }
}

export function createConversationConfig(config: Config): ConversationConfig {
    return {
        initialPrompts: {
            role: 'system',
            content: config.botIdentity.replace(/{name}/gi, config.botName)
        },
        inject: (config.injectDataEnenhance && config.injectData) ? 'enhanced' : config.injectData ? 'default' : 'none',
    }
}

export function createConversationConfigWithLabelAndPrompts(config: Config, label: string, prompts: string[]): ConversationConfig {
    return {
        initialPrompts: prompts.map((prompt) => {
            return {
                role: 'system',
                // replace all match {name} to config.name
                content: prompt.replace(/{name}/gi, config.botName)
            }
        }),
        inject: (config.injectDataEnenhance && config.injectData) ? 'enhanced' : config.injectData ? 'default' : 'none',
        adapterLabel: label
    }
}

export async function replyMessage(
    session: Session,
    message: Fragment,
    isReplyWithAt: boolean = true
) {

    logger.debug(`reply message: ${message}`)

    await session.send(
        isReplyWithAt && session.subtype === "group"
            ? h("at", { id: session.userId }, message)
            : message
    );
};

export function readChatMessage(session: Session) {
    //要求
    //过滤xml，转换艾特为实际昵称，过滤图片等
    const result = []

    for (const element of session.elements) {
        if (element.type === 'text') {
            result.push(element.attrs["content"])
        } else if (element.type === 'at' && element.attrs["type"] === "here") {
            result.push(element.attrs["string"])
        }
    }

    return result.join("")
}


export function createSenderInfo(session: Session, config: Config) {
    let senderId = session.subtype === 'group' ? session.guildId : session.userId
    let senderName = session.subtype === 'group' ? session.guildName : session.username

    //检测是否为群聊，是否在隔离名单里面
    if (session.guildId && config.conversationIsolationGroup.includes(session.guildId)) {
        // 应用为自己发的id
        senderId = session.userId
        senderName = session.username
    }

    return {
        senderId: senderId,
        senderName: senderName
    }
}

export function checkBasicCanReply(ctx: Context, session: Session, config: Config) {
    // 禁止套娃
    if (ctx.bots[session.uid]) return false

    const needReply =
        //私聊
        session.subtype === "private" && config.allowPrivate ? true :
            //群艾特
            session.parsed.appel ? true :
                //bot名字
                session.content.includes(config.botName) && config.isNickname ? true :
                    //随机回复
                    Math.random() < config.randomReplyFrequency

    if (!needReply) {
        logger.debug(`[unreply] ${session.username}(${session.userId}): ${session.content}`)
    }

    return needReply
}

export async function checkCooldownTime(session: Session, config: Config): Promise<boolean> {
    const currentChatTime = Date.now()
    if (currentChatTime - lastChatTime < config.msgCooldown * 1000) {
        const waitTime = (config.msgCooldown * 1000 - (currentChatTime - lastChatTime)) / 1000
        logger.debug(`[冷却中:${waitTime}s] ${session.username}(${session.userId}): ${session.content}`)

        await replyMessage(session, `技能冷却中，请${waitTime}秒后再试`, config.isReplyWithAt)
        return false
    }
    lastChatTime = currentChatTime
    return true
}




