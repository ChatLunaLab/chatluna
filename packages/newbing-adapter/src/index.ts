import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'


const logger = createLogger()

export function apply(ctx: Context, config: Config) {
    config.chatConcurrentMaxSize = 0
}



export interface Config extends ChatHubPlugin.Config {
    cookie: string,
    showExtraInfo: boolean,

    webSocketApiEndPoint: string,
    createConversationApiEndPoint: string,

    sydney: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,

    Schema.object({
        cookie: Schema.string().role('secret').description('Bing 账号的 Cookie').default(""),
        webSocketApiEndPoint: Schema.string().description('New Bing 的WebSocket Api EndPoint').default("wss://sydney.bing.com/sydney/ChatHub"),
        createConversationApiEndPoint: Schema.string().description('New Bing 的新建会话 Api EndPoint').default("https://edgeservices.bing.com/edgesvc/turing/conversation/create"),
    }).description('请求设置'),


    Schema.object({
        sydney: Schema.boolean().description('是否开启 Sydeny 模式（破解对话20次回复数限制，账号可能会有风险）').default(false),

        showExtraInfo: Schema.boolean().description('是否显示额外信息（如剩余回复数，猜你想问）').default(false),

    }).description('对话设置'),


])


export const using = ['chathub']


export const name = "chathub-newbing-adapter"
