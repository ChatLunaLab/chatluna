import OpenAIPlugin from '.';
import { ChatHubBaseChatModel, CreateParams, EmbeddingsProvider, ModelProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'
import { Api } from './api';
import { RWKVChatModel, RWKVEmbeddings } from './models';
import { Embeddings } from 'langchain/embeddings/base';
import RWKVPlugin from '.';



export class RWKVModelProvider extends ModelProvider {

    private _models: string[] | null = null

    private _API: Api | null = null

    name = "rwkv"
    description?: string = "RWKV model provider, provide RWKV models by backend: https://github.com/josStorer/RWKV-Runner"

    constructor(private readonly config: RWKVPlugin.Config) {
        super()
        this._API = new Api(config)
        this._models = [config.chatModel]
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
        const models = await this.listModels()

        return models[0]
    }


    async createModel(modelName: string, params: CreateParams): Promise<ChatHubBaseChatModel> {
        const hasModel = (await this.listModels()).includes(modelName)

        if (!hasModel) {
            throw new Error(`Can't find model ${modelName}`)
        }

        return new RWKVChatModel(modelName, this.config, params)
    }

    getExtraInfo(): Record<string, any> {
        return this.config
    }
}

export class RWKVEmbeddingsProvider extends EmbeddingsProvider {



    private _models: string[] | null = null

    name = "rwkv"
    description?: string = "rwkv embeddings provider"

    constructor(private readonly config: OpenAIPlugin.Config) {
        super()
        this._models = ['rwkv']
    }

    async createEmbeddings(modelName: string, params: CreateParams): Promise<Embeddings> {
        return new RWKVEmbeddings(this.config, {})
    }

    async listEmbeddings(): Promise<string[]> {
        if (this._models) {
            return this._models
        }
    }

    async isSupported(modelName: string): Promise<boolean> {
        return (await this.listEmbeddings()).includes(modelName)
    }


    getExtraInfo(): Record<string, any> {
        return this.config
    }
}