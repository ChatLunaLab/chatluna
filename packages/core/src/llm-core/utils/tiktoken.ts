import {
    getEncoding,
    getEncodingNameForModel,
    Tiktoken,
    TiktokenModel
} from 'js-tiktoken'

const cache: Record<string, Tiktoken> = {}

export async function encodingForModel(
    model: TiktokenModel,
    options?: {
        extendedSpecialTokens?: Record<string, number>
    }
) {
    const encoding = getEncodingNameForModel(model)

    if (!(encoding in cache)) {
        cache[encoding] = getEncoding(encoding, options?.extendedSpecialTokens)
    }

    return cache[encoding]
}
