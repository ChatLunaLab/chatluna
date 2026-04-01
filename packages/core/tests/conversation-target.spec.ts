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
