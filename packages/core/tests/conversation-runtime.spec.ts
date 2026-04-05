/// <reference types="mocha" />

import { HumanMessage } from '@langchain/core/messages'
import { assert } from 'chai'
import { ConversationRuntime } from '../src/services/conversation_runtime'
import { createConversation, createSession } from './helpers'

it('ConversationRuntime registers, resolves, and stops active requests', () => {
    const runtime = new ConversationRuntime({} as never)
    const abortController = new AbortController()
    const session = createSession({ sid: 'sid-1' })

    runtime.registerRequest(
        'conversation-1',
        'request-1',
        'plugin',
        abortController,
        session
    )

    assert.equal(runtime.getRequestIdBySession(session), 'request-1')
    assert.equal(runtime.stopRequest('request-1'), true)
    assert.equal(abortController.signal.aborted, true)
    assert.equal(runtime.stopRequest('missing-request'), false)

    runtime.completeRequest('conversation-1', 'request-1', session)
    assert.equal(runtime.getRequestIdBySession(session), undefined)
})

it('ConversationRuntime chat preserves additional kwargs metadata', async () => {
    const runtime = new ConversationRuntime({
        createChatInterface: async () => ({
            chat: async () => ({
                message: new HumanMessage('placeholder')
            })
        }),
        resolveToolMask: async () => undefined,
        awaitLoadPlatform: async () => {},
        currentConfig: {
            showThoughtMessage: true
        },
        platform: {
            getClient: async () => ({
                value: {
                    configPool: {
                        getConfig: () => ({
                            value: {
                                concurrentMaxSize: 1
                            }
                        })
                    }
                }
            })
        },
        ctx: {
            root: {
                parallel: async () => {}
            }
        }
    } as never)

    const conversation = createConversation({
        id: 'conversation-runtime-chat',
        model: 'platform/model'
    })
    const chatInterface = {
        chat: async () => ({
            message: {
                content: 'assistant reply',
                additional_kwargs: {
                    provider: 'mock',
                    reasoning_content: 'thinking',
                    reasoning_time: 1000
                },
                usage_metadata: {
                    total_tokens: 12,
                    input_tokens: 5,
                    output_tokens: 7
                }
            }
        })
    }
    runtime.interfaces.set(conversation.id, {
        conversation,
        chatInterface: chatInterface as never
    })

    const result = await runtime.chat(
        createSession(),
        conversation,
        {
            content: 'hello'
        },
        {} as never
    )

    assert.deepEqual(result.additional_kwargs, {
        provider: 'mock',
        reasoning_content: 'thinking',
        reasoning_time: 1000
    })
    assert.equal(result.additionalReplyMessages?.length, 2)
})

it('ConversationRuntime appendPendingMessage waits for plugin round decisions', async () => {
    const runtime = new ConversationRuntime({} as never)
    const activeRequest = runtime.registerRequest(
        'conversation-1',
        'request-1',
        'plugin',
        new AbortController(),
        createSession()
    )

    const pushed: HumanMessage[] = []
    const originalPush = activeRequest.messageQueue.push.bind(
        activeRequest.messageQueue
    )
    activeRequest.messageQueue.push = ((message: HumanMessage) => {
        pushed.push(message)
        return originalPush(message)
    }) as typeof activeRequest.messageQueue.push

    const pending = runtime.appendPendingMessage(
        'conversation-1',
        new HumanMessage('follow-up')
    )

    assert.equal(activeRequest.roundDecisionResolvers.length, 1)
    activeRequest.roundDecisionResolvers[0](true)
    assert.equal(await pending, true)
    assert.equal(pushed.length, 1)
    assert.equal(String(pushed[0].content), 'follow-up')

    activeRequest.lastDecision = false
    assert.equal(
        await runtime.appendPendingMessage(
            'conversation-1',
            new HumanMessage('ignored'),
            'plugin'
        ),
        false
    )
    assert.equal(
        await runtime.appendPendingMessage(
            'conversation-1',
            new HumanMessage('wrong-mode'),
            'chat'
        ),
        false
    )
})

it('ConversationRuntime clears cached interfaces and dispatches compression', async () => {
    const cleared: string[] = []
    const compressed: boolean[] = []
    const runtime = new ConversationRuntime({
        createChatInterface: async () => ({
            clearChatHistory: async () => {
                cleared.push('cleared')
            },
            compressContext: async (force: boolean) => {
                compressed.push(force)
                return {
                    compressed: true,
                    inputTokens: 10,
                    outputTokens: 5,
                    reducedPercent: 50
                }
            }
        }),
        awaitLoadPlatform: async () => {},
        platform: {
            getClient: async () => ({
                value: {
                    configPool: {
                        getConfig: () => ({
                            value: {
                                concurrentMaxSize: 1
                            }
                        })
                    }
                }
            })
        },
        ctx: {
            root: {
                parallel: async () => {}
            }
        }
    } as never)

    const conversation = createConversation({
        id: 'conversation-runtime',
        model: 'platform/model'
    })

    await runtime.ensureChatInterface(conversation)
    assert.equal(runtime.getCachedConversations().length, 1)

    await runtime.clearConversationHistory(conversation)
    assert.deepEqual(cleared, ['cleared'])
    assert.equal(runtime.getCachedConversations().length, 0)

    const result = await runtime.compressConversation(conversation, true)
    assert.equal(result.compressed, true)
    assert.deepEqual(compressed, [true])
})

it('ConversationRuntime dispose clears platform-scoped and global state', () => {
    const runtime = new ConversationRuntime({} as never)
    const session = createSession({ sid: 'sid-dispose' })
    const conversation = createConversation({ id: 'conversation-dispose' })

    runtime.interfaces.set(conversation.id, {
        conversation,
        chatInterface: {} as never
    })
    runtime.registerPlatformConversation('platform-a', conversation.id)
    runtime.registerRequest(
        conversation.id,
        'request-dispose',
        'plugin',
        new AbortController(),
        session
    )

    runtime.dispose('platform-a')
    assert.equal(runtime.interfaces.has(conversation.id), false)
    assert.equal(runtime.activeByConversation.has(conversation.id), false)

    runtime.registerRequest(
        'conversation-2',
        'request-2',
        'plugin',
        new AbortController(),
        createSession({ sid: 'sid-2' })
    )
    runtime.dispose()
    assert.equal(runtime.requestsById.size, 0)
    assert.equal(runtime.requestBySession.size, 0)
    assert.equal(runtime.platformIndex.size, 0)
})
