import {
    ChatLunaError,
    ChatLunaErrorCode,
    createAbortError,
    createTimeoutError
} from 'koishi-plugin-chatluna/utils/error'
import * as fetchType from 'undici/types/fetch'

const BOM = 0xfeff
const LF = 0x000a
const CR = 0x000d
const SPACE = 0x0020
const COLON = 0x003a

/**
 * Event type push by {@link createParser}
 */
export type SSEEvent = {
    /**
     * event field (name)
     */
    event?: string
    /**
     * data field
     */
    data?: string
    /**
     * comments in event
     */
    comments?: string[]
} & Record<string, string> // record for any not standard event fields

function createParser() {
    let state = 'stream'

    let temp: SSEEvent = {}
    let comment = ''
    let fieldName = ''
    let fieldValue = ''

    // eslint-disable-next-line generator-star-spacing
    function* parse(data: string) {
        const cursor = data[Symbol.iterator]()
        let value: IteratorResult<string> = { done: false, value: '' }
        const looks: IteratorResult<string>[] = []

        function lookNext(
            ignoreIfFn: (v: IteratorResult<string>) => boolean
        ): void {
            next()

            if (value.value === undefined) return

            if (!ignoreIfFn(value)) {
                looks.push(value)
            }
        }

        function next(): boolean {
            if (looks.length > 0) {
                value = looks.shift() as IteratorResult<string>
                return value.done ?? false
            }

            value = cursor.next()
            return value.done ?? false
        }

        while (!next()) {
            const char = value.value
            const charCode = char.codePointAt(0)

            function isLF(): boolean {
                if (charCode === LF) return true
                if (charCode === CR) {
                    lookNext((c) => c.value.codePointAt(0) === LF)
                    return true
                }

                return false
            }

            switch (state) {
                case 'stream':
                    state = 'event'
                    if (charCode === BOM) break
                // tslint:disable-next-line: no-fallthrough --> intentional fallthrough
                case 'event':
                    if (isLF()) {
                        yield temp
                        temp = {}
                    } else if (charCode === COLON) {
                        state = 'comment'
                        comment = ''
                    } else {
                        state = 'field'
                        fieldName = char
                        fieldValue = ''
                    }
                    break
                case 'comment':
                    if (isLF()) {
                        if (temp.comments === undefined) {
                            temp.comments = []
                        }
                        temp.comments.push(comment)
                        comment = ''
                        state = 'event'
                    } else {
                        comment += char
                    }
                    break
                case 'field':
                    if (charCode === COLON) {
                        lookNext((c) => c.value.codePointAt(0) === SPACE)
                        state = 'field_value'
                    } else if (isLF()) {
                        if (temp[fieldName] !== undefined)
                            temp[fieldName] += '\n'
                        else temp[fieldName] = ''
                        fieldName = ''
                        fieldValue = ''
                        state = 'event'
                    } else fieldName += char
                    break
                case 'field_value':
                    if (isLF()) {
                        if (temp[fieldName] !== undefined)
                            temp[fieldName] += '\n' + fieldValue
                        else temp[fieldName] = fieldValue
                        fieldName = ''
                        fieldValue = ''
                        state = 'event'
                    } else fieldValue += char
            }
        }
    }

    return (data: string) => parse(data)
}

export async function checkResponse(
    response: fetchType.Response | ReadableStreamDefaultReader<string>
) {
    if (!(response instanceof ReadableStreamDefaultReader || response.ok)) {
        const error = await response.text().catch(() => '')

        throw new ChatLunaError(
            ChatLunaErrorCode.NETWORK_ERROR,
            new Error(
                `${response.status} ${response.statusText} ${JSON.stringify(
                    error
                )}`
            )
        )
    }
}

// eslint-disable-next-line generator-star-spacing
async function* readSSE(
    reader: ReadableStreamDefaultReader,
    signal?: AbortSignal
) {
    const decoder = new TextDecoder('utf-8')
    const abort = () => {
        // eslint-disable-next-line no-void
        void reader.cancel(signal?.reason ?? createAbortError()).catch(() => {})
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try {
        while (true) {
            const { value, done } = await reader.read()
            if (signal?.aborted) throw signal.reason ?? createAbortError()
            if (done) return
            yield decoder.decode(value, { stream: true })
        }
    } finally {
        signal?.removeEventListener('abort', abort)
        await reader.cancel().catch(() => {})
        reader.releaseLock()
    }
}

// eslint-disable-next-line generator-star-spacing
export async function* rawSeeAsIterable(
    response: fetchType.Response | ReadableStreamDefaultReader<string>,
    cacheCount: number = 0,
    signal?: AbortSignal
) {
    await checkResponse(response)

    const reader =
        response instanceof ReadableStreamDefaultReader
            ? response
            : (response.body.getReader() as ReadableStreamDefaultReader<string>)

    let bufferString = ''

    let tempCount = 0

    for await (const rawChunk of readSSE(reader, signal)) {
        bufferString += rawChunk
        tempCount++

        if (tempCount > cacheCount) {
            yield bufferString

            bufferString = ''
            tempCount = 0
        }
    }

    if (bufferString.length > 0) {
        yield bufferString
    }
}

// eslint-disable-next-line generator-star-spacing
export async function* sseIterable(
    response: fetchType.Response | ReadableStreamDefaultReader<string>,
    params: { timeout?: number; signal?: AbortSignal } = {}
) {
    const idleTimeout = params.timeout
    const parser = createParser()
    const controller = new AbortController()
    let timer: NodeJS.Timeout | undefined
    const abort = () => controller.abort(params.signal?.reason)

    const reset = () => {
        if (idleTimeout == null || controller.signal.aborted) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(
            () => controller.abort(createTimeoutError()),
            idleTimeout
        )
    }

    if (params.signal) {
        params.signal.addEventListener('abort', abort, { once: true })
        if (params.signal.aborted) abort()
    }

    reset()

    try {
        for await (const rawChunk of rawSeeAsIterable(
            response,
            0,
            controller.signal
        )) {
            for (const event of parser(rawChunk)) {
                if (Object.keys(event).some((key) => key !== 'comments')) {
                    reset()
                }
                yield event
            }
        }
    } finally {
        if (timer) clearTimeout(timer)
        params.signal?.removeEventListener('abort', abort)
    }

    return '[DONE]'
}
