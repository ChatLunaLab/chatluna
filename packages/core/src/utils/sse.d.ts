import * as fetchType from 'undici/types/fetch'
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
} & Record<string, string>
export declare function checkResponse(
    response: fetchType.Response | ReadableStreamDefaultReader<string>
): Promise<void>
export declare function sse(
    response: fetchType.Response | ReadableStreamDefaultReader<string>,
    onEvent?: (rawData: string) => Promise<string | boolean | void>,
    cacheCount?: number
): Promise<void>
export declare function rawSeeAsIterable(
    response: fetchType.Response | ReadableStreamDefaultReader<string>,
    cacheCount?: number
): AsyncGenerator<string, void, unknown>
export declare function sseIterable(
    response: fetchType.Response | ReadableStreamDefaultReader<string>
): AsyncGenerator<SSEEvent, string, unknown>
