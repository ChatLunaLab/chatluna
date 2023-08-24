import OpenAIPlugin from '.';
import { ChatHubBaseChatModel, CreateParams, ModelProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'
import { Api } from './api';

import { BaseChatModel } from 'langchain/chat_models/base';
import { BardChatModel } from './model';



export class BardProvider extends ModelProvider {

    private _models = ['bard']

    private _client: Api | null = null

    name = "bard"
    description?: string = "bard provider, provide bard chat by google"

    constructor(private readonly config: OpenAIPlugin.Config) {
        super()
        this._client = new Api(config)
    }

    async listModels(): Promise<string[]> {
        return this._models
    }

    async isSupported(modelName: string): Promise<boolean> {
        return (await this.listModels()).includes(modelName)
    }

    async isSupportedChatMode(modelName: string, chatMode: string): Promise<boolean> {
        return (await this.isSupported(modelName)) && chatMode === "chat"
    }

    async recommendModel(): Promise<string> {
        return this._models[0]
    }


    async createModel(modelName: string, params: CreateParams): Promise<ChatHubBaseChatModel> {
        if (!this._models.includes(modelName)) {
            throw new Error(`Can't find model ${modelName}`)
        }

        return new BardChatModel(this.config, this._client)
    }

    getExtraInfo(): Record<string, any> {
        return this.config
    }
}