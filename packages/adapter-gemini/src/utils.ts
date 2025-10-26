/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    AIMessage,
    BaseMessage,
    MessageContentComplex,
    MessageContentImageUrl,
    MessageType,
    ToolMessage
} from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import {
    ChatCompletionFunction,
    ChatCompletionResponseMessage,
    ChatCompletionResponseMessageRoleEnum,
    ChatMessagePart,
    ChatPart,
    ChatResponse
} from './types'
import { Config, logger } from '.'
import { ModelRequestParams } from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    fetchImageUrl,
    removeAdditionalProperties
} from '@chatluna/v1-shared-adapter'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    isMessageContentImageUrl,
    isMessageContentText
} from 'koishi-plugin-chatluna/utils/string'
import { isZodSchemaV3 } from '@langchain/core/utils/types'
import { generateSchema } from '@anatine/zod-openapi'

export async function langchainMessageToGeminiMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin,
    model?: string
): Promise<ChatCompletionResponseMessage[]> {
    return Promise.all(
        messages.map(async (message) => {
            const role = messageTypeToGeminiRole(message.getType())
            const hasFunctionCall =
                (message as AIMessage).tool_calls != null &&
                (message as AIMessage).tool_calls.length > 0

            if (role === 'function' || hasFunctionCall) {
                return processFunctionMessage(message)
            }

            const result: ChatCompletionResponseMessage = {
                role,
                parts: []
            }

            result.parts =
                typeof message.content === 'string'
                    ? [{ text: message.content }]
                    : await processGeminiContentParts(plugin, message.content)

            const images = message.additional_kwargs.images as string[] | null
            if (images) {
                processImageParts(result, images, model)
            }

            return result
        })
    )
}

export function extractSystemMessages(
    messages: ChatCompletionResponseMessage[]
): [ChatCompletionResponseMessage, ChatCompletionResponseMessage[]] {
    let lastSystemMessageIndex = -1

    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'system') {
            lastSystemMessageIndex = i
            break
        }
    }

    if (lastSystemMessageIndex === -1) {
        return [undefined, messages]
    }

    const systemMessages = messages.slice(
        0,
        Math.max(1, lastSystemMessageIndex)
    )

    const modelMessages = messages.slice(lastSystemMessageIndex + 1)

    return [
        {
            role: 'user',
            parts: systemMessages.reduce((acc, cur) => {
                acc.push(...cur.parts)
                return acc
            }, [])
        },
        modelMessages
    ]
}

function parseJsonArgs(args: string) {
    try {
        const result = JSON.parse(args)
        if (typeof result === 'string') return { response: result }
        if (Array.isArray(result)) return { response: result }

        return result
    } catch {
        return { response: args }
    }
}

function processFunctionMessage(
    message: AIMessage | ToolMessage
): ChatCompletionResponseMessage {
    if (message['tool_calls']) {
        message = message as AIMessage
        const toolCalls = message.tool_calls
        return {
            role: 'model',
            parts: toolCalls.map((toolCall) => {
                return {
                    functionCall: {
                        name: toolCall.name,
                        args: toolCall.args,
                        id: toolCall.id
                    }
                }
            })
        }
    }

    const finalMessage = message as ToolMessage

    return {
        role: 'user',
        parts: [
            {
                functionResponse: {
                    name: message.name,
                    id: finalMessage.tool_call_id,
                    response: parseJsonArgs(message.content as string)
                }
            }
        ]
    }
}

function processImageParts(
    result: ChatCompletionResponseMessage,
    images: string[],
    model: string
) {
    if (
        !(
            (model.includes('vision') ||
                model.includes('gemini') ||
                model.includes('gemma')) &&
            !model.includes('gemini-1.0')
        )
    ) {
        return
    }

    for (const image of images) {
        const mineType = image.split(';')?.[0]?.split(':')?.[1] ?? 'image/jpeg'
        const data = image.replace(/^data:image\/\w+;base64,/, '')

        result.parts.push({
            inline_data: { data, mime_type: mineType }
        })
    }

    result.parts = result.parts.filter((uncheckedPart) => {
        const part = partAsTypeCheck<ChatMessagePart>(
            uncheckedPart,
            (part) => part['text'] != null
        )
        return part == null || part.text.length > 0
    })
}

async function processGeminiImageContent(
    plugin: ChatLunaPlugin,
    part: MessageContentImageUrl
) {
    let url: string
    try {
        url = await fetchImageUrl(plugin, part)
    } catch (e) {
        url =
            typeof part.image_url === 'string'
                ? part.image_url
                : part.image_url.url
        logger.warn(`Failed to fetch image url: ${url}`, e)
    }

    const mineType = url.match(/^data:([^;]+);base64,/)?.[1] ?? 'image/jpeg'
    const data = url.replace(/^data:image\/\w+;base64,/, '')

    return {
        inline_data: { data, mime_type: mineType }
    }
}

async function processGeminiContentParts(
    plugin: ChatLunaPlugin,
    content: MessageContentComplex[]
) {
    return Promise.all(
        content.map(async (part) => {
            if (isMessageContentText(part)) {
                return { text: part.text }
            }
            if (isMessageContentImageUrl(part)) {
                return await processGeminiImageContent(plugin, part)
            }
            return part as any
        })
    )
}

export function partAsType<T extends ChatPart>(part: ChatPart): T {
    return part as T
}

export function partAsTypeCheck<T extends ChatPart>(
    part: ChatPart,
    check: (part: ChatPart & unknown) => boolean
): T | undefined {
    return check(part) ? (part as T) : undefined
}

export function formatToolsToGeminiAITools(
    tools: StructuredTool[],
    config: Config,
    model: string
): Record<string, any> {
    if (tools.length < 1 && !config.googleSearch) {
        return undefined
    }
    const functions = tools.map(formatToolToGeminiAITool)

    const result = []

    const unsupportedModels = [
        'gemini-1.0',
        'gemini-2.0-flash-lite',
        'gemini-1.5-flash',
        'gemini-2.0-flash-exp'
    ]

    const imageGenerationModels = [
        'gemini-2.0-flash-exp',
        'gemini-2.0-flash-exp-image-generation',
        'gemini-2.5-flash-image-preview'
    ]

    let googleSearch = config.googleSearch
    let codeExecution = config.codeExecution
    let urlContext = config.urlContext

    const useCustomTools =
        config.googleSearch || config.codeExecution || config.urlContext

    if (functions.length > 0 && !useCustomTools) {
        result.push({
            functionDeclarations: functions
        })
    } else if (functions.length > 0 && useCustomTools) {
        logger.warn('Use custom tools instead of tool calls.')
    } else if (
        (unsupportedModels.some((unsupportedModel) =>
            model.includes(unsupportedModel)
        ) ||
            (imageGenerationModels.some((unsupportedModels) =>
                model.includes(unsupportedModels)
            ) &&
                config.imageGeneration)) &&
        useCustomTools
    ) {
        logger.warn(
            `The model ${model} does not support google search. google search will be disable.`
        )
        googleSearch = false
        codeExecution = false
        urlContext = false
    }

    if (googleSearch) {
        if (model.includes('gemini-2')) {
            result.push({
                google_search: {}
            })
        } else {
            result.push({
                google_search_retrieval: {
                    dynamic_retrieval_config: {
                        mode: 'MODE_DYNAMIC',
                        dynamic_threshold: config.searchThreshold
                    }
                }
            })
        }
    }

    if (codeExecution) {
        result.push({
            code_execution: {}
        })
    }

    if (urlContext) {
        result.push({
            urlContext: {}
        })
    }

    return result
}

export function formatToolToGeminiAITool(
    tool: StructuredTool
): ChatCompletionFunction {
    const parameters = removeAdditionalProperties(
        isZodSchemaV3(tool.schema)
            ? generateSchema(tool.schema as never, true, '3.0')
            : tool.schema
    )

    return {
        name: tool.name,
        description: tool.description,
        // any?
        parameters
    }
}

export function messageTypeToGeminiRole(
    type: MessageType
): ChatCompletionResponseMessageRoleEnum {
    switch (type) {
        case 'system':
            return 'system'
        case 'ai':
            return 'model'
        case 'human':
            return 'user'
        case 'tool':
            return 'function'
        default:
            throw new Error(`Unknown message type: ${type}`)
    }
}

export function prepareModelConfig(
    params: ModelRequestParams,
    pluginConfig: Config
) {
    let model = params.model
    let enabledThinking: boolean | undefined = null

    if (model.includes('-thinking') && model.includes('gemini-2.5')) {
        enabledThinking = !model.includes('-non-thinking')
        model = model.replace('-non-thinking', '').replace('-thinking', '')
    }

    let thinkingBudget = pluginConfig.thinkingBudget ?? -1

    if (!enabledThinking && !model.includes('2.5-pro')) {
        thinkingBudget = 0
    } else if (thinkingBudget >= 0 && thinkingBudget < 128) {
        thinkingBudget = 128
    }

    let imageGeneration = pluginConfig.imageGeneration ?? false

    if (imageGeneration) {
        imageGeneration =
            params.model.includes('gemini-2.0-flash-exp') ||
            params.model.includes('gemini-2.5-flash-image')
    }

    return { model, enabledThinking, thinkingBudget, imageGeneration }
}

export function createSafetySettings(model: string) {
    const isGemini2 = model.includes('gemini-2')

    return [
        {
            category: 'HARM_CATEGORY_HARASSMENT',
            threshold: isGemini2 ? 'OFF' : 'BLOCK_NONE'
        },
        {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            threshold: isGemini2 ? 'OFF' : 'BLOCK_NONE'
        },
        {
            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
            threshold: isGemini2 ? 'OFF' : 'BLOCK_NONE'
        },
        {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            threshold: isGemini2 ? 'OFF' : 'BLOCK_NONE'
        },
        {
            category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
            threshold: isGemini2 ? 'OFF' : 'BLOCK_NONE'
        }
    ]
}

export function createGenerationConfig(
    params: ModelRequestParams,
    modelConfig: ReturnType<typeof prepareModelConfig>,
    pluginConfig: Config
) {
    return {
        stopSequences: params.stop,
        temperature: params.temperature,
        maxOutputTokens: params.model.includes('vision')
            ? undefined
            : params.maxTokens,
        topP: params.topP,
        responseModalities: modelConfig.imageGeneration
            ? ['TEXT', 'IMAGE']
            : undefined,
        thinkingConfig:
            modelConfig.enabledThinking != null || pluginConfig.includeThoughts
                ? {
                      thinkingBudget: modelConfig.thinkingBudget,
                      includeThoughts: pluginConfig.includeThoughts
                  }
                : undefined
    }
}

export async function createChatGenerationParams(
    params: ModelRequestParams,
    plugin: ChatLunaPlugin,
    modelConfig: ReturnType<typeof prepareModelConfig>,
    pluginConfig: Config
) {
    const geminiMessages = await langchainMessageToGeminiMessage(
        params.input,
        plugin,
        modelConfig.model
    )

    const [systemInstruction, modelMessages] =
        extractSystemMessages(geminiMessages)

    return {
        contents: modelMessages,
        safetySettings: createSafetySettings(params.model),
        generationConfig: createGenerationConfig(
            params,
            modelConfig,
            pluginConfig
        ),
        system_instruction:
            systemInstruction != null ? systemInstruction : undefined,
        tools:
            params.tools != null ||
            pluginConfig.googleSearch ||
            pluginConfig.codeExecution ||
            pluginConfig.urlContext
                ? formatToolsToGeminiAITools(
                      params.tools ?? [],
                      pluginConfig,
                      params.model
                  )
                : undefined
    }
}

export function isChatResponse(response: any): response is ChatResponse {
    return 'candidates' in response
}
