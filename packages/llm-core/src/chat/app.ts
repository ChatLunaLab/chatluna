import { SystemPrompts } from '../chain/base';

export class ChatInterface {

}


export interface ChatInterfaceInput {
    chatMode: "search-chat" | "chat" | "search" | "tools";
    botName: string;
    systemPrompts?: SystemPrompts
    // use this to store the chat history
    conversationId: string;
    mixedModelName: string;
}