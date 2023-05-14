import { Context } from 'koishi';
import { ChatHubPlugin } from '../services/chat';
import { CreateParams, ModelProvider } from '@dingyi222666/chathub-llm-core/lib/model/base';
import { PromiseLikeDisposeable } from '@dingyi222666/chathub-llm-core/lib/utils/types';
import { BaseChatModel, SimpleChatModel } from 'langchain/chat_models/base';
import { CallbackManagerForLLMRun } from 'langchain/callbacks';
import { AIChatMessage, BaseChatMessage, ChatGeneration, ChatResult } from 'langchain/schema';

class TestPlugin extends ChatHubPlugin<ChatHubPlugin.Config> {
    name: string = "test"

    public constructor(protected ctx: Context, public readonly config: ChatHubPlugin.Config) {
        super(ctx, config)

        this.registerModelProvider(new TestModelProvider())
    }

}

class TestModelProvider extends ModelProvider {


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

    async dispose(): Promise<void> {
        await ModelProvider.prototype.dispose.call(this)
    }

    onDispose(callback: PromiseLikeDisposeable): void {
        ModelProvider.prototype.onDispose.call(this, callback)
    }
    getExtraInfo(): Record<string, any> {
        return {}
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

        const response = lastestMessage.text.replaceAll("你", "我").replaceAll('?','!').replaceAll("不", " ").replaceAll("吗", " ").replaceAll("有", "没有").replaceAll('？','！')

        generations.push({
            text: response,
            message: new AIChatMessage(response)
        });

        return {
            generations

        }
    }
}


export function apply(ctx: Context, config: ChatHubPlugin.Config) {
    ctx.chathub.registerPlugin(new TestPlugin(ctx,config))
}