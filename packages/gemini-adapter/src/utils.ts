/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    AIMessageChunk,
    BaseMessage,
    ChatMessageChunk,
    HumanMessageChunk,
    MessageType,
    SystemMessageChunk
} from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { JsonSchema7Type, zodToJsonSchema } from 'zod-to-json-schema'
import {
    ChatCompletionFunction,
    ChatCompletionResponseMessage,
    ChatCompletionResponseMessageRoleEnum,
    ChatMessagePart,
    ChatPart
} from './types'
import { Config, logger } from '.'

export async function langchainMessageToGeminiMessage(
    messages: BaseMessage[],
    model?: string
): Promise<ChatCompletionResponseMessage[]> {
    const mappedMessage = await Promise.all(
        messages.map(async (rawMessage) => {
            const role = messageTypeToGeminiRole(rawMessage.getType())

            if (
                role === 'function' ||
                rawMessage.additional_kwargs?.function_call != null
            ) {
                return {
                    role: 'function',
                    parts: [
                        {
                            functionResponse:
                                rawMessage.additional_kwargs?.function_call !=
                                null
                                    ? undefined
                                    : {
                                          name: rawMessage.name,
                                          response: {
                                              name: rawMessage.name,
                                              content: (() => {
                                                  try {
                                                      const result = JSON.parse(
                                                          rawMessage.content as string
                                                      )

                                                      if (
                                                          typeof result ===
                                                          'string'
                                                      ) {
                                                          return {
                                                              response: result
                                                          }
                                                      } else {
                                                          return result
                                                      }
                                                  } catch (e) {
                                                      return {
                                                          response:
                                                              rawMessage.content
                                                      }
                                                  }
                                              })()
                                          }
                                      },
                            functionCall:
                                rawMessage.additional_kwargs?.function_call !=
                                null
                                    ? {
                                          name: rawMessage.additional_kwargs
                                              .function_call.name,
                                          args: (() => {
                                              try {
                                                  const result = JSON.parse(
                                                      rawMessage
                                                          .additional_kwargs
                                                          .function_call
                                                          .arguments
                                                  )

                                                  if (
                                                      typeof result === 'string'
                                                  ) {
                                                      return {
                                                          input: result
                                                      }
                                                  } else {
                                                      return result
                                                  }
                                              } catch (e) {
                                                  return {
                                                      input: rawMessage
                                                          .additional_kwargs
                                                          .function_call
                                                          .arguments
                                                  }
                                              }
                                          })()
                                      }
                                    : undefined
                        }
                    ]
                }
            }

            const images = rawMessage.additional_kwargs.images as
                | string[]
                | null

            const result: ChatCompletionResponseMessage = {
                role,
                parts: [
                    {
                        text: rawMessage.content as string
                    }
                ]
            }

            if (
                (model.includes('vision') ||
                    model.includes('gemini') ||
                    model.includes('gemma')) &&
                images != null &&
                !model.includes('gemini-1.0')
            ) {
                for (const image of images) {
                    const mineType = image.split(';')?.[0]?.split(':')?.[1]

                    const data = image.replace(/^data:image\/\w+;base64,/, '')

                    result.parts.push({
                        inline_data: {
                            // base64 image match type
                            data,
                            mime_type: mineType ?? 'image/jpeg'
                        }
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

            return result
        })
    )

    const result: ChatCompletionResponseMessage[] = []

    for (let i = 0; i < mappedMessage.length; i++) {
        const message = mappedMessage[i]

        if (message.role !== 'system') {
            result.push(message)
            continue
        }

        /*   if (removeSystemMessage) {
            continue
        } */

        result.push({
            role: 'user',
            parts: message.parts
        })

        const nextMessage = mappedMessage?.[i + 1]

        if (nextMessage?.role === 'model') {
            continue
        }

        if (nextMessage?.role === 'user' || nextMessage?.role === 'system') {
            result.push({
                role: 'model',
                parts: [{ text: 'Okay, what do I need to do?' }]
            })
        }

        if (nextMessage?.role === 'system') {
            result.push({
                role: 'user',
                parts: [
                    {
                        text: 'Continue what I said to you last message. Follow these instructions.'
                    }
                ]
            })
        }
    }

    if (result[result.length - 1].role === 'model') {
        result.push({
            role: 'user',
            parts: [
                {
                    text: 'Continue what I said to you last message. Follow these instructions.'
                }
            ]
        })
    }

    return result
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
        'gemini-2.0-flash-exp-image-generation'
    ]

    let googleSearch = config.googleSearch

    if (functions.length > 0 && !googleSearch) {
        result.push({
            functionDeclarations: functions
        })
    } else if (functions.length > 0 && googleSearch) {
        logger.warn('Google search is enabled, tool calling will be disable.')
    } else if (
        (unsupportedModels.some((unsupportedModel) =>
            model.includes(unsupportedModel)
        ) ||
            (imageGenerationModels.some((unsupportedModels) =>
                model.includes(unsupportedModels)
            ) &&
                config.imageGeneration)) &&
        googleSearch
    ) {
        logger.warn(
            `The model ${model} does not support google search. google search will be disable.`
        )
        googleSearch = false
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

    return result
}

export function formatToolToGeminiAITool(
    tool: StructuredTool
): ChatCompletionFunction {
    const parameters = removeAdditionalProperties(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zodToJsonSchema(tool.schema as any, {
            allowedAdditionalProperties: undefined
        })
    )

    return {
        name: tool.name,
        description: tool.description,
        // any?
        parameters
    }
}

function removeAdditionalProperties(schema: JsonSchema7Type): JsonSchema7Type {
    if (!schema || typeof schema !== 'object') return schema

    const stack: [JsonSchema7Type, string | null][] = [[schema, null]]

    while (stack.length > 0) {
        const [current] = stack.pop()

        if (typeof current !== 'object' || current === null) continue

        // Remove additionalProperties and $schema
        if (Object.hasOwn(current, 'additionalProperties')) {
            delete current['additionalProperties']
        }

        if (Object.hasOwn(current, '$schema')) {
            delete current['$schema']
        }

        // Process all keys in the object
        for (const key of Object.keys(current)) {
            const value = current[key]
            if (value && typeof value === 'object') {
                stack.push([value, key])
            }
        }
    }

    return schema
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
        case 'function':
            return 'function'
        default:
            throw new Error(`Unknown message type: ${type}`)
    }
}

export function convertDeltaToMessageChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delta: Record<string, any>,
    defaultRole?: ChatCompletionResponseMessageRoleEnum
) {
    const role = delta.role ?? defaultRole
    const content = delta.content ?? ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
    let additional_kwargs: { function_call?: any; tool_calls?: any }
    if (delta.function_call) {
        additional_kwargs = {
            function_call: delta.function_call
        }
    } else if (delta.tool_calls) {
        additional_kwargs = {
            tool_calls: delta.tool_calls
        }
    } else {
        additional_kwargs = {}
    }
    if (role === 'user') {
        return new HumanMessageChunk({ content })
    } else if (role === 'assistant') {
        return new AIMessageChunk({ content, additional_kwargs })
    } else if (role === 'system') {
        return new SystemMessageChunk({ content })
    } else {
        return new ChatMessageChunk({ content, role })
    }
}
