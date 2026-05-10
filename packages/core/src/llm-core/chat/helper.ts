import { Embeddings } from '@langchain/core/embeddings'
import { AIMessage } from '@langchain/core/messages'
import { computed, ComputedRef } from '@vue/reactivity'
import { logger } from 'koishi-plugin-chatluna'
import { emptyEmbeddings } from 'koishi-plugin-chatluna/llm-core/model/in_memory'
import {
    PlatformEmbeddingsClient,
    PlatformModelAndEmbeddingsClient,
    PlatformModelClient,
    PlatformModelEmbeddingsAndRerankerClient
} from 'koishi-plugin-chatluna/llm-core/platform/client'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import {
    ModelCapabilities,
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import type { ChatLunaService } from '../../services/chat'

export function createDisplayResponse(responseMessage: AIMessage) {
    const msg = new AIMessage({
        content: responseMessage.content,
        id: responseMessage.id,
        name: responseMessage.name,
        tool_calls: responseMessage.tool_calls,
        usage_metadata: responseMessage.usage_metadata,
        additional_kwargs: {
            ...responseMessage.additional_kwargs
        },
        response_metadata: {
            ...responseMessage.response_metadata
        }
    })
    return msg
}

export async function initEmbeddings(
    service: PlatformService,
    model: string | undefined
) {
    const [platform, modelName] = parseRawModelName(model)

    if (model == null || model.length < 1 || model === '无') {
        return computed(() => emptyEmbeddings)
    }

    if (platform == null || modelName == null) {
        logger.warn(
            `Embeddings model ${model} is invalid, falling back to empty embeddings`
        )
        return computed(() => emptyEmbeddings)
    }

    const clientRef = await service.getClient(platform)
    const info = service.findModel(platform, modelName)

    return computed<Embeddings>(() => {
        const client = clientRef.value

        logger.info(`Init embeddings for %c`, model)

        if (info.value == null) {
            logger.warn(
                `Embeddings model ${modelName} not found, falling back to empty embeddings`
            )
            return emptyEmbeddings
        }

        if (info.value.type !== ModelType.embeddings) {
            logger.warn(
                `Model ${modelName} is not an embeddings model, falling back to empty embeddings`
            )
            return emptyEmbeddings
        }

        if (client == null || client instanceof PlatformModelClient) {
            logger.warn(
                `Platform ${platform} is not supported, falling back to empty embeddings`
            )
            return emptyEmbeddings
        }

        if (
            client instanceof PlatformEmbeddingsClient ||
            client instanceof PlatformModelAndEmbeddingsClient ||
            client instanceof PlatformModelEmbeddingsAndRerankerClient
        ) {
            try {
                const ref = client.createModel(modelName)

                if (ref instanceof ChatLunaBaseEmbeddings) {
                    return ref
                }

                logger.warn(
                    `Model ${modelName} is not an embeddings model, falling back to empty embeddings`
                )
                return emptyEmbeddings
            } catch (error) {
                logger.warn(
                    `Embeddings model ${modelName} not found, falling back to empty embeddings`,
                    error
                )
                return emptyEmbeddings
            }
        }

        logger.warn(
            `Platform ${platform} is not supported, falling back to empty embeddings`
        )
        return emptyEmbeddings
    })
}

export async function initModel(
    chatluna: ChatLunaService,
    llmPlatform: string,
    llmModelName: string
): Promise<
    [ComputedRef<ChatLunaChatModel>, ComputedRef<ModelInfo | undefined>]
> {
    const service = chatluna.platform
    const llmInfo = service.findModel(llmPlatform, llmModelName)

    const llmModel = await chatluna.createChatModel(llmPlatform, llmModelName)

    if (llmModel.value instanceof ChatLunaChatModel) {
        return [llmModel, llmInfo]
    }

    throw new ChatLunaError(
        ChatLunaErrorCode.MODEL_INIT_ERROR,
        new Error(`Model ${llmModelName} is not a chat model`)
    )
}

export function supportChatMode(modelInfo: ModelInfo, chatMode: string) {
    if (
        !modelInfo.capabilities.includes(ModelCapabilities.ToolCall) &&
        chatMode === 'plugin'
    ) {
        return false
    }

    return true
}
