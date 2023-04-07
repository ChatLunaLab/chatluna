import { Context, Fragment, Logger, Next, Session, h } from 'koishi';
import { Config } from './config';
import { Conversation, ConversationConfig, InjectData, UUID } from './types';
import { lookup } from 'dns';
import { ConversationIdCache } from './cache';

const logger = new Logger('@dingyi222666/koishi-plugin-chathub/chat')

let lastChatTime = 0

export class Chat {

    private senderIdToChatSessionId: Record<string, UUID> = {}

    private conversationIdCache: ConversationIdCache

    constructor(public context: Context, public config: Config) {
        this.conversationIdCache = new ConversationIdCache(context, config)
    }

    async measureTime(fn: () => Promise<void>) {
        const start = Date.now()
        await fn()
        const end = Date.now()
        return end - start
    }

    private async getConversationId(senderId: string): Promise<UUID | null> {
        const conversationId = senderId in this.senderIdToChatSessionId ? this.senderIdToChatSessionId[senderId] : await this.conversationIdCache.get(senderId)

        if (conversationId) {
            return conversationId
        }

        return null
    }

    private async setConversationId(senderId: string, conversationId: UUID) {
        this.senderIdToChatSessionId[senderId] = conversationId
        await this.conversationIdCache.set(senderId, conversationId)
    }

    private async injectData(message: string, config: Config): Promise<InjectData[] | null> {

        if (this.context.llminject == null || config.injectData == false) {
            return null
        }

        //分词？算了先直接搜就好了

        const llmInjectService = this.context.llminject

        return llmInjectService.search(message)
    }

    async chat(message: string, config: Config, senderId: string, senderName: string, conversationConfig: ConversationConfig): Promise<Fragment> {
        const chatService = this.context.llmchat

        let conversation: Conversation
        let conversationId = await this.getConversationId(senderId)

        if (conversationId === null) {
            conversation = await chatService.createConversation(conversationConfig)
            conversationId = conversation.id
        } else {
            conversation = await chatService.queryConversation(conversationId)
        }

        await this.setConversationId(senderId, conversationId)

        await conversation.init(conversationConfig)

        const result = await conversation.ask({
            role: 'user',
            content: message,
            inject: await this.injectData(message, config),
            sender: senderName
        })

        logger.info(`chat result: ${result.content}`)

        return result.content
    }
}

export function createConversationConfig(config: Config): ConversationConfig {
    return {
        initialPrompts: {
            role: 'system',
            content: config.botIdentity.replace(/{name}/gi, config.botName)
        },

        inject: config.injectData
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
        inject: config.injectData,
        adapterLabel: label
    }
}

export async function replyMessage(
    session: Session,
    message: string,
    isReplyWithAt: boolean = true
) {

    logger.info(`reply message: ${message}`)

    await session.send(
        isReplyWithAt && session.subtype === "group"
            ? h("at", { id: session.userId }) + message
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
                session.content.includes(config.botName) ? true :
                    //随机回复
                    Math.random() < config.randomReplyFrequency

    if (!needReply) {
        logger.info(`[unreply] ${session.username}(${session.userId}): ${session.content}`)
    }

    return needReply
}

export async function checkCooldownTime(session: Session, config: Config): Promise<boolean> {
    const currentChatTime = Date.now()
    if (currentChatTime - lastChatTime < config.msgCooldown * 1000) {
        const waitTime = (config.msgCooldown * 1000 - (currentChatTime - lastChatTime)) / 1000
        logger.info(`[冷却中:${waitTime}s] ${session.username}(${session.userId}): ${session.content}`)

        await replyMessage(session, `技能冷却中，请${waitTime}秒后再试`, config.isReplyWithAt)
        return false
    }
    lastChatTime = currentChatTime
    return true
}




