import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    MessageType,
    ToolMessage
} from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { removeAdditionalProperties } from '@chatluna/v1-shared-adapter'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    ChatCompletionDelta,
    ChatCompletionMessage,
    ChatCompletionMessageRoleEnum,
    ChatCompletionTool
} from './types'
import { isZodSchemaV3 } from '@langchain/core/utils/types'

export function langchainMessageToSparkMessage(
    messages: BaseMessage[],
    removeSystemMessage?: boolean
): ChatCompletionMessage[] {
    const mappedMessage = messages.map((it) => {
        const role = messageTypeSparkAIRole(it.getType())

        const msg: ChatCompletionMessage = {
            role,
            tool_call_id: (it as ToolMessage).tool_call_id,
            content: it.content as string,
            name: role === 'assistant' || role === 'tool' ? it.name : undefined
        }

        if (it.getType() === 'ai') {
            const toolCalls = (it as AIMessage).tool_calls

            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                msg.tool_calls = toolCalls.map((toolCall) => ({
                    id: toolCall.id,
                    type: 'function',
                    function: {
                        name: toolCall.name,
                        arguments: JSON.stringify(toolCall.args)
                    }
                }))
            }
        }

        return msg
    })

    const result: ChatCompletionMessage[] = []

    for (let i = 0; i < mappedMessage.length; i++) {
        const message = mappedMessage[i]

        if (message.role !== 'system') {
            result.push(message)
            continue
        }

        if (removeSystemMessage) {
            continue
        }

        result.push({
            role: 'user',
            content: message.content
        })

        result.push({
            role: 'assistant',
            content: 'Okay, what do I need to do?'
        })

        if (mappedMessage?.[i + 1]?.role === 'assistant') {
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

export function convertDeltaToMessageChunk(
    delta: ChatCompletionDelta,
    defaultRole: string
): AIMessageChunk {
    const content = delta.content || ''

    const chunk = new AIMessageChunk({
        content,
        additional_kwargs: {}
    })

    if (delta.tool_calls && delta.tool_calls.length > 0) {
        chunk.additional_kwargs.tool_calls = delta.tool_calls.map(
            (toolCall) => ({
                id: toolCall.id,
                type: toolCall.type,
                function: {
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments
                }
            })
        )
    }

    // Handle reasoning content for thinking models
    if (delta.reasoning_content) {
        chunk.additional_kwargs.reasoning_content = delta.reasoning_content
    }

    return chunk
}

export function messageTypeSparkAIRole(
    type: MessageType
): ChatCompletionMessageRoleEnum {
    switch (type) {
        case 'system':
            return 'system'
        case 'ai':
            return 'assistant'
        case 'human':
            return 'user'
        case 'function':
            return 'tool'
        case 'tool':
            return 'tool'
        default:
            throw new Error(`Unknown message type: ${type}`)
    }
}

export function formatToolsToSparkTools(
    tools: StructuredTool[]
): ChatCompletionTool[] {
    if (tools.length < 1) {
        return undefined
    }
    return tools.map(formatToolToSparkTool)
}

export function formatToolToSparkTool(
    tool: StructuredTool
): ChatCompletionTool {
    const parameters = removeAdditionalProperties(
        isZodSchemaV3(tool.schema)
            ? zodToJsonSchema(tool.schema as never, {
                  allowedAdditionalProperties: undefined
              })
            : tool.schema
    )

    return {
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters
        }
    }
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
