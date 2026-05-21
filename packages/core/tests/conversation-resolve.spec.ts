/// <reference types="mocha" />

import { createHash } from 'crypto'
import { assert } from 'chai'
import { ChainMiddlewareRunStatus, ChatChain } from '../src/chains/chain'
import { apply as applyRead } from '../src/middlewares/chat/read_chat_message'
import { apply as applyMessageDelay } from '../src/middlewares/chat/message_delay'
import { apply as applyTimeLimitSave } from '../src/middlewares/chat/chat_time_limit_save'
import { apply as applyResolve } from '../src/middlewares/conversation/resolve_conversation'
import { apply as applyRequest } from '../src/middlewares/conversation/request_conversation'
import { apply as applyManage } from '../src/middlewares/system/conversation_manage'
import { apply as applyLifecycle } from '../src/middlewares/system/lifecycle'
import { ConversationResolutionError } from '../src/types'
import {
    createConfig,
    createConversation,
    createMemoryService,
    createSession
} from './helpers'

it('resolve_conversation inherits active preset lane for explicit commands without target', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        let useRoutePresetLane: boolean | undefined

        ctx.chatluna.conversation.resolveConversation = async (
            _session,
            opts
        ) => {
            useRoutePresetLane = opts.useRoutePresetLane
            return {
                bindingKey: 'shared:discord:bot:guild:preset:helper',
                constraint: {},
                effectiveModel: 'test-platform/test-model',
                effectivePreset: 'default-preset',
                effectiveChatMode: 'plugin',
                conversation: null,
                conversationId: null,
                mode: 'context'
            }
        }

        applyResolve(
            ctx as never,
            {} as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        },
                        before() {
                            return this
                        }
                    }
                }
            } as never
        )

        const status = await run!(session, {
            command: 'chat',
            options: {}
        })

        assert.equal(status, ChainMiddlewareRunStatus.CONTINUE)
        assert.equal(useRoutePresetLane, true)
    } finally {
        await app.stop()
    }
})

it('request_conversation inherits active preset lane for explicit commands without target', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        let useRoutePresetLane: boolean | undefined

        ctx.chatluna.conversation.ensureActiveConversation = async (
            _session,
            opts
        ) => {
            useRoutePresetLane = opts.useRoutePresetLane
            throw new Error('stop-after-ensure')
        }

        applyRequest(
            ctx as never,
            {
                streamResponse: false,
                splitMessage: false
            } as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        }
                    }
                }
            } as never
        )

        try {
            await run!(session, {
                command: 'voice',
                options: {
                    inputMessage: {
                        content: 'hello'
                    }
                }
            })
            assert.fail('Expected middleware to stop after ensure.')
        } catch (err) {
            assert.match(String(err), /stop-after-ensure/)
        }

        assert.equal(useRoutePresetLane, false)
    } finally {
        await app.stop()
    }
})

it('request_conversation uses resolved conversation state instead of legacy top-level ids', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        let opts: any

        ctx.chatluna.conversation.ensureActiveConversation = async (
            _session,
            value
        ) => {
            opts = value
            throw new Error('stop-after-ensure')
        }

        applyRequest(
            ctx as never,
            {
                streamResponse: false,
                splitMessage: false
            } as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        }
                    }
                }
            } as never
        )

        try {
            await run!(session, {
                command: 'chat',
                options: {
                    conversationId: 'legacy-conversation',
                    conversation: {
                        conversationId: 'resolved-conversation',
                        bindingKey: 'shared:discord:bot:guild',
                        presetLane: 'helper'
                    },
                    inputMessage: {
                        content: 'hello'
                    }
                }
            })
            assert.fail('Expected middleware to stop after ensure.')
        } catch (err) {
            assert.match(String(err), /stop-after-ensure/)
        }

        assert.equal(opts.conversationId, 'resolved-conversation')
        assert.equal(opts.bindingKey, 'shared:discord:bot:guild')
        assert.equal(opts.presetLane, 'helper')
    } finally {
        await app.stop()
    }
})

it('resolve_conversation restores target suggestions for mistyped explicit targets', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined

        session.text = (key) => key
        session.suggest = async ({ actual, expect, suffix }) =>
            `${actual}|${expect.join(',')}|${suffix}`
        ctx.chatluna.conversation.resolveConversation = async () => ({
            bindingKey: 'shared:discord:bot:guild',
            constraint: {},
            effectiveModel: 'test-platform/test-model',
            effectivePreset: 'default-preset',
            effectiveChatMode: 'plugin',
            conversation: null,
            conversationId: null,
            mode: 'target'
        })
        ctx.chatluna.conversation.listConversationEntries = async () => [
            {
                displaySeq: 1,
                conversation: {
                    id: 'conversation-1',
                    title: 'First Topic'
                }
            }
        ]

        applyResolve(
            ctx as never,
            {} as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        },
                        before() {
                            return this
                        }
                    }
                }
            } as never
        )

        const state = {
            command: '',
            options: {
                targetConversation: 'frist'
            }
        }
        const status = await run!(session, state)

        assert.equal(status, ChainMiddlewareRunStatus.STOP)
        assert.equal(
            state.message,
            'frist|conversation-1,1,First Topic|commands.chatluna.chat.text.options.conversation'
        )
    } finally {
        await app.stop()
    }
})

it('resolve_conversation restores target-specific ambiguous errors', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined

        session.text = (key) => key
        ctx.chatluna.conversation.resolveConversation = async () => {
            throw new ConversationResolutionError('ambiguous_target')
        }

        applyResolve(
            ctx as never,
            {} as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        },
                        before() {
                            return this
                        }
                    }
                }
            } as never
        )

        const state = {
            command: 'conversation_switch',
            options: {
                conversation_manage: {
                    targetConversation: 'topic'
                }
            }
        }
        const status = await run!(session, state)

        assert.equal(status, ChainMiddlewareRunStatus.STOP)
        assert.equal(
            state.message,
            'chatluna.conversation.messages.target_ambiguous'
        )
    } finally {
        await app.stop()
    }
})

it('resolve_conversation prefers pre-resolved conversation state over legacy top-level ids', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        let opts: any

        ctx.chatluna.conversation.resolveConversation = async (
            _session,
            value
        ) => {
            opts = value
            return {
                bindingKey: 'shared:discord:bot:guild',
                constraint: {
                    bindingKey: 'shared:discord:bot:guild'
                },
                effectiveModel: 'test-platform/test-model',
                effectivePreset: 'default-preset',
                effectiveChatMode: 'plugin',
                conversation: createConversation({
                    id: 'resolved-conversation'
                }),
                conversationId: 'resolved-conversation',
                mode: 'target'
            }
        }

        applyResolve(
            ctx as never,
            {} as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        },
                        before() {
                            return this
                        }
                    }
                }
            } as never
        )

        const state = {
            command: 'chat',
            options: {
                conversationId: 'stale-conversation',
                conversation: {
                    conversationId: 'resolved-conversation'
                }
            }
        }
        const status = await run!(session, state)

        assert.equal(status, ChainMiddlewareRunStatus.CONTINUE)
        assert.equal(opts.mode, 'target')
        assert.equal(opts.conversationId, 'resolved-conversation')
        assert.equal(
            state.options.conversation.conversationId,
            'resolved-conversation'
        )
    } finally {
        await app.stop()
    }
})

it('resolve_conversation maps outside-route errors by code', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined

        session.text = (key) => key
        ctx.chatluna.conversation.resolveConversation = async () => {
            throw new ConversationResolutionError('target_outside_route')
        }

        applyResolve(
            ctx as never,
            {} as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        },
                        before() {
                            return this
                        }
                    }
                }
            } as never
        )

        const state = {
            command: 'conversation_restore',
            options: {
                conversation_manage: {
                    targetConversation: 'conversation-1'
                }
            }
        }
        const status = await run!(session, state)

        assert.equal(status, ChainMiddlewareRunStatus.STOP)
        assert.equal(
            state.message,
            'chatluna.conversation.messages.target_outside_route'
        )
    } finally {
        await app.stop()
    }
})

it('transform_chat_message continues when conversation resolution stopped earlier', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        let calls = 0

        ctx.chatluna.messageTransformer.transform = async () => {
            calls += 1
            return 'unexpected'
        }

        applyRead(
            ctx as never,
            {
                includeQuoteReply: false,
                attachForwardMsgIdToContext: false
            } as never,
            {
                middleware: (name, fn) => {
                    if (name === 'transform_chat_message') {
                        run = fn as never
                    }

                    return {
                        after() {
                            return this
                        },
                        before() {
                            return this
                        }
                    }
                }
            } as never
        )

        const status = await run!(session, {
            options: {
                chatMessage: []
            }
        })

        assert.equal(status, ChainMiddlewareRunStatus.CONTINUE)
        assert.equal(calls, 0)
    } finally {
        await app.stop()
    }
})

it('resolve_conversation uses command-specific target suffix for conversation management commands', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined

        session.text = (key) => key
        session.suggest = async ({ actual, expect, suffix }) =>
            `${actual}|${expect.join(',')}|${suffix}`
        ctx.chatluna.conversation.resolveConversation = async () => ({
            bindingKey: 'shared:discord:bot:guild',
            constraint: {},
            effectiveModel: 'test-platform/test-model',
            effectivePreset: 'default-preset',
            effectiveChatMode: 'plugin',
            conversation: null,
            conversationId: null,
            mode: 'target'
        })
        ctx.chatluna.conversation.listConversationEntries = async () => [
            {
                displaySeq: 1,
                conversation: {
                    id: 'conversation-1',
                    title: 'First Topic'
                }
            }
        ]

        applyResolve(
            ctx as never,
            {} as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        },
                        before() {
                            return this
                        }
                    }
                }
            } as never
        )

        const state = {
            command: 'conversation_restore',
            options: {
                conversation_manage: {
                    targetConversation: 'frist'
                }
            }
        }
        const status = await run!(session, state)

        assert.equal(status, ChainMiddlewareRunStatus.STOP)
        assert.equal(
            state.message,
            'frist|conversation-1,1,First Topic|commands.chatluna.restore.arguments.conversation'
        )
    } finally {
        await app.stop()
    }
})

it('conversation_rule_share reports the effective route after reset', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        const runs = new Map<
            string,
            (session: any, context: any) => Promise<ChainMiddlewareRunStatus>
        >()

        session.text = (key, params) =>
            params == null ? key : `${key}:${params.join(',')}`
        ctx.chatluna.conversation.updateManagedConstraint = async () => ({
            routeMode: null
        })
        ctx.chatluna.conversation.resolveConstraint = async () => ({
            routeMode: 'shared'
        })

        applyManage(
            ctx as never,
            {} as never,
            {
                middleware: (name, fn) => {
                    runs.set(name, fn as never)
                    return {
                        after() {
                            return this
                        },
                        before() {
                            return this
                        }
                    }
                }
            } as never
        )

        const run = runs.get('conversation_rule_share')
        const state = {
            command: 'conversation_rule_share',
            options: {
                conversation_rule: {
                    share: 'reset'
                },
                conversation: {
                    constraint: {
                        routeMode: 'personal'
                    }
                }
            }
        }
        const status = await run!(session, state)

        assert.equal(status, ChainMiddlewareRunStatus.STOP)
        assert.equal(
            state.message,
            'chatluna.conversation.messages.rule_share_status:shared'
        )
    } finally {
        await app.stop()
    }
})

it('conversation_switch accepts resolved direct conversation ids', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        let conversationId: string | undefined

        session.text = (key, params) =>
            params == null ? key : `${key}:${params.join(',')}`
        ctx.chatluna.conversation.switchConversation = async (
            _session,
            opts
        ) => {
            conversationId = opts.conversationId
            return {
                id: 'conversation-1',
                title: 'First Topic',
                seq: 1
            }
        }

        applyManage(
            ctx as never,
            {} as never,
            {
                middleware: (name, fn) => {
                    if (name === 'conversation_switch') {
                        run = fn as never
                    }

                    return {
                        after() {
                            return this
                        },
                        before() {
                            return this
                        }
                    }
                }
            } as never
        )

        const state = {
            command: 'conversation_switch',
            options: {
                conversation: {
                    conversationId: 'conversation-direct',
                    conversation: {
                        id: 'conversation-direct',
                        title: 'Direct Topic'
                    }
                },
                conversation_manage: {}
            }
        }
        const status = await run!(session, state)

        assert.equal(status, ChainMiddlewareRunStatus.STOP)
        assert.equal(conversationId, 'conversation-direct')
        assert.equal(
            state.message,
            'chatluna.conversation.messages.switch_success:First Topic,1,conversation-1'
        )
    } finally {
        await app.stop()
    }
})

it('conversation_switch preserves explicit chain conversation through middleware order', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        const sent: string[] = []
        const chain = new ChatChain(
            ctx,
            createConfig({
                isForwardMsg: false,
                isReplyWithAt: false,
                forwardMsgMinLength: 99999
            })
        )
        const constraint = {
            routeMode: 'shared',
            bindingKey: 'shared:discord:bot:guild',
            baseKey: 'shared:discord:bot:guild',
            constraints: [],
            lockConversation: false,
            allowNew: true,
            allowSwitch: true,
            allowArchive: true,
            allowExport: true,
            manageMode: 'admin'
        }
        let resolveOpts: any
        let switchedId: string | undefined

        session.text = (key, params) =>
            params == null ? key : `${key}:${params.join(',')}`
        session.sendQueued = async () => {}
        chain.sender(async (_session, messages) => {
            const msg = messages[0]
            if (typeof msg === 'string') {
                sent.push(msg)
            }
        })

        chain.middleware('read_chat_message' as never, async () => 0)
        chain.middleware('transform_chat_message' as never, async () => 0)
        chain.middleware('resolve_model' as never, async () => 0)

        applyLifecycle(ctx as never, {} as never, chain)
        applyResolve(ctx as never, {} as never, chain)
        applyManage(ctx as never, {} as never, chain)

        ctx.chatluna.conversation.resolveConversation = async (
            _session,
            opts
        ) => {
            resolveOpts = opts

            return {
                bindingKey: 'shared:discord:bot:guild',
                constraint,
                effectiveModel: 'test-platform/test-model',
                effectivePreset: 'default-preset',
                effectiveChatMode: 'plugin',
                conversation: createConversation({
                    id: opts.conversationId,
                    title: 'Direct Topic'
                }),
                conversationId: opts.conversationId,
                mode: opts.mode
            }
        }
        ctx.chatluna.conversation.switchConversation = async (
            _session,
            opts
        ) => {
            switchedId = opts.conversationId

            return {
                id: 'conversation-1',
                title: 'First Topic',
                seq: 1
            }
        }

        const handled = await chain.receiveCommand(
            session,
            'conversation_switch',
            {
                conversation: {
                    bindingKey: 'shared:discord:bot:guild',
                    constraint,
                    effectiveModel: 'test-platform/test-model',
                    effectivePreset: 'default-preset',
                    effectiveChatMode: 'plugin',
                    conversationId: 'conversation-direct',
                    conversation: createConversation({
                        id: 'conversation-direct',
                        title: 'Direct Topic'
                    })
                },
                conversation_manage: {}
            }
        )

        assert.equal(handled, false)
        assert.equal(resolveOpts.mode, 'target')
        assert.equal(resolveOpts.conversationId, 'conversation-direct')
        assert.equal(switchedId, 'conversation-direct')
        assert.deepEqual(sent, [
            'chatluna.conversation.messages.switch_success:First Topic,1,conversation-1'
        ])
    } finally {
        await app.stop()
    }
})

it('conversation_switch prefers explicit target over preexisting chain conversation', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        const sent: string[] = []
        const chain = new ChatChain(
            ctx,
            createConfig({
                isForwardMsg: false,
                isReplyWithAt: false,
                forwardMsgMinLength: 99999
            })
        )
        const constraint = {
            routeMode: 'shared',
            bindingKey: 'shared:discord:bot:guild',
            baseKey: 'shared:discord:bot:guild',
            constraints: [],
            lockConversation: false,
            allowNew: true,
            allowSwitch: true,
            allowArchive: true,
            allowExport: true,
            manageMode: 'admin'
        }
        let resolveOpts: any
        let switchedId: string | undefined

        session.text = (key, params) =>
            params == null ? key : `${key}:${params.join(',')}`
        session.sendQueued = async () => {}
        chain.sender(async (_session, messages) => {
            const msg = messages[0]
            if (typeof msg === 'string') {
                sent.push(msg)
            }
        })

        chain.middleware('read_chat_message' as never, async () => 0)
        chain.middleware('transform_chat_message' as never, async () => 0)
        chain.middleware('resolve_model' as never, async () => 0)

        applyLifecycle(ctx as never, {} as never, chain)
        applyResolve(ctx as never, {} as never, chain)
        applyManage(ctx as never, {} as never, chain)

        ctx.chatluna.conversation.resolveConversation = async (
            _session,
            opts
        ) => {
            resolveOpts = opts

            return {
                bindingKey: 'shared:discord:bot:guild',
                constraint,
                effectiveModel: 'test-platform/test-model',
                effectivePreset: 'default-preset',
                effectiveChatMode: 'plugin',
                conversation: createConversation({
                    id: opts.targetConversation,
                    title: 'Target Topic'
                }),
                conversationId: opts.targetConversation,
                mode: opts.mode
            }
        }
        ctx.chatluna.conversation.switchConversation = async (
            _session,
            opts
        ) => {
            switchedId = opts.conversationId

            return {
                id: 'conversation-target',
                title: 'Target Topic',
                seq: 2
            }
        }

        const handled = await chain.receiveCommand(
            session,
            'conversation_switch',
            {
                conversation: {
                    bindingKey: 'shared:discord:bot:guild',
                    constraint,
                    effectiveModel: 'test-platform/test-model',
                    effectivePreset: 'default-preset',
                    effectiveChatMode: 'plugin',
                    conversationId: 'conversation-direct',
                    conversation: createConversation({
                        id: 'conversation-direct',
                        title: 'Direct Topic'
                    })
                },
                conversation_manage: {
                    targetConversation: 'conversation-target'
                }
            }
        )

        assert.equal(handled, false)
        assert.equal(resolveOpts.mode, 'target')
        assert.equal(resolveOpts.conversationId, undefined)
        assert.equal(resolveOpts.targetConversation, 'conversation-target')
        assert.equal(switchedId, 'conversation-target')
        assert.deepEqual(sent, [
            'chatluna.conversation.messages.switch_success:Target Topic,2,conversation-target'
        ])
    } finally {
        await app.stop()
    }
})

it('conversation_switch prefers explicit target over preexisting resolved conversation ids', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        const sent: string[] = []
        const chain = new ChatChain(
            ctx,
            createConfig({
                isForwardMsg: false,
                isReplyWithAt: false,
                forwardMsgMinLength: 99999
            })
        )
        const constraint = {
            routeMode: 'shared',
            bindingKey: 'shared:discord:bot:guild',
            baseKey: 'shared:discord:bot:guild',
            constraints: [],
            lockConversation: false,
            allowNew: true,
            allowSwitch: true,
            allowArchive: true,
            allowExport: true,
            manageMode: 'admin'
        }
        let resolveOpts: any
        let switchedId: string | undefined

        session.text = (key, params) =>
            params == null ? key : `${key}:${params.join(',')}`
        session.sendQueued = async () => {}
        chain.sender(async (_session, messages) => {
            const msg = messages[0]
            if (typeof msg === 'string') {
                sent.push(msg)
            }
        })

        chain.middleware('read_chat_message' as never, async () => 0)
        chain.middleware('transform_chat_message' as never, async () => 0)
        chain.middleware('resolve_model' as never, async () => 0)

        applyLifecycle(ctx as never, {} as never, chain)
        applyResolve(ctx as never, {} as never, chain)
        applyManage(ctx as never, {} as never, chain)

        ctx.chatluna.conversation.resolveConversation = async (
            _session,
            opts
        ) => {
            resolveOpts = opts

            return {
                bindingKey: 'shared:discord:bot:guild',
                constraint,
                effectiveModel: 'test-platform/test-model',
                effectivePreset: 'default-preset',
                effectiveChatMode: 'plugin',
                conversation: createConversation({
                    id: opts.targetConversation,
                    title: 'Target Topic'
                }),
                conversationId: opts.targetConversation,
                mode: opts.mode
            }
        }
        ctx.chatluna.conversation.switchConversation = async (
            _session,
            opts
        ) => {
            switchedId = opts.conversationId

            return {
                id: 'conversation-target',
                title: 'Target Topic',
                seq: 2
            }
        }

        const handled = await chain.receiveCommand(
            session,
            'conversation_switch',
            {
                conversation: {
                    conversationId: 'conversation-direct'
                },
                conversation_manage: {
                    targetConversation: 'conversation-target'
                }
            }
        )

        assert.equal(handled, false)
        assert.equal(resolveOpts.mode, 'target')
        assert.equal(resolveOpts.conversationId, undefined)
        assert.equal(resolveOpts.targetConversation, 'conversation-target')
        assert.equal(switchedId, 'conversation-target')
        assert.deepEqual(sent, [
            'chatluna.conversation.messages.switch_success:Target Topic,2,conversation-target'
        ])
    } finally {
        await app.stop()
    }
})

it('message_delay uses the resolved conversation only', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        let appendedId: string | undefined

        ctx.chatluna.conversationRuntime.appendPendingMessage = async (id) => {
            appendedId = id
            return true
        }

        applyMessageDelay(
            ctx as never,
            {
                messageQueue: true,
                messageQueueDelay: 0
            } as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        },
                        before() {
                            return this
                        }
                    }
                }
            } as never
        )

        const status = await run!(session, {
            options: {
                conversationId: 'legacy-conversation',
                inputMessage: {
                    content: 'hello',
                    name: 'tester'
                },
                conversation: {
                    conversation: createConversation({
                        id: 'resolved-conversation'
                    })
                }
            }
        })

        assert.equal(status, ChainMiddlewareRunStatus.STOP)
        assert.equal(appendedId, 'resolved-conversation')
    } finally {
        await app.stop()
    }
})

it('message_delay keeps collected messages in send order', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined

        applyMessageDelay(
            ctx as never,
            {
                messageQueue: true,
                messageQueueDelay: 0.01
            } as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        },
                        before() {
                            return this
                        }
                    }
                }
            } as never
        )

        const conversation = createConversation({
            id: 'message-delay-order'
        })
        const contexts = [1, 2, 3].map((num) => ({
            options: {
                inputMessage: {
                    content: String(num),
                    name: 'tester'
                },
                conversation: {
                    conversation
                }
            }
        }))

        const p3 = run!(
            { ...createSession(), timestamp: 3 } as any,
            contexts[2]
        )
        const p2 = run!(
            { ...createSession(), timestamp: 2 } as any,
            contexts[1]
        )
        const p1 = run!(
            { ...createSession(), timestamp: 1 } as any,
            contexts[0]
        )
        const statuses = await Promise.all([p1, p2, p3])
        const content = contexts[0].options.inputMessage.content as {
            text?: string
        }[]

        assert.deepEqual(statuses, [
            ChainMiddlewareRunStatus.CONTINUE,
            ChainMiddlewareRunStatus.STOP,
            ChainMiddlewareRunStatus.STOP
        ])
        assert.equal(content.map((part) => part.text ?? '').join(''), '1\n2\n3')
        ctx.emit('chatluna/after-chat', 'message-delay-order')
    } finally {
        await app.stop()
    }
})

it('chat_time_limit_save uses the resolved conversation only', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        let key: string | undefined

        applyTimeLimitSave(
            ctx as never,
            {} as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        }
                    }
                }
            } as never
        )

        const status = await run!(session, {
            options: {
                conversationId: 'legacy-conversation',
                conversation: {
                    conversationId: 'resolved-conversation'
                },
                chatLimit: {
                    count: 0
                },
                chatLimitCache: {
                    set: async (value, data) => {
                        key = value
                        assert.equal(data.count, 1)
                    }
                }
            }
        })

        assert.equal(status, ChainMiddlewareRunStatus.CONTINUE)
        assert.equal(
            key,
            createHash('md5')
                .update(`resolved-conversation-${session.userId}`)
                .digest('hex')
        )
    } finally {
        await app.stop()
    }
})

it('conversation_new keeps preset option out of preset lane resolution', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        const sent: string[] = []
        const chain = new ChatChain(
            ctx,
            createConfig({
                isForwardMsg: false,
                isReplyWithAt: false,
                forwardMsgMinLength: 99999
            })
        )
        const constraint = {
            routeMode: 'shared',
            bindingKey: 'shared:discord:bot:guild',
            baseKey: 'shared:discord:bot:guild',
            constraints: [],
            lockConversation: false,
            allowNew: true,
            allowSwitch: true,
            allowArchive: true,
            allowExport: true,
            manageMode: 'admin'
        }
        let resolveOpts: any
        let createOpts: any

        session.text = (key, params) =>
            params == null ? key : `${key}:${params.join(',')}`
        session.sendQueued = async () => {}
        chain.sender(async (_session, messages) => {
            const msg = messages[0]
            if (typeof msg === 'string') {
                sent.push(msg)
            }
        })

        chain.middleware('read_chat_message' as never, async () => 0)
        chain.middleware('transform_chat_message' as never, async () => 0)
        chain.middleware('resolve_model' as never, async () => 0)

        applyLifecycle(ctx as never, {} as never, chain)
        applyResolve(ctx as never, {} as never, chain)
        applyManage(ctx as never, {} as never, chain)

        ctx.chatluna.conversation.resolveConversation = async (
            _session,
            opts
        ) => {
            resolveOpts = opts

            return {
                bindingKey: 'shared:discord:bot:guild',
                constraint,
                effectiveModel: 'test-platform/test-model',
                effectivePreset: 'default-preset',
                effectiveChatMode: 'plugin',
                conversation: null,
                conversationId: null,
                mode: opts.mode
            }
        }
        ctx.chatluna.conversation.createConversation = async (
            _session,
            opts
        ) => {
            createOpts = opts

            return createConversation({
                id: 'conversation-new',
                bindingKey: opts.bindingKey,
                title: opts.title,
                preset: opts.preset,
                model: opts.model,
                chatMode: opts.chatMode
            })
        }

        const handled = await chain.receiveCommand(
            session,
            'conversation_new',
            {
                conversation_create: {
                    preset: 'writer'
                }
            }
        )

        assert.equal(handled, false)
        assert.equal(resolveOpts.mode, 'context')
        assert.equal(resolveOpts.presetLane, undefined)
        assert.equal(createOpts.preset, 'writer')
        assert.equal(createOpts.bindingKey, 'shared:discord:bot:guild')
        assert.deepEqual(sent, [
            'chatluna.conversation.messages.new_success:chatluna.conversation.default_title,1,conversation-new'
        ])
    } finally {
        await app.stop()
    }
})
