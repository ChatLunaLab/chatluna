/// <reference types="mocha" />

import { assert } from 'chai'
import { ChainMiddlewareRunStatus } from '../src/chains/chain'
import { apply } from '../src/middlewares/chat/rollback_chat'
import {
    createConversation,
    createMemoryService,
    createMessage,
    createSession,
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
