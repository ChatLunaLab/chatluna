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
    showThoughtMessage: boolean
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

    autoCreateRoomFromUser: boolean

    authUserDefaultGroup: Computed<Awaitable<[number, number, string]>>
    authSystem: boolean

    errorTemplate: string
    voiceSpeakId: number

    longMemorySimilarity: number
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        botName: Schema.string().description('bot 姓名').default('香草'),
        isNickname: Schema.boolean()
            .description('允许 bot 配置中的昵称引发对话')
            .default(true)
    }).description('bot 配置'),

    Schema.object({
        allowPrivate: Schema.boolean()
            .description('允许私聊触发')
            .default(true),
        allowAtReply: Schema.boolean()
            .description('允许 at 对话')
            .default(true),
        isReplyWithAt: Schema.boolean()
            .description('bot 回复时引用原消息')
            .default(false),
        isForwardMsg: Schema.boolean()
            .description('让消息以转发消息的形式发送')
            .default(false),
        privateChatWithoutCommand: Schema.boolean()
            .description('私聊可不调用命令直接和 bot 对话')
            .default(true),
        msgCooldown: Schema.number()
            .description('全局消息冷却时间，单位为秒，防止适配器调用过于频繁')
            .min(0)
            .max(3600)
            .step(1)
            .default(0),

        outputMode: Schema.union([
            Schema.const('raw').description('原始（直接输出，不做任何处理）'),
            Schema.const('text').description(
                '文本（把回复当成 markdown 渲染）'
            ),
            Schema.const('image').description('图片（需要 puppeteer服务）'),
            Schema.const('voice').description('语音（需要 vits 服务）'),
            Schema.const('mixed-image').description('混合（图片和文本）'),
            Schema.const('mixed-voice').description('混合（语音和文本）')
        ])
            .default('text')
            .description('消息回复的渲染输出模式'),

        splitMessage: Schema.boolean()
            .description(
                '分割消息发送（看起来更像普通水友（并且会不支持引用消息，不支持原始模式和图片模式。开启流式响应后启用该项会进行更细化的分割消息））'
            )
            .default(false),

        censor: Schema.boolean()
            .description('文本审核服务（需要安装 censor 服务）')
            .default(false),

        sendThinkingMessage: Schema.boolean()
            .description('发送等待消息，在请求时会发送这条消息')
            .default(true),

        sendThinkingMessageTimeout: Schema.number()
            .description('请求多少毫秒后模型未响应时发送等待消息')
            .default(15000),

        thinkingMessage: Schema.string()
            .description('等待消息内容')
            .default(
                '我还在思考中，前面还有 {count} 条消息等着我回复呢，稍等一下哦~'
            ),

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
        longMemorySimilarity: Schema.percent()
            .description('长期记忆相似度阈值')
            .min(0)
            .max(1)
            .step(0.01)
            .default(0.3),

        blackList: Schema.union([Schema.boolean(), Schema.any().hidden()])
            .role('computed')
            .description(
                '黑名单列表 (请只对需要拉黑的用户或群开启，其他（如默认）请不要打开，否则会导致全部聊天都会被拉黑无法响应））'
            )
            .default(false),
        blockText: Schema.string()
            .description('被拉黑用户的固定回复内容')
            .default(
                '哎呀(ｷ｀ﾟДﾟ´)!!，你怎么被拉入黑名单了呢？要不你去问问我的主人吧。'
            ),

        messageCount: Schema.number()
            .role('slider')
            .min(2)
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
        showThoughtMessage: Schema.boolean()
            .description('使用插件模式时显示思考过程')
            .default(false),

        historyMode: Schema.union([
            Schema.const('default').description('保存最近的对话'),
            Schema.const('summary').description('保存对话的摘要')
        ])
            .default('default')
            .description('聊天历史模式')
    }).description('对话选项'),

    Schema.object({
        defaultEmbeddings: Schema.dynamic('embeddings')
            .description('默认使用的嵌入模型')
            .default('无'),

        defaultVectorStore: Schema.dynamic('vector-store')
            .description('默认使用的向量数据库')
            .default('无')
    }).description('模型选项'),

    Schema.object({
        autoCreateRoomFromUser: Schema.boolean()
            .description('默认为每个用户创建自己的房间')
            .default(false),
        defaultChatMode: Schema.dynamic('chat-mode')
            .default('chat')
            .description('聊天模式'),
        defaultModel: Schema.dynamic('model')
            .description('聊天模型')
            .default('无'),
        defaultPreset: Schema.dynamic('preset')
            .description('聊天预设')
            .default('chatgpt')
    }).description('模板房间选项'),

    Schema.object({
        authSystem: Schema.boolean()
            .description(
                '配额组，用户权限系统（实验性功能，启用后针对各适配器设置的调用限额将会无效）'
            )
            .default(false),
        isProxy: Schema.boolean()
            .description(
                '是否启用全局代理，开启后会为 ChatLuna 全家桶插件的网络请求使用代理'
            )
            .default(false),
        errorTemplate: Schema.string()
            .description(
                '错误提示消息模板（该设置可能会在未来的版本中出现更改）'
            )
            .default(
                '使用 ChatLuna 时出现错误，错误码为 %s。请联系开发者以解决此问题。'
            ),

        voiceSpeakId: Schema.number()
            .description('使用 vits 时的默认 ID')
            .default(0),

        isLog: Schema.boolean().description('调试模式').default(false)
    }).description('杂项'),
    Schema.union([
        Schema.object({
            isProxy: Schema.const(true).required(),
            proxyAddress: Schema.string()
                .description(
                    '网络请求的代理地址，填写后 ChatLuna 相关插件的网络服务都将使用该代理地址。如不填写会尝试使用 Koishi 的全局配置里的代理设置'
                )
                .default('')
        }).description('代理设置'),
        Schema.object({})
    ]),

    Schema.union([
        Schema.object({
            authSystem: Schema.const(true).required(),
            authUserDefaultGroup: Schema.union([
                Schema.tuple([
                    Schema.number().default(0),
                    Schema.number().default(1.0),
                    Schema.string().default('guest')
                ]),
                Schema.any().hidden()
            ])
                .role('computed')
                .description(
                    '默认新建用户加入的授权组（左边填写权限等级，0 为 guest，1 为 user，2 为 admin，中间为初始化的余额，右边填写授权组名字，如不懂不要配置）'
                )
                .default([0, 1.0, 'guest'])
        }).description('配额组设置'),
        Schema.object({})
    ])
]) as Schema<Config>
