import { ChatHubBaseChatModel, CreateParams, ModelProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'
import BingChatPlugin from '.'
import { LmsysModel } from './model'


export class LmsysProvider extends ModelProvider {


    private _models = { 'vicuna': 'vicuna-13b', 'alpaca': 'alpaca-13b', 'chatglm': 'chatglm-6b', 'koala': 'koala-13b', 'dolly': 'dolly-v2-12b', 'llama': 'llama-13b', 'stablelm': 'stablelm-tuned-alpha-7b', 'oasst': 'oasst-pythia-12b', 'rwkv': 'RWKV-4-Raven-14B' }

    name = "lmsys"
    description?: string = "lmsys chat provider, powered by Large Model Systems Organization (LMSYS Org)"

    constructor(private readonly config: BingChatPlugin.Config) {
        super()
    }

    async listModels(): Promise<string[]> {
        return Object.keys(this._models)
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

        return new LmsysModel(this.config, this._models[modelName])
    }

    getExtraInfo(): Record<string, any> {
        return this.config
    }
}