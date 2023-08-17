import { Dict } from 'koishi'
import { request } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { BaseMessage, MessageType } from 'langchain/schema'
import GPTFreePlugin from './index'

const logger = createLogger('@dingyi222666/chathub-gptfree-adapter/api')

export class Api {

  constructor(
    private readonly config: GPTFreePlugin.Config
  ) { }

  private _buildHeaders() {
    return {
   //   Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json"
    }
  }

  private _concatUrl(url: string): string {
    const apiEndPoint = this.config.apiEndPoint


    return apiEndPoint + '/' + url

  }

  private _get(url: string) {
    const requestUrl = this._concatUrl(url)

    return request.fetch(requestUrl, {
      method: 'GET',
      headers: this._buildHeaders()
    })
  }

  private _post(urL: string, data: any, params: Record<string, any> = {}) {
    const requestUrl = this._concatUrl(urL)

    return request.fetch(requestUrl, {
      body: JSON.stringify(data),
      headers: this._buildHeaders(),
      method: 'POST',
      ...params
    })
  }


  async listModels(): Promise<string[] | null> {
    try {
      const response = await this._get("supports")
      const data = (<any[]>(await response.json()))

      // logger.debug(JSON.stringify(data))

      return data.flatMap((site:any) => site.models.map(model => site.site + "/" + model) as string[])
    } catch (e) {

      logger.error(
        "Error when listing openai models, Result: " + e.response
          ? (e.response ? e.response.data : e)
          : e
      );

      // return fake empty models
      return null
    }
  }


  async chatTrubo(
    model: string,
    messages: BaseMessage[],
    signal?: AbortSignal
  ) {
    let data: {
      choices: Array<{
        index: number;
        finish_reason: string | null;
        delta: { content?: string; role?: string };
        message: { role: string, content: string }
      }>; id: string; object: string; created: number; model: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }

    const [siteName, modelName] = model.split(/(?<=^[^\/]+)\//)

    try {
      const response = await this._post(`v1/chat/completions?site=${siteName}`, {
        model: modelName,
        messages: messages.map((message) => {
          return {
            role: messageTypeToOpenAIRole(message._getType()),
            content: message.content
          }
        }),
       
        user: "user"
      }, {
        signal: signal
      })

      data = (await response.text()) as any

      data = JSON.parse(data as any) as {
        id: string;
        object: string;
        created: number;
        model: string;
        choices: Array<{
          index: number;
          finish_reason: string | null;
          delta: { content?: string; role?: string };
          message: { role: string, content: string }
        }>;
        usage: {
          prompt_tokens: number,
          completion_tokens: number,
          total_tokens: number
        }
      };


      if (data.choices && data.choices.length > 0) {
        return data
      }

      throw new Error("error when calling gptfree chat, Result: " + JSON.stringify(data))

    } catch (e) {

      logger.error(data)
      logger.error(
        "Error when calling gptfree chat, Result: " + e.response
          ? (e.response ? e.response.data : e)
          : e
      );


      return null
    }
  }


  
}

export function messageTypeToOpenAIRole(
  type: MessageType
): string {
  switch (type) {
    case "system":
      return "system";
    case "ai":
      return "assistant";
    case "human":
      return "user";
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}