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
    ChatFunctionCallingPart,
    ChatFunctionResponsePart,
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
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'

export async function langchainMessageToGeminiMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin<ClientConfig, Config>,
    model?: string
): Promise<ChatCompletionResponseMessage[]> {
    return Promise.all(
        messages.map(async (message) => {
            const role = messageTypeToGeminiRole(message.getType())
            const hasFunctionCall =
                (message as AIMessage).tool_calls != null &&
                (message as AIMessage).tool_calls.length > 0

            if (role === 'function' || hasFunctionCall) {
                return processFunctionMessage(
                    message,
                    plugin.config.useCamelCaseSystemInstruction
                )
            }

            const result: ChatCompletionResponseMessage = {
                role,
                parts: []
            }

            const thoughtData: Record<string, any> =
                message.additional_kwargs['thought_data'] ?? {}

            result.parts =
                typeof message.content === 'string'
                    ? [{ text: message.content, ...thoughtData }]
                    : await processGeminiContentParts(
                          plugin,
                          message.content,
                          thoughtData
                      )

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
    message: AIMessage | ToolMessage,
    removeId: boolean
): ChatCompletionResponseMessage {
    const thoughtData: Record<string, any> =
        message.additional_kwargs['thought_data'] ?? {}

    if (message['tool_calls']) {
        message = message as AIMessage
        const toolCalls = message.tool_calls
        return {
            role: 'model',
            parts: toolCalls.map((toolCall) => {
                const functionCall: ChatFunctionCallingPart['functionCall'] = {
                    name: toolCall.name,
                    args: toolCall.args
                }
                if (!removeId) {
                    functionCall.id = toolCall.id
                }
                return {
                    functionCall,
                    ...thoughtData
                }
            })
        }
    }

    const finalMessage = message as ToolMessage

    const functionResponse: ChatFunctionResponsePart['functionResponse'] = {
        name: message.name,
        response: parseJsonArgs(message.content as string)
    }

    if (!removeId) {
        functionResponse.id = finalMessage.tool_call_id
    }

    return {
        role: 'user',
        parts: [
            {
                functionResponse
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
    content: MessageContentComplex[],
    thoughtData: Record<string, any>
) {
    return Promise.all(
        content.map(async (part) => {
            if (isMessageContentText(part)) {
                return { text: part.text, ...thoughtData }
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
        if (model.includes('gemini-1')) {
            result.push({
                google_search_retrieval: {
                    dynamic_retrieval_config: {
                        mode: 'MODE_DYNAMIC',
                        dynamic_threshold: config.searchThreshold
                    }
                }
            })
        } else {
            result.push({
                google_search: {}
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
    let thinkingLevel: string = 'THINKING_LEVEL_UNSPECIFIED'

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

    if (model.includes('-thinking') && model.includes('gemini-3.0')) {
        enabledThinking = true
        const match = model.match(/-(low|medium|high)-thinking/)
        if (match) {
            thinkingLevel = match[1]
            model = model.replace(`-${match[1]}-thinking`, '')
        } else {
            // Default to THINKING_LEVEL_UNSPECIFIED for gemini-3.0 if no level specified
            thinkingLevel = 'THINKING_LEVEL_UNSPECIFIED'
            model = model.replace('-thinking', '')
        }
        thinkingBudget = undefined
    } else {
        thinkingLevel = undefined
    }

    let imageGeneration = pluginConfig.imageGeneration ?? false

    if (imageGeneration) {
        imageGeneration =
            params.model.includes('gemini-2.0-flash-exp') ||
            params.model.includes('image')
    }

    return {
        model,
        enabledThinking,
        thinkingBudget,
        imageGeneration,
        thinkingLevel
    }
}

export function createSafetySettings(model: string) {
    const isNonGemini1 = !model.includes('gemini-1')

    return [
        {
            category: 'HARM_CATEGORY_HARASSMENT',
            threshold: isNonGemini1 ? 'OFF' : 'BLOCK_NONE'
        },
        {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            threshold: isNonGemini1 ? 'OFF' : 'BLOCK_NONE'
        },
        {
            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
            threshold: isNonGemini1 ? 'OFF' : 'BLOCK_NONE'
        },
        {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            threshold: isNonGemini1 ? 'OFF' : 'BLOCK_NONE'
        },
        {
            category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
            threshold: isNonGemini1 ? 'OFF' : 'BLOCK_NONE'
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
                ? filterKeys(
                      {
                          thinkingBudget: modelConfig.thinkingBudget,
                          thinkingLevel: modelConfig.thinkingLevel,
                          includeThoughts: pluginConfig.includeThoughts
                      },
                      notNullFn
                  )
                : undefined
    }
}

export async function createChatGenerationParams(
    params: ModelRequestParams,
    plugin: ChatLunaPlugin<ClientConfig, Config>,
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

    const systemInstructionKey = pluginConfig.useCamelCaseSystemInstruction
        ? 'systemInstruction'
        : 'system_instruction'

    return {
        contents: modelMessages,
        safetySettings: createSafetySettings(params.model),
        generationConfig: createGenerationConfig(
            params,
            modelConfig,
            pluginConfig
        ),
        [systemInstructionKey]:
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

function notNullFn<K, V>(_: K, v: V): v is NonNullable<V> {
    return v != null
}

type RecordKey = string | number | symbol
function filterKeys<K extends RecordKey, V>(
    obj: Record<K, V>,
    fn: (k: K, v: V) => boolean
): Record<K, V> {
    return Object.fromEntries(
        Object.entries(obj).filter(([k, v]) => fn(k as K, v as V))
    ) as Record<K, V>
}
