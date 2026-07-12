import { Context, Logger, Session } from 'koishi'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from 'koishi-plugin-chatluna/chains'
import { Config } from '../../config'
import { Message } from '../../types'
import {
    formatToolCall,
    formatUserPromptString,
    getMessageContent,
    getSystemPromptVariables,
    PresetPostHandler
} from 'koishi-plugin-chatluna/utils/string'
import type { ConversationRecord } from '../../types'
import {
    BaseMessageChunk,
    MessageContent,
    UsageMetadata
} from '@langchain/core/messages'
import { AgentAction } from 'koishi-plugin-chatluna/llm-core/agent'
import { ReplyStream } from '../../render/stream'

let logger: Logger
export function apply(ctx: Context, config: Config, chain: ChatChain) {
    logger = createLogger(ctx)
    chain
        .middleware('request_conversation', async (session, context) => {
            const { inputMessage } = context.options
            const invocation = context.options.invocation
            let replyStream: ReplyStream | undefined
            let captureOnly = false

            try {
                await ctx.chatluna.chatRuntime.request(session, {
                    conversation: context.options.conversation,
                    prepare: async ({ conversation, resolution }) => {
                        context.options.conversation = resolution

                        const presetTemplate = ctx.chatluna.preset.getPreset(
                            conversation.preset
                        ).value

                        if (presetTemplate == null) {
                            throw new ChatLunaError(
                                ChatLunaErrorCode.PRESET_NOT_FOUND,
                                new Error(
                                    `Preset ${conversation.preset} not found`
                                )
                            )
                        }

                        const originContent = inputMessage.content

                        if (presetTemplate.formatUserPromptString != null) {
                            inputMessage.content = await processUserPrompt(
                                config,
                                presetTemplate,
                                session,
                                inputMessage.content,
                                conversation
                            )
                        }

                        const postHandler = presetTemplate.config?.postHandler
                            ? new PresetPostHandler(
                                  ctx,
                                  config,
                                  presetTemplate.config?.postHandler
                              )
                            : undefined

                        const shouldSend =
                            invocation?.delivery !== 'capture' &&
                            invocation?.delivery !== 'silent'
                        captureOnly =
                            invocation?.delivery === 'capture' ||
                            invocation?.delivery === 'silent'
                        const deliverySession =
                            context.options.deliverySession ?? session
                        replyStream = ctx.chatluna.renderer.createStream(
                            context,
                            {
                                enabled:
                                    config.streamResponse &&
                                    shouldSend &&
                                    context.options.deliverySession == null,
                                send: shouldSend && !captureOnly,
                                renderOptions: {
                                    ...context.options.renderOptions,
                                    session: deliverySession,
                                    prefix: presetTemplate.config?.postHandler
                                        ?.prefix,
                                    postfix:
                                        presetTemplate.config?.postHandler
                                            ?.postfix
                                }
                            }
                        )

                        inputMessage.conversationId = conversation.id
                        inputMessage.name =
                            context.options.messageName ??
                            (invocation?.source.kind === 'agent-task'
                                ? 'task'
                                : (session.author?.name ??
                                  session.author?.id ??
                                  session.username))

                        return {
                            message: inputMessage,
                            chat: {
                                event: createChatCallbacks(
                                    context,
                                    config,
                                    replyStream,
                                    captureOnly
                                ),
                                stream: config.streamResponse && shouldSend,
                                variables: {
                                    prompt: getMessageContent(originContent),
                                    ...getSystemPromptVariables(
                                        session,
                                        config,
                                        conversation
                                    ),
                                    ...invocation?.variables
                                },
                                postHandler,
                                requestId: context.options.messageId,
                                toolMask: invocation?.toolMask,
                                signal: invocation?.signal,
                                persist: invocation?.persist !== false
                            }
                        }
                    },
                    onResponse: async ({ response, resolution }) => {
                        context.options.conversation = resolution
                        context.options.finalResponseMessage = response
                        if (replyStream != null) {
                            await replyStream.end(
                                captureOnly
                                    ? undefined
                                    : {
                                          type: 'done',
                                          message: response
                                      }
                            )
                        }
                        context.options.responseMessage = null
                        context.message = null
                    }
                })

                return ChainMiddlewareRunStatus.CONTINUE
            } catch (e) {
                const err = e?.message?.includes('output values have 1 keys')
                    ? new ChatLunaError(
                          ChatLunaErrorCode.MODEL_RESPONSE_IS_EMPTY
                      )
                    : e

                if (replyStream != null) {
                    await replyStream.end({ type: 'error', error: err })
                }
                throw err
            }
        })
        .after('lifecycle-request_conversation')
}

function createChatCallbacks(
    context: ChainMiddlewareContext,
    config: Config,
    stream: ReplyStream,
    captureOnly: boolean
) {
    return {
        'llm-new-chunk': captureOnly
            ? async () => {}
            : async (chunk?: BaseMessageChunk) => {
                  if (chunk == null) {
                      await stream.end()
                      return
                  }
                  await stream.write({ type: 'content', chunk })
              },
        'llm-queue-waiting': async (count: number) => {
            context.options.queueCount = count
        },
        'llm-usage': async (usage: UsageMetadata) => {
            if (context.options.invocation != null) {
                context.options.invocation.usage = usage
            }
        },
        'llm-call-tool': captureOnly
            ? async () => {}
            : async (
                  tool: string,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  arg: any,
                  content: AgentAction['content'],
                  log: string
              ) => {
                  logger.debug(`Call tool: ${tool} with ${JSON.stringify(arg)}`)
                  if (
                      content != null &&
                      ((typeof content === 'string' &&
                          content.trim().length > 0) ||
                          (Array.isArray(content) && content.length > 0))
                  ) {
                      await stream.write({
                          type: 'mark',
                          name: 'tool_result',
                          content,
                          instant: true
                      })
                      return
                  }
                  if (!config.showThoughtMessage) return
                  if (!(log.includes('Invoking') && log.includes('with'))) {
                      await stream.write({
                          type: 'mark',
                          name: 'tool',
                          content: log,
                          instant: true
                      })
                      return
                  }
                  await stream.write({
                      type: 'mark',
                      name: 'tool',
                      content: formatToolCall(context.session, tool),
                      instant: true
                  })
              }
    }
}

async function processUserPrompt(
    config: Config,
    presetTemplate: PresetTemplate,
    session: Session,
    originContent: MessageContent,
    conversation: Pick<
        ConversationRecord,
        'preset' | 'id' | 'updatedAt' | 'lastChatAt'
    >
) {
    if (typeof originContent === 'string') {
        return (
            await formatUserPromptString(
                config,
                presetTemplate,
                session,
                originContent,
                conversation
            )
        ).text
    }

    // Preserve interleaved multimodal order; do not sort text ahead of media.
    return Promise.all(
        originContent.map(async (message) => {
            if (message.type !== 'text') return message
            const text = (
                await formatUserPromptString(
                    config,
                    presetTemplate,
                    session,
                    message.text,
                    conversation
                )
            ).text
            return { type: 'text' as const, text }
        })
    )
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        request_conversation: never
    }

    interface ChainMiddlewareContextOptions {
        responseMessage?: Message
        finalResponseMessage?: Message
        inputMessage?: Message
        queueCount?: number
    }
}
