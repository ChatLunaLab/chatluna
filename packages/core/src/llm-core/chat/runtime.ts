import { randomUUID } from 'crypto'
import { h, Session, Universal } from 'koishi'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaError } from 'koishi-plugin-chatluna/utils/error'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/koishi'
import { buildVirtualSession } from 'koishi-plugin-chatluna/utils/virtual_session'
import {
    ActiveConversationResolution,
    ChatInvocationContext,
    ChatInvocationInput,
    ChatInvocationResult,
    ConversationInvocationError,
    ConversationRecord,
    ConversationResolution,
    ConversationResolutionError,
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

            const session = this.resolveSession(input)
            if (session == null) {
                if (input.routing == null) {
                    throw new RuntimeFailure(
                        'routing_required',
                        'A session or routing target is required.'
                    )
                }
                throw new RuntimeFailure(
                    'bot_not_found',
                    `Bot ${input.routing.platform}:${input.routing.selfId} was not found.`
                )
            }
            if (session.bot.status !== Universal.Status.ONLINE) {
                throw new RuntimeFailure(
                    'bot_offline',
                    `Bot ${session.platform}:${session.selfId} is offline.`
                )
            }

            if (input.model != null) this.checkModel(input.model)
            if (input.preset != null) this.checkPreset(input.preset)

            const persist = input.persist !== false
            const resolved = await this.service.conversation.resolveInvocation(
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
                deliverySession = buildVirtualSession(
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
            if (invocation.persist === false) cleanup = conversation
            if (controller.signal.aborted) {
                throw abortErr(state.timedOut, conversation)
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
            if (!run.ok || (controller.signal.aborted && reply == null)) {
                if (state.timedOut) throw abortErr(true, conversation)
                if (controller.signal.aborted) {
                    throw abortErr(false, conversation)
                }
                if (error instanceof ChatLunaError) {
                    throw new RuntimeFailure(
                        `chatluna_${error.errorCode}`,
                        error.message,
                        conversation
                    )
                }
                throw new RuntimeFailure(
                    'chain_stopped',
                    error instanceof Error && error.message
                        ? error.message
                        : 'Chat invocation stopped before completion.',
                    conversation
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
            conversation
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

    private resolveSession(input: ChatInvocationInput): Session | undefined {
        if (input.session != null) return input.session
        if (input.routing == null) return undefined
        const key = `${input.routing.platform}:${input.routing.selfId}`
        const bot = this.service.ctx.bots[key]
        if (bot == null) return undefined
        return buildVirtualSession(bot, input.routing, {
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
            throw new RuntimeFailure(
                'model_not_found',
                `Model ${model} is not available.`
            )
        }
    }

    private checkPreset(preset: string) {
        if (this.service.preset.getPreset(preset, false).value == null) {
            throw new RuntimeFailure(
                'preset_not_found',
                `Preset ${preset} was not found.`
            )
        }
    }

    private async cleanupTransient(conversation?: ConversationRecord) {
        if (conversation == null) return
        const id = conversation.id
        await this.service.ctx.database
            .remove('chatluna_message', { conversationId: id })
            .catch(() => {})
        await this.service.ctx.database
            .remove('chatluna_conversation', { id })
            .catch(() => {})
        await this.service.conversationRuntime
            .clearConversationCache(id)
            .catch(() => {})
    }
}

interface RequestOptions {
    conversation?: ConversationResolution
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

class RuntimeFailure extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly conversation?: ConversationRecord
    ) {
        super(message)
        this.name = 'RuntimeFailure'
    }
}

function abortErr(timedOut: boolean, conversation?: ConversationRecord) {
    return new RuntimeFailure(
        timedOut ? 'timeout' : 'aborted',
        timedOut
            ? 'Chat invocation timed out.'
            : 'Chat invocation was aborted.',
        conversation
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
    let conversation = extras.conversation

    if (err instanceof RuntimeFailure) {
        code = err.code
        message = err.message
        conversation = err.conversation ?? conversation
    } else if (
        timedOut ||
        controller.signal.aborted ||
        error.name === 'AbortError'
    ) {
        code = timedOut ? 'timeout' : 'aborted'
        message = timedOut
            ? 'Chat invocation timed out.'
            : 'Chat invocation was aborted.'
    } else if (err instanceof ConversationInvocationError) {
        code = err.code
        message = err.message
    } else if (err instanceof ConversationResolutionError) {
        code = err.code
        message = err.message
    } else if (err instanceof ChatLunaError) {
        code = `chatluna_${err.errorCode}`
        message = err.message
    }

    return {
        ok: false,
        requestId,
        conversation,
        usage: extras.usage,
        error: { code, message }
    }
}
