import { BaseChatMessageHistory } from 'langchain/dist/schema';
import { SystemPrompts } from '../chain/base';

export class ChatInterface {

}


export interface ChatInterfaceInput {
    chatMode: "search-chat" | "chat" | "search" | "tools";
    botName?: string;
    chatHistory: BaseChatMessageHistory;
    systemPrompts?: SystemPrompts
    // use this to store the chat history
    conversationId: string;
    // the extra params will serialize to the converstaion
    extraParams?: Record<string, any>;
    // api key, cookie, etc. Used to visit the chat model
    createParams: Record<string, any>;
    mixedModelName: string;
}