const assert = require('node:assert/strict')

const { Context } = require('koishi')
const {
    AIMessage,
    AIMessageChunk,
    HumanMessage
} = require('@langchain/core/messages')
const { ChatGenerationChunk } = require('@langchain/core/outputs')
const {
    ChatPromptTemplate,
    MessagesPlaceholder
} = require('@langchain/core/prompts')
const { DynamicStructuredTool } = require('@langchain/core/tools')
const { z } = require('zod')
const chatluna = require('koishi-plugin-chatluna')
const {
    createOpenAIAgent,
    runAgent
} = require('koishi-plugin-chatluna/llm-core/agent')
const {
    ModelRequester
} = require('koishi-plugin-chatluna/llm-core/platform/api')
const {
    ChatLunaChatModel
} = require('koishi-plugin-chatluna/llm-core/platform/model')

chatluna.apply(new Context(), { isLog: false })

const tools = ['one', 'two', 'three', 'four'].map((name) =>
    new DynamicStructuredTool({
        name,
        description: `Return a deterministic ${name} result.`,
        schema: z.object({
            batch: z.number(),
            index: z.number()
        }),
        func: async (input) =>
            `${name} result for batch ${input.batch}, call ${input.index}`
    })
)

class PlannerRequester extends ModelRequester {
    logger = console

    constructor(stream) {
        const config = {
            value: {},
            md5: () => 'scratchpad-planner-probe'
        }
        super(
            new Context(),
            {
                getConfig: () => config,
                markConfigStatus: () => {}
            },
            { maxRetries: 0 },
            {}
        )
        this.stream = stream
    }

    async *completionStreamInternal(params) {
        yield* this.stream(params)
    }
}

async function run(
    mode,
    providerInput = 850_000,
    localEstimate = 1,
    hardContext = 1_000_000,
    usableLimit = 850_000,
    usageSource = 'provider',
    controller
) {
    let plans = 0
    let compressionCalls = 0
    let compressionPrompt
    let nextMessages
    let localCalls = 0
    const usageEvents = []

    const model = new ChatLunaChatModel({
        model: 'scratchpad-compression-probe',
        modelInfo: { name: 'scratchpad-compression-probe' },
        modelMaxContextSize: hardContext,
        maxTokenLimit: usableLimit,
        requester: {
            async completion(params) {
                compressionCalls += 1
                compressionPrompt = params.input
                    .map((message) => message.content)
                    .join('\n')
                if (mode === 'abort') {
                    controller.abort(
                        new Error('parent aborted during compression')
                    )
                    throw new Error('compression interrupted')
                }
                if (mode === 'failure') {
                    throw new Error('compression probe failure')
                }

                const text =
                    mode === 'empty' ? '' : 'compressed scratchpad summary'
                const message =
                    mode === 'empty'
                        ? new AIMessage({
                              content: '',
                              additional_kwargs: { thought_data: {} }
                          })
                        : new AIMessage(text)
                return new ChatGenerationChunk({
                    text,
                    message
                })
            }
        }
    })
    model.getNumTokens = async () => {
        localCalls += 1
        return localEstimate
    }

    const prompt = ChatPromptTemplate.fromMessages([
        ['system', 'Scratchpad compression probe.'],
        new MessagesPlaceholder('chat_history'),
        new MessagesPlaceholder('agent_scratchpad')
    ])
    const plannerModel = new ChatLunaChatModel({
        model: 'scratchpad-planner-probe',
        modelInfo: { name: 'scratchpad-planner-probe' },
        modelMaxContextSize: hardContext,
        maxTokenLimit: usableLimit,
        requester: new PlannerRequester(async function* (params) {
            plans += 1
            if (plans === 3) nextMessages = params.input

            const message = new AIMessageChunk({
                content: plans === 3 ? 'finished' : '',
                tool_call_chunks:
                    plans === 3
                        ? []
                        : tools.map((tool, index) => ({
                              id: `${plans}-${index}`,
                              name: tool.name,
                              args: JSON.stringify({ batch: plans, index }),
                              index
                          })),
                usage_metadata:
                    usageSource === 'provider'
                        ? {
                              input_tokens: providerInput,
                              output_tokens: 1,
                              total_tokens: providerInput + 1
                          }
                        : undefined
            })
            yield new ChatGenerationChunk({
                text: plans === 3 ? 'finished' : '',
                message
            })
        }),
        usageReporter: async (event) => usageEvents.push(event)
    })
    plannerModel.cropMessages = async (messages) => [messages, localEstimate]
    plannerModel.countMessageTokens = async () => 1
    const agent = createOpenAIAgent({
        llm: plannerModel,
        tools,
        prompt
    })
    const input = {
        input: new HumanMessage('Run the compression probe.'),
        chat_history: [new HumanMessage('prior history')]
    }
    const events = []

    for await (const event of runAgent({
        agent,
        tools,
        input,
        maxIterations: 3,
        signal: controller?.signal,
        config: {
            configurable: {
                model,
                agentContext: {
                    kind: 'main',
                    agentId: 'probe',
                    agentName: 'probe',
                    conversationId: 'probe',
                    requestId: 'probe',
                    source: 'chatluna'
                }
            }
        }
    })) {
        events.push(event)
    }

    const calls = events.filter((event) => event.type === 'tool-call')
    assert.equal(calls.length, 2)
    for (const event of calls) {
        assert.equal(event.actions.length, 4)
        assert.equal(event.actions[0].messageLog.length, 1)
        assert(
            event.actions.slice(1).every((action) =>
                Array.isArray(action.messageLog) &&
                action.messageLog.length === 0
            )
        )
    }
    assert.equal(plans, 3)
    if (mode === 'threshold') {
        assert.equal(compressionCalls, 0)
    } else {
        assert.equal(compressionCalls, 1)
        assert.match(compressionPrompt, /"batch":1/)
        assert.doesNotMatch(compressionPrompt, /"batch":2/)
    }
    assert(nextMessages)
    assert.equal(usageEvents.length, 3)
    assert(
        calls.every((event) => event.actions[0].messageLog[0].usage_metadata != null) ===
            (usageSource === 'provider')
    )

    const scratchpadTypes = nextMessages
        .filter((message) =>
            message.getType() === 'ai' || message.getType() === 'tool'
        )
        .map((message) => message.getType())
    const summary = input.chat_history.find(
        (message) => message.name === 'infinite_context'
    )
    const nextSummary = nextMessages.find(
        (message) => message.name === 'infinite_context'
    )
    let callsLeft = new Set()
    let batches = 0
    for (const message of nextMessages) {
        if (message.getType() === 'ai') {
            assert.equal(callsLeft.size, 0)
            callsLeft = new Set(message.tool_calls.map((call) => call.id))
            assert.equal(callsLeft.size, 4)
            batches += 1
        } else if (message.getType() === 'tool') {
            assert.equal(callsLeft.delete(message.tool_call_id), true)
        }
    }
    assert.equal(callsLeft.size, 0)

    if (mode === 'success') {
        assert.deepEqual(scratchpadTypes, [
            'ai',
            'tool',
            'tool',
            'tool',
            'tool'
        ])
        assert.equal(batches, 1)
        assert.equal(summary.content, 'compressed scratchpad summary')
        assert.equal(nextSummary.content, 'compressed scratchpad summary')
        assert.deepEqual(
            input.chat_history.map((message) => message.content),
            ['compressed scratchpad summary']
        )
    } else {
        assert.deepEqual(scratchpadTypes, [
            'ai',
            'tool',
            'tool',
            'tool',
            'tool',
            'ai',
            'tool',
            'tool',
            'tool',
            'tool'
        ])
        assert.equal(batches, 2)
        assert.equal(summary, undefined)
        assert.equal(nextSummary, undefined)
        assert.deepEqual(
            input.chat_history.map((message) => message.content),
            ['prior history']
        )
    }

    return {
        mode,
        hardContext: model.getModelMaxContextSize(),
        usableLimit: model.invocationParams().maxTokenLimit,
        providerInput,
        localEstimate,
        localCalls,
        plannerCalls: plans,
        compressionCalls,
        reportedCalls: usageEvents.filter((event) => !event.estimated).length,
        estimatedCalls: usageEvents.filter((event) => event.estimated).length,
        reportedTotal: usageEvents
            .filter((event) => !event.estimated)
            .reduce(
                (sum, event) => sum + event.usageMetadata.total_tokens,
                0
            ),
        missingProviderTotalEstimate: usageEvents
            .filter((event) => event.estimated)
            .reduce(
                (sum, event) => sum + event.usageMetadata.total_tokens,
                0
            ),
        nextScratchpadTypes: scratchpadTypes,
        summary: summary?.content ?? null
    }
}

async function main() {
    const highBelow = await run('threshold', 840_000, 1_000_000)
    const highAt = await run('success', 850_000)
    assert.equal(highBelow.hardContext, 1_000_000)
    assert.equal(highBelow.usableLimit, 850_000)
    assert.equal(highBelow.compressionCalls, 0)
    assert.equal(highBelow.localCalls, 0)
    assert.equal(highAt.compressionCalls, 1)
    assert.equal(highAt.reportedCalls, 3)
    assert.equal(highAt.estimatedCalls, 0)

    const estimatedAt = await run(
        'threshold',
        850_000,
        850_000,
        1_000_000,
        850_000,
        'estimated'
    )
    assert.equal(estimatedAt.compressionCalls, 0)
    assert.equal(estimatedAt.reportedCalls, 0)
    assert.equal(estimatedAt.reportedTotal, 0)
    assert.equal(estimatedAt.estimatedCalls, 3)
    assert(estimatedAt.missingProviderTotalEstimate > 0)

    const lowBelow = await run(
        'threshold',
        34_999,
        1_000_000,
        100_000,
        35_000
    )
    const lowAt = await run('success', 35_000, 1, 100_000, 35_000)
    assert.equal(lowBelow.hardContext, 100_000)
    assert.equal(lowBelow.usableLimit, 35_000)
    assert.equal(lowBelow.compressionCalls, 0)
    assert.equal(lowBelow.localCalls, 0)
    assert.equal(lowAt.compressionCalls, 1)

    const results = [highBelow, highAt, estimatedAt, lowBelow, lowAt]

    for (const mode of ['empty', 'failure']) {
        results.push(await run(mode, 850_000))
    }

    const controller = new AbortController()
    await assert.rejects(
        () =>
            run(
                'abort',
                850_000,
                1,
                1_000_000,
                850_000,
                'provider',
                controller
            ),
        (err) => err === controller.signal.reason
    )
    process.stdout.write(`${JSON.stringify(results)}\n`)
}

main().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`)
    process.exitCode = 1
})
