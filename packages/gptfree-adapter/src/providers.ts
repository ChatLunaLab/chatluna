import OpenAIPlugin from '.';
import { ChatHubBaseChatModel, CreateParams, EmbeddingsProvider, ModelProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'
import { Api } from './api';
import { GPTFreeChatModel } from './models';
import { BaseChatModel } from 'langchain/chat_models/base';
import { Embeddings } from 'langchain/embeddings/base';
import GPTFreePlugin from '.';



export class GPTFreeModelProvider extends ModelProvider {

    private _models: string[] | null = null

    private _API: Api | null = null

    name = "gptfree"
    description?: string = "gptfree model provider, provide gpt models by backend: https://github.com/xiangsx/gpt4free-ts"

    constructor(private readonly config: GPTFreePlugin.Config) {
        super()
        this._API = new Api(config)
    }

    async listModels(): Promise<string[]> {
        if (this._models) {
            return this._models
        }

        this._models = await this._API.listModels()

        return this._models
    }

    async isSupported(modelName: string): Promise<boolean> {
        return (await this.listModels()).includes(modelName)
    }

    isSupportedChatMode(modelName: string, chatMode: string): Promise<boolean> {
        return this.isSupported(modelName)
    }

    async recommendModel(): Promise<string> {
        const models =  await this.listModels()
        
        return models[0]
    }


    async createModel(modelName: string, params: CreateParams): Promise<ChatHubBaseChatModel> {
        const hasModel = (await this.listModels()).includes(modelName)

        if (!hasModel) {
            throw new Error(`Can't find model ${modelName}`)
        }

        return new GPTFreeChatModel(modelName, this.config, params)
    }

    getExtraInfo(): Record<string, any> {
        return this.config
    }
}
