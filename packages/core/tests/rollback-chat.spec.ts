/// <reference types="mocha" />

import { assert } from 'chai'
import { ChainMiddlewareRunStatus } from '../src/chains/chain'
import { apply } from '../src/middlewares/chat/rollback_chat'
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
                resolvedConversation: conversation
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
                    resolvedConversation: conversation
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
