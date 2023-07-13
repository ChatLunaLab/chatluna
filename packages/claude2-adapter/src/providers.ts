import { ChatHubBaseChatModel, CreateParams, ModelProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'
import BingChatPlugin from '.'
import { Claude2ChatModel } from './model'
import { Claude2ChatClient } from './client'
import { Api } from './api'


export class Claude2ChatProvider extends ModelProvider {

    private _models = ['claude-2']

    private _api: Api

    name = "claude"
    description?: string = "claude2 provider, provide claude2 chat bot"

    constructor(private readonly config: BingChatPlugin.Config) {
        super()
        this._api = new Api(config)
    }

    async listModels(): Promise<string[]> {
        return this._models
    }

    async isSupported(modelName: string): Promise<boolean> {
        return (await this.listModels()).includes(modelName)
    }


    isSupportedChatMode(modelName: string, chatMode: string): Promise<boolean> {
        if (this.config.formatMessages === false) {
            return Promise.resolve(chatMode === "chat")
        }
        return this.isSupported(modelName)
    }

    async recommendModel(): Promise<string> {
        return this._models[0]
    }

    async createModel(modelName: string, params: CreateParams): Promise<ChatHubBaseChatModel> {
        if (!this._models.includes(modelName)) {
            throw new Error(`Can't find model ${modelName}`)
        }

        return new Claude2ChatModel({
            config: this.config,
            modelName,
            api: this._api
        })
    }

    getExtraInfo(): Record<string, any> {
        return this.config
    }
}