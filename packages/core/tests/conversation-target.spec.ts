/// <reference types="mocha" />

import { assert } from 'chai'
import { completeConversationTarget } from '../src/utils/conversation'

it('completeConversationTarget accepts exact display seq without suggest', async () => {
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
                    ]
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

    assert.equal(result, '2')
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
