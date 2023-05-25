import OpenAIPlugin from '.';
import { CreateParams, EmbeddingsProvider, ModelProvider } from '@dingyi222666/chathub-llm-core/lib/model/base'
import { Api } from './api';
import { OpenAIChatModel, OpenAIEmbeddings } from './models';
import { BaseChatModel } from 'langchain/chat_models/base';
import { Embeddings } from 'langchain/embeddings/base';



export class OpenAIModelProvider extends ModelProvider {

    private _models: string[] | null = null

    private _API: Api | null = null

    name = "openai"
    description?: string = "OpenAI model provider, provide gpt3.5/gpt4 model"

    constructor(private readonly config: OpenAIPlugin.Config) {
        super()
        this._API = new Api(config)
    }

    async listModels(): Promise<string[]> {
        if (this._models) {
            return this._models
        }

        this._models = (await this._API.listModels()).filter((id) => id.startsWith("gpt"))

        return this._models
    }

    async isSupported(modelName: string): Promise<boolean> {
        return (await this.listModels()).includes(modelName)
    }

    isSupportedChatMode(modelName: string, chatMode: string): Promise<boolean> {
        return this.isSupported(modelName)
    }

    async recommendModel(): Promise<string> {
        return (await this.listModels()).find((value) => value.includes("gpt3.5"))
    }


    async createModel(modelName: string, params: CreateParams): Promise<BaseChatModel> {
        const hasModel = (await this.listModels()).includes(modelName)

        if (!hasModel) {
            throw new Error(`Can't find model ${modelName}`)
        }

        return new OpenAIChatModel(modelName, this.config, params)
    }

    getExtraInfo(): Record<string, any> {
        return this.config
    }
}

export class OpenAIEmbeddingsProvider extends EmbeddingsProvider {

    private _API: Api | null = null


    private _models: string[] | null = null

    name = "openai"
    description?: string = "OpenAI embeddings provider, provide text-embedding-ada-002"

    constructor(private readonly config: OpenAIPlugin.Config) {
        super()
        this._API = new Api(config)
    }

    async createEmbeddings(modelName: string, params: CreateParams): Promise<Embeddings> {
        return new OpenAIEmbeddings(this.config, {})
    }

    async listEmbeddings(): Promise<string[]> {
        if (this._models) {
            return this._models
        }

        this._models = (await this._API.listModels()).filter((id) => id === "text-embedding-ada-002")

        return this._models
    }

    async isSupported(modelName: string): Promise<boolean> {
        return (await this.listEmbeddings()).includes(modelName)
    }


    getExtraInfo(): Record<string, any> {
        return this.config
    }
}