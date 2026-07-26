import { randomUUID } from 'crypto'
import { h, Session, Universal } from 'koishi'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/koishi'
import { buildVirtualSession } from 'koishi-plugin-chatluna/utils/virtual_session'
import {
    ActiveConversationResolution,
    ChatInvocationContext,
    ChatInvocationInput,
    ChatInvocationResult,
    ConversationRecord,
    ConversationResolution,
    Message
} from '../../types'
import type { ChatLunaService } from '../../services/chat'
import type { ChatOptions } from '../../services/conversation_runtime'

export class ChatRuntime {
    constructor(private readonly service: ChatLunaService) {}

    async invoke(input: ChatInvocationInput): Promise<ChatInvocationResult> {
        const requestId = randomUUID()
        const controller = new AbortController()
        const onAbort = () => controller.abort(input.signal?.reason)
        const state = { timedOut: false }
        let conversation: ConversationRecord | undefined
        let usage: ChatInvocationContext['usage']
        let cleanup: ConversationRecord | undefined

        if (input.signal?.aborted) {
            controller.abort(input.signal.reason)
        } else {
            input.signal?.addEventListener('abort', onAbort, { once: true })
        }

        const timer =
            input.timeout == null
                ? undefined
                : this.service.ctx.setTimeout(() => {
                      state.timedOut = true
                      controller.abort()
                  }, input.timeout)

        try {
            if (controller.signal.aborted) throw abortErr(state.timedOut)

            const session = await this.resolveSession(input)
            if (session == null) {
                if (input.routing == null) {
                    throw new ChatLunaError(
                        ChatLunaErrorCode.INVOCATION_ROUTING_REQUIRED,
                        new Error('A session or routing target is required.')
                    )
                }
                throw new ChatLunaError(
                    ChatLunaErrorCode.BOT_NOT_FOUND,
                    new Error(
                        `Bot ${input.routing.platform}:${input.routing.selfId} was not found.`
                    )
                )
            }
            if (session.bot.status !== Universal.Status.ONLINE) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.BOT_OFFLINE,
                    new Error(
                        `Bot ${session.platform}:${session.selfId} is offline.`
                    )
                )
            }

            if (input.model != null) this.checkModel(input.model)
            if (input.preset != null) this.checkPreset(input.preset)

            const persist = input.persist !== false
            const resolved = await this.service.conversation.prepareInvocation(
                session,
                {
                    target: input.conversation,
                    requestId,
                    model: input.model,
                    preset: input.preset,
                    persist
                }
            )
            conversation = resolved.conversation
            this.checkModel(conversation.model)
            this.checkPreset(conversation.preset)

            let deliverySession: Session | undefined
            if (input.delivery === 'direct' && !session.isDirect) {
                deliverySession = await buildVirtualSession(
                    session.bot,
                    {
                        platform: session.platform,
                        selfId: session.selfId,
                        userId: session.userId,
                        username: session.username,
                        isDirect: true
                    },
                    {
                        message: input.message,
                        messageName: input.messageName
                    }
                )
            }

            const invocation: ChatInvocationContext = {
                requestId,
                delivery: input.delivery,
                source: input.source,
                variables: input.variables ?? {},
                toolMask: input.tools,
                signal: controller.signal,
                persist: persist && input.conversation.type !== 'ephemeral'
            }
            if (resolved.transient) cleanup = conversation
            if (controller.signal.aborted) {
                throw abortErr(state.timedOut)
            }

            const run = await this.service.chatChain.runCommand(
                session,
                'chat',
                {
                    message:
                        typeof input.message === 'string'
                            ? [h.text(input.message)]
                            : transformMessageContentToElements(input.message),
                    messageId: requestId,
                    messageName: input.messageName,
                    conversation: resolved,
                    invocation,
                    deliverySession
                }
            )
            usage = invocation.usage
            const reply = run.context.options.finalResponseMessage
            const error = run.context.options.error
            if (controller.signal.aborted) {
                throw abortErr(state.timedOut)
            }
            if (!run.ok) {
                if (error instanceof ChatLunaError) throw error
                throw new ChatLunaError(
                    ChatLunaErrorCode.CHAIN_STOPPED,
                    error instanceof Error
                        ? error
                        : new Error(
                              'Chat invocation stopped before completion.'
                          )
                )
            }

            return {
                ok: true,
                requestId,
                model: conversation.model,
                conversation:
                    invocation.persist === false ? undefined : conversation,
                reply: input.delivery === 'silent' ? undefined : reply,
                usage
            }
        } catch (err) {
            return mapFail(requestId, state.timedOut, controller, err, {
                conversation,
                usage
            })
        } finally {
            timer?.()
            input.signal?.removeEventListener('abort', onAbort)
            await this.cleanupTransient(cleanup)
        }
    }

    async request(session: Session, options: RequestOptions) {
        const existing = options.conversation
        const resolved =
            existing?.mode === 'active' && existing.conversation != null
                ? existing
                : await this.service.conversation.ensureActiveConversation(
                      session,
                      {
                          conversationId:
                              existing?.conversationId ??
                              existing?.conversation?.id,
                          bindingKey: existing?.bindingKey,
                          presetLane: existing?.presetLane,
                          useRoutePresetLane: false
                      }
                  )
        const conversation = resolved.conversation
        const resolution: ActiveConversationResolution = {
            ...resolved,
            conversation,
            transient: false
        }
        const prepared = await options.prepare({ conversation, resolution })
        const response = await this.chat(
            session,
            conversation,
            prepared.message,
            prepared.chat
        )
        if (options.onResponse != null) {
            await options.onResponse({ response, conversation, resolution })
        }
        if (prepared.chat.persist !== false) {
            try {
                await this.service.conversation.touchConversation(
                    conversation.id,
                    { lastChatAt: new Date() }
                )
            } catch (err) {
                this.service.ctx.logger.warn(
                    'Failed to touch lastChatAt for conversation %s',
                    conversation.id,
                    err
                )
            }
        }
        return { resolution, conversation, response }
    }

    chat(
        session: Session,
        conversation: ConversationRecord,
        message: Message,
        options: ChatOptions = {}
    ) {
        return this.service.conversationRuntime.chat(
            session,
            conversation,
            message,
            options
        )
    }

    private async resolveSession(
        input: ChatInvocationInput
    ): Promise<Session | undefined> {
        if (input.session != null) return input.session
        if (input.routing == null) return undefined
        const key = `${input.routing.platform}:${input.routing.selfId}`
        const bot = this.service.ctx.bots[key]
        if (bot == null) return undefined
        return await buildVirtualSession(bot, input.routing, {
            message: input.message,
            messageName: input.messageName
        })
    }

    private checkModel(model: string) {
        const [platform, name] = parseRawModelName(model)
        const info =
            platform == null || name == null
                ? null
                : this.service.platform.findModel(platform, name).value
        if (info == null || info.type !== ModelType.llm) {
            throw new ChatLunaError(
                ChatLunaErrorCode.MODEL_NOT_FOUND,
                new Error(`Model ${model} is not available.`)
            )
        }
    }

    private checkPreset(preset: string) {
        if (this.service.preset.getPreset(preset, false).value == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.PRESET_NOT_FOUND,
                new Error(`Preset ${preset} was not found.`)
            )
        }
    }

    private async cleanupTransient(conversation?: ConversationRecord) {
        if (conversation == null) return
        const id = conversation.id
        try {
            await this.service.ctx.database.remove('chatluna_message', {
                conversationId: id
            })
        } catch (err) {
            this.service.ctx.logger.warn(
                'Failed to remove transient messages for conversation %s',
                id,
                err
            )
        }
        try {
            await this.service.ctx.database.remove('chatluna_conversation', {
                id
            })
        } catch (err) {
            this.service.ctx.logger.warn(
                'Failed to remove transient conversation %s',
                id,
                err
            )
        }
        try {
            await this.service.conversationRuntime.clearConversationCache(id)
        } catch (err) {
            this.service.ctx.logger.warn(
                'Failed to clear cache for transient conversation %s',
                id,
                err
            )
        }
    }
}

interface RequestOptions {
    conversation?: ConversationResolution
    invocation?: ChatInvocationContext
    prepare: (args: {
        conversation: ConversationRecord
        resolution: ActiveConversationResolution
    }) => Promise<{ message: Message; chat: ChatOptions }>
    onResponse?: (args: {
        response: Message
        conversation: ConversationRecord
        resolution: ActiveConversationResolution
    }) => Promise<void>
}

function abortErr(timedOut: boolean) {
    return new ChatLunaError(
        timedOut
            ? ChatLunaErrorCode.API_REQUEST_TIMEOUT
            : ChatLunaErrorCode.ABORTED,
        new Error(
            timedOut
                ? 'Chat invocation timed out.'
                : 'Chat invocation was aborted.'
        ),
        timedOut
    )
}

function mapFail(
    requestId: string,
    timedOut: boolean,
    controller: AbortController,
    err: unknown,
    extras: {
        conversation?: ConversationRecord
        usage?: ChatInvocationContext['usage']
    }
): ChatInvocationResult {
    const error = err instanceof Error ? err : new Error(String(err))
    let code = 'invoke_failed'
    let message = error.message

    if (timedOut || controller.signal.aborted || error.name === 'AbortError') {
        code = timedOut ? 'timeout' : 'aborted'
        message = timedOut
            ? 'Chat invocation timed out.'
            : 'Chat invocation was aborted.'
    } else if (err instanceof ChatLunaError) {
        const mapped = INVOKE_ERROR_CODES[err.errorCode]
        if (mapped != null) {
            code = mapped.code
            message = err.originError?.message ?? mapped.fallback ?? err.message
        } else {
            code = `chatluna_${err.errorCode}`
            message = err.originError?.message ?? err.message
        }
    }

    return {
        ok: false,
        requestId,
        conversation: extras.conversation,
        usage: extras.usage,
        error: { code, message }
    }
}

const INVOKE_ERROR_CODES: Partial<
    Record<ChatLunaErrorCode, { code: string; fallback?: string }>
> = {
    [ChatLunaErrorCode.ABORTED]: {
        code: 'aborted',
        fallback: 'Chat invocation was aborted.'
    },
    [ChatLunaErrorCode.API_REQUEST_TIMEOUT]: {
        code: 'timeout',
        fallback: 'Chat invocation timed out.'
    },
    [ChatLunaErrorCode.INVOCATION_ROUTING_REQUIRED]: {
        code: 'routing_required',
        fallback: 'A session or routing target is required.'
    },
    [ChatLunaErrorCode.BOT_NOT_FOUND]: { code: 'bot_not_found' },
    [ChatLunaErrorCode.BOT_OFFLINE]: { code: 'bot_offline' },
    [ChatLunaErrorCode.MODEL_NOT_FOUND]: { code: 'model_not_found' },
    [ChatLunaErrorCode.PRESET_NOT_FOUND]: { code: 'preset_not_found' },
    [ChatLunaErrorCode.CHAIN_STOPPED]: { code: 'chain_stopped' },
    [ChatLunaErrorCode.CONVERSATION_CREATE_DISABLED]: {
        code: 'allow_new_disabled'
    },
    [ChatLunaErrorCode.CONVERSATION_NOT_FOUND]: {
        code: 'conversation_not_found'
    },
    [ChatLunaErrorCode.CONVERSATION_TARGET_AMBIGUOUS]: {
        code: 'ambiguous_target'
    },
    [ChatLunaErrorCode.CONVERSATION_TARGET_OUTSIDE_ROUTE]: {
        code: 'target_outside_route'
    }
}
