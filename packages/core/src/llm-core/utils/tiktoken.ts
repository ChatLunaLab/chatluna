import {
    getEncodingNameForModel,
    Tiktoken,
    TiktokenBPE,
    TiktokenEncoding,
    TiktokenModel
} from 'js-tiktoken/lite'
import { chatLunaFetch } from '../../utils/request'

const cache: Record<string, TiktokenBPE> = {}

export let errorCount = 0

export async function getEncoding(
    encoding: TiktokenEncoding,
    options?: {
        signal?: AbortSignal
        extendedSpecialTokens?: Record<string, number>
    }
) {
    if (errorCount > 3) {
        throw new Error('Too many errors')
    }
    if (!(encoding in cache)) {
        cache[encoding] = await chatLunaFetch(
            `https://tiktoken.pages.dev/js/${encoding}.json`,
            {
                signal: options?.signal
            }
        )
            .then((res) => res.json() as unknown as TiktokenBPE)
            .catch((e) => {
                errorCount++

                delete cache[encoding]
                throw e
            })
    }

    return new Tiktoken(cache[encoding], options?.extendedSpecialTokens)
}

export async function encodingForModel(
    model: TiktokenModel,
    options?: {
        signal?: AbortSignal
        extendedSpecialTokens?: Record<string, number>
    }
) {
    options = options ?? {}

    let timeout: NodeJS.Timeout

    if (options.signal == null) {
        const abortController = new AbortController()

        options.signal = abortController.signal

        timeout = setTimeout(() => abortController.abort(), 1000 * 25)
    }
    const result = await getEncoding(getEncodingNameForModel(model), options)

    if (timeout != null) {
        clearTimeout(timeout)
    }

    return result
}
