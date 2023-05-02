import { Context, h, Session } from 'koishi';
import { Config } from './config';
import { ChatOptions, Conversation, ConversationConfig, ConversationId, InjectData, RenderMessage, RenderOptions, SenderInfo, SimpleMessage, UUID } from './types';
import { Cache, ChatLimit } from './cache';
import { createLogger } from './utils/logger';
import { DefaultRenderer } from './render';
import type { } from "@koishijs/censor"
import { formatPresetTemplate, formatPresetTemplateString, Preset, PresetTemplate } from './preset';

const logger = createLogger('@dingyi222666/chathub/chat')

let lastChatTime = 0
let globalConfig: Config

export class Chat {
    private senderIdToChatSessionId: Record<string, ConversationId[]> = {}

    private conversationIdCache: Cache<'chathub/conversationIds', ConversationId[]>

    private chatLimitCache: Cache<'chathub/chatTimeLimit', ChatLimit>

    private keyCache: Cache<'chathub/keys', string>

    private renderer: DefaultRenderer

    private preset: Preset

    constructor(public readonly context: Context, public readonly config: Config) {
        this.conversationIdCache = new Cache(context, config, 'chathub/conversationIds')
        this.chatLimitCache = new Cache(context, config, 'chathub/chatTimeLimit')
        this.keyCache = new Cache(context, config, 'chathub/keys')

        this.preset = new Preset(context, config, this.keyCache)
        this.renderer = new DefaultRenderer(context, config)
        globalConfig = config
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

    private async setConversationId(senderId: string, conversationId: UUID, conversationConfig: ConversationConfig, oldConversationId?: UUID) {
        const sessions = await this.getConversationIds(senderId)

        const conversationAdapterLabel = conversationConfig.adapterLabel

        const conversationIdInMemory = sessions.find((session) => session.adapterLabel === conversationAdapterLabel || session.id === oldConversationId) ?? {
            id: conversationId,
            adapterLabel: conversationAdapterLabel
        }

        conversationIdInMemory.adapterLabel = conversationAdapterLabel
        conversationIdInMemory.id = conversationId
        sessions.push(conversationIdInMemory)
        await this.conversationIdCache.set(senderId, sessions)
    }

    private async injectData(message: string, config: Config): Promise<InjectData[] | null> {

        if (this.context.llminject == null || config.injectData === false) {
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
        let conversationId = this.selectConversationId(conversationIds, conversationConfig.adapterLabel === "empty" ? null : conversationConfig.adapterLabel)

        if (conversationId == null) {
            // 现在就选择一个adapter，不然下次可能会换别的
            if (conversationConfig.adapterLabel === "empty" || conversationConfig.adapterLabel == null) {
                //设置为null，不然会按照label去选择adapter
                conversationConfig.adapterLabel = null
                const adapter = this.context.llmchat.selectAdapter(conversationConfig)
                conversationConfig.adapterLabel = adapter.label
            }

            conversation = await chatService.createConversation(conversationConfig)

        } else {
            conversation = await chatService.queryConversation(conversationId.id)

            if (conversation == null) {
                //如果没找到，就重新创建一个
                conversation = await chatService.createConversation(conversationConfig)
            }

            await this.setConversationId(senderId, conversation.id, conversationConfig, conversationId.id)
        }


        return conversation
    }


    // 把答辩移到这边了。。。
    async chat(chatOptions: ChatOptions): Promise<boolean> {
        const { ctx, session, config } = chatOptions

        if (!checkBasicCanReply(ctx, session, config)) return false

        if (!(await checkCooldownTime(ctx, session, config))) return false

        if (await checkInBlackList(ctx, session, config) === true) return false

        // 检测输入是否能聊起来
        let input = readChatMessage(session)

        logger.debug(`[chat-input] ${session.userId}(${session.username}): ${input}`)

        if (input.trim() === '') return false

        const senderInfo = createSenderInfo(session, config)
        const { senderId, senderName } = senderInfo

        const conversationConfig = chatOptions?.model?.conversationConfig ??
            await this.createConversationConfig("empty")

        const chatLimitResult = await this.withChatLimit(async (conversationConfig) => {

            logger.debug(`[chat] ${senderName}(${senderId}): ${input}`)

            try {
                return await this.chatWithModel(input, config, senderId, senderName, chatOptions?.model?.needInjectData,
                    conversationConfig, chatOptions.render ?? this.renderer.defaultOptions)
            } catch (e) {
                logger.error(e)
            }

            return null
        }, session, senderInfo, conversationConfig)

        if (chatLimitResult == null) {
            logger.debug(`[chat-limit/error] ${senderName}(${senderId}): ${input}`)
            return false
        }


        await runPromiseByQueue(chatLimitResult.map(async (result) => {
            await replyMessage(ctx, session, result.element)
        }))

        return true
    }

    private async chatWithModel(message: string, config: Config, senderId: string, senderName: string, needInjectData: boolean = false, conversationConfig: ConversationConfig, renderOptions: RenderOptions): Promise<RenderMessage[]> {

        const conversation = await this.resolveConversation(senderId, conversationConfig)
        await this.setConversationId(senderId, conversation.id, conversationConfig)

        await this.measureTime(async () => {
            await conversation.init(conversationConfig)
        }, (time) => {
            logger.debug(`init conversation ${conversation.id} cost ${time}ms`)
        })


        let injectData: InjectData[] | null = null
        if ((config.injectData && conversation.supportInject && checkCanInjectData(message)) ||
            needInjectData || (config.injectData && config.injectDataEnenhance)) {
            injectData = await this.measureTime(() => this.injectData(message, config), (time) => {
                logger.debug(`inject data cost ${time}ms`)
            })

            if (injectData?.length === 0) {
                injectData = null
            }
        }

        message = conversationConfig.formatUserPrompt != null ?
            formatPresetTemplateString(conversationConfig.formatUserPrompt, {
                prompt: message,
                sender: senderName
            }) : message

        const response = await this.measureTime(() => conversation.ask({
            role: 'user',
            content: message,
            inject: injectData,
            sender: senderName
        }), (time) => {
            logger.debug(`chat cost ${time}ms`)
        })

        logger.debug(`chat result: ${response.content}`)

        return this.renderer.render(response, renderOptions)
    }

    async clearAll(senderId: string) {
        const chatService = this.context.llmchat

        const conversationIds = await this.getConversationIds(senderId)

        if (conversationIds == null) {
            //没创建就算了
            return
        }

        for (const conversationId of conversationIds) {
            const conversation = await chatService.queryConversation(conversationId.id)
            await conversation.clear()
        }
    }

    async clear(senderId: string, adapterLabel?: string) {

        const conversation = await this.selectConversation(senderId, adapterLabel)

        if (conversation == null) {
            //没创建就算了
            return
        }

        const size = Object.keys(conversation.messages).length


        // conversation.config = createConversationConfigWithLabelAndPrompts(this.config, adapterLabel, [this.config.botIdentity])
        await conversation.clear()

        return size
    }

    async setBotPreset(senderId: string, presetKeyword?: string, adapterLabel?: string) {

        if (presetKeyword == null) {
            await this.preset.resetDefaultPreset()
            presetKeyword = "猫娘"
        }

        const conversation = await this.resolveConversation(senderId, await this.createConversationConfig(adapterLabel, presetKeyword))

        await conversation.clear()

        conversation.config = await this.createConversationConfig(adapterLabel, presetKeyword)

        return conversation.config
    }


    async withChatLimit<T>(fn: (conversation: ConversationConfig) => Promise<T>, session: Session, senderInfo: SenderInfo, conversationConfig: ConversationConfig): Promise<T> {

        const { senderId, userId } = senderInfo

        const conversation = await this.resolveConversation(senderId, conversationConfig)
        const chatLimitRaw = conversation.getAdapter().config.chatTimeLimit
        const chatLimitComputed = await session.resolve(chatLimitRaw)

        let chatLimitOnDataBase = await this.chatLimitCache.get(conversation.id + "-" + userId)

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
                    await session.send(`你的聊天次数已经用完了喵，还需要等待${time}分钟才能继续聊天喵 >_<`)

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
        await this.chatLimitCache.set(conversation.id + "-" + userId, chatLimitOnDataBase)

        let thinkingTimeoutObj: { timeout?: NodeJS.Timeout, recallFunc?: () => PromiseLike<void> } = null
        if (this.config.sendThinkingMessage) {
            thinkingTimeoutObj = {}
            thinkingTimeoutObj.timeout = setTimeout(async () => {
                thinkingTimeoutObj.recallFunc = (await replyMessage(this.context, session, buildTextElement(this.config.thinkingMessage))).recall

            }, this.config.sendThinkingMessageTimeout)
        }

        const runResult = await fn(conversationConfig)

        if (thinkingTimeoutObj != null) {
            clearTimeout(thinkingTimeoutObj.timeout)
            if (thinkingTimeoutObj.recallFunc) {
                await thinkingTimeoutObj.recallFunc()
            }
        }

        if (runResult != null) {
            chatLimitOnDataBase.count++
            await this.chatLimitCache.set(conversation.id + "-" + senderId, chatLimitOnDataBase)
            return runResult
        }

        return null

    }


    getAllPresets() {
        return this.preset.getAllPreset()
    }

    private async selectConversation(senderId: string, adapterLabel?: string): Promise<Conversation> {
        const chatService = this.context.llmchat


        const conversationIds = await this.getConversationIds(senderId)

        if (conversationIds == null) {
            //没创建就算了
            return
        }

        const conversationId = this.selectConversationId(conversationIds, adapterLabel)

        if (conversationId == null) {
            return
        }

        return await chatService.queryConversation(conversationId.id)
    }

    private selectConversationId(conversationIds: ConversationId[], adapterLabel?: string): ConversationId {
        if (adapterLabel == null) {
            adapterLabel = this.context.llmchat.selectAdapter({}).label
        }

        return conversationIds.find((conversationId) => conversationId.adapterLabel === adapterLabel)
    }


    private async createInitialPrompts(presetKeyword?: string): Promise<[SimpleMessage[], PresetTemplate]> {
        const defaultPreset = await (presetKeyword != null ? this.preset.getPreset(presetKeyword) : this.preset.getDefaultPreset())

        return [formatPresetTemplate(defaultPreset, {
            "name": this.config.botName,
            "date": new Date().toLocaleDateString()
        }), defaultPreset]
    }

    async createConversationConfig(label?: string,
        presetKeyword?: string): Promise<ConversationConfig> {

        const [initialPrompts, presetTemplate] = await this.createInitialPrompts(presetKeyword)
        return {
            initialPrompts: initialPrompts,
            inject: (this.config.injectDataEnenhance && this.config.injectData) ? 'enhanced' : this.config.injectData ? 'default' : 'none',
            adapterLabel: label,
            formatUserPrompt: presetTemplate.formatUserPromptString ?? "{prompt}",
            personalityId: presetTemplate.triggerKeyword[0]
        }
    }


}



function checkCanInjectData(message: string): boolean {

    // https://github.com/LlmKira/Openaibot/blob/5e83f35abe80e18b3b7fa0fa72deccb3b14da80f/utils/Detect.py#L67
    const queryKeyword = ["怎么", "How",
        "什么", "作用", "知道", "吗？", "什么", "认识", "What", "bilibili", "http",
        "what", "who", "how", "Who",
        "Why", "的作品", "why", "Where",
        "了解", "简述一下", "How to", "how to",
        "解释", "怎样的", "新闻", "ニュース", "电影", "番剧", "アニメ",
        "2022", "2023", "请教", "介绍", "怎样", "吗", "么", "？", "?", "呢",
        "天气", "时间"
    ]

    // 长消息关闭搜索
    if (message.length > 100) {
        return false
    }

    for (const keyword of queryKeyword) {
        if (message.includes(keyword)) {
            return true
        }
    }
    return false
}

export async function replyMessage(
    ctx: Context,
    session: Session,
    message: h | h[],
    isReplyWithAt: boolean = true,
) {

    logger.debug(`reply message: ${message}`)

    let messageFragment: h[]

    if (isReplyWithAt && session.subtype === "group") {
        messageFragment = [
            h('quote', { id: session.messageId })
        ]

        if (message instanceof Array) {
            messageFragment = messageFragment.concat(message)
        } else {
            messageFragment.push(message)
        }

        for (const element of messageFragment) {
            // 语音,消息 不能引用
            if (element.type === "audio" || element.type === "message") {
                messageFragment.shift()
                break
            }
        }

    } else {
        if (message instanceof Array) {
            messageFragment = message
        } else {
            messageFragment = [message]
        }
    }

    if (ctx.censor != null && globalConfig?.censor === true) {
        messageFragment = await ctx.censor.transform(messageFragment, session)
    }

    const messageIds = await session.send(
        messageFragment
    );

    return {
        recall: async () => {
            try {
                await session.bot.deleteMessage(session.channelId, messageIds[0])
            } catch (e) {
                logger.error(e)
            }
        }
    }

};

export function readChatMessage(session: Session) {
    // 要求
    // 过滤xml，转换艾特为实际昵称，过滤图片等
    const result = []

    for (const element of session.elements) {
        if (element.type === 'text') {
            result.push(element.attrs["content"])
        } else if (element.type === 'at') {
            result.push("@" + element.attrs["id"])
        }
    }

    return result.join("")
}


export function createSenderInfo(session: Session, config: Config = globalConfig): SenderInfo {
    let senderId = session.subtype === 'group' ? session.guildId : session.userId
    let senderName = session.subtype === 'group' ? (session.guildName ?? session.username) : session.username

    //检测是否为群聊，是否在隔离名单里面
    if (session.guildId && config.conversationIsolationGroup.includes(session.guildId)) {
        // 应用为自己发的id
        senderId = session.userId
        senderName = session.username
    }

    return {
        senderId: senderId,
        senderName: senderName,
        userId: session.userId,
    }
}

export function checkBasicCanReply(ctx: Context, session: Session, config: Config = globalConfig) {
    // 禁止套娃
    if (ctx.bots[session.uid]) return false

    const needReply =
        //私聊
        (session.subtype === "private" && config.allowPrivate) ? true :
            //群艾特
            session.parsed.appel ? true :
                //bot名字
                session.content.includes(config.botName) && config.isNickname ? true :
                    //随机回复
                    Math.random() < config.randomReplyFrequency

    /*   if (!needReply) {
          logger.debug(`[unreply] ${session.username}(${session.userId}): ${session.content}`)
      } */

    return needReply
}

export async function checkCooldownTime(ctx: Context, session: Session, config: Config = globalConfig): Promise<boolean> {
    const currentChatTime = Date.now()
    if (currentChatTime - lastChatTime < config.msgCooldown * 1000) {
        const waitTime = (config.msgCooldown * 1000 - (currentChatTime - lastChatTime)) / 1000
        logger.debug(`[冷却中:${waitTime}s] ${session.username}(${session.userId}): ${session.content}`)

        await replyMessage(ctx, session, buildTextElement(`不要发这么快喵，等${waitTime}s后我们在聊天喵`), false)
        return false
    }
    lastChatTime = currentChatTime
    return true
}

export function buildTextElement(text: string) {
    return h.text(text)
}

export async function runPromiseByQueue(myPromises: Promise<any>[]) {
    for (const promise of myPromises) {
        await promise
    }
}

// 这个函数的调用非常的丑陋，我cv了十多处
// v1需要重构，这个函数会变成中间件的形式
export async function checkInBlackList(ctx: Context, session: Session, config: Config = globalConfig) {
    const resolved = await session.resolve(config.blackList)

    if (resolved === true) {
        logger.debug(`[黑名单] ${session.username}(${session.userId}): ${session.content}`)
        await replyMessage(ctx, session, buildTextElement(globalConfig.blockText), true)
        return true
    }

    return resolved
}