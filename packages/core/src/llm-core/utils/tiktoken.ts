import {
    Tiktoken,
    TiktokenBPE,
    TiktokenEncoding,
    TiktokenModel,
    getEncodingNameForModel,
} from "js-tiktoken/lite";
import { request } from './request';


const cache: Record<string, Promise<TiktokenBPE>> = {};

export async function getEncoding(
    encoding: TiktokenEncoding,
    options?: {
        signal?: AbortSignal;
        extendedSpecialTokens?: Record<string, number>;
    }
) {
    if (!(encoding in cache)) {
        cache[encoding] = request
            .fetch(`https://tiktoken.pages.dev/js/${encoding}.json`, {
                signal: options?.signal,
            })
            .then((res) => res.json() as unknown as TiktokenBPE)
            .catch((e) => {
                delete cache[encoding];
                throw e;
            });
    }

    return new Tiktoken(await cache[encoding], options?.extendedSpecialTokens);
}

export async function encodingForModel(
    model: TiktokenModel,
    options?: {
        signal?: AbortSignal;
        extendedSpecialTokens?: Record<string, number>;
    }
) {
    return getEncoding(getEncodingNameForModel(model), options);
}