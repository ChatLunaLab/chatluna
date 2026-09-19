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
    ChatFunctionResponsePart,
    ChatPart,
    ChatResponse,
    ChatThoughtData,
    ChatThoughtPart,
    ChatTool,
    GeminiUsageMetadata
} from './types'
import { Config, logger } from '.'
import { ModelRequestParams } from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    fetchFileLikeUrl,
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
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'

export async function langchainMessageToGeminiMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin<ClientConfig, Config>,
    model?: string
): Promise<ChatCompletionResponseMessage[]> {
    const cfg = plugin.config
    const agentic =
        cfg.agenticVideo &&
        AGENTIC_VIDEO_MODELS.some((name) => model?.includes(name))

    async function convert(
        content: MessageContentComplex[]
    ): Promise<ChatPart[]> {
        const parts = await Promise.all(
            content.map(async (part): Promise<ChatPart | null> => {
                if (isMessageContentText(part)) {
                    return part.text.length > 0 ? { text: part.text } : null
                }
                const image = isMessageContentImageUrl(part)
                if (!image && !isGeminiFileLikeContent(part)) {
                    return part as unknown as ChatPart
                }

                const media = await readMedia(plugin, part)
                if (media == null) return null
                const mode =
                    agentic && !image && media.mimeType.startsWith('video/')
                        ? 'AGENTIC'
                        : undefined
                return cfg.useCamelCaseMediaFields
                    ? { inlineData: media, mediaProcessing: mode }
                    : {
                          inline_data: {
                              data: media.data,
                              mime_type: media.mimeType
                          },
                          media_processing: mode
                      }
            })
        )
        return parts.filter((part) => part != null)
    }

    const result: ChatCompletionResponseMessage[] = []
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        const role = messageTypeToGeminiRole(msg.getType())

        if (role === 'function') {
            const response: ChatFunctionResponsePart['functionResponse'] = {
                name: msg.name,
                id: (msg as ToolMessage).tool_call_id || undefined,
                response: {}
            }
            const parts: ChatPart[] = [{ functionResponse: response }]
            if (typeof msg.content === 'string') {
                response.response = parseJsonArgs(msg.content)
            } else {
                const texts = msg.content.filter(isMessageContentText)
                if (texts.length > 0) {
                    response.response = parseJsonArgs(
                        texts.map((part) => part.text).join('')
                    )
                }
                const media = await convert(
                    msg.content.filter(
                        (part) =>
                            isMessageContentImageUrl(part) ||
                            isGeminiFileLikeContent(part)
                    )
                )
                for (const part of media) {
                    // Gemini requires agentic videos beside the function response.
                    if (
                        ('inlineData' in part && part.mediaProcessing) ||
                        ('inline_data' in part && part.media_processing)
                    ) {
                        parts.push(part)
                        continue
                    }
                    if ('inlineData' in part) {
                        response.parts ??= []
                        response.parts.push({ inlineData: part.inlineData })
                    } else if ('inline_data' in part) {
                        response.parts ??= []
                        response.parts.push({ inline_data: part.inline_data })
                    }
                }
            }

            // Consecutive tool results form one user turn.
            if (i > 0 && messages[i - 1].getType() === 'tool') {
                result[result.length - 1].parts.push(...parts)
            } else {
                result.push({ role: 'user', parts })
            }
            continue
        }

        if ((msg as AIMessage).tool_calls?.length > 0) {
            const text =
                typeof msg.content === 'string'
                    ? msg.content.length > 0
                        ? [{ text: msg.content }]
                        : []
                    : await convert(msg.content)
            result.push({
                role: 'model',
                parts: [...text, ...convertCalls(msg as AIMessage)]
            })
            continue
        }

        const data = (msg.additional_kwargs.thought_data ??
            {}) as ChatThoughtData

        const parts =
            typeof msg.content === 'string'
                ? msg.content.length > 0
                    ? [{ text: msg.content }]
                    : []
                : await convert(msg.content)
        result.push({
            role,
            parts: [
                ...getContextParts([data, ...Object.values(data)]),
                ...parts
            ]
        })

        if (msg.additional_kwargs.images != null) {
            logger.warn(
                'Deprecated: `additional_kwargs.images` is no longer supported. Use `image_url` content parts instead.'
            )
        }
    }

    return result
}

async function readMedia(
    plugin: ChatLunaPlugin<ClientConfig, Config>,
    part: MessageContentImageUrl | Parameters<typeof fetchFileLikeUrl>[1]
) {
    try {
        if (isMessageContentImageUrl(part)) {
            const url = await fetchImageUrl(plugin, part)
            return {
                data: url.replace(/^data:image\/\w+;base64,/, ''),
                mimeType:
                    url.match(/^data:([^;]+);base64,/)?.[1] ?? 'image/jpeg'
            }
        }
        const file = await fetchFileLikeUrl(plugin, part)
        return { data: file.buffer.toString('base64'), mimeType: file.mimeType }
    } catch (err) {
        logger.warn(`Failed to fetch ${part.type}`, err)
        return null
    }
}

function convertCalls(msg: AIMessage): ChatPart[] {
    const calls = msg.tool_calls
    const data = (msg.additional_kwargs.thought_data ?? {}) as ChatThoughtData
    // Replay shared context once; call-specific context stays with its call.
    const shared = { ...data }
    for (const call of calls) {
        if (call.id != null) delete shared[call.id]
    }
    const parts: ChatPart[] = getContextParts([
        shared,
        ...Object.values(shared)
    ])
    for (const call of calls) {
        if (call.id != null) {
            parts.push(...getContextParts([data[call.id]]))
        }
        const context = data[call.id] ?? data
        const sig = Array.isArray(context)
            ? context.find((part) => typeof part?.thoughtSignature === 'string')
                  ?.thoughtSignature
            : typeof context === 'object'
              ? context.thoughtSignature
              : undefined
        parts.push({
            functionCall: {
                name: call.name,
                args: call.args,
                id: call.id || undefined
            },
            ...(typeof sig === 'string' ? { thoughtSignature: sig } : {})
        })
    }

    return parts
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

    const systemMessages = messages
        .slice(0, lastSystemMessageIndex + 1)
        .filter((msg) => msg.role === 'system')

    const modelMessages = [
        ...messages
            .slice(0, lastSystemMessageIndex)
            .filter((msg) => msg.role !== 'system'),
        ...messages
            .slice(lastSystemMessageIndex + 1)
            .filter((msg) => msg.role !== 'system')
    ]

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

function parseJsonArgs(args: string): Record<string, unknown> {
    try {
        const result: unknown = JSON.parse(args)
        if (
            typeof result === 'object' &&
            result != null &&
            !Array.isArray(result)
        ) {
            return result as Record<string, unknown>
        }

        return { response: result }
    } catch {
        return { response: args }
    }
}

export function isMediaProcessingPart(part: ChatThoughtPart): boolean {
    const tool = part.toolCall ?? part.toolResponse
    // Agentic media steps can omit toolType and cannot be replayed by Gemini.
    return (
        tool != null &&
        (tool.toolType == null || tool.toolType === 'MEDIA_PROCESSING')
    )
}

export function isToolContext(part: unknown): part is ChatThoughtPart {
    return (
        typeof part === 'object' &&
        part != null &&
        (('toolCall' in part && part.toolCall != null) ||
            ('toolResponse' in part && part.toolResponse != null) ||
            ('executableCode' in part && part.executableCode != null) ||
            ('codeExecutionResult' in part && part.codeExecutionResult != null))
    )
}

function getContextParts(parts: ChatThoughtData[string][]): ChatThoughtPart[] {
    // Old histories also store context directly or under individual call IDs.
    return parts
        .flat()
        .filter(
            (part): part is ChatThoughtPart =>
                isToolContext(part) && !isMediaProcessingPart(part)
        )
}

function isGeminiFileLikeContent(
    part: MessageContentComplex
): part is Parameters<typeof fetchFileLikeUrl>[1] {
    return (
        part != null &&
        typeof part === 'object' &&
        ['file_url', 'audio_url', 'video_url'].includes(part['type'] as string)
    )
}

// 不支持 googleSearch / codeExecution / urlContext 的模型列表
const CUSTOM_TOOLS_UNSUPPORTED_MODELS = [
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-exp'
]

const AGENTIC_VIDEO_MODELS = [
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.8-flash'
]

// 启用 imageGeneration 时同样不支持上述自定义工具的模型列表
const IMAGE_GENERATION_MODELS = [
    'gemini-2.0-flash-exp',
    'gemini-2.0-flash-exp-image-generation',
    'gemini-2.5-flash-image-preview'
]

/**
 * 支持 imageSearch（图片搜索）的模型列表。
 * 这些模型在启用 googleSearch 时，会在 google_search 配置中额外注入
 * searchTypes.imageSearch，以支持图文混合搜索。
 */
const IMAGE_SEARCH_SUPPORTED_MODELS = ['gemini-3.1-flash-image']

/**
 * 判断当前模型是否不支持 googleSearch / codeExecution / urlContext。
 * 两种情况会触发：
 *   1. 模型本身在不支持列表中
 *   2. 开启了 imageGeneration，且模型属于图片生成系列
 */
function isCustomToolsUnsupported(model: string, imageGeneration: boolean) {
    const isUnsupportedModel = CUSTOM_TOOLS_UNSUPPORTED_MODELS.some((m) =>
        model.includes(m)
    )
    const isImageGenerationModel =
        imageGeneration &&
        IMAGE_GENERATION_MODELS.some((m) => model.includes(m))

    return isUnsupportedModel || isImageGenerationModel
}

/**
 * 判断模型是否支持 imageSearch。
 * 支持的模型在 google_search 工具中会额外携带 searchTypes.imageSearch 配置。
 */
function isImageSearchSupported(model: string): boolean {
    return IMAGE_SEARCH_SUPPORTED_MODELS.some((m) => model.includes(m))
}

/**
 * 将 googleSearch / codeExecution / urlContext 对应的工具项追加到 result 中。
 * - 支持 imageSearch 的模型会在 google_search 中注入 searchTypes
 * - 其余模型使用标准的新版 google_search: {} 格式
 */
function appendBuiltinTools(
    result: ChatTool[],
    googleSearch: boolean,
    codeExecution: boolean,
    urlContext: boolean,
    model: string
) {
    if (googleSearch) {
        if (isImageSearchSupported(model)) {
            result.push({
                google_search: {
                    searchTypes: {
                        webSearch: {},
                        imageSearch: {}
                    }
                }
            })
        } else {
            result.push({ google_search: {} })
        }
    }

    if (codeExecution) {
        result.push({ code_execution: {} })
    }

    if (urlContext) {
        result.push({ urlContext: {} })
    }
}

export function formatToolsToGeminiAITools(
    tools: StructuredTool[],
    config: Config,
    model: string
): ChatTool[] | undefined {
    // 没有任何工具需要注册时直接返回
    if (
        tools.length < 1 &&
        !config.googleSearch &&
        !config.codeExecution &&
        !config.urlContext
    ) {
        return undefined
    }

    const functions = tools.map(formatToolToGeminiAITool)
    const result: ChatTool[] = []

    // --- 处理内置工具（googleSearch / codeExecution / urlContext）---
    let { googleSearch, codeExecution, urlContext } = config

    if (
        (googleSearch || codeExecution || urlContext) &&
        isCustomToolsUnsupported(model, config.imageGeneration)
    ) {
        logger.warn(
            `The model ${model} does not support googleSearch/codeExecution/urlContext. They will be disabled.`
        )
        googleSearch = false
        codeExecution = false
        urlContext = false
    }

    const useBuiltinTools = googleSearch || codeExecution || urlContext

    if (
        functions.length > 0 &&
        (!useBuiltinTools || model.includes('gemini-3'))
    ) {
        result.push({ functionDeclarations: functions })
    } else if (functions.length > 0) {
        logger.warn(
            `The model ${model} does not support combining built-in tools and function calling. Function calling will be disabled.`
        )
    }

    appendBuiltinTools(result, googleSearch, codeExecution, urlContext, model)

    if (result.length < 1) {
        return undefined
    }

    return result
}

export function formatToolToGeminiAITool(
    tool: StructuredTool
): ChatCompletionFunction {
    const parameters = sanitizeGeminiSchema(
        removeAdditionalProperties(
            isZodSchemaV3(tool.schema)
                ? generateSchema(tool.schema as never, true, '3.0')
                : tool.schema
        )
    )

    return {
        name: tool.name,
        description: tool.description,
        parameters: parameters as ChatCompletionFunction['parameters']
    }
}

// Strip keys outside the Gemini `Schema` field set (exclusiveMinimum,
// exclusiveMaximum, discriminator, ...) which upstream rejects with HTTP 400.
const GEMINI_SCHEMA_KEYS = new Set([
    'type',
    'format',
    'title',
    'description',
    'nullable',
    'default',
    'example',
    'enum',
    'items',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    'minProperties',
    'maxProperties',
    'minimum',
    'maximum',
    'pattern',
    'properties',
    'required',
    'propertyOrdering',
    'anyOf'
])

function sanitizeGeminiSchema(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        return schema
    }

    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(schema)) {
        if (key === 'oneOf' || key === 'anyOf') {
            result['anyOf'] = (value as unknown[]).map(sanitizeGeminiSchema)
            continue
        }
        if (!GEMINI_SCHEMA_KEYS.has(key)) continue
        if (key === 'items') {
            result['items'] = sanitizeGeminiSchema(value)
            continue
        }
        if (key === 'properties') {
            result['properties'] = Object.fromEntries(
                Object.entries(value as Record<string, unknown>).map(
                    ([name, sub]) => [name, sanitizeGeminiSchema(sub)]
                )
            )
            continue
        }
        result[key] = value
    }
    return result
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
    let forceGoogleSearch = false

    if (
        pluginConfig.additionalModels.some(
            (item) => item.model === model && !isGeminiModelName(item.model)
        )
    ) {
        return {
            model,
            enabledThinking,
            thinkingBudget: pluginConfig.thinkingBudget ?? -1,
            imageGeneration: pluginConfig.imageGeneration ?? false,
            thinkingLevel: undefined,
            imageSize,
            forceGoogleSearch
        }
    }

    if (model.toLowerCase().endsWith('-search')) {
        forceGoogleSearch = true
        model = model.slice(0, -'-search'.length)
    }

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
            if (level === 'minimal' && isGemini3ProFamily(model)) {
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

    // Extract imageSize from model name suffix (e.g., gemini-3-pro-image-2k-search)
    const imageSizeMatch = model.match(/-(0\.5k|05\.k|2k|4k)$/i)
    if (imageSizeMatch) {
        const normalizedSize = imageSizeMatch[1].toLowerCase()
        imageSize =
            normalizedSize === '0.5k' || normalizedSize === '05.k'
                ? '0.5K'
                : normalizedSize.toUpperCase()
        model = model.replace(/-(0\.5k|05\.k|2k|4k)$/i, '')
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
        imageSize,
        forceGoogleSearch
    }
}

export function createSafetySettings() {
    return [
        {
            category: 'HARM_CATEGORY_HARASSMENT',
            threshold: 'OFF'
        },
        {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            threshold: 'OFF'
        },
        {
            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
            threshold: 'OFF'
        },
        {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            threshold: 'OFF'
        },
        {
            category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
            threshold: 'OFF'
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

    const includeServerSideToolInvocationKey =
        pluginConfig.useCamelCaseSystemInstruction
            ? 'includeServerSideToolInvocations'
            : 'include_server_side_tool_invocations'

    const tools =
        params.tools != null ||
        modelConfig.forceGoogleSearch ||
        pluginConfig.googleSearch ||
        pluginConfig.codeExecution ||
        pluginConfig.urlContext
            ? formatToolsToGeminiAITools(
                  params.tools ?? [],
                  {
                      ...pluginConfig,
                      googleSearch:
                          pluginConfig.googleSearch ||
                          modelConfig.forceGoogleSearch
                  },
                  modelConfig.model
              )
            : undefined
    const hasBuiltinTools = tools?.some(
        (tool) =>
            tool.google_search != null ||
            tool.code_execution != null ||
            tool.urlContext != null
    )

    return {
        contents: modelMessages,
        safetySettings: createSafetySettings(),
        generationConfig: createGenerationConfig(
            params,
            modelConfig,
            pluginConfig
        ),
        [systemInstructionKey]:
            systemInstruction != null ? systemInstruction : undefined,
        tools,
        toolConfig:
            modelConfig.model.includes('gemini-3') && hasBuiltinTools
                ? {
                      [includeServerSideToolInvocationKey]: true
                  }
                : undefined
    }
}

// #region refreshModels helpers

export function isGeminiModelName(model: string): boolean {
    const name = model.toLowerCase().split('/').pop() ?? model.toLowerCase()
    return /^gemini(?:-|$)/.test(name)
}

export function createGeminiCapabilities(
    modelNameLower: string,
    isEmbedding: boolean
): ModelCapabilities[] {
    if (isEmbedding) {
        return []
    }

    // Keep previous fallback behavior for non-Gemini model names (e.g. gemma).
    if (!modelNameLower.includes('gemini')) {
        return [ModelCapabilities.ImageInput, ModelCapabilities.ToolCall]
    }

    // Rules derived from models.dev (google provider):
    // - *-tts: text only
    // - *-image: image input only
    // - gemini-live native-audio: audio/video (no image/pdf)
    // - newer flash/pro/flash-lite: image/audio/video/pdf
    const isTtsModel = modelNameLower.includes('-tts')
    const isImageOnlyModel = modelNameLower.includes('-image')
    const isLiveModel = modelNameLower.includes('gemini-live')
    const isNativeAudioLiveModel = modelNameLower.includes('native-audio')

    const capabilities: ModelCapabilities[] = []

    if (!isTtsModel && !isImageOnlyModel) {
        capabilities.push(ModelCapabilities.ToolCall)
    }

    if (isTtsModel) {
        return capabilities
    }

    if (isImageOnlyModel) {
        capabilities.push(ModelCapabilities.ImageInput)
        return capabilities
    }

    if (!isNativeAudioLiveModel) {
        capabilities.push(ModelCapabilities.ImageInput)
    }

    capabilities.push(
        ModelCapabilities.AudioInput,
        ModelCapabilities.VideoInput
    )

    if (!isLiveModel) {
        capabilities.push(ModelCapabilities.FileInput)
    }

    return capabilities
}

export function shouldFilterOutGeminiModel(modelNameLower: string): boolean {
    const name = modelNameLower.slice(modelNameLower.lastIndexOf('/') + 1)

    return (
        name.includes('-tts') ||
        name.includes('gemini-live-') ||
        (name.startsWith('gemini-') && Number(name.split('-')[1]) < 2)
    )
}

/** 判断是否属于 gemini-3-pro / gemini-3.1-pro 系列（影响 thinking 等级列表） */
export function isGemini3ProFamily(modelName: string): boolean {
    return /gemini-3(\.1)?-pro/.test(modelName)
}

/** 图片生成模型支持的分辨率变体 */
const IMAGE_MODEL_RESOLUTIONS: [string, string[]][] = [
    ['gemini-3-pro-image', ['-2k', '-4k']],
    ['gemini-3.1-flash-image', ['-0.5k', '-2k', '-4k']]
]

/** 计算模型需要展开的变体后缀（图片分辨率 / 搜索、thinking 开关与等级） */
export function getModelVariantSuffixes(
    name: string,
    imageModelSearch: boolean
): string[] {
    const resolutions = IMAGE_MODEL_RESOLUTIONS.find(([model]) =>
        name.includes(model)
    )?.[1]

    if (resolutions) {
        if (!imageModelSearch) return resolutions
        return [
            ...resolutions,
            '-search',
            ...resolutions.map((r) => `${r}-search`)
        ]
    }

    if (name.includes('image')) return []

    if (name.includes('gemini-2.5')) {
        return name.includes('-thinking') ? [] : ['-non-thinking', '-thinking']
    }

    if (!/gemini-3(-pro|-flash|\.5-flash|\.1-pro)/.test(name)) return []

    // gemini-3-pro（不含 3.1）不提供 medium 等级
    return (
        /(^|\/)gemini-3-pro/.test(name)
            ? ['low', 'high', 'minimal']
            : ['low', 'high', 'minimal', 'medium']
    ).map((level) => `-${level}-thinking`)
}

// #endregion

export function getModalityTokens(
    details: GeminiUsageMetadata['promptTokensDetails'],
    modality: string
) {
    return details?.find((item) => item.modality === modality)?.tokenCount
}

function getCompletionTokens(data: ChatResponse) {
    if (data.usageMetadata?.candidatesTokenCount != null) {
        return (
            data.usageMetadata.candidatesTokenCount +
            (data.usageMetadata.thoughtsTokenCount ?? 0)
        )
    }

    let total = 0
    for (const candidate of data.candidates ?? []) {
        total += candidate.tokenCount ?? 0
    }
    return total
}

export function getUsage(data: ChatResponse) {
    const usage = data.usageMetadata
    if (usage == null) {
        return
    }

    return {
        promptTokens: usage.promptTokenCount,
        completionTokens: getCompletionTokens(data),
        totalTokens: usage.totalTokenCount,
        inputAudioTokens: getModalityTokens(usage.promptTokensDetails, 'AUDIO'),
        inputImageTokens: getModalityTokens(usage.promptTokensDetails, 'IMAGE'),
        outputImageTokens: getModalityTokens(
            usage.candidatesTokensDetails,
            'IMAGE'
        ),
        outputAudioTokens: getModalityTokens(
            usage.candidatesTokensDetails,
            'AUDIO'
        ),
        cacheReadTokens: usage.cachedContentTokenCount,
        reasoningTokens: usage.thoughtsTokenCount
    }
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
