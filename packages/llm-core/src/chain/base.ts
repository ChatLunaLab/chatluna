import { Callbacks } from 'langchain/dist/callbacks';
import { AIChatMessage, BaseChatMessage, BaseChatMessageHistory, HumanChatMessage } from 'langchain/dist/schema';
import { BaseOutputParser } from 'langchain/dist/schema/output_parser';

export const FINISH_NAME = "finish";

import { StructuredTool } from "langchain/dist/tools/base";

export type ObjectTool = StructuredTool;

export type SystemPrompts = BaseChatMessage[]


export abstract class ChatHubChain {
    abstract call(message: HumanChatMessage): Promise<AIChatMessage>
}