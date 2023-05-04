import {
    ChatMessage,
    BaseChatMessageHistory,
    createHumanChatMessage,
    createAIChatMessage,
  } from "../../common/index.js";
  
  export class ChatMessageHistory extends BaseChatMessageHistory {
    private messages: ChatMessage[] = [];
  
    constructor(messages?: ChatMessage[]) {
      super();
      this.messages = messages ?? [];
    }
  
    async getMessages(): Promise<ChatMessage[]> {
      return this.messages;
    }
  
    async addUserMessage(message: string) {
      this.messages.push(createHumanChatMessage(message));
    }
  
    async addAIChatMessage(message: string) {
      this.messages.push(createAIChatMessage(message));
    }
  
    async clear() {
      this.messages = [];
    }
  }