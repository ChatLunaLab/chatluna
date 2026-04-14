/// <reference types="mocha" />

import { assert } from 'chai'
import { ChainMiddlewareRunStatus } from '../src/chains/chain'
import { apply } from '../src/middlewares/chat/rollback_chat'
import { apply as applyStop } from '../src/middlewares/chat/stop_chat'
import {
    createConversation,
    createMemoryService,
    createMessage,
    createSession,
    expectRejected,
    type TableRow
} from './helpers'

it('rollback_chat keeps plain text rollback input as string and runs in sync lock', async () => {
    const conversation = createConversation({
        id: 'conversation-rollback',
        latestMessageId: 'message-rollback'
    })
    const message = createMessage({
        id: 'message-rollback',
        conversationId: conversation.id,
        text: '123',
        content: null
    })
    const { app, ctx, database } = await createMemoryService({
        tables: {
            chatluna_conversation: [conversation as unknown as TableRow],
            chatluna_message: [message as unknown as TableRow]
        }
    })

    try {
        const sent: string[] = []
        const syncCalls: string[] = []
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        const withSync =
            ctx.chatluna.conversationRuntime.withConversationSync.bind(
                ctx.chatluna.conversationRuntime
            )

        ctx.chatluna.conversationRuntime.withConversationSync = async (
            current,
            callback
        ) => {
            syncCalls.push(current.id)
            return withSync(current, callback)
        }
        ctx.chatluna.messageTransformer.transform = async () => 'transformed'
        session.text = (key, params) =>
            key === '.rollback_success' ? `${key}:${params?.[0]}` : key
        session.send = async (msg) => {
            sent.push(msg)
        }

        apply(
            ctx as never,
            {
                includeQuoteReply: false
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
            command: 'rollback',
            message: '',
            options: {
                rollback_round: 1,
                conversation: {
                    conversation
                }
            }
        })

        assert.equal(status, ChainMiddlewareRunStatus.CONTINUE)
        assert.deepEqual(syncCalls, [conversation.id])
        assert.equal((await database.get('chatluna_message', {})).length, 0)
        assert.equal(
            (
                await database.get('chatluna_conversation', {
                    id: conversation.id
                })
            )[0].latestMessageId,
            null
        )
        assert.deepEqual(sent, ['.rollback_success:1'])
    } finally {
        await app.stop()
    }
})

it('rollback_chat does not fall back to current conversation for an explicit missing target', async () => {
    const conversation = createConversation({
        id: 'conversation-current',
        latestMessageId: 'message-current'
    })
    const message = createMessage({
        id: 'message-current',
        conversationId: conversation.id,
        text: 'hello current',
        content: null
    })
    const { app, database, ctx } = await createMemoryService({
        tables: {
            chatluna_conversation: [conversation as unknown as TableRow],
            chatluna_binding: [
                {
                    bindingKey: conversation.bindingKey,
                    activeConversationId: conversation.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                } as TableRow
            ],
            chatluna_message: [message as unknown as TableRow]
        }
    })

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined

        session.text = (key) => key
        session.send = async () => {}

        apply(
            ctx as never,
            {
                includeQuoteReply: false
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

        const state = {
            command: 'rollback',
            message: '',
            options: {
                rollback_round: 1,
                conversationId: 'missing-conversation'
            }
        }
        const status = await run!(session, state)

        assert.equal(status, ChainMiddlewareRunStatus.STOP)
        assert.equal(state.message, '.conversation_not_exist')
        assert.equal((await database.get('chatluna_message', {})).length, 1)
        assert.equal(
            (
                await database.get('chatluna_conversation', {
                    id: conversation.id
                })
            )[0].latestMessageId,
            'message-current'
        )
    } finally {
        await app.stop()
    }
})

it('rollback_chat keeps history untouched when rebuilding the input fails', async () => {
    const conversation = createConversation({
        id: 'conversation-transform-failure',
        latestMessageId: 'message-transform-failure'
    })
    const message = createMessage({
        id: 'message-transform-failure',
        conversationId: conversation.id,
        text: 'fail me',
        content: null
    })
    const { app, database, ctx } = await createMemoryService({
        tables: {
            chatluna_conversation: [conversation as unknown as TableRow],
            chatluna_message: [message as unknown as TableRow]
        }
    })

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined

        ctx.chatluna.messageTransformer.transform = async () => {
            throw new Error('transform failed')
        }
        session.text = (key) => key
        session.send = async () => {}

        apply(
            ctx as never,
            {
                includeQuoteReply: false
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

        await expectRejected(
            run!(session, {
                command: 'rollback',
                message: '',
                options: {
                    rollback_round: 1,
                    conversation: {
                        conversation
                    }
                }
            }),
            /transform failed/
        )

        assert.equal((await database.get('chatluna_message', {})).length, 1)
        assert.equal(
            (
                await database.get('chatluna_conversation', {
                    id: conversation.id
                })
            )[0].latestMessageId,
            'message-transform-failure'
        )
    } finally {
        await app.stop()
    }
})

it('rollback_chat falls back to the active preset lane conversation', async () => {
    const main = createConversation({
        id: 'conversation-main-lane',
        latestMessageId: 'message-main-lane'
    })
    const helper = createConversation({
        id: 'conversation-helper-lane',
        bindingKey: 'shared:discord:bot:guild:preset:helper',
        latestMessageId: 'message-helper-lane'
    })
    const mainMessage = createMessage({
        id: 'message-main-lane',
        conversationId: main.id,
        text: 'main lane',
        content: null
    })
    const helperMessage = createMessage({
        id: 'message-helper-lane',
        conversationId: helper.id,
        text: 'helper lane',
        content: null
    })
    const { app, ctx, database } = await createMemoryService({
        tables: {
            chatluna_conversation: [
                main as unknown as TableRow,
                helper as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: main.bindingKey,
                    activeConversationId: main.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                } as TableRow,
                {
                    bindingKey: helper.bindingKey,
                    activeConversationId: helper.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                } as TableRow
            ],
            chatluna_message: [
                mainMessage as unknown as TableRow,
                helperMessage as unknown as TableRow
            ],
            chatluna_constraint: [
                {
                    id: 1,
                    name: 'managed:discord:bot:guild:guild',
                    enabled: true,
                    priority: 1000,
                    createdBy: 'user',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    platform: 'discord',
                    selfId: 'bot',
                    guildId: 'guild',
                    channelId: null,
                    direct: false,
                    users: null,
                    excludeUsers: null,
                    routeMode: null,
                    routeKey: null,
                    activePresetLane: 'helper',
                    defaultModel: null,
                    defaultPreset: null,
                    defaultChatMode: null,
                    fixedModel: null,
                    fixedPreset: null,
                    fixedChatMode: null,
                    lockConversation: false,
                    allowNew: true,
                    allowSwitch: true,
                    allowArchive: true,
                    allowExport: true,
                    manageMode: 'anyone'
                } as unknown as TableRow
            ]
        }
    })

    try {
        const sent: string[] = []
        const syncCalls: string[] = []
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        const withSync =
            ctx.chatluna.conversationRuntime.withConversationSync.bind(
                ctx.chatluna.conversationRuntime
            )

        ctx.chatluna.conversationRuntime.withConversationSync = async (
            current,
            callback
        ) => {
            syncCalls.push(current.id)
            return withSync(current, callback)
        }
        ctx.chatluna.messageTransformer.transform = async () => 'transformed'
        session.text = (key, params) =>
            key === '.rollback_success' ? `${key}:${params?.[0]}` : key
        session.send = async (msg) => {
            sent.push(msg)
        }

        apply(
            ctx as never,
            {
                includeQuoteReply: false
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
            command: 'rollback',
            message: '',
            options: {
                rollback_round: 1
            }
        })

        assert.equal(status, ChainMiddlewareRunStatus.CONTINUE)
        assert.deepEqual(syncCalls, [helper.id])
        assert.equal(
            (
                await database.get('chatluna_message', {
                    conversationId: helper.id
                })
            ).length,
            0
        )
        assert.equal(
            (
                await database.get('chatluna_message', {
                    conversationId: main.id
                })
            ).length,
            1
        )
        assert.deepEqual(sent, ['.rollback_success:1'])
    } finally {
        await app.stop()
    }
})

it('stop_chat falls back to the active preset lane conversation', async () => {
    const main = createConversation({
        id: 'conversation-main-stop'
    })
    const helper = createConversation({
        id: 'conversation-helper-stop',
        bindingKey: 'shared:discord:bot:guild:preset:helper'
    })
    const { app, ctx } = await createMemoryService({
        tables: {
            chatluna_conversation: [
                main as unknown as TableRow,
                helper as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: main.bindingKey,
                    activeConversationId: main.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                } as TableRow,
                {
                    bindingKey: helper.bindingKey,
                    activeConversationId: helper.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                } as TableRow
            ],
            chatluna_constraint: [
                {
                    id: 1,
                    name: 'managed:discord:bot:guild:guild',
                    enabled: true,
                    priority: 1000,
                    createdBy: 'user',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    platform: 'discord',
                    selfId: 'bot',
                    guildId: 'guild',
                    channelId: null,
                    direct: false,
                    users: null,
                    excludeUsers: null,
                    routeMode: null,
                    routeKey: null,
                    activePresetLane: 'helper',
                    defaultModel: null,
                    defaultPreset: null,
                    defaultChatMode: null,
                    fixedModel: null,
                    fixedPreset: null,
                    fixedChatMode: null,
                    lockConversation: false,
                    allowNew: true,
                    allowSwitch: true,
                    allowArchive: true,
                    allowExport: true,
                    manageMode: 'anyone'
                } as unknown as TableRow
            ]
        }
    })

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        let stoppedId: string | undefined

        ctx.chatluna.conversationRuntime.stopConversationRequest = (id) => {
            stoppedId = id
            return true
        }
        session.text = (key) => key

        applyStop(
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
            command: 'stop_chat',
            options: {}
        })

        assert.equal(status, ChainMiddlewareRunStatus.STOP)
        assert.equal(stoppedId, helper.id)
    } finally {
        await app.stop()
    }
})
