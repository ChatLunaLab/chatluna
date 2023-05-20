import { ModelProvider, CreateParams, BaseProvider } from '@dingyi222666/chathub-llm-core/lib/model/base'
import { PromiseLikeDisposeable } from '@dingyi222666/chathub-llm-core/lib/utils/types'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'
import { BaseChatModel } from 'langchain/chat_models/base'
import { CallbackManagerForLLMRun } from 'langchain/callbacks'
import { BaseChatMessage, ChatResult, ChatGeneration, AIChatMessage } from 'langchain/schema'

class TestPlugin extends ChatHubPlugin<TestPlugin.Config> {
    name = "@dingyi222666/chathub-test-adapter"

    public constructor(protected ctx: Context, public readonly config: TestPlugin.Config) {
        super(ctx, config)

        setTimeout(async () => {
            await ctx.chathub.registerPlugin(this)
            this.registerModelProvider(new TestModelProvider(config))
        })
    }

}




class TestModelProvider extends ModelProvider {

    constructor(private readonly config: TestPlugin.Config) {
        super()
    }



    private _models = ['test']

    async createModel(modelName: string, params: CreateParams): Promise<BaseChatModel> {
        return new TestChatModel(params)
    }
    listModels(): Promise<string[]> {
        return Promise.resolve(this._models)
    }
    name = "testProvider"
    description?: string;
    isSupported(modelName: string): Promise<boolean> {
        return Promise.resolve(this._models.includes(modelName))
    }


    getExtraInfo(): Record<string, any> {
        return this.config
    }
}


class TestChatModel extends BaseChatModel {

    _llmType() {
        return "test";
    }

    /** @ignore */
    _combineLLMOutput() {
        return [];
    }

    async _generate(messages: BaseChatMessage[], stop?: string[] | this["CallOptions"], runManager?: CallbackManagerForLLMRun): Promise<ChatResult> {

        console.log(`messages: ${JSON.stringify(messages)}`)

        const lastestMessage = messages[messages.length - 1]

        const generations: ChatGeneration[] = [];

        const response = lastestMessage.text.replaceAll("你", "我").replaceAll('?', '!').replaceAll("不", " ").replaceAll("吗", " ").replaceAll("有", "没有").replaceAll('？', '！')

        generations.push({
            text: response,
            message: new AIChatMessage(response)
        });

        return {
            generations

        }
    }
}


namespace TestPlugin {
    export interface Config extends ChatHubPlugin.Config { }

    export const Config = Schema.intersect([
        ChatHubPlugin.Config,
    ])


    export const using = ['chathub']
}

export default TestPlugin