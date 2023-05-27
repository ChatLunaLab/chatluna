import OpenAIPlugin from '.';
import { ChatHubBaseChatModel, CreateParams, EmbeddingsProvider, ModelProvider } from '@dingyi222666/chathub-llm-core/lib/model/base'
import { Api } from './api';
import { ChatGLMChatModel, ChatGLMEmbeddings } from './models';
import { BaseChatModel } from 'langchain/chat_models/base';
import { Embeddings } from 'langchain/embeddings/base';



export class ChatGLMModelProvider extends ModelProvider {

    private _models: string[] | null = null

    private _API: Api | null = null

    name = "chatglm"
    description?: string = "ChatGLM model provider, provide chatglm-6b model by backend:  https://github.com/ninehills/chatglm-openai-api"

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
        return (await this.listModels()).find((value) => value.includes("gpt-3.5"))
    }


    async createModel(modelName: string, params: CreateParams): Promise<ChatHubBaseChatModel> {
        const hasModel = (await this.listModels()).includes(modelName)

        if (!hasModel) {
            throw new Error(`Can't find model ${modelName}`)
        }

        return new ChatGLMChatModel(modelName, this.config, params)
    }

    getExtraInfo(): Record<string, any> {
        return this.config
    }
}

export class ChatGLMEmbeddingsProvider extends EmbeddingsProvider {

    private _API: Api | null = null


    private _models: string[] | null = null

    name = "chatglm"
    description?: string = "chatglm embeddings provider"

    constructor(private readonly config: OpenAIPlugin.Config) {
        super()
        this._API = new Api(config)
    }

    async createEmbeddings(modelName: string, params: CreateParams): Promise<Embeddings> {
        return new ChatGLMEmbeddings(this.config, {})
    }

    async listEmbeddings(): Promise<string[]> {
        if (this._models) {
            return this._models
        }

        this._models = await this._API.listModels()

        if (!this._models.includes("text-embedding-ada-002")) {
            this._models = []
        }

        return this._models
    }

    async isSupported(modelName: string): Promise<boolean> {
        return (await this.listEmbeddings()).includes(modelName)
    }


    getExtraInfo(): Record<string, any> {
        return this.config
    }
}