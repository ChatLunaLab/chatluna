import { createLogger } from '../utils/logger';
import { ClientConfig } from './config';
import { ChatHubChatModel } from './model';

const logger = createLogger("@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/client")

export interface ModelInfo {
    name: string

    maxTokens?: number

    supportChatMode(mode: string): boolean
}

export abstract class PlatformModelClient<T extends ClientConfig = ClientConfig> {

    private _modelPool: Record<string, ChatHubChatModel> = {}

    constructor(public config: T) {

    }

    async isAvailable(): Promise<boolean> {
        for (let i = 0; i < this.config.maxRetries ?? 1; i++) {
            try {
                await this.init()
                return true
            } catch (e) {
                //logger.error(e)
                if (i == this.config.maxRetries - 1) {
                    return false
                }
            }
        }
    }

    async clearContext(): Promise<void> { }

    abstract init(): Promise<void>

    abstract getModels(): Promise<ModelInfo[]>

    abstract _createModel(model: string): ChatHubChatModel

    createModel(model: string): ChatHubChatModel {
        if (!this._modelPool[model]) {
            this._modelPool[model] = this._createModel(model)
        }

        return this._modelPool[model]
    }
}