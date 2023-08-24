import OpenAIPlugin from '.';
import { ChatHubBaseChatModel, CreateParams, ModelProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'
import { Api } from './api';

import { BaseChatModel } from 'langchain/chat_models/base';
import { PoeChatModel } from './model';
import PoePlugin from '.';


export class PoeProvider extends ModelProvider {

    private _models: string[] | null = null

    private _API: Api | null = null

    name = "poe"
    description?: string = "poe provider, provide poe chat bot"

    constructor(private readonly config: PoePlugin.Config) {
        super()
        this._API = new Api(config)
    }

    async listModels(): Promise<string[]> {
        // unable to check api key, return const value

        if (this._models != null) {
            return this._models
        }

        this._models = await this._API.listBots()

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
        const hasModel = (await this.listModels()).includes(modelName)

        if (!hasModel) {
            throw new Error(`Can't find model ${modelName}`)
        }

        params.client = this._API
        params.modelName = modelName
        return new PoeChatModel(this.config, params)
    }

    getExtraInfo(): Record<string, any> {
        return this.config
    }
}