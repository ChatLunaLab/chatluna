import { ChatHubBaseChatModel, CreateParams, ModelProvider } from '@dingyi222666/chathub-llm-core/lib/model/base'
import { BingConversationStyle } from './types'
import BingChatPlugin from '.'
import { BingChatModel } from './model'


export class BingChatProvider extends ModelProvider {

    private _models = Object.values(BingConversationStyle)

    name = "bing"
    description?: string = "bing chat provider, provide bing chat"

    constructor(private readonly config: BingChatPlugin.Config) {
        super()
    }

    async listModels(): Promise<string[]> {
        return this._models
    }

    async isSupported(modelName: string): Promise<boolean> {
        return (await this.listModels()).includes(modelName)
    }

    async isSupportedChatMode(modelName: string, chatMode: string): Promise<boolean> {
        const supported = (await this.isSupported(modelName))

        if (!supported)
            return false

        if (chatMode !== "chat" && this.config.sydney !== true) {
            return false
        }

        return chatMode === "chat"
    }

    async recommendModel(): Promise<string> {
        return this._models[0]
    }


    async createModel(modelName: string, params: CreateParams): Promise<ChatHubBaseChatModel> {
        if (!this._models.includes(modelName as BingConversationStyle)) {
            throw new Error(`Can't find model ${modelName}`)
        }

        return new BingChatModel(this.config, modelName as BingConversationStyle)
    }

    getExtraInfo(): Record<string, any> {
        return this.config
    }
}