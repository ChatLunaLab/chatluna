import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'
import { PlatformModelClient } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/client'
import { ChatHubChatModel } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/model'
import { ModelInfo, ModelType } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/types'
import { ModelRequestParams, ModelRequester } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api'
import { AIMessageChunk, ChatGenerationChunk } from 'langchain/dist/schema'


export function apply(ctx: Context, config: Config) {
    const plugin = new ChatHubPlugin<ClientConfig, Config>(ctx, config, "test",false)

    ctx.on("ready", async () => {

        await plugin.parseConfig(() => [{
            apiKey: "?",
            platform: "test",
            maxRetries: config.maxRetries,
            chatLimit: config.chatTimeLimit,
            concurrentMaxSize: config.chatConcurrentMaxSize,
            timeout: 0
        }])

        await plugin.registerClient((ctx, config) => {
            return new TestPlatformClient(ctx, config)
        })

        await plugin.registerToService()
    })
}


class TestPlatformClient extends PlatformModelClient {

    platform: string = "test"

    async init(): Promise<void> { }

    async getModels(): Promise<ModelInfo[]> {
        return [{
            name: "test",
            type: ModelType.llm
        }]
    }

    protected _createModel(model: string): ChatHubChatModel {
        return new ChatHubChatModel({
            model: model,
            modelMaxContextSize: 10000000000,
            requester: new TestModelRequester()
        })
    }

}


class TestModelRequester extends ModelRequester {

    async *completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk> {

        const messages = params.input

        console.log(`messages: ${JSON.stringify(messages)}`)

        const latestMessage = messages[messages.length - 1]

        const response = latestMessage.content.replaceAll("你", "我").replaceAll('?', '!').replaceAll("不", " ").replaceAll("吗", " ").replaceAll("有", "没有").replaceAll('？', '！')

        yield new ChatGenerationChunk({
            text: response,
            message: new AIMessageChunk(response)
        })
    }

    async init(): Promise<void> {
        
    }

    async dispose(): Promise<void> {
        
    }
}



export interface Config extends ChatHubPlugin.Config { }

export const Config = Schema.intersect([
    ChatHubPlugin.Config,
])


export const using = ['chathub']

export const name = "chathub-test-adapter"