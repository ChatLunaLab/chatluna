/// <reference types="mocha" />

import {
    AIMessage,
    AIMessageChunk,
    HumanMessage
} from '@langchain/core/messages'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assert } from 'chai'
import { Context } from 'koishi'
import {
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from '../src/llm-core/platform/model'
import { ChatLunaReranker } from '../src/llm-core/platform/rerank'
import { ModelType } from '../src/llm-core/platform/types'
import type { ModelUsageInput, ModelUsagePayload } from '../src/services/usage'
import { createMemoryService } from './helpers'
import {
    usageSourceFromContext,
    usageSourceFromPackageName,
    usageSourceFromStack
} from '../src/services/usage_source'

function createModel(message: AIMessage) {
    return new ChatLunaChatModel({
        modelInfo: {
            name: 'usage-model',
            type: ModelType.llm,
            maxTokens: 4096,
            capabilities: []
        },
        requester: {
            completion: async () => ({
                message,
                text: String(message.content),
                generationInfo: {
                    usage_metadata: message.usage_metadata
                }
            })
        } as never,
        model: 'usage-model',
        modelMaxContextSize: 4096,
        maxTokenLimit: 2048,
        timeout: 1000,
        maxRetries: 1
    })
}

function createChunk(content: string, usage?: AIMessageChunk['usage_metadata']) {
    return new ChatGenerationChunk({
        message: new AIMessageChunk({
            content,
            usage_metadata: usage
        }),
        text: content
    })
}

function createStreamModel(chunks: ChatGenerationChunk[]) {
    return new ChatLunaChatModel({
        modelInfo: {
            name: 'usage-model',
            type: ModelType.llm,
            maxTokens: 4096,
            capabilities: []
        },
        requester: {
            async *completionStream() {
                for (const chunk of chunks) {
                    yield chunk
                }
            }
        } as never,
        model: 'usage-model',
        modelMaxContextSize: 4096,
        maxTokenLimit: 2048,
        timeout: 1000,
        maxRetries: 1
    })
}

it('ChatLunaChatModel reports provider usage metadata', async () => {
    const calls: ModelUsageInput[] = []
    const model = createModel(
        new AIMessage({
            content: 'reply',
            usage_metadata: {
                input_tokens: 5,
                output_tokens: 7,
                total_tokens: 12
            }
        })
    )

    model.setUsageReporter((usage) => {
        calls.push(usage)
    })

    await model.invoke([new HumanMessage('hello')], {
        chatlunaUsageContext: {
            conversationId: 'conversation-1',
            requestId: 'request-1',
            source: 'chatluna',
            userId: 'user-1',
            guildId: 'guild-1'
        }
    })

    assert.equal(calls.length, 1)
    assert.include(calls[0], {
        callType: 'llm',
        inputTokens: 5,
        outputTokens: 7,
        totalTokens: 12,
        estimated: false,
        source: 'chatluna',
        conversationId: 'conversation-1',
        requestId: 'request-1',
        userId: 'user-1',
        guildId: 'guild-1'
    })
})

it('ChatLunaChatModel reports provider usage from stream', async () => {
    const calls: ModelUsageInput[] = []
    const model = createStreamModel([
        createChunk('reply', {
            input_tokens: 6,
            output_tokens: 8,
            total_tokens: 14
        })
    ])

    model.setUsageReporter((usage) => {
        calls.push(usage)
    })

    const stream = await model.stream([new HumanMessage('hello')], {
        chatlunaUsageContext: {
            source: 'chatluna',
            conversationId: 'conversation-1'
        }
    })
    for await (const _chunk of stream) {
        void _chunk
    }

    assert.equal(calls.length, 1)
    assert.include(calls[0], {
        callType: 'llm',
        inputTokens: 6,
        outputTokens: 8,
        totalTokens: 14,
        estimated: false,
        source: 'chatluna',
        conversationId: 'conversation-1'
    })
})

it('ChatLunaChatModel reports estimated usage from stream', async () => {
    const calls: ModelUsageInput[] = []
    const model = createStreamModel([createChunk('reply')])

    model.setUsageReporter((usage) => {
        calls.push(usage)
    })

    const stream = await model.stream([new HumanMessage('hello')], {
        chatlunaUsageContext: {
            source: 'chatluna'
        }
    })
    for await (const _chunk of stream) {
        void _chunk
    }

    assert.equal(calls.length, 1)
    assert.equal(calls[0].callType, 'llm')
    assert.equal(calls[0].estimated, true)
    assert.isAbove(calls[0].inputTokens, 0)
    assert.isAbove(calls[0].outputTokens, 0)
    assert.equal(
        calls[0].totalTokens,
        calls[0].inputTokens + calls[0].outputTokens
    )
})

it('_generate stream mode reports usage once', async () => {
    const calls: ModelUsageInput[] = []
    const model = createStreamModel([
        createChunk('reply', {
            input_tokens: 6,
            output_tokens: 8,
            total_tokens: 14
        })
    ])

    model.setUsageReporter((usage) => {
        calls.push(usage)
    })

    await model._generate([new HumanMessage('hello')], {
        stream: true,
        chatlunaUsageContext: {
            source: 'chatluna'
        }
    })

    assert.equal(calls.length, 1)
    assert.include(calls[0], {
        inputTokens: 6,
        outputTokens: 8,
        totalTokens: 14,
        estimated: false,
        source: 'chatluna'
    })
})

it('ChatLunaChatModel reports estimated usage without provider usage', async () => {
    const calls: ModelUsageInput[] = []
    const model = createModel(new AIMessage('reply'))

    model.setUsageReporter((usage) => {
        calls.push(usage)
    })

    await model.invoke([new HumanMessage('hello')])

    assert.equal(calls.length, 1)
    assert.equal(calls[0].callType, 'llm')
    assert.equal(calls[0].estimated, true)
    assert.isAbove(calls[0].inputTokens, 0)
    assert.isAbove(calls[0].outputTokens, 0)
    assert.equal(
        calls[0].totalTokens,
        calls[0].inputTokens + calls[0].outputTokens
    )
})

it('embeddings and reranker report estimated usage after success', async () => {
    const calls: ModelUsageInput[] = []
    const embeddings = new ChatLunaEmbeddings({
        model: 'embedding-model',
        timeout: 1000,
        client: {
            embeddings: async () => [
                [1, 2],
                [3, 4]
            ]
        } as never
    })
    const reranker = new ChatLunaReranker({
        model: 'reranker-model',
        timeout: 1000,
        client: {
            rerank: async () => [{ index: 0, relevanceScore: 0.9 }]
        } as never
    })

    embeddings.setUsageReporter((usage) => {
        calls.push(usage)
    })
    reranker.setUsageReporter((usage) => {
        calls.push(usage)
    })

    await embeddings.embedDocuments(['first', 'second'])
    await reranker.rerank(['memory text'], 'query')

    assert.deepEqual(
        calls.map((call) => call.callType),
        ['embeddings', 'reranker']
    )
    assert.isTrue(calls.every((call) => call.estimated))
    assert.isTrue(calls.every((call) => call.totalTokens > 0))
})

it('withUsageSource keeps concurrent source scopes isolated', async () => {
    const { app } = await createMemoryService()

    try {
        const result = await Promise.all([
            app.chatluna.withUsageSource('alpha', async () => {
                await Promise.resolve()
                return app.chatluna.usageSource
            }),
            app.chatluna.withUsageSource('beta', async () => {
                await Promise.resolve()
                return app.chatluna.usageSource
            })
        ])

        assert.deepEqual(result, ['alpha', 'beta'])
        assert.equal(app.chatluna.usageSource, 'unknown')
    } finally {
        await app.stop()
    }
})

it('usageSourceFromStack infers plugin package source', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-usage-'))
    const pluginDir = path.join(dir, 'koishi-plugin-chatluna-character')
    await fs.mkdir(path.join(pluginDir, 'src'), { recursive: true })
    await fs.writeFile(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({ name: 'koishi-plugin-chatluna-character' })
    )

    const stack = [
        'Error',
        `    at ChatLunaService.createChatModel (${path.join(process.cwd(), 'packages/core/src/services/chat.ts')}:1:1)`,
        `    at run (${path.join(pluginDir, 'src/index.ts')}:2:3)`
    ].join('\n')

    assert.equal(usageSourceFromStack(stack), 'chatluna-character')
})

it('usageSourceFromPackageName normalizes character entry source', () => {
    assert.equal(
        usageSourceFromPackageName('koishi-plugin-chatluna-character'),
        'chatluna-character'
    )
    assert.equal(
        usageSourceFromPackageName('chatluna_character_entry_point'),
        'chatluna-character'
    )
})

it('usageSourceFromContext infers nested character source', () => {
    const ctx = {
        scope: {
            runtime: { name: 'chatluna_character_entry_point' },
            parent: {
                scope: {
                    runtime: { name: 'root' }
                }
            }
        }
    }

    assert.equal(usageSourceFromContext(ctx as never), 'chatluna-character')
})

it('usageSourceFromContext skips framework and chatluna scopes', () => {
    const ctx = {
        scope: {
            runtime: { name: '@cordisjs/core' },
            parent: {
                scope: {
                    runtime: { name: 'chatluna' },
                    parent: {
                        scope: {
                            runtime: { name: 'root' }
                        }
                    }
                }
            }
        }
    }

    assert.equal(usageSourceFromContext(ctx as never), 'unknown')
})

it('usageSourceFromStack infers node_modules package source', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-usage-'))
    const pluginDir = path.join(
        dir,
        'node_modules',
        'koishi-plugin-chatluna-character'
    )
    await fs.mkdir(path.join(pluginDir, 'lib'), { recursive: true })
    await fs.writeFile(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({ name: 'koishi-plugin-chatluna-character' })
    )

    const stack = [
        'Error',
        `    at ChatLunaService.createChatModel (${path.join(process.cwd(), 'packages/core/lib/services/chat.cjs')}:1:1)`,
        `    at run (${path.join(pluginDir, 'lib/index.cjs')}:2:3)`
    ].join('\n')

    assert.equal(usageSourceFromStack(stack), 'chatluna-character')
})

it('usageSourceFromStack infers Windows paths with forward slashes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-usage-'))
    const pluginDir = path.join(dir, 'koishi-plugin-chatluna-character')
    await fs.mkdir(path.join(pluginDir, 'lib'), { recursive: true })
    await fs.writeFile(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({ name: 'koishi-plugin-chatluna-character' })
    )

    const stack = [
        'Error',
        `    at run (${path
            .join(pluginDir, 'lib/index.cjs')
            .replaceAll('\\', '/')}:2:3)`
    ].join('\n')

    assert.equal(usageSourceFromStack(stack), 'chatluna-character')
})

it('usageSourceFromStack skips framework frames before plugin source', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-usage-'))
    const frameworkDir = path.join(dir, 'node_modules', '@cordisjs', 'core')
    const pluginDir = path.join(dir, 'koishi-plugin-chatluna-character')
    await fs.mkdir(path.join(frameworkDir, 'lib'), { recursive: true })
    await fs.mkdir(path.join(pluginDir, 'lib'), { recursive: true })
    await fs.writeFile(
        path.join(frameworkDir, 'package.json'),
        JSON.stringify({ name: '@cordisjs/core' })
    )
    await fs.writeFile(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({ name: 'koishi-plugin-chatluna-character' })
    )

    const stack = [
        'Error',
        `    at ChatLunaService.createChatModel (${path.join(process.cwd(), 'packages/core/lib/services/chat.cjs')}:1:1)`,
        `    at Object.apply (${path.join(frameworkDir, 'lib/index.cjs')}:2:3)`,
        `    at initializeModel (${path.join(pluginDir, 'lib/index.cjs')}:4:5)`
    ].join('\n')

    assert.equal(usageSourceFromStack(stack), 'chatluna-character')
})

it('usageSourceFromStack skips package-less frames before plugin source', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-usage-'))
    const pluginDir = path.join(dir, 'koishi-plugin-chatluna-character')
    await fs.mkdir(path.join(dir, 'generated'), { recursive: true })
    await fs.mkdir(path.join(pluginDir, 'lib'), { recursive: true })
    await fs.writeFile(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({ name: 'koishi-plugin-chatluna-character' })
    )

    const stack = [
        'Error',
        `    at ChatLunaService.createChatModel (${path.join(process.cwd(), 'packages/core/lib/services/chat.cjs')}:1:1)`,
        `    at run (${path.join(dir, 'generated/plugin.cjs')}:2:3)`,
        `    at initializeModel (${path.join(pluginDir, 'lib/index.cjs')}:4:5)`
    ].join('\n')

    assert.equal(usageSourceFromStack(stack), 'chatluna-character')
})

it('usageSourceFromStack returns unknown without plugin package', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-usage-'))
    const stack = [
        'Error',
        `    at run (${path.join(dir, 'src/index.ts')}:2:3)`
    ].join('\n')

    assert.equal(usageSourceFromStack(stack), 'unknown')
})

it('usage source proxy keeps explicit source ahead of inferred source', async () => {
    const { app } = await createMemoryService()
    const payloads: ModelUsageInput[] = []
    const target = {
        async invoke() {
            await app.chatluna.reportModelUsage({
                callType: 'llm',
                platform: 'test',
                model: 'usage-model',
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
                estimated: false
            })
        }
    }

    try {
        app.on('chatluna/model-usage', async (payload) => {
            payloads.push(payload)
        })

        const proxy = (
            app.chatluna as unknown as {
                _withUsageSourceProxy<T extends object>(
                    value: T,
                    source: string,
                    methods: string[]
                ): T
            }
        )._withUsageSourceProxy(target, 'auto-source', ['invoke'])

        await proxy.invoke()
        await app.chatluna.withUsageSource('explicit-source', () =>
            proxy.invoke()
        )

        assert.deepEqual(
            payloads.map((payload) => payload.source),
            ['auto-source', 'explicit-source']
        )
    } finally {
        await app.stop()
    }
})

it('usage source proxy keeps unknown source wrapped', async () => {
    const { app } = await createMemoryService()
    const target = {
        async invoke() {}
    }

    try {
        const proxy = (
            app.chatluna as unknown as {
                _withUsageSourceProxy<T extends object>(
                    value: T,
                    source: string,
                    methods: string[]
                ): T
            }
        )._withUsageSourceProxy(target, 'unknown', ['invoke'])

        assert.notStrictEqual(proxy, target)
    } finally {
        await app.stop()
    }
})

it('usage source proxy lazily infers nested character context', async () => {
    const { app } = await createMemoryService()
    const payloads: ModelUsagePayload[] = []
    let run: (() => Promise<void>) | undefined

    try {
        app.on('chatluna/model-usage', async (payload) => {
            payloads.push(payload)
        })

        app.plugin({
            name: 'chatluna-character',
            inject: ['chatluna'],
            apply(ctx: Context) {
                ctx.plugin({
                    name: 'chatluna_character_entry_point',
                    inject: ['chatluna'],
                    apply(ctx: Context) {
                        run = async () => {
                            const target = {
                                async invoke() {
                                    await ctx.chatluna.reportModelUsage({
                                        callType: 'llm',
                                        platform: 'test',
                                        model: 'usage-model',
                                        inputTokens: 1,
                                        outputTokens: 1,
                                        totalTokens: 2,
                                        estimated: false
                                    })
                                }
                            }
                            const proxy = (
                                ctx.chatluna as unknown as {
                                    _withUsageSourceProxy<T extends object>(
                                        value: T,
                                        source: string,
                                        methods: string[]
                                    ): T
                                }
                            )._withUsageSourceProxy(target, 'unknown', [
                                'invoke'
                            ])

                            assert.notStrictEqual(proxy, target)
                            await proxy.invoke()
                        }
                    }
                })
            }
        })
        await app.events.flush()
        await run?.()

        assert.deepEqual(
            payloads.map((payload) => payload.source),
            ['chatluna-character']
        )
    } finally {
        await app.stop()
    }
})

it('usage source proxy injects source into withConfig binding', async () => {
    const { app } = await createMemoryService()
    const payloads: ModelUsageInput[] = []
    const target = {
        withConfig(opts: {
            chatlunaUsageContext?: { source?: string }
        }) {
            return {
                async invoke() {
                    await app.chatluna.reportModelUsage({
                        callType: 'llm',
                        source: opts.chatlunaUsageContext?.source,
                        platform: 'test',
                        model: 'usage-model',
                        inputTokens: 1,
                        outputTokens: 1,
                        totalTokens: 2,
                        estimated: false
                    })
                }
            }
        }
    }

    try {
        app.on('chatluna/model-usage', async (payload) => {
            payloads.push(payload)
        })

        const proxy = (
            app.chatluna as unknown as {
                _withUsageSourceProxy<T extends object>(
                    value: T,
                    source: string,
                    methods: string[],
                    injectUsageContext?: boolean
                ): T
            }
        )._withUsageSourceProxy(target, 'chatluna-character', ['invoke'], true)
        const bound = proxy.withConfig({})

        await bound.invoke()

        assert.deepEqual(
            payloads.map((payload) => payload.source),
            ['chatluna-character']
        )
    } finally {
        await app.stop()
    }
})

it('usage source proxy does not pin one source onto the cached target', async () => {
    const { app } = await createMemoryService()
    const payloads: ModelUsageInput[] = []
    const target = {
        async invoke() {
            await app.chatluna.reportModelUsage({
                callType: 'llm',
                platform: 'test',
                model: 'usage-model',
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
                estimated: false
            })
        }
    }
    const wrap = app.chatluna as unknown as {
        _withUsageSourceProxy<T extends object>(
            value: T,
            source: string,
            methods: string[]
        ): T
    }

    try {
        app.on('chatluna/model-usage', async (payload) => {
            payloads.push(payload)
        })

        const left = wrap._withUsageSourceProxy(target, 'left-source', [
            'invoke'
        ])
        const right = wrap._withUsageSourceProxy(target, 'right-source', [
            'invoke'
        ])

        assert.notStrictEqual(left, right)

        await left.invoke()
        await right.invoke()

        assert.deepEqual(
            payloads.map((payload) => payload.source),
            ['left-source', 'right-source']
        )
    } finally {
        await app.stop()
    }
})

it('usage source proxy injects context through withConfig stream', async () => {
    const { app } = await createMemoryService()
    const payloads: ModelUsagePayload[] = []
    const model = createStreamModel([
        createChunk('reply', {
            input_tokens: 6,
            output_tokens: 8,
            total_tokens: 14
        })
    ])
    const wrap = app.chatluna as unknown as {
        _withUsageSourceProxy<T extends object>(
            value: T,
            source: string,
            methods: string[],
            injectUsageContext?: boolean
        ): T
    }

    model.setUsageReporter((usage) =>
        app.chatluna.reportModelUsage({
            ...usage,
            platform: 'test',
            model: 'usage-model'
        })
    )

    try {
        app.on('chatluna/model-usage', async (payload) => {
            payloads.push(payload)
        })

        const proxy = wrap._withUsageSourceProxy(
            model,
            'chatluna-character',
            [
                'invoke',
                'stream',
                'batch',
                'generate',
                'generatePrompt',
                '_generate'
            ],
            true
        )
        const bound = proxy.withConfig({
            configurable: {
                conversationId: 'conversation-1',
                requestId: 'request-1',
                session: {
                    userId: 'user-1',
                    guildId: 'guild-1'
                }
            }
        })
        const stream = await bound.stream([new HumanMessage('hello')])
        for await (const _chunk of stream) {
            void _chunk
        }

        assert.equal(payloads.length, 1)
        assert.include(payloads[0], {
            source: 'chatluna-character',
            conversationId: 'conversation-1',
            requestId: 'request-1',
            userId: 'user-1',
            guildId: 'guild-1'
        })
    } finally {
        await app.stop()
    }
})

it('reportModelUsage is a no-op when enableUsageTracking is false', async () => {
    const { app } = await createMemoryService({
        config: { enableUsageTracking: false }
    })
    const payloads: ModelUsagePayload[] = []

    try {
        app.on('chatluna/model-usage', async (payload) => {
            payloads.push(payload)
        })

        await app.chatluna.reportModelUsage({
            callType: 'llm',
            platform: 'test',
            model: 'usage-model',
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            estimated: false
        })

        assert.equal(payloads.length, 0)
    } finally {
        await app.stop()
    }
})

it('withUsageContext propagates fields into reportModelUsage payload', async () => {
    const { app } = await createMemoryService()
    const payloads: ModelUsagePayload[] = []

    try {
        app.on('chatluna/model-usage', async (payload) => {
            payloads.push(payload)
        })

        await app.chatluna.withUsageContext(
            {
                source: 'context-source',
                conversationId: 'C',
                userId: 'U',
                guildId: 'G'
            },
            () =>
                app.chatluna.reportModelUsage({
                    callType: 'embeddings',
                    inputTokens: 1,
                    outputTokens: 0,
                    totalTokens: 1,
                    estimated: true
                })
        )

        assert.equal(payloads.length, 1)
        assert.include(payloads[0], {
            source: 'context-source',
            conversationId: 'C',
            userId: 'U',
            guildId: 'G'
        })
    } finally {
        await app.stop()
    }
})

it('withUsageContext nesting merges outer and inner fields', async () => {
    const { app } = await createMemoryService()
    const payloads: ModelUsagePayload[] = []

    try {
        app.on('chatluna/model-usage', async (payload) => {
            payloads.push(payload)
        })

        await app.chatluna.withUsageContext(
            {
                source: 'outer-source',
                conversationId: 'C',
                userId: 'U',
                guildId: 'G'
            },
            () =>
                app.chatluna.withUsageContext({ requestId: 'R' }, () =>
                    app.chatluna.reportModelUsage({
                        callType: 'reranker',
                        inputTokens: 4,
                        outputTokens: 0,
                        totalTokens: 4,
                        estimated: true
                    })
                )
        )

        assert.equal(payloads.length, 1)
        assert.include(payloads[0], {
            source: 'outer-source',
            conversationId: 'C',
            userId: 'U',
            guildId: 'G',
            requestId: 'R'
        })
    } finally {
        await app.stop()
    }
})

it('reportModelUsage uses context source before input source', async () => {
    const { app } = await createMemoryService()
    const payloads: ModelUsagePayload[] = []

    try {
        app.on('chatluna/model-usage', async (payload) => {
            payloads.push(payload)
        })

        await app.chatluna.reportModelUsage({
            callType: 'llm',
            source: 'chatluna',
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            estimated: false
        })
        await app.chatluna.withUsageSource('explicit-source', () =>
            app.chatluna.reportModelUsage({
                callType: 'llm',
                source: 'chatluna',
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
                estimated: false
            })
        )

        assert.deepEqual(
            payloads.map((payload) => payload.source),
            ['chatluna', 'explicit-source']
        )
    } finally {
        await app.stop()
    }
})
