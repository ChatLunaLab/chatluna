import { BaseMessage } from '@langchain/core/messages'
import type { StructuredTool } from '@langchain/core/tools'
import {
    convertDeltaToMessageChunk as convertOpenAIDeltaToMessageChunk,
    formatToolsToOpenAITools,
    langchainMessageToOpenAIMessage
} from '@chatluna/v1-shared-adapter'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    ChatCompletionDelta,
    ChatCompletionMessage,
    ChatCompletionMessageRoleEnum,
    ChatCompletionTool
} from './types'

function transformSparkSystemMessages(
    messages: ChatCompletionMessage[]
): ChatCompletionMessage[] {
    const result: ChatCompletionMessage[] = []

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]

        if (msg.role !== 'system') {
            result.push(msg)
            continue
        }

        result.push({
            role: 'user',
            content: msg.content
        })

        result.push({
            role: 'assistant',
            content: 'Okay, what do I need to do?'
        })

        if (messages[i + 1]?.role === 'assistant') {
            result.push({
                role: 'user',
                content:
                    'Continue what I said to you last message. Follow these instructions.'
            })
        }
    }

    if (result[result.length - 1].role === 'assistant') {
        result.push({
            role: 'user',
            content:
                'Continue what I said to you last message. Follow these instructions.'
        })
    }

    if (result[0].role === 'assistant') {
        result.unshift({
            role: 'user',
            content:
                'Continue what I said to you last time. Follow these instructions.'
        })
    }

    return result
}

export async function langchainMessageToSparkMessage(
    messages: BaseMessage[],
    plugin: ChatLunaPlugin,
    model: string,
    removeSystemMessage?: boolean
): Promise<ChatCompletionMessage[]> {
    const result = (
        await langchainMessageToOpenAIMessage(messages, plugin, model, false)
    ).map((msg) => {
        if (msg.role !== 'function') {
            return msg as ChatCompletionMessage
        }

        return {
            ...msg,
            role: 'tool'
        } satisfies ChatCompletionMessage
    })

    if (!removeSystemMessage) {
        return result
    }

    return transformSparkSystemMessages(result)
}

export function convertDeltaToMessageChunk(
    delta: ChatCompletionDelta,
    defaultRole?: ChatCompletionMessageRoleEnum
) {
    return convertOpenAIDeltaToMessageChunk(delta, defaultRole)
}

export function formatToolsToSparkTools(
    tools: StructuredTool[]
): ChatCompletionTool[] {
    return formatToolsToOpenAITools(tools, false) as ChatCompletionTool[]
}

export interface SparkModelDefinition {
    name: string
    httpModel: string
    apiPath: string
    maxTokens: number
    capabilities: ModelCapabilities[]
    modelAliases?: string[]
    passwordAliases?: string[]
    removeSystemMessage?: boolean
}

export const sparkModelCatalog: SparkModelDefinition[] = [
    {
        name: 'spark-lite',
        httpModel: 'lite',
        apiPath: 'v1/chat/completions',
        maxTokens: 8192,
        capabilities: [],
        modelAliases: ['general', 'generalv1', 'lite']
    },
    {
        name: 'spark-pro',
        httpModel: 'generalv3',
        apiPath: 'v1/chat/completions',
        maxTokens: 8192,
        capabilities: [],
        modelAliases: ['generalv3']
    },
    {
        name: 'spark-pro-128k',
        httpModel: 'pro-128k',
        apiPath: 'v1/chat/completions',
        maxTokens: 128000,
        capabilities: [],
        modelAliases: ['pro-128k']
    },
    {
        name: 'spark-max',
        httpModel: 'generalv3.5',
        apiPath: 'v1/chat/completions',
        maxTokens: 8192,
        capabilities: [ModelCapabilities.ToolCall],
        modelAliases: ['generalv3.5']
    },
    {
        name: 'spark-max-32k',
        httpModel: 'max-32k',
        apiPath: 'v1/chat/completions',
        maxTokens: 32768,
        capabilities: [ModelCapabilities.ToolCall],
        modelAliases: ['max-32k']
    },
    {
        name: 'spark-4.0-ultra',
        httpModel: '4.0Ultra',
        apiPath: 'v1/chat/completions',
        maxTokens: 128000,
        capabilities: [ModelCapabilities.ToolCall],
        modelAliases: ['4.0Ultra']
    },
    {
        name: 'spark-x1.5',
        httpModel: 'spark-x',
        apiPath: 'v2/chat/completions',
        maxTokens: 128000,
        capabilities: [ModelCapabilities.ToolCall],
        modelAliases: ['spark-x1', 'x1', 'x1.5'],
        passwordAliases: ['spark-x'],
        removeSystemMessage: true
    },
    {
        name: 'spark-x2',
        httpModel: 'spark-x',
        apiPath: 'x2/chat/completions',
        maxTokens: 128000,
        capabilities: [ModelCapabilities.ToolCall],
        modelAliases: ['x2'],
        passwordAliases: ['spark-x'],
        removeSystemMessage: true
    }
]

const modelMappingEntries = sparkModelCatalog.flatMap((definition) =>
    [definition.name, ...(definition.modelAliases ?? [])].map(
        (alias) => [alias, definition] as const
    )
)

export const modelMapping = Object.fromEntries(modelMappingEntries) as Record<
    string,
    SparkModelDefinition
>

export const defaultSparkAppConfig = Object.freeze(
    Object.fromEntries(
        sparkModelCatalog.map((definition) => [definition.name, ''])
    ) as Record<string, string>
)

export function getSparkModelDefinition(
    model: string
): SparkModelDefinition | undefined {
    return modelMapping[model]
}

export function getSparkModelConfigAliases(model: string): string[] {
    const definition = getSparkModelDefinition(model)
    const aliases = definition
        ? [
              definition.name,
              definition.httpModel,
              ...(definition.modelAliases ?? []),
              ...(definition.passwordAliases ?? [])
          ]
        : [model]

    return [
        ...new Set([
            ...aliases,
            ...aliases
                .filter((alias) => alias.includes('-'))
                .map((alias) => humanizeSparkAlias(alias))
        ])
    ]
}

export function getSparkModelPassword(
    apiPasswords: Record<string, string>,
    model: string
): string | undefined {
    for (const alias of getSparkModelConfigAliases(model)) {
        const value = apiPasswords[alias]?.trim()

        if (value?.length > 0) {
            return value
        }
    }

    return undefined
}

export function hasSparkModelPassword(
    apiPasswords: Record<string, string>,
    model: string
): boolean {
    return getSparkModelPassword(apiPasswords, model) != null
}

function humanizeSparkAlias(alias: string): string {
    return alias
        .split('-')
        .map((segment) => {
            if (segment.length < 1) {
                return segment
            }

            return segment.charAt(0).toUpperCase() + segment.slice(1)
        })
        .join(' ')
}
