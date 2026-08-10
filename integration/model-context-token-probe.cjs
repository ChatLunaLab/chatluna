const assert = require('node:assert/strict')
require('yml-register')
require('tsx/cjs')

const { Context } = require('koishi')
const {
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage
} = require('@langchain/core/messages')
const { ChatGenerationChunk } = require('@langchain/core/outputs')
const chatluna = require('koishi-plugin-chatluna')
const {
    ChatLunaChatModel
} = require('koishi-plugin-chatluna/llm-core/platform/model')
const {
    compressIfNeeded
} = require('../packages/core/src/llm-core/chat/infinite_context.ts')

chatluna.apply(new Context(), { isLog: false })

async function main() {
    const model = new ChatLunaChatModel({
        model: 'model-context-token-probe',
        modelInfo: { name: 'model-context-token-probe' },
        modelMaxContextSize: 3000,
        maxTokenLimit: 3000,
        requester: {}
    })
    const providerBaseline = 1000
    const firstAi = new AIMessage({
        content: '',
        tool_calls: [
            {
                id: 'call-first',
                name: 'lookup',
                args: { value: 'first' }
            }
        ]
    })
    const firstTool = new ToolMessage({
        content: 'first result',
        tool_call_id: 'call-first'
    })
    const secondAi = new AIMessage({
        content: '',
        tool_calls: [
            {
                id: 'call-second',
                name: 'lookup',
                args: { value: 'second' }
            }
        ],
        usage_metadata: {
            input_tokens: providerBaseline,
            output_tokens: 1,
            total_tokens: providerBaseline + 1
        }
    })
    const secondTool = new ToolMessage({
        content: 'second result',
        tool_call_id: 'call-second'
    })
    const messages = [
        new SystemMessage('Context token probe.'),
        new HumanMessage('Run two tool cycles.'),
        firstAi,
        firstTool,
        secondAi,
        secondTool
    ]
    const [cropped, promptTokens] = await model.cropMessages(
        messages,
        undefined,
        1,
        3000
    )
    const systemTokens = await model.countMessageTokens(messages[0])
    const firstCycleTokens =
        (await model.countMessageTokens(firstAi)) +
        (await model.countMessageTokens(firstTool))
    const secondCycleTokens =
        (await model.countMessageTokens(secondAi)) +
        (await model.countMessageTokens(secondTool))
    const expectedPromptTokens = providerBaseline + secondCycleTokens + 3

    assert.deepEqual(
        cropped.map((message) => message.getType()),
        ['system', 'human', 'ai', 'tool', 'ai', 'tool']
    )
    assert.equal(promptTokens, expectedPromptTokens)
    assert.notEqual(
        promptTokens,
        expectedPromptTokens + firstCycleTokens
    )
    assert.equal(
        providerBaseline - systemTokens + secondCycleTokens + systemTokens + 3,
        expectedPromptTokens
    )

    const emptyAiTokens = await model.countMessageTokens(new AIMessage(''))
    const argsAiTokens = await model.countMessageTokens(
        new AIMessage({
            content: '',
            tool_calls: [
                {
                    id: 'call-args',
                    name: 'lookup',
                    args: { value: 'x'.repeat(1000) }
                }
            ]
        })
    )
    const rawArgsAiTokens = await model.countMessageTokens(
        new AIMessage({
            content: '',
            additional_kwargs: {
                tool_calls: [
                    {
                        id: 'call-raw-args',
                        type: 'function',
                        function: {
                            name: 'lookup',
                            arguments: 'x'.repeat(1000)
                        }
                    }
                ]
            }
        })
    )
    const noToolCallIdTokens = await model.countMessageTokens(
        new ToolMessage({ content: 'tool result', tool_call_id: '' })
    )
    const toolCallIdTokens = await model.countMessageTokens(
        new ToolMessage({ content: 'tool result', tool_call_id: 'call-id' })
    )

    assert(argsAiTokens > emptyAiTokens)
    assert(rawArgsAiTokens > emptyAiTokens)
    assert(toolCallIdTokens > noToolCallIdTokens)

    async function runInfinite(
        inputTokens,
        hardContext = 1_000_000,
        usableLimit = 850_000,
        configuredThreshold = 0.85
    ) {
        let compressionCalls = 0
        const model = new ChatLunaChatModel({
            model: 'infinite-context-threshold-probe',
            modelInfo: { name: 'infinite-context-threshold-probe' },
            modelMaxContextSize: hardContext,
            maxTokenLimit: usableLimit,
            requester: {
                async completion() {
                    compressionCalls += 1
                    return new ChatGenerationChunk({
                        text: 'compressed context summary',
                        message: new AIMessage('compressed context summary')
                    })
                }
            }
        })
        model.getNumTokens = async (text) =>
            text === 'old history' ? inputTokens : 0

        const result = await compressIfNeeded({
            chatHistory: {
                async getMessages() {
                    return [
                        new HumanMessage('old history'),
                        new AIMessage('old result'),
                        new HumanMessage('latest message')
                    ]
                }
            },
            model,
            conversationId: 'infinite-context-threshold-probe',
            threshold: configuredThreshold
        })

        return {
            inputTokens: result.inputTokens,
            compressed: result.compressed,
            compressionCalls,
            hardContext: model.getModelMaxContextSize(),
            usableLimit: model.invocationParams().maxTokenLimit,
            configuredThreshold
        }
    }

    const highBelow = await runInfinite(840_000)
    const highAt = await runInfinite(850_000)
    assert.equal(highBelow.hardContext, 1_000_000)
    assert.equal(highBelow.usableLimit, 850_000)
    assert.equal(highBelow.inputTokens, 840_000)
    assert.equal(highBelow.compressed, false)
    assert.equal(highBelow.compressionCalls, 0)
    assert.equal(highAt.inputTokens, 850_000)
    assert.equal(highAt.compressed, true)
    assert.equal(highAt.compressionCalls, 1)

    const lowBelow = await runInfinite(34_999, 100_000, 35_000)
    const lowAt = await runInfinite(35_000, 100_000, 35_000)
    assert.equal(lowBelow.hardContext, 100_000)
    assert.equal(lowBelow.usableLimit, 35_000)
    assert.equal(lowBelow.inputTokens, 34_999)
    assert.equal(lowBelow.compressed, false)
    assert.equal(lowBelow.compressionCalls, 0)
    assert.equal(lowAt.inputTokens, 35_000)
    assert.equal(lowAt.compressed, true)
    assert.equal(lowAt.compressionCalls, 1)

    process.stdout.write(
        `${JSON.stringify({
            providerBaseline,
            promptTokens,
            expectedPromptTokens,
            firstCycleTokens,
            secondCycleTokens,
            emptyAiTokens,
            argsAiTokens,
            rawArgsAiTokens,
            noToolCallIdTokens,
            toolCallIdTokens,
            highBelow,
            highAt,
            lowBelow,
            lowAt
        })}\n`
    )
}

main().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`)
    process.exitCode = 1
})
