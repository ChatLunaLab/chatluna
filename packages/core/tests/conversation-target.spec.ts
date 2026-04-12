/// <reference types="mocha" />

import { assert } from 'chai'
import { completeConversationTarget } from '../src/utils/conversation'
import {
    createConversation,
    createService,
    createSession,
    type TableRow
} from './helpers'

it('completeConversationTarget resolves display seq to canonical id', async () => {
    let called = false

    const result = await completeConversationTarget(
        {
            chatluna: {
                conversation: {
                    listConversationEntries: async () => [
                        {
                            displaySeq: 1,
                            conversation: {
                                id: 'conversation-1',
                                title: 'First',
                                seq: 1
                            }
                        },
                        {
                            displaySeq: 2,
                            conversation: {
                                id: 'conversation-2',
                                title: 'Second',
                                seq: 1
                            }
                        }
                    ],
                    resolveCommandConversation: async (
                        _session,
                        opts: { targetConversation?: string }
                    ) => {
                        return opts.targetConversation === '2'
                            ? { id: 'conversation-2' }
                            : null
                    }
                }
            }
        } as never,
        {
            text: () => '',
            suggest: async () => {
                called = true
                return 'suggested'
            }
        } as never,
        '2',
        undefined,
        false,
        'commands.chatluna.chat.text.options.conversation',
        true
    )

    assert.equal(result, 'conversation-2')
    assert.equal(called, false)
})

it('completeConversationTarget accepts accessible target outside current list', async () => {
    let called = false

    const result = await completeConversationTarget(
        {
            chatluna: {
                conversation: {
                    listConversationEntries: async () => [
                        {
                            displaySeq: 1,
                            conversation: {
                                id: 'conversation-1',
                                title: 'First',
                                seq: 1
                            }
                        }
                    ],
                    resolveCommandConversation: async (
                        _session,
                        opts: { targetConversation?: string }
                    ) => {
                        return opts.targetConversation === 'conversation-remote'
                            ? { id: 'conversation-remote' }
                            : null
                    }
                }
            }
        } as never,
        {
            text: () => '',
            suggest: async () => {
                called = true
                return 'suggested'
            }
        } as never,
        'conversation-remote'
    )

    assert.equal(result, 'conversation-remote')
    assert.equal(called, false)
})

it('completeConversationTarget keeps visible numbering stable when archived conversations are hidden', async () => {
    const archived = createConversation({
        id: 'conversation-archived',
        status: 'archived',
        lastChatAt: new Date('2026-03-23T00:00:00.000Z')
    })
    const older = createConversation({
        id: 'conversation-old',
        title: 'Older',
        seq: 1,
        lastChatAt: new Date('2026-03-20T00:00:00.000Z')
    })
    const newer = createConversation({
        id: 'conversation-new',
        title: 'Newer',
        seq: 2,
        lastChatAt: new Date('2026-03-22T00:00:00.000Z')
    })
    const { service, ctx } = await createService({
        tables: {
            chatluna_conversation: [
                archived as unknown as TableRow,
                older as unknown as TableRow,
                newer as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: older.bindingKey,
                    activeConversationId: older.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                } as unknown as TableRow
            ]
        }
    })

    ctx.chatluna.conversation = service as never

    const result = await completeConversationTarget(
        ctx as never,
        createSession(),
        '2',
        undefined,
        false,
        'commands.chatluna.chat.text.options.conversation',
        false,
        true
    )

    assert.equal(result, older.id)
})

it('completeConversationTarget still resolves archived ids outside the visible list', async () => {
    const archived = createConversation({
        id: 'conversation-archived-hidden',
        status: 'archived'
    })
    const { service, ctx } = await createService({
        tables: {
            chatluna_conversation: [archived as unknown as TableRow]
        }
    })

    ctx.chatluna.conversation = service as never

    const result = await completeConversationTarget(
        ctx as never,
        createSession(),
        archived.id,
        undefined,
        false,
        'commands.chatluna.chat.text.options.conversation',
        false,
        true
    )

    assert.equal(result, archived.id)
})
