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
import { deepAssign } from 'koishi-plugin-chatluna/utils/object'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    MULTIMODAL_PAYLOAD_STORE_KEY,
    MULTIMODAL_PAYLOAD_TTL_MS
} from './constants'

function takeMultimodalPayloadParts(payloadId: string): ChatPart[] {
    const g = globalThis as Record<string, unknown>
    const store = g[MULTIMODAL_PAYLOAD_STORE_KEY]
    if (!(store instanceof Map)) {
        return []
    }

    const typedStore = store as Map<
        string,
        { parts: ChatPart[]; createdAt: number }
    >
    const now = Date.now()
    for (const [key, value] of typedStore.entries()) {
        if (now - value.createdAt > MULTIMODAL_PAYLOAD_TTL_MS) {
            typedStore.delete(key)
        }
    }

    const record = typedStore.get(payloadId)
    if (!record) {
        return []
    }

    typedStore.delete(payloadId)
    return record.parts
}

export async function langchainMessageToGeminiMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin<ClientConfig, Config>,
    model?: string
): Promise<ChatCompletionResponseMessage[]> {
    const mappedMessages = await Promise.all(
        messages.map(async (message) => {
            const role = messageTypeToGeminiRole(message.getType())
            const hasFunctionCall =
                (message as AIMessage).tool_calls != null &&
                (message as AIMessage).tool_calls.length > 0

            if (role === 'function' || hasFunctionCall) {
                return processFunctionMessage(
                    message,
                    // 如果使用 new api，我们应该去掉 id，，，
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

    return mappedMessages.flatMap((item) =>
        Array.isArray(item) ? item : [item]
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

function parseGeminiMultimodalFunctionResponsePayload(message: ToolMessage): {
    response: any
    inlineParts?: ChatPart[]
} {
    const payloadFromKwargs = message.additional_kwargs?.[
        'gemini_multimodal_payload'
    ] as Record<string, any> | undefined

    if (payloadFromKwargs?.['__chatluna_gemini_multimodal_v1'] === true) {
        const parts =
            typeof payloadFromKwargs?.['payloadId'] === 'string'
                ? takeMultimodalPayloadParts(payloadFromKwargs['payloadId'])
                : Array.isArray(payloadFromKwargs?.['parts'])
                  ? (payloadFromKwargs['parts'] as ChatPart[])
                  : []

        return {
            response: payloadFromKwargs['response'] ?? {},
            inlineParts: parts
        }
    }

    if (typeof message.content !== 'string') {
        return {
            response: parseJsonArgs(JSON.stringify(message.content))
        }
    }

    const parsed = parseJsonArgs(message.content)
    const isGeminiMultimodalPayload =
        parsed != null &&
        typeof parsed === 'object' &&
        parsed['__chatluna_gemini_multimodal_v1'] === true

    if (!isGeminiMultimodalPayload) {
        return {
            response: parsed
        }
    }

    const parts =
        typeof parsed['payloadId'] === 'string'
            ? takeMultimodalPayloadParts(parsed['payloadId'])
            : Array.isArray(parsed['parts'])
              ? (parsed['parts'] as ChatPart[])
              : []

    return {
        response: parsed['response'] ?? {},
        inlineParts: parts
    }
}

function processFunctionMessage(
    message: AIMessage | ToolMessage,
    removeId: boolean
): ChatCompletionResponseMessage | ChatCompletionResponseMessage[] {
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

    const parsedPayload =
        parseGeminiMultimodalFunctionResponsePayload(finalMessage)

    const functionResponse: ChatFunctionResponsePart['functionResponse'] = {
        name: message.name,
        response: parsedPayload.response
    }

    if (!removeId) {
        functionResponse.id = finalMessage.tool_call_id
    }

    if ((parsedPayload.inlineParts?.length ?? 0) < 1) {
        return {
            role: 'user',
            parts: [
                {
                    functionResponse
                }
            ]
        }
    }

    return [
        {
            role: 'user',
            parts: [
                {
                    functionResponse
                }
            ]
        },
        {
            role: 'user',
            parts: [
                {
                    text: `Tool "${message.name}" returned inline files for this turn. Use these attached files as the corresponding tool output context.`
                },
                ...parsedPayload.inlineParts
            ]
        }
    ]
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
        const rawUrl =
            typeof part.image_url === 'string'
                ? part.image_url
                : part.image_url.url
        logger.warn(`Failed to fetch image url: ${rawUrl}`, e)
        return null
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
    const mappedParts = await Promise.all(
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

    return mappedParts.filter((part) => part != null)
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
    const useCustomTools =
        config.googleSearch || config.codeExecution || config.urlContext

    if (tools.length < 1 && !useCustomTools) {
        return undefined
    }

    const functions = tools.map(formatToolToGeminiAITool)
    const result = []

    const unsupportedModels = [
        'gemini-1.0',
        'gemini-2.0-flash-lite',
        'gemini-1.5-flash',
        'gemini-2.0-flash-exp',
        'gemma'
    ]

    const imageGenerationModels = [
        'gemini-2.0-flash-exp',
        'gemini-2.0-flash-exp-image-generation',
        'gemini-2.5-flash-image-preview'
    ]

    const customToolsUnsupported =
        unsupportedModels.some((unsupportedModel) =>
            model.includes(unsupportedModel)
        ) ||
        (imageGenerationModels.some((unsupportedModel) =>
            model.includes(unsupportedModel)
        ) &&
            config.imageGeneration)

    if (functions.length > 0 && !useCustomTools) {
        result.push({
            functionDeclarations: functions
        })
    } else if (functions.length > 0 && useCustomTools) {
        logger.warn('Use custom tools instead of tool calls.')
    }

    if (useCustomTools && customToolsUnsupported) {
        logger.warn(
            `The model ${model} does not support googleSearch/codeExecution/urlContext. They will be disabled.`
        )
    }

    const enableGoogleSearch =
        useCustomTools && !customToolsUnsupported && config.googleSearch
    const enableCodeExecution =
        useCustomTools && !customToolsUnsupported && config.codeExecution
    const enableUrlContext =
        useCustomTools && !customToolsUnsupported && config.urlContext

    if (enableGoogleSearch) {
        result.push({
            google_search: {}
        })
    }

    if (enableCodeExecution) {
        result.push({
            code_execution: {}
        })
    }

    if (enableUrlContext) {
        result.push({
            urlContext: {}
        })
    }

    if (result.length < 1) {
        return undefined
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
    let thinkingLevel: string = 'high'
    let imageSize: string | undefined

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

    if (model.includes('gemini-3')) {
        enabledThinking = true
        thinkingBudget = undefined
        const match = model.match(/-(low|medium|high|tiny|minimal)-thinking/)

        if (match && match[1]) {
            const level = match[1]
            model = model.replace(`-${level}-thinking`, '')
            if (level === 'minimal' && model.includes('3-pro')) {
                thinkingLevel = undefined
                thinkingBudget = 128
            } else {
                thinkingLevel = level
            }
        } else {
            // Default to 'high' thinking level for gemini-3 if no level specified
            thinkingLevel = 'high'
        }
    } else {
        thinkingLevel = undefined
    }

    // Extract imageSize from model name suffix (e.g., gemini-3-pro-image-2K)
    const imageSizeMatch = model.match(/-(2K|4K)$/)
    if (imageSizeMatch) {
        imageSize = imageSizeMatch[1]
        model = model.replace(`-${imageSize}`, '')
    }

    let imageGeneration = pluginConfig.imageGeneration ?? false

    if (imageGeneration) {
        imageGeneration =
            model.includes('gemini-2.0-flash-exp') || model.includes('image')

        thinkingBudget = undefined
        thinkingLevel = undefined
    }

    return {
        model,
        enabledThinking,
        thinkingBudget,
        imageGeneration,
        thinkingLevel,
        imageSize
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
    const base = {
        stopSequences: params.stop,
        temperature: params.temperature,
        maxOutputTokens: params.model.includes('vision')
            ? undefined
            : params.maxTokens,
        topP: params.topP,
        responseModalities: modelConfig.imageGeneration
            ? ['TEXT', 'IMAGE']
            : undefined,
        imageConfig: modelConfig.imageSize
            ? {
                  imageSize: modelConfig.imageSize
              }
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

    return deepAssign({}, base, params.overrideRequestParams ?? {})
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
