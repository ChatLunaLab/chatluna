import { BaseLLM } from 'langchain/dist/llms/base';
import { BaseChatModel } from 'langchain/dist/chat_models/base';

export interface ModelProvider {
    createModel(modelName: string, params: ModelParams): BaseLLM | BaseChatModel
}

export type ModelParams = Record<string, any> 