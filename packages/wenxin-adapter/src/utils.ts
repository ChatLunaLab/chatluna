import {
    AIMessageChunk,
    BaseMessage,
    ChatMessageChunk,
    HumanMessageChunk,
    MessageType,
    SystemMessageChunk
} from 'langchain/schema'
import {
    ChatCompletionResponse,
    WenxinMessage,
    WenxinMessageRole
} from './types'

export function langchainMessageToWenXinMessage(
    messages: BaseMessage[]
): WenxinMessage[] {
    const mappedMessage = messages.map((it) => {
        const role = messageTypeToWenXinRole(it._getType())

        return {
            role,
            content: it.content
        }
    })

    const result: WenxinMessage[] = []

    for (let i = 0; i < mappedMessage.length; i++) {
        const message = mappedMessage[i]

        if (message.role === 'system') {
            continue
        }

        result.push({
            role: message.role,
            content: message.content
        })

        if (mappedMessage?.[i + 1]?.role === 'assistant') {
            result.push({
                role: 'user',
                content:
                    'Continue what I said to you last time. Follow these instructions.'
            })
        }
    }

    if (result[result.length - 1].role === 'assistant') {
        result.push({
            role: 'user',
            content:
                'Continue what I said to you last time. Follow these instructions.'
        })
    }

    return result
}

export function messageTypeToWenXinRole(type: MessageType): WenxinMessageRole {
    switch (type) {
        case 'system':
            return 'system'
        case 'ai':
            return 'assistant'
        case 'human':
            return 'user'

        default:
            throw new Error(`Unknown message type: ${type}`)
    }
}

export function convertDeltaToMessageChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delta: ChatCompletionResponse,
    defaultRole?: WenxinMessageRole
) {
    const role = defaultRole
    const content = delta.result ?? ''
    // eslint-disable-next-line @typescript-eslint/naming-convention

    if (role === 'user') {
        return new HumanMessageChunk({ content })
    } else if (role === 'assistant') {
        return new AIMessageChunk({ content })
    } else if (role === 'system') {
        return new SystemMessageChunk({ content })
    } else {
        return new ChatMessageChunk({ content, role })
    }
}

/* if (this.modelName === "ERNIE-Bot") {
    this.apiUrl =
      "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions";
  } else if (this.modelName === "ERNIE-Bot-turbo") {
    this.apiUrl =
      "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/eb-instant";
  } else if (this.modelName === "ERNIE-Bot-4") {
    this.apiUrl =
      "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro";
  } else {
    throw new Error(`Invalid model name: ${this.modelName}`);
  } */

export const modelMappedUrl = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'ERNIE-Bot-4': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro?access_token=${accessToken}`
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'ERNIE-Bot': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions?access_token=${accessToken}`
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'ERNIE-Bot-turbo': (accessToken: string) => {
        return `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/eb-instant?access_token=${accessToken}`
    }
}
