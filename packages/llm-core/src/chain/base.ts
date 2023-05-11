import { Callbacks } from 'langchain/callbacks';
import { AIChatMessage, BaseChatMessage, BaseChatMessageHistory, ChainValues, HumanChatMessage } from 'langchain/schema';
import { BaseOutputParser } from 'langchain/schema/output_parser';
import { StructuredTool } from "langchain/tools";

export const FINISH_NAME = "finish";

export type ObjectTool = StructuredTool;

export type SystemPrompts = BaseChatMessage[]


export abstract class ChatHubChain {
    abstract call(message: HumanChatMessage): Promise<ChainValues>
}