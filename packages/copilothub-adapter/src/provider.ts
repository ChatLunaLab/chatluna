import OpenAIPlugin from '.';
import { ChatHubBaseChatModel, CreateParams, ModelProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'
import { Api } from './api';

import { BaseChatModel } from 'langchain/chat_models/base';
import { CopilotHubChatModel } from './model';



export class CopilotHubProvider extends ModelProvider {

    private _models: string[] = ['copilothub']

    private _API: Api | null = null

    name = "copilothub"
    description?: string = "CopilotHub bot provider, provide copilot hub bot"

    constructor(private readonly config: OpenAIPlugin.Config) {
        super()
        this._API = new Api(config)
    }

    async listModels(): Promise<string[]> {
        // unable to check api key, return const value
        return this._models
    }

    async isSupported(modelName: string): Promise<boolean> {
        return (await this.listModels()).includes(modelName)
    }

    isSupportedChatMode(modelName: string, chatMode: string): Promise<boolean> {
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
        return new CopilotHubChatModel(this.config, params)
    }

    getExtraInfo(): Record<string, any> {
        return this.config
    }
}