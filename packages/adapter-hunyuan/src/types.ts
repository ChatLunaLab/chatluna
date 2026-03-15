import { buildChatCompletionParams } from '@chatluna/v1-shared-adapter'

export type {
    ChatCompletionFunction,
    ChatCompletionRequestMessageToolCall,
    ChatCompletionResponse,
    ChatCompletionResponseMessage,
    ChatCompletionResponseMessageRoleEnum,
    ChatCompletionTool,
    CreateEmbeddingRequest,
    CreateEmbeddingResponse,
    CreateEmbeddingResponseDataInner,
    CreateEmbeddingResponseUsage
} from '@chatluna/v1-shared-adapter'

export type HunyuanChatRequest = Awaited<
    ReturnType<typeof buildChatCompletionParams>
> & {
    enable_enhancement?: boolean
}
