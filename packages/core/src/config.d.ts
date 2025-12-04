import { Awaitable, Computed, Schema } from 'koishi'
export interface Config {
    botNames: string[]
    isNickname: boolean
    isNickNameWithContent: boolean
    allowPrivate: boolean
    isForwardMsg: boolean
    forwardMsgMinLength: number
    allowChatWithRoomName: boolean
    msgCooldown: number
    randomReplyFrequency: Computed<Awaitable<number>>
    includeQuoteReply: boolean
    isLog: boolean
    isReplyWithAt: boolean
    allowQuoteReply: boolean
    proxyAddress: string
    isProxy: boolean
    outputMode: string
    sendThinkingMessage: boolean
    sendThinkingMessageTimeout: number
    showThoughtMessage: boolean
    splitMessage: boolean
    blackList: Computed<Awaitable<number>>
    censor: boolean
    autoDelete: boolean
    autoDeleteTimeout: number
    messageQueue: boolean
    messageQueueDelay: number
    infiniteContext: boolean
    rawOnCensor: boolean
    autoUpdateRoomMode: 'disable' | 'all' | 'manual'
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
    voiceSpeakId: number
    enableSimilarityCheck: boolean
}
export declare const Config: Schema<Config>
