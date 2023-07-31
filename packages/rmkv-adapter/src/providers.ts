import OpenAIPlugin from '.';
import { ChatHubBaseChatModel, CreateParams, EmbeddingsProvider, ModelProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'
import { Api } from './api';
import {  RMKVChatModel,  RMKVEmbeddings } from './models';
import { Embeddings } from 'langchain/embeddings/base';
import RMKVPlugin from '.';



export class RMKVModelProvider extends ModelProvider {

    private _models: string[] | null = null

    private _API: Api | null = null

    name = "rmkv"
    description?: string = "RMKV model provider, provide RMKV models by backend: https://github.com/josStorer/RWKV-Runner"

    constructor(private readonly config: RMKVPlugin.Config) {
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

        return new RMKVChatModel(modelName, this.config, params)
    }

    getExtraInfo(): Record<string, any> {
        return this.config
    }
}

export class RMKVEmbeddingsProvider extends EmbeddingsProvider {



    private _models: string[] | null = null

    name = "rmkv"
    description?: string = "rmkv embeddings provider"

    constructor(private readonly config: OpenAIPlugin.Config) {
        super()
        this._models = ['rmkv']
    }

    async createEmbeddings(modelName: string, params: CreateParams): Promise<Embeddings> {
        return new RMKVEmbeddings(this.config, {})
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