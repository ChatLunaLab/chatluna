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
import { ModelInfo } from 'koishi-plugin-chatluna/llm-core/platform/types'

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

// 不支持 googleSearch / codeExecution / urlContext 的模型列表
const CUSTOM_TOOLS_UNSUPPORTED_MODELS = [
    'gemini-1.0',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-2.0-flash-exp'
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
 * - gemini-1 系列使用旧版 google_search_retrieval 格式
 * - 支持 imageSearch 的模型会在 google_search 中注入 searchTypes
 * - 其余模型使用标准的新版 google_search: {} 格式
 */
function appendBuiltinTools(
    result: Record<string, any>[],
    googleSearch: boolean,
    codeExecution: boolean,
    urlContext: boolean,
    model: string,
    searchThreshold: number
) {
    if (googleSearch) {
        if (model.includes('gemini-1')) {
            result.push({
                google_search_retrieval: {
                    dynamic_retrieval_config: {
                        mode: 'MODE_DYNAMIC',
                        dynamic_threshold: searchThreshold
                    }
                }
            })
        } else if (isImageSearchSupported(model)) {
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
): Record<string, any> {
    // 没有任何工具需要注册时直接返回
    if (tools.length < 1 && !config.googleSearch) {
        return undefined
    }

    const functions = tools.map(formatToolToGeminiAITool)
    const result: Record<string, any>[] = []

    const useCustomTools =
        config.googleSearch || config.codeExecution || config.urlContext

    // --- 处理 functionDeclarations（与自定义工具互斥）---
    if (functions.length > 0 && !useCustomTools) {
        result.push({ functionDeclarations: functions })
    } else if (functions.length > 0 && useCustomTools) {
        logger.warn('Use custom tools instead of tool calls.')
    }

    // --- 处理内置工具（googleSearch / codeExecution / urlContext）---
    let { googleSearch, codeExecution, urlContext } = config

    if (
        useCustomTools &&
        isCustomToolsUnsupported(model, config.imageGeneration)
    ) {
        logger.warn(
            `The model ${model} does not support google search. google search will be disable.`
        )
        googleSearch = false
        codeExecution = false
        urlContext = false
    }

    appendBuiltinTools(
        result,
        googleSearch,
        codeExecution,
        urlContext,
        model,
        config.searchThreshold
    )

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
    let forceGoogleSearch = false

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
            if (level === 'minimal' && /gemini-3(\.1)?-pro/.test(model)) {
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
        safetySettings: createSafetySettings(modelConfig.model),
        generationConfig: createGenerationConfig(
            params,
            modelConfig,
            pluginConfig
        ),
        [systemInstructionKey]:
            systemInstruction != null ? systemInstruction : undefined,
        tools:
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
    }
}

export function isChatResponse(response: any): response is ChatResponse {
    return 'candidates' in response
}

// #region refreshModels helpers

/** 支持 thinking 开关（-thinking / -non-thinking）的模型前缀 */
const THINKING_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash'] as const

/** 支持 thinking 等级（-low/medium/high/minimal-thinking）的模型前缀 */
const THINKING_LEVEL_MODELS = [
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-3.1-pro'
] as const

/**
 * 带分辨率 / 搜索后缀变体的图片生成模型配置。
 * resolutions: 该模型支持的分辨率后缀列表
 * supportSearch: 是否同时生成 -search 变体
 */
export const IMAGE_VARIANT_MODELS = [
    {
        name: 'gemini-3-pro-image',
        resolutions: ['2k', '4k'],
        supportSearch: true
    },
    {
        name: 'gemini-3.1-flash-image',
        resolutions: ['0.5k', '2k', '4k'],
        supportSearch: true
    }
] as const

/** 判断 haystack 中是否包含 needles 里的任意一项 */
export function includesAny(
    needles: readonly string[],
    haystack: string
): boolean {
    return needles.some((name) => haystack.includes(name))
}

/**
 * 将 base 模型连同所有 suffixes 变体一起压入 out 数组。
 * 变体先入，base 最后入，保持列表顺序直观。
 */
export function pushExpanded(
    out: ModelInfo[],
    base: ModelInfo,
    suffixes: readonly string[]
): void {
    for (const suffix of suffixes) {
        out.push({ ...base, name: base.name + suffix })
    }
    out.push(base)
}

/**
 * 查找模型名是否命中 IMAGE_VARIANT_MODELS 中的某一项。
 * 命中则返回该配置，否则返回 undefined。
 */
export function getImageVariantConfig(modelName: string) {
    return IMAGE_VARIANT_MODELS.find((item) => modelName.includes(item.name))
}

/**
 * 为图片生成模型生成所有分辨率 + 搜索后缀的变体并压入 out。
 * 例如：base + -2k / -4k / -search / -2k-search / -4k-search
 */
export function pushImageVariants(
    out: ModelInfo[],
    base: ModelInfo,
    resolutions: readonly string[],
    supportSearch: boolean
): void {
    const resolutionSuffixes = resolutions.map((r) => `-${r}`)
    const searchSuffixes = supportSearch
        ? ['-search', ...resolutions.map((r) => `-${r}-search`)]
        : []

    pushExpanded(out, base, [...resolutionSuffixes, ...searchSuffixes])
}

/** 判断是否属于 gemini-3-pro / gemini-3.1-pro 系列（影响 thinking 等级列表） */
export function isGemini3ProFamily(modelName: string): boolean {
    return /gemini-3(\.1)?-pro/.test(modelName)
}

/**
 * 判断模型是否支持 thinking 开关（gemini-2.5 系列，且不是图片生成模型）。
 */
export function isThinkingModel(modelNameLower: string): boolean {
    return (
        includesAny(THINKING_MODELS, modelNameLower) &&
        !modelNameLower.includes('image')
    )
}

/**
 * 判断模型是否支持 thinking 等级（gemini-3 系列，且不是图片生成模型）。
 */
export function isThinkingLevelModel(modelNameLower: string): boolean {
    return (
        includesAny(THINKING_LEVEL_MODELS, modelNameLower) &&
        !modelNameLower.includes('image')
    )
}

/**
 * 根据模型类型，将模型展开为所有变体后压入 models 数组。
 * 返回 true 表示已处理（调用方应 continue），false 表示未命中任何特殊类型。
 */
export function expandModelVariants(
    models: ModelInfo[],
    base: ModelInfo
): boolean {
    const nameLower = base.name.toLowerCase()

    // 图片生成模型：展开分辨率 + 搜索变体
    const imageVariantConfig = getImageVariantConfig(nameLower)
    if (imageVariantConfig) {
        pushImageVariants(
            models,
            base,
            imageVariantConfig.resolutions,
            imageVariantConfig.supportSearch
        )
        return true
    }

    // gemini-2.5 系列：展开 -thinking / -non-thinking 变体
    if (isThinkingModel(nameLower)) {
        if (nameLower.includes('-thinking')) {
            // 已经是 thinking 变体，直接加入
            models.push(base)
        } else {
            pushExpanded(models, base, ['-non-thinking', '-thinking'])
        }
        return true
    }

    // gemini-3 系列：展开 thinking 等级变体
    if (isThinkingLevelModel(nameLower)) {
        const suffixes = isGemini3ProFamily(nameLower)
            ? ['-low-thinking', '-high-thinking', '-minimal-thinking']
            : [
                  '-low-thinking',
                  '-high-thinking',
                  '-minimal-thinking',
                  '-medium-thinking'
              ]
        pushExpanded(models, base, suffixes)
        return true
    }

    return false
}

// #endregion

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
