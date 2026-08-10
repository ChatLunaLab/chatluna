const assert = require('node:assert/strict')

const { Context } = require('koishi')
const { HumanMessage, AIMessageChunk } = require('@langchain/core/messages')
const { ChatGenerationChunk } = require('@langchain/core/outputs')
const chatluna = require('koishi-plugin-chatluna')
chatluna.apply(new Context(), { isLog: false })
const {
    ModelRequester
} = require('koishi-plugin-chatluna/llm-core/platform/api')
const {
    ChatLunaChatModel
} = require('koishi-plugin-chatluna/llm-core/platform/model')

const SNAPSHOT_KEYS = [
    'reasoning_time',
    'output_tokens',
    'total_tokens',
    'totalMs',
    'tps'
]

function chunk(text, usage_metadata) {
    return new ChatGenerationChunk({
        message: new AIMessageChunk({ content: text, usage_metadata }),
        text
    })
}

function snapshots(base) {
    return {
        reasoning_time: base + 1,
        output_tokens: base + 2,
        total_tokens: base + 3,
        totalMs: base + 4,
        tps: base + 5
    }
}

function metadataChunk(text, base) {
    return new ChatGenerationChunk({
        message: new AIMessageChunk({
            content: text,
            additional_kwargs: {
                reasoning_content: `reason-${text}`,
                tool_calls: [
                    {
                        id: `call-${text}`,
                        type: 'function',
                        function: {
                            name: 'lookup',
                            arguments: text
                        }
                    }
                ],
                [`kwargs_${text}`]: `keep-${text}`,
                ...snapshots(base)
            },
            response_metadata: {
                [`response_${text}`]: `keep-${text}`,
                ...snapshots(base + 100)
            },
            usage_metadata: {
                input_tokens: base === 10 ? 3 : 0,
                output_tokens: 1,
                total_tokens: base === 10 ? 4 : 1
            }
        }),
        text,
        generationInfo: {
            [`info_${text}`]: `keep-${text}`,
            ...snapshots(base + 200)
        }
    })
}

class MetadataRequester extends ModelRequester {
    logger = console

    constructor(chunks) {
        const config = {
            value: {},
            md5: () => 'stream-metadata-probe'
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
        this.chunks = chunks
    }

    async *completionStreamInternal() {
        yield* this.chunks
    }
}

function createModel(streams, events) {
    let calls = 0
    const requester = {
        completionStream(params) {
            calls += 1
            return streams[calls - 1](params.signal)
        }
    }
    const model = new ChatLunaChatModel({
        model: 'stream-usage-probe',
        modelInfo: { name: 'stream-usage-probe' },
        modelMaxContextSize: 1024,
        requester,
        maxRetries: 1,
        usageReporter: async (event) => events.push(event)
    })

    return {
        model,
        get calls() {
            return calls
        }
    }
}

async function collect(model, options) {
    const result = []
    for await (const item of model._streamResponseChunks(
        [new HumanMessage('stream usage probe')],
        options
    )) {
        result.push(item.text)
    }
    return result
}

async function* fail() {
    throw new Error('network failure')
}

async function* success() {
    yield chunk('ok', {
        input_tokens: 4,
        output_tokens: 2,
        total_tokens: 6
    })
}

async function* partialFailure() {
    yield chunk('partial response')
    throw new Error('partial stream failure')
}

async function main() {
    const retryEvents = []
    const retry = createModel([fail, success], retryEvents)
    assert.deepEqual(await collect(retry.model, { stream: true }), ['ok'])
    assert.equal(retry.calls, 2)
    assert.equal(retryEvents.length, 2)
    assert.equal(retryEvents[0].success, false)
    assert.equal(retryEvents[0].estimated, true)
    assert(retryEvents[0].usageMetadata.input_tokens > 0)
    assert.equal(
        retryEvents[0].localInputTokens,
        retryEvents[0].usageMetadata.input_tokens
    )
    assert.equal(retryEvents[0].localOutputTokens, 0)
    assert.equal(retryEvents[1].success, true)
    assert.equal(retryEvents[1].estimated, false)
    assert.deepEqual(retryEvents[1].usageMetadata, {
        input_tokens: 4,
        output_tokens: 2,
        total_tokens: 6
    })
    assert(retryEvents[1].localInputTokens > 0)
    assert(retryEvents[1].localOutputTokens > 0)
    const localInputTotal = retryEvents.reduce(
        (sum, event) => sum + event.localInputTokens,
        0
    )
    const localOutputTotal = retryEvents.reduce(
        (sum, event) => sum + event.localOutputTokens,
        0
    )
    const providerInputDelta =
        localInputTotal -
        retryEvents.reduce(
            (sum, event) => sum + event.usageMetadata.input_tokens,
            0
        )
    const providerOutputDelta =
        localOutputTotal -
        retryEvents.reduce(
            (sum, event) => sum + event.usageMetadata.output_tokens,
            0
        )
    assert.equal(
        providerInputDelta,
        retryEvents[1].localInputTokens -
            retryEvents[1].usageMetadata.input_tokens
    )
    assert.equal(
        providerOutputDelta,
        retryEvents[1].localOutputTokens -
            retryEvents[1].usageMetadata.output_tokens
    )

    const partialEvents = []
    const partial = createModel([partialFailure], partialEvents)
    await assert.rejects(
        collect(partial.model, { stream: true }),
        /partial stream failure/
    )
    assert.equal(partial.calls, 1)
    assert.equal(partialEvents.length, 1)
    assert.equal(partialEvents[0].success, false)
    assert.equal(partialEvents[0].estimated, true)
    assert(partialEvents[0].usageMetadata.output_tokens > 0)
    assert.equal(
        partialEvents[0].localInputTokens,
        partialEvents[0].usageMetadata.input_tokens
    )
    assert.equal(
        partialEvents[0].localOutputTokens,
        partialEvents[0].usageMetadata.output_tokens
    )
    assert.equal(
        partialEvents[0].usageMetadata.total_tokens,
        partialEvents[0].usageMetadata.input_tokens +
            partialEvents[0].usageMetadata.output_tokens
    )

    let start
    const started = new Promise((resolve) => {
        start = resolve
    })
    const abortEvents = []
    const abortController = new AbortController()
    const abort = createModel(
        [
            async function* (signal) {
                start()
                await new Promise((resolve) => {
                    signal.addEventListener('abort', resolve, { once: true })
                })
                throw signal.reason
            }
        ],
        abortEvents
    )
    const pending = collect(abort.model, {
        stream: true,
        signal: abortController.signal
    })
    await started
    const reason = new Error('external abort')
    abortController.abort(reason)

    await assert.rejects(pending, (error) => error === reason)
    assert.equal(abort.calls, 1)
    assert.equal(abortEvents.length, 1)
    assert.equal(abortEvents[0].success, false)
    assert.equal(abortEvents[0].estimated, true)
    assert(abortEvents[0].usageMetadata.input_tokens > 0)
    assert.equal(
        abortEvents[0].localInputTokens,
        abortEvents[0].usageMetadata.input_tokens
    )
    assert.equal(abortEvents[0].localOutputTokens, 0)

    const streamed = []
    let response
    for await (const item of new MetadataRequester([
        metadataChunk('A', 10),
        metadataChunk('B', 20)
    ]).completionStream({ input: [] })) {
        streamed.push(item)
        response = response == null ? item : response.concat(item)
    }

    assert.equal(streamed.length, 3)
    for (const item of streamed.slice(0, 2)) {
        for (const key of SNAPSHOT_KEYS) {
            assert.equal(
                Object.hasOwn(item.message.additional_kwargs, key),
                false
            )
            assert.equal(
                Object.hasOwn(item.message.response_metadata, key),
                false
            )
            assert.equal(Object.hasOwn(item.generationInfo, key), false)
        }
    }
    assert.equal(streamed[0].text, 'A')
    assert.equal(streamed[0].message.content, 'A')
    assert.equal(
        streamed[0].message.additional_kwargs.reasoning_content,
        'reason-A'
    )
    assert.equal(
        streamed[0].message.additional_kwargs.tool_calls[0].id,
        'call-A'
    )
    assert.equal(streamed[0].message.additional_kwargs.kwargs_A, 'keep-A')
    assert.equal(streamed[0].message.response_metadata.response_A, 'keep-A')
    assert.equal(streamed[0].generationInfo.info_A, 'keep-A')
    assert.deepEqual(streamed[0].message.usage_metadata, {
        input_tokens: 3,
        output_tokens: 1,
        total_tokens: 4
    })

    assert.equal(streamed[1].text, 'B')
    assert.equal(streamed[1].message.content, 'B')
    assert.equal(
        streamed[1].message.additional_kwargs.reasoning_content,
        'reason-B'
    )
    assert.equal(
        streamed[1].message.additional_kwargs.tool_calls[0].id,
        'call-B'
    )
    assert.equal(streamed[1].message.additional_kwargs.kwargs_B, 'keep-B')
    assert.equal(streamed[1].message.response_metadata.response_B, 'keep-B')
    assert.equal(streamed[1].generationInfo.info_B, 'keep-B')
    assert.deepEqual(streamed[1].message.usage_metadata, {
        input_tokens: 0,
        output_tokens: 1,
        total_tokens: 1
    })

    assert.deepEqual(
        Object.fromEntries(
            SNAPSHOT_KEYS.map((key) => [
                key,
                streamed[2].message.additional_kwargs[key]
            ])
        ),
        snapshots(20)
    )
    assert.deepEqual(
        Object.fromEntries(
            SNAPSHOT_KEYS.map((key) => [
                key,
                streamed[2].message.response_metadata[key]
            ])
        ),
        snapshots(120)
    )
    assert.deepEqual(
        Object.fromEntries(
            SNAPSHOT_KEYS.map((key) => [key, streamed[2].generationInfo[key]])
        ),
        snapshots(220)
    )

    assert.equal(response.text, 'AB')
    assert.equal(response.message.content, 'AB')
    assert.equal(
        response.message.additional_kwargs.reasoning_content,
        'reason-Areason-B'
    )
    assert.deepEqual(
        response.message.additional_kwargs.tool_calls.map((call) => call.id),
        ['call-A', 'call-B']
    )
    assert.equal(response.message.additional_kwargs.kwargs_A, 'keep-A')
    assert.equal(response.message.additional_kwargs.kwargs_B, 'keep-B')
    assert.equal(response.message.response_metadata.response_A, 'keep-A')
    assert.equal(response.message.response_metadata.response_B, 'keep-B')
    assert.equal(response.generationInfo.info_A, 'keep-A')
    assert.equal(response.generationInfo.info_B, 'keep-B')
    assert.deepEqual(response.message.usage_metadata, {
        input_tokens: 3,
        output_tokens: 2,
        total_tokens: 5
    })
    assert.deepEqual(
        Object.fromEntries(
            SNAPSHOT_KEYS.map((key) => [
                key,
                response.message.additional_kwargs[key]
            ])
        ),
        snapshots(20)
    )
    assert.deepEqual(
        Object.fromEntries(
            SNAPSHOT_KEYS.map((key) => [
                key,
                response.message.response_metadata[key]
            ])
        ),
        snapshots(120)
    )
    assert.deepEqual(
        Object.fromEntries(
            SNAPSHOT_KEYS.map((key) => [key, response.generationInfo[key]])
        ),
        snapshots(220)
    )

    process.stdout.write(
        `${JSON.stringify({ retryEvents: retryEvents.length, localInputTotal, localOutputTotal, providerInputDelta, providerOutputDelta, partialEvents: partialEvents.length, partialOutputTokens: partialEvents[0].localOutputTokens, abortEvents: abortEvents.length, metadataCarriers: 3 })}\n`
    )
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
})
