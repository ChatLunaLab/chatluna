const assert = require('node:assert/strict')

const { Context } = require('koishi')
const { HumanMessage, AIMessageChunk } = require('@langchain/core/messages')
const { ChatGenerationChunk } = require('@langchain/core/outputs')
const chatluna = require('koishi-plugin-chatluna')
chatluna.apply(new Context(), { isLog: false })
const {
    ChatLunaChatModel
} = require('koishi-plugin-chatluna/llm-core/platform/model')
const {
    ChatLunaError,
    ChatLunaErrorCode
} = require('koishi-plugin-chatluna/utils/error')
const {
    completion,
    completionStream
} = require('@chatluna/v1-shared-adapter')
const { sseIterable } = require('koishi-plugin-chatluna/utils/sse')

function wait(ms, signal) {
    return new Promise((resolve, reject) => {
        const done = () => {
            signal?.removeEventListener('abort', abort)
            resolve()
        }
        const timer = setTimeout(done, ms)
        const abort = () => {
            clearTimeout(timer)
            reject(signal.reason)
        }

        if (signal?.aborted) {
            abort()
            return
        }
        signal?.addEventListener('abort', abort, { once: true })
    })
}

function chunk(text) {
    return new ChatGenerationChunk({
        message: new AIMessageChunk({ content: text }),
        text
    })
}

function sseResponse(events, delay, signal, keepOpen = false) {
    const encoder = new TextEncoder()
    let index = 0
    let canceled = false
    let stop
    const body = new ReadableStream({
        async pull(controller) {
            if (index < events.length) {
                await wait(delay, signal)
                if (canceled) return
                const event = events[index++]
                const data =
                    typeof event === 'string' ? event : JSON.stringify(event)
                controller.enqueue(encoder.encode(`data: ${data}\n\n`))
                return
            }

            if (!keepOpen) {
                controller.close()
                return
            }

            await new Promise((resolve, reject) => {
                stop = resolve
                if (signal?.aborted) {
                    reject(signal.reason)
                    return
                }
                signal?.addEventListener(
                    'abort',
                    () => reject(signal.reason),
                    { once: true }
                )
            })
        },
        cancel() {
            canceled = true
            stop?.()
        }
    })

    return {
        response: new Response(body),
        wasCanceled: () => canceled
    }
}

function periodicSseResponse(frames, delay) {
    const encoder = new TextEncoder()
    let index = 0
    let timer
    let canceled = false
    let cancelReason
    const body = new ReadableStream({
        start(controller) {
            timer = setInterval(() => {
                controller.enqueue(
                    encoder.encode(frames[index++ % frames.length])
                )
            }, delay)
        },
        cancel(reason) {
            canceled = true
            cancelReason = reason
            clearInterval(timer)
        }
    })

    return {
        response: new Response(body),
        wasCanceled: () => canceled,
        cancelReason: () => cancelReason
    }
}

function createContext(response) {
    return {
        ctx: {
            chatluna: {
                currentConfig: { isLog: false }
            }
        },
        plugin: {},
        modelRequester: {
            logger: {
                debug() {},
                error() {}
            },
            async post(_url, _body, options) {
                return response(options.signal)
            }
        }
    }
}

function adapterStream(params, response) {
    return completionStream(createContext(response), params)
}

function adapterCompletion(params, response) {
    return completion(createContext(response), params)
}

function createModel(streams, maxRetries = 5) {
    let calls = 0
    const requester = {
        completionStream(params) {
            calls++
            return streams[calls - 1](params)
        }
    }
    const model = new ChatLunaChatModel({
        model: 'stream-idle-probe',
        modelInfo: { name: 'stream-idle-probe' },
        modelMaxContextSize: 1024,
        requester,
        timeout: 35,
        maxRetries
    })

    return {
        model,
        get calls() {
            return calls
        }
    }
}

async function collect(model, signal, result = []) {
    for await (const item of model._streamResponseChunks(
        [new HumanMessage('stream idle probe')],
        { stream: true, signal },
        undefined,
        false
    )) {
        result.push(item)
    }
    return result
}

async function collectStream(stream) {
    const result = []
    for await (const item of stream) result.push(item)
    return result
}

async function* failed() {
    throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED)
}

async function* recovered() {
    yield chunk('recovered')
}

async function main() {
    const input = [new HumanMessage('raw SSE probe')]
    const reasoningEvents = [
        {
            choices: [
                {
                    delta: {
                        role: 'assistant',
                        reasoning_content: 'first'
                    }
                }
            ]
        },
        { choices: [{ delta: { reasoning_content: '' } }] },
        { choices: [{ delta: { reasoning_content: 'second' } }] },
        { choices: [{ delta: { content: 'answer' } }] },
        '[DONE]'
    ]
    let reasoningTransport
    const reasoningStarted = Date.now()
    const reasoningOutput = await collectStream(
        adapterStream(
            {
                model: 'stream-idle-probe',
                input,
                timeout: 35
            },
            (signal) => {
                reasoningTransport = sseResponse(
                    reasoningEvents,
                    20,
                    signal
                )
                return reasoningTransport.response
            }
        )
    )
    assert(Date.now() - reasoningStarted > 35)
    assert.equal(reasoningTransport.wasCanceled(), false)
    const reasoningMessage = reasoningOutput.reduce((result, item) =>
        result == null ? item : result.concat(item)
    ).message
    assert.equal(reasoningMessage.content, 'answer')
    assert.equal(
        reasoningMessage.additional_kwargs.reasoning_content,
        'firstsecond'
    )

    let headerAborted = false
    const headerStarted = Date.now()
    await assert.rejects(
        () =>
            collectStream(
                adapterStream(
                    {
                        model: 'stream-idle-probe',
                        input,
                        timeout: 35
                    },
                    async (signal) => {
                        signal.addEventListener(
                            'abort',
                            () => {
                                headerAborted = true
                            },
                            { once: true }
                        )
                        await wait(100, signal)
                        return sseResponse([], 0, signal).response
                    }
                )
            ),
        (error) =>
            error instanceof ChatLunaError &&
            error.errorCode === ChatLunaErrorCode.API_REQUEST_TIMEOUT
    )
    assert.equal(headerAborted, true)
    assert(Date.now() - headerStarted < 500)

    let nonStreamAborted = false
    await assert.rejects(
        () =>
            adapterCompletion(
                {
                    model: 'stream-idle-probe',
                    input,
                    timeout: 35
                },
                (signal) => {
                    signal.addEventListener(
                        'abort',
                        () => {
                            nonStreamAborted = true
                        },
                        { once: true }
                    )
                    return sseResponse([], 0, signal, true).response
                }
            ),
        (error) =>
            error instanceof ChatLunaError &&
            error.errorCode === ChatLunaErrorCode.API_REQUEST_TIMEOUT
    )
    assert.equal(nonStreamAborted, true)

    let silentTransport
    const silentStarted = Date.now()
    await assert.rejects(
        () =>
            collectStream(
                adapterStream(
                    {
                        model: 'stream-idle-probe',
                        input,
                        timeout: 35
                    },
                    (signal) => {
                        silentTransport = sseResponse([], 0, signal, true)
                        return silentTransport.response
                    }
                )
            ),
        (error) =>
            error instanceof ChatLunaError &&
            error.errorCode === ChatLunaErrorCode.API_REQUEST_TIMEOUT
    )
    assert(silentTransport.wasCanceled())
    assert(Date.now() - silentStarted < 500)

    const idleTransports = []
    const timeoutStream = (params) =>
        adapterStream(params, (signal) => {
            const transport = sseResponse([], 0, signal, true)
            idleTransports.push(transport)
            return transport.response
        })
    const retry = createModel([timeoutStream, timeoutStream])
    await assert.rejects(
        () => collect(retry.model),
        (error) =>
            error instanceof ChatLunaError &&
            error.errorCode === ChatLunaErrorCode.API_REQUEST_TIMEOUT
    )
    assert.equal(retry.calls, 2)
    assert(idleTransports.every((transport) => transport.wasCanceled()))

    const retryable = createModel([failed, failed, recovered], 2)
    assert.deepEqual(
        (await collect(retryable.model)).map((item) => item.text),
        ['recovered']
    )
    assert.equal(retryable.calls, 3)

    let partialTransport
    const partial = createModel([
        (params) =>
            adapterStream(params, (signal) => {
                partialTransport = sseResponse(
                    [{ choices: [{ delta: { content: 'partial' } }] }],
                    0,
                    signal,
                    true
                )
                return partialTransport.response
            })
    ])
    const partialOutput = []
    await assert.rejects(
        () => collect(partial.model, undefined, partialOutput),
        (error) =>
            error instanceof ChatLunaError &&
            error.errorCode === ChatLunaErrorCode.API_REQUEST_TIMEOUT
    )
    assert.deepEqual(
        partialOutput.map((item) => item.text),
        ['partial']
    )
    assert.equal(partial.calls, 1)
    assert(partialTransport.wasCanceled())

    const parent = new AbortController()
    const parentError = new Error('parent aborted')
    const aborted = createModel([
        (params) =>
            adapterStream(params, (signal) => {
                return sseResponse([], 0, signal, true).response
            })
    ])
    setTimeout(() => parent.abort(parentError), 10)
    await assert.rejects(
        () => collect(aborted.model, parent.signal),
        (error) => error === parentError
    )
    assert.equal(aborted.calls, 1)

    const returnedTransport = sseResponse(['first'], 0, undefined, true)
    const returned = sseIterable(returnedTransport.response)
    assert.equal((await returned.next()).value.data, 'first')
    await returned.return()
    assert.equal(returnedTransport.wasCanceled(), true)

    const semanticSignal = new AbortController()
    const semanticAdd = semanticSignal.signal.addEventListener.bind(
        semanticSignal.signal
    )
    const semanticRemove = semanticSignal.signal.removeEventListener.bind(
        semanticSignal.signal
    )
    let semanticListeners = 0
    Object.defineProperty(semanticSignal.signal, 'addEventListener', {
        value(type, callback, options) {
            if (type === 'abort') semanticListeners++
            return semanticAdd(type, callback, options)
        }
    })
    Object.defineProperty(semanticSignal.signal, 'removeEventListener', {
        value(type, callback, options) {
            if (type === 'abort') semanticListeners--
            return semanticRemove(type, callback, options)
        }
    })

    const timeoutResourcesBefore = process
        .getActiveResourcesInfo()
        .filter((type) => type === 'Timeout').length
    const commentTransport = periodicSseResponse([': ping\n\n'], 15)
    const commentStarted = Date.now()
    let commentEvents = 0
    let commentError
    try {
        for await (const event of sseIterable(
            commentTransport.response,
            75,
            semanticSignal.signal
        )) {
            commentEvents++
            assert(
                Object.keys(event).every((key) => key === 'comments'),
                'comment-only stream yielded a semantic event'
            )
        }
    } catch (error) {
        commentError = error
    }
    const commentElapsed = Date.now() - commentStarted
    await new Promise((resolve) => setImmediate(resolve))
    const timeoutResourcesAfterComments = process
        .getActiveResourcesInfo()
        .filter((type) => type === 'Timeout').length
    assert(commentError instanceof ChatLunaError)
    assert.equal(
        commentError.errorCode,
        ChatLunaErrorCode.API_REQUEST_TIMEOUT
    )
    assert(commentElapsed >= 50 && commentElapsed < 500)
    assert(commentEvents >= 3)
    assert.equal(commentTransport.wasCanceled(), true)
    assert.equal(
        commentTransport.cancelReason().errorCode,
        ChatLunaErrorCode.API_REQUEST_TIMEOUT
    )
    assert.equal(semanticListeners, 0)
    assert.equal(timeoutResourcesAfterComments, timeoutResourcesBefore)

    const eventTransport = periodicSseResponse(
        [': ping\n\n', ': ping\n\n', ': ping\n\n', 'data: hello\n\n',
            ': ping\n\n', ': ping\n\n', ': ping\n\n', ': ping\n\n',
            ': ping\n\n', ': ping\n\n'],
        15
    )
    const eventStarted = Date.now()
    let eventAt
    let eventError
    const events = []
    try {
        for await (const event of sseIterable(
            eventTransport.response,
            75,
            semanticSignal.signal
        )) {
            events.push(event)
            if (event.data === 'hello') eventAt = Date.now()
        }
    } catch (error) {
        eventError = error
    }
    const eventElapsed = Date.now() - eventStarted
    await new Promise((resolve) => setImmediate(resolve))
    const timeoutResourcesAfterEvent = process
        .getActiveResourcesInfo()
        .filter((type) => type === 'Timeout').length
    assert(eventAt != null)
    assert(eventAt - eventStarted < 75)
    assert(eventError instanceof ChatLunaError)
    assert.equal(eventError.errorCode, ChatLunaErrorCode.API_REQUEST_TIMEOUT)
    assert(eventElapsed - (eventAt - eventStarted) >= 50)
    assert(eventElapsed < 500)
    assert.equal(events.filter((event) => event.data === 'hello').length, 1)
    assert.equal(eventTransport.wasCanceled(), true)
    assert.equal(
        eventTransport.cancelReason().errorCode,
        ChatLunaErrorCode.API_REQUEST_TIMEOUT
    )
    assert.equal(semanticListeners, 0)
    assert.equal(timeoutResourcesAfterEvent, timeoutResourcesBefore)

    process.stdout.write(
        `${JSON.stringify({
            rawReasoningActivity: 'survived',
            initialHeaders: 'timed-out',
            rawSilence: 'timed-out',
            totalDuration: 'unbounded',
            timeoutRetries: 'at-most-once',
            retryableFailure: 'used-configured-retries',
            partialOutput: 'not-retried',
            parentAbort: 'preserved',
            consumerReturn: 'reader-canceled',
            semanticComments: {
                timeoutMs: commentElapsed,
                readerCanceled: commentTransport.wasCanceled(),
                events: commentEvents,
                listeners: semanticListeners,
                timerResources: timeoutResourcesAfterComments - timeoutResourcesBefore
            },
            semanticEventThenComments: {
                timeoutMs: eventElapsed,
                eventDelayMs: eventAt - eventStarted,
                timeoutAfterEventMs: eventElapsed - (eventAt - eventStarted),
                readerCanceled: eventTransport.wasCanceled(),
                listeners: semanticListeners,
                timerResources: timeoutResourcesAfterEvent - timeoutResourcesBefore
            }
        })}\n`
    )
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
})
