import { randomUUID } from 'crypto'
import type { UsageMetadata } from '@langchain/core/messages'
import { type Context, h, type Session, Universal, type User } from 'koishi'
import {
    ChainMiddlewareRunStatus,
    type TriggerWakeupContext
} from 'koishi-plugin-chatluna/chains'
import {
    ConversationRecord,
    ConversationResolution,
    getPresetLane
} from 'koishi-plugin-chatluna/services/chat'
import type { Message, RenderType } from 'koishi-plugin-chatluna'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/koishi'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import {
    parseBindingKey,
    type WakeupAction,
    type WakeupResult,
    type WakeupRouting
} from '../types'
import { buildVirtualSession } from './session'

export class ChatLunaAgentTriggerExecutor {
    private readonly _chainReplyResolvers = new Map<
        string,
        (msg: Message | undefined) => void
    >()

    constructor(private readonly ctx: Context) {
        this.ctx.chatluna.chatChain
            .middleware(
                'chatluna_agent_trigger_capture',
                async (_session, context) => {
                    const wakeup = context.options.triggerWakeup
                    if (wakeup == null) {
                        return ChainMiddlewareRunStatus.SKIPPED
                    }

                    const resolve = this._chainReplyResolvers.get(
                        wakeup.requestId
                    )
                    if (resolve != null) {
                        this._chainReplyResolvers.delete(wakeup.requestId)
                    }
                    const reply =
                        context.options.responseMessage ??
                        context.options.finalResponseMessage

                    resolve?.(reply ?? undefined)

                    if (
                        wakeup.replyTo === 'silent' ||
                        wakeup.replyTo === 'user' ||
                        wakeup.replyTo === 'callback'
                    ) {
                        context.options.responseMessage = null
                        context.message = null
                    }

                    return ChainMiddlewareRunStatus.CONTINUE
                },
                this.ctx
            )
            .after('censor')
            .before('render_message')
    }

    async wakeup(action: WakeupAction): Promise<WakeupResult> {
        const startedAt = Date.now()
        const requestId = action.requestId ?? randomUUID()
        const state: { tokens?: UsageMetadata } = {}

        try {
            const routed = await this._resolveTarget(action, requestId)
            if ('result' in routed) {
                return routed.result
            }

            if (this.ctx.database != null) {
                await (routed.session as Session<User.Field>).observeUser([
                    'id',
                    'name',
                    'flag',
                    'authority',
                    'permissions',
                    'locales'
                ])
            }

            const resolved =
                action.newConversation === true && action.conversationId == null
                    ? await this._createFreshConversation(routed, action)
                    : await this.ctx.chatluna.conversation.resolveConversation(
                          routed.session,
                          {
                              mode: 'active',
                              bindingKey: routed.bindingKey,
                              conversationId:
                                  action.conversationId ?? undefined,
                              presetLane: action.presetLane ?? undefined
                          }
                      )

            if (resolved.conversation == null) {
                return {
                    ok: false,
                    requestId,
                    error: {
                        code: 'conversation-unavailable',
                        message: 'Conversation is unavailable.'
                    },
                    stats: {
                        durationMs: Date.now() - startedAt,
                        tokens: state.tokens
                    }
                }
            }

            // chatMode override is applied per-mode below so the chain
            // middleware ('request_conversation') can re-derive a fresh
            // conversation from triggerWakeup.chatMode in chain mode, while
            // direct mode overrides it locally.
            const useChain = (action.execMode ?? 'chain') === 'chain'
            const conversation =
                useChain ||
                action.chatMode == null ||
                action.chatMode === resolved.conversation.chatMode
                    ? resolved.conversation
                    : { ...resolved.conversation, chatMode: action.chatMode }

            if (conversation !== resolved.conversation) {
                await this.ctx.chatluna.clearCache(resolved.conversation)
            }

            const fullResolved = {
                ...resolved,
                conversation
            } as ConversationResolution & { conversation: ConversationRecord }

            const reply = useChain
                ? await this._runChainMode(
                      routed.session,
                      fullResolved,
                      action,
                      requestId,
                      state
                  )
                : await this._runDirectMode(
                      routed.session,
                      fullResolved,
                      action,
                      requestId,
                      state
                  )

            if (reply != null) {
                await this._dispatchReply(
                    routed.session,
                    action,
                    reply,
                    useChain
                )
            }

            return {
                ok: true,
                conversation,
                reply,
                requestId,
                stats: {
                    durationMs: Date.now() - startedAt,
                    tokens: state.tokens
                }
            }
        } catch (err) {
            this.ctx.logger.error(err)
            return {
                ok: false,
                requestId,
                error: {
                    code: 'internal',
                    message: err instanceof Error ? err.message : String(err)
                },
                stats: {
                    durationMs: Date.now() - startedAt,
                    tokens: state.tokens
                }
            }
        }
    }

    private async _createFreshConversation(
        routed: { session: Session; bindingKey: string },
        action: WakeupAction
    ): Promise<ConversationResolution> {
        const constraint =
            await this.ctx.chatluna.conversation.resolveConstraint(
                routed.session,
                {
                    bindingKey: routed.bindingKey,
                    presetLane: action.presetLane ?? undefined
                }
            )

        const preset =
            constraint.fixedPreset ??
            constraint.defaultPreset ??
            this.ctx.chatluna.config.defaultPreset
        const model = this.ctx.chatluna.conversation.pickModel(constraint)

        if (model == null) {
            throw new Error('No available model found.')
        }

        const chatMode =
            constraint.fixedChatMode ??
            constraint.defaultChatMode ??
            this.ctx.chatluna.config.defaultChatMode

        const conversation =
            await this.ctx.chatluna.conversation.createConversation(
                routed.session,
                {
                    bindingKey: constraint.bindingKey,
                    preset,
                    model,
                    chatMode,
                    title: 'Trigger session',
                    setActive: false
                }
            )

        return {
            mode: 'active',
            bindingKey: constraint.bindingKey,
            presetLane: getPresetLane(constraint.bindingKey),
            conversation,
            conversationId: conversation.id,
            binding: null,
            effectiveModel: model,
            effectivePreset: preset,
            effectiveChatMode: chatMode,
            constraint
        }
    }

    /**
     * Resolve the wakeup target into a usable session + bindingKey, supporting
     * both the new {@link WakeupAction.target} and the legacy
     * `session`/`routing`/`bindingKey` fields.
     */
    private async _resolveTarget(
        action: WakeupAction,
        requestId: string
    ): Promise<
        { session: Session; bindingKey: string } | { result: WakeupResult }
    > {
        const target =
            action.target ??
            action.session ??
            action.routing ??
            (action.bindingKey != null
                ? { bindingKey: action.bindingKey }
                : undefined)
        if (target == null) {
            return {
                result: errorResult(
                    requestId,
                    'no-routing',
                    'Wakeup target is required.'
                )
            }
        }

        let session: Session | undefined
        let bindingKey: string | undefined

        if (
            typeof target === 'object' &&
            target != null &&
            'bot' in target &&
            'platform' in target
        ) {
            session = target as Session
        } else if ('bindingKey' in target) {
            bindingKey = target.bindingKey
            const parsed = parseBindingKey(bindingKey)
            if (parsed.error != null) {
                return {
                    result: errorResult(
                        requestId,
                        parsed.error,
                        parsed.error === 'no-routing'
                            ? 'Binding key requires routing with a real userId.'
                            : 'Binding key requires a session or routing context.'
                    )
                }
            }
            const routed = resolveBot(
                this.ctx,
                parsed.routing.platform,
                parsed.routing.selfId,
                requestId
            )
            if ('result' in routed) return { result: routed.result }
            session = buildVirtualSession(routed.bot, parsed.routing, {
                message: action.message,
                messageName: action.messageName,
                requestId
            })
        } else {
            const routed = resolveBot(
                this.ctx,
                target.platform,
                target.selfId,
                requestId
            )
            if ('result' in routed) return { result: routed.result }
            session = buildVirtualSession(routed.bot, target as WakeupRouting, {
                message: action.message,
                messageName: action.messageName,
                requestId
            })
        }

        if (session.bot.status !== Universal.Status.ONLINE) {
            return {
                result: createDeferredResult(
                    `${session.platform}:${session.selfId}`,
                    requestId,
                    'bot-offline'
                )
            }
        }

        bindingKey ??=
            action.bindingKey ??
            (
                await this.ctx.chatluna.conversation.resolveConstraint(
                    session,
                    { presetLane: action.presetLane ?? undefined }
                )
            ).bindingKey

        return { session, bindingKey }
    }

    private async _runChainMode(
        session: Session,
        resolved: ConversationResolution & { conversation: ConversationRecord },
        action: WakeupAction,
        requestId: string,
        state: { tokens?: UsageMetadata }
    ) {
        const wakeup: TriggerWakeupContext = {
            requestId,
            replyTo: action.replyTo,
            source: action.source,
            chatMode: action.chatMode,
            signal: createAbortSignal(action),
            toolMask: action.toolMask,
            variables: action.variables ?? {},
            state
        }
        const content =
            typeof action.message === 'string'
                ? [h.text(action.message)]
                : transformMessageContentToElements(action.message)

        const captured = new Promise<Message | undefined>((resolve) => {
            this._chainReplyResolvers.set(requestId, resolve)
        })

        try {
            await this.ctx.chatluna.chatChain.receiveCommand(session, 'chat', {
                message: content,
                messageId: requestId,
                conversation: resolved,
                triggerWakeup: wakeup,
                inputMessage: {
                    content: action.message,
                    name: action.messageName ?? 'trigger'
                }
            })
        } finally {
            const resolver = this._chainReplyResolvers.get(requestId)
            if (resolver != null) {
                this._chainReplyResolvers.delete(requestId)
                resolver(undefined)
            }
        }

        return await captured
    }

    private async _runDirectMode(
        session: Session,
        resolved: ConversationResolution & { conversation: ConversationRecord },
        action: WakeupAction,
        requestId: string,
        state: { tokens?: UsageMetadata }
    ) {
        return await this.ctx.chatluna.chat(
            session,
            resolved.conversation,
            {
                content: action.message,
                name: action.messageName ?? 'trigger'
            },
            {
                event: {
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    'llm-usage': async (usage) => {
                        state.tokens = usage
                    }
                },
                variables: action.variables ?? {},
                requestId,
                toolMask: action.toolMask,
                signal: createAbortSignal(action)
            }
        )
    }

    private async _dispatchReply(
        session: Session,
        action: WakeupAction,
        reply: Message,
        useChain: boolean
    ) {
        switch (action.replyTo) {
            case 'silent':
                return
            case 'callback':
                await action.onReply?.(reply)
                return
            case 'user': {
                const targetId = action.replyUserId ?? session.userId
                const target = buildVirtualSession(
                    session.bot,
                    {
                        platform: session.platform,
                        selfId: session.selfId,
                        userId: targetId,
                        isDirect: true
                    },
                    {
                        message: getMessageContent(reply.content),
                        requestId: session.messageId,
                        messageName: action.messageName
                    }
                )
                await sendReply(target, this.ctx, reply)
                return
            }
            default:
                // 'channel' or undefined: chain mode already sends; direct sends here.
                if (useChain) return
                await sendReply(session, this.ctx, reply)
        }
    }
}

function resolveBot(
    ctx: Context,
    platform: string,
    selfId: string,
    requestId: string
) {
    const bot = ctx.bots[`${platform}:${selfId}`]
    if (bot == null) {
        return {
            result: createDeferredResult(
                `${platform}:${selfId}`,
                requestId,
                'bot-not-found'
            )
        }
    }

    if (bot.status !== Universal.Status.ONLINE) {
        return {
            result: createDeferredResult(
                `${platform}:${selfId}`,
                requestId,
                'bot-offline'
            )
        }
    }

    return { bot }
}

function errorResult(
    requestId: string,
    code: string,
    message: string
): WakeupResult {
    return {
        ok: false,
        requestId,
        error: { code, message }
    }
}

function createDeferredResult(
    pendingKey: string,
    requestId: string,
    reason: 'bot-offline' | 'bot-not-found'
): WakeupResult {
    return {
        ok: false,
        requestId,
        deferred: {
            reason,
            pendingKey
        },
        error: {
            code: reason,
            message:
                reason === 'bot-not-found'
                    ? 'Bot is not registered.'
                    : 'Bot is offline or unavailable.'
        }
    }
}

function createAbortSignal(action: WakeupAction) {
    if (action.timeout == null) return action.signal
    if (action.signal == null) return AbortSignal.timeout(action.timeout)
    if (typeof AbortSignal.any === 'function') {
        return AbortSignal.any([
            action.signal,
            AbortSignal.timeout(action.timeout)
        ])
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), action.timeout)
    if (action.signal.aborted) {
        clearTimeout(timer)
        controller.abort(action.signal.reason)
        return controller.signal
    }

    action.signal.addEventListener(
        'abort',
        () => {
            clearTimeout(timer)
            controller.abort(action.signal?.reason)
        },
        { once: true }
    )
    controller.signal.addEventListener('abort', () => clearTimeout(timer), {
        once: true
    })
    return controller.signal
}

async function sendReply(session: Session, ctx: Context, reply: Message) {
    const rendered = await ctx.chatluna.renderer.render(reply, {
        session,
        type: ctx.chatluna.config.outputMode as RenderType
    })
    for (const item of rendered) {
        await session.sendQueued(
            Array.isArray(item.element) ? item.element : [item.element]
        )
    }
}

declare module 'koishi-plugin-chatluna/chains' {
    interface ChainMiddlewareName {
        censor: never
        render_message: never
        chatluna_agent_trigger_capture: never
    }
}
