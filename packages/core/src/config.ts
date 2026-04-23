import { Awaitable, Computed, Schema, Time } from 'koishi'

export interface Config {
    botNames: string[]
    isNickname: boolean
    isNickNameWithContent: boolean
    allowPrivate: boolean
    isForwardMsg: boolean
    forwardMsgMinLength: number
    msgCooldown: number
    randomReplyFrequency: Computed<Awaitable<number>>
    includeQuoteReply: boolean
    attachForwardMsgIdToContext: boolean
    isLog: boolean

    isReplyWithAt: boolean
    replyQuoteThreshold?: number
    allowQuoteReply: boolean
    proxyAddress?: string
    isProxy: boolean
    outputMode: string
    sendThinkingMessage: boolean
    sendThinkingMessageTimeout: number
    showThoughtMessage: boolean
    splitMessage: boolean
    blackList: Computed<Awaitable<number>>
    censor: boolean
    autoArchive: boolean
    autoArchiveTimeout: number
    autoPurgeArchive: boolean
    autoPurgeArchiveTimeout: number
    messageQueue: boolean
    messageQueueDelay: number
    infiniteContext: boolean
    infiniteContextThreshold: number
    rawOnCensor: boolean
    defaultGroupRouteMode: 'shared' | 'personal'

    privateChatWithoutCommand: boolean
    allowAtReply: boolean
    streamResponse: boolean

    defaultEmbeddings: string
    defaultVectorStore: string
    defaultReranker: string

    defaultChatMode: string
    defaultModel: string
    defaultPreset: string

    voiceSpeakId: number

    enableSimilarityCheck: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        botNames: Schema.array(Schema.string()).default(['香草']),
        isNickname: Schema.boolean().default(true),
        isNickNameWithContent: Schema.boolean().default(false)
    }),

    Schema.object({
        allowPrivate: Schema.boolean().default(true),
        allowAtReply: Schema.boolean().default(true),
        allowQuoteReply: Schema.boolean().default(false),
        privateChatWithoutCommand: Schema.boolean().default(true),
        includeQuoteReply: Schema.boolean().default(true),
        randomReplyFrequency: Schema.percent()
            .min(0)
            .max(1)
            .step(0.01)
            .default(0)
            .computed(),
        attachForwardMsgIdToContext: Schema.boolean().default(false)
    }),

    Schema.intersect([
        Schema.object({
            isForwardMsg: Schema.boolean().default(false)
        }),
        Schema.union([
            Schema.object({
                isForwardMsg: Schema.const(true).required(),
                forwardMsgMinLength: Schema.number()
                    .min(0)
                    .max(400)
                    .step(1)
                    .default(0)
            }),
            Schema.object({})
        ])
    ]),

    Schema.intersect([
        Schema.object({
            isReplyWithAt: Schema.boolean().default(false)
        }),
        Schema.union([
            Schema.object({
                isReplyWithAt: Schema.const(true).required(),
                replyQuoteThreshold: Schema.number()
                    .min(0)
                    .max(600)
                    .step(1)
                    .default(0)
            }),
            Schema.object({})
        ])
    ]),

    Schema.object({
        sendThinkingMessage: Schema.boolean().default(true),
        sendThinkingMessageTimeout: Schema.number().default(15000),
        msgCooldown: Schema.number().min(0).max(3600).step(1).default(0),
        messageQueue: Schema.boolean().default(true),
        messageQueueDelay: Schema.number()
            .min(0)
            .max(60 * 30)
            .default(0),
        showThoughtMessage: Schema.boolean().default(false)
    }),

    Schema.object({
        outputMode: Schema.dynamic('output-mode').default('text'),
        splitMessage: Schema.boolean().default(false),
        censor: Schema.boolean().default(false),
        rawOnCensor: Schema.boolean().default(false),
        streamResponse: Schema.boolean().default(false)
    }),

    Schema.object({
        blackList: Schema.number()
            .min(0)
            .max(1)
            .step(1)
            .default(0)
            .computed()
            .default(0)
    }),

    Schema.object({
        infiniteContext: Schema.boolean().default(true),
        infiniteContextThreshold: Schema.percent()
            .min(0.5)
            .max(0.95)
            .step(0.01)
            .default(0.85),
        autoArchive: Schema.boolean().default(false),
        autoArchiveTimeout: Schema.number()
            .default((Time.day * 10) / Time.second)
            .min(Time.hour / Time.second),
        autoPurgeArchive: Schema.boolean().default(false),
        autoPurgeArchiveTimeout: Schema.number()
            .default((Time.day * 30) / Time.second)
            .min(Time.hour / Time.second)
    }),

    Schema.object({
        defaultEmbeddings: Schema.dynamic('embeddings').default('无'),
        defaultVectorStore: Schema.dynamic('vector-store').default('无'),
        defaultReranker: Schema.dynamic('reranker').default('无')
    }),

    Schema.object({
        defaultGroupRouteMode: Schema.union([
            Schema.const('shared'),
            Schema.const('personal')
        ]).default('shared'),
        defaultChatMode: Schema.dynamic('chat-mode').default('plugin'),
        defaultModel: Schema.dynamic('model').default('无'),
        defaultPreset: Schema.dynamic('preset').default('sydney')
    }),

    Schema.object({
        voiceSpeakId: Schema.number().default(0),
        isLog: Schema.boolean().default(false)
    }),

    Schema.intersect([
        Schema.object({
            isProxy: Schema.boolean().default(false)
        }),
        Schema.union([
            Schema.object({
                isProxy: Schema.const(true).required(),
                proxyAddress: Schema.string().default('http://127.0.0.1:7897')
            }),
            Schema.object({})
        ])
    ])
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema'),
    'en-US': require('./locales/en-US.schema')
}) as Schema<Config>
