import { Awaitable, Computed, Schema } from 'koishi'

export interface Config {
    botName: string
    isNickname: boolean
    allowPrivate: boolean
    isForwardMsg: boolean
    msgCooldown: number
    randomReplyFrequency: number
    messageCount: number
    isLog: boolean

    isReplyWithAt: boolean
    proxyAddress: string
    isProxy: boolean
    outputMode: string
    sendThinkingMessage: boolean
    sendThinkingMessageTimeout: number
    thinkingMessage: string
    splitMessage: boolean
    blackList: Computed<Awaitable<boolean>>
    blockText: string
    censor: boolean

    historyMode: string
    longMemory: boolean
    privateChatWithoutCommand: boolean
    allowAtReply: boolean
    streamResponse: boolean

    defaultEmbeddings: string
    defaultVectorStore: string

    defaultChatMode: string
    defaultModel: string
    defaultPreset: string
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        botName: Schema.string().description('bot 姓名').default('香草'),
        isNickname: Schema.boolean().description('允许 bot 配置中的昵称引发回复').default(true)
    }).description('bot 配置'),

    Schema.object({
        allowPrivate: Schema.boolean().description('允许私聊触发').default(true),
        allowAtReply: Schema.boolean().description('允许 at 回复').default(true),
        isReplyWithAt: Schema.boolean().description('回复时引用原消息').default(false),
        isForwardMsg: Schema.boolean().description('让消息以转发消息的形式发送').default(false),
        privateChatWithoutCommand: Schema.boolean()
            .description('私聊可不调用命令直接和 bot 聊天')
            .default(false),
        msgCooldown: Schema.number()
            .description('全局消息冷却时间，单位为秒，防止适配器调用过于频繁')
            .min(1)
            .max(3600)
            .step(1)
            .default(5),

        outputMode: Schema.union([
            Schema.const('raw').description('原始（直接输出，不做任何处理）'),
            Schema.const('text').description('文本（把回复当成 markdown 渲染）'),
            Schema.const('image').description('图片（需要 Puppeteer服务）'),
            Schema.const('voice').description('语音（需要 vits 服务）'),
            Schema.const('mixed-image').description('混合（图片和文本）'),
            Schema.const('mixed-voice').description('混合（语音和文本）')
        ])
            .default('text')
            .description('消息回复的渲染输出模式'),

        splitMessage: Schema.boolean()
            .description(
                '分割消息发送（看起来更像普通水友（并且会不支持引用消息，不支持原始模式和图片模式。开启流式响应后启用该项会进行更加进阶的分割消息））'
            )
            .default(false),

        censor: Schema.boolean().description('文本审核服务（需要安装censor服务').default(false),

        sendThinkingMessage: Schema.boolean()
            .description('发送等待消息，在请求时会发送这条消息')
            .default(true),

        sendThinkingMessageTimeout: Schema.number()
            .description('请求多少毫秒后未响应时发送等待消息')
            .default(15000),

        thinkingMessage: Schema.string()
            .description('等待消息内容')
            .default('我还在思考中，前面还有 {count} 条消息等着我回复呢，稍等一下哦~'),

        randomReplyFrequency: Schema.percent()
            .description('随机回复频率')
            .min(0)
            .max(1)
            .step(0.01)
            .default(0)
    }).description('回复选项'),
    Schema.object({
        longMemory: Schema.boolean()
            .description(
                '长期记忆（让模型能记住久远对话内容，需要提供向量数据库和 Embeddings 服务）'
            )
            .default(false),
        blackList: Schema.union([Schema.boolean(), Schema.any().hidden()])
            .role('computed')
            .description(
                '黑名单列表 (请只对需要拉黑的用户或群开启，其他（如默认）请不要打开，否则会导致全部聊天都会被拉黑无法响应））'
            )
            .default(false),
        blockText: Schema.string()
            .description('被拉黑用户的固定回复内容')
            .default('哎呀(ｷ｀ﾟДﾟ´)!!，你怎么被拉入黑名单了呢？要不你去问问我的主人吧。'),

        messageCount: Schema.number()
            .role('slider')
            .min(10)
            .max(100)
            .step(1)
            .default(40)
            .description(
                '最大消息数量（用于约束聊天历史下的消息数量，超出后会自动删除最久远的消息，不让数据库存储过多消息）'
            ),

        streamResponse: Schema.boolean()
            .description(
                '流式响应（会在响应时就开始发送消息，而不是等待完全响应后再发送。开启后渲染输出模式选项可能会无效）'
            )
            .default(false),

        historyMode: Schema.union([
            Schema.const('default').description('保存最近的对话'),
            Schema.const('summary').description('保存对话的摘要')
        ])
            .default('default')
            .description('聊天历史模式')
    }).description('对话选项'),

    Schema.object({
        defaultEmbeddings: Schema.dynamic('embeddings').description('默认使用的嵌入模型'),

        defaultVectorStore: Schema.dynamic('vector-store').description('默认使用的向量数据库')
    }).description('模型选项'),

    Schema.object({
        defaultChatMode: Schema.dynamic('chat-mode').default('chat').description('聊天模式'),
        defaultModel: Schema.dynamic('model').description('聊天模型'),
        defaultPreset: Schema.dynamic('preset').description('聊天预设')
    }).description('模板房间选项'),

    Schema.object({
        isProxy: Schema.boolean()
            .description('代理网络连接，开启后会为相关插件的网络服务使用代理')
            .default(false),

        isLog: Schema.boolean().description('调试模式').default(false)
    }).description('杂项'),

    Schema.union([
        Schema.object({
            isProxy: Schema.const(true).required(),
            proxyAddress: Schema.string()
                .description(
                    '网络请求的代理地址，填写后 ChatHub 相关插件的网络服务都将使用该代理地址。如不填写会尝试使用 Koishi 的全局配置里的代理设置'
                )
                .default('')
        }).description('代理设置'),
        Schema.object({})
    ])
]) as Schema<Config>
