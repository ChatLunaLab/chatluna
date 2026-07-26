/// <reference types="mocha" />

import { HumanMessage } from '@langchain/core/messages'
import { assert } from 'chai'
import { ChatRuntime } from '../src/llm-core/chat/runtime'
import type {
    ActiveConversationResolution,
    ConversationRecord
} from '../src/types'
import { createConversation, createSession } from './helpers'

type RequestHarnessOptions = {
    enabled?: boolean
    conversation?: ConversationRecord
    fixedModel?: string | null
    targetModel?: string | null
    constraintDefaultModel?: string | null
    globalDefaultModel?: string
}

function createRequestHarness(options: RequestHarnessOptions = {}) {
    const conversation =
        options.conversation ??
        createConversation({
            model: 'platform/old-model',
            preset: 'kept-preset',
            chatMode: 'kept-mode'
        })
    const resolution = {
        mode: 'active',
        conversationId: conversation.id,
        conversation,
        constraint: {
            fixedModel: options.fixedModel ?? null,
            defaultModel: options.constraintDefaultModel ?? null
        },
        effectiveModel: options.fixedModel ?? conversation.model,
        transient: false
    } as ActiveConversationResolution
    const touched: Partial<ConversationRecord>[] = []
    const cleared: ConversationRecord[] = []
    const service = {
        currentConfig: {
            autoUpdateConversationModel: options.enabled ?? false,
            defaultModel: options.globalDefaultModel ?? null
        },
        conversation: {
            ensureActiveConversation: async () => resolution,
            pickModel: (constraint: { defaultModel?: string | null }) =>
                options.targetModel ??
                constraint.defaultModel ??
                options.globalDefaultModel ??
                null,
            touchConversation: async (
                _id: string,
                patch: Partial<ConversationRecord>
            ) => {
                touched.push(patch)
                return { ...conversation, ...patch }
            }
        },
        conversationRuntime: {
            clearConversationInterface: async (
                conversation: ConversationRecord
            ) => {
                cleared.push(conversation)
            },
            chat: async () => new HumanMessage('response')
        },
        ctx: {
            logger: { warn: () => {} }
        }
    }
    const runtime = new ChatRuntime(service as never)

    return { runtime, resolution, touched, cleared }
}

async function request(runtime: ChatRuntime, invocation = false) {
    return runtime.request(createSession(), {
        invocation: invocation
            ? ({
                  requestId: 'invocation-request',
                  delivery: 'capture',
                  source: { kind: 'api' },
                  variables: {}
              } as never)
            : undefined,
        prepare: async () => ({
            message: { content: 'hello' },
            chat: { persist: false }
        })
    })
}

it('ChatRuntime request leaves the conversation model unchanged when auto-update is off', async () => {
    const { runtime, touched, cleared } = createRequestHarness({
        targetModel: 'platform/new-model'
    })

    const result = await request(runtime)

    assert.equal(result.conversation.model, 'platform/old-model')
    assert.deepEqual(touched, [])
    assert.deepEqual(cleared, [])
})

it('ChatRuntime request updates only the model before prepare and clears its cached interface', async () => {
    const { runtime, resolution, touched, cleared } = createRequestHarness({
        enabled: true,
        targetModel: 'platform/new-model'
    })
    let preparedConversation: ConversationRecord | undefined
    let preparedResolution: ActiveConversationResolution | undefined

    const result = await runtime.request(createSession(), {
        prepare: async ({ conversation, resolution }) => {
            preparedConversation = conversation
            preparedResolution = resolution
            return {
                message: { content: 'hello' },
                chat: { persist: false }
            }
        }
    })

    assert.deepEqual(touched, [{ model: 'platform/new-model' }])
    assert.equal(cleared.length, 1)
    assert.equal(cleared[0].id, resolution.conversation.id)
    assert.equal(cleared[0].model, 'platform/new-model')
    assert.equal(preparedConversation?.model, 'platform/new-model')
    assert.equal(preparedConversation?.preset, 'kept-preset')
    assert.equal(preparedConversation?.chatMode, 'kept-mode')
    assert.strictEqual(preparedResolution?.conversation, preparedConversation)
    assert.equal(preparedResolution?.effectiveModel, 'platform/new-model')
    assert.strictEqual(result.conversation, preparedConversation)
})

it('ChatRuntime request uses the constraint default model before the global default', async () => {
    const { runtime, touched } = createRequestHarness({
        enabled: true,
        constraintDefaultModel: 'platform/constraint-model',
        globalDefaultModel: 'platform/global-model'
    })

    const result = await request(runtime)

    assert.equal(result.conversation.model, 'platform/constraint-model')
    assert.deepEqual(touched, [{ model: 'platform/constraint-model' }])
})

it('ChatRuntime request does not persist when the constraint fixes the model', async () => {
    const { runtime, touched, cleared } = createRequestHarness({
        enabled: true,
        fixedModel: 'platform/fixed-model',
        targetModel: 'platform/new-model'
    })

    await request(runtime)

    assert.deepEqual(touched, [])
    assert.deepEqual(cleared, [])
})

it('ChatRuntime request leaves invocation model overlays unchanged', async () => {
    const conversation = createConversation({
        model: 'platform/invocation-model'
    })
    const { runtime, touched, cleared } = createRequestHarness({
        enabled: true,
        conversation,
        targetModel: 'platform/default-model'
    })

    const result = await request(runtime, true)

    assert.equal(result.conversation.model, 'platform/invocation-model')
    assert.deepEqual(touched, [])
    assert.deepEqual(cleared, [])
})

it('ChatRuntime request skips persistence and cache clearing for the same model', async () => {
    const { runtime, touched, cleared } = createRequestHarness({
        enabled: true,
        targetModel: 'platform/old-model'
    })

    await request(runtime)

    assert.deepEqual(touched, [])
    assert.deepEqual(cleared, [])
})
