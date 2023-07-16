
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger';
import { Api } from './api';

import { AIMessage, BaseMessage, SystemMessage } from "langchain/schema"
import Claude2ChatPlugin from '.';
import { v4 as uuid } from 'uuid';


const logger = createLogger('@dingyi222666/chathub-claude2-adapter/client')


export class Claude2ChatClient {

  private _conversationId: string

  constructor(
    public config: Claude2ChatPlugin.Config,
    private readonly _api: Api
  ) { }


  async ask(prompt: string): Promise<string> {

    if (this._conversationId == null) {
      this._conversationId = uuid()

      const result = await this._api.createConversation(this._conversationId)

      if (result instanceof Error) {
        throw result
      }
    }


    const response = await this._api.sendMessage(
      this._conversationId,
      prompt
    )


    return response

  }


  async clear() {
    this._conversationId = null
  }
}