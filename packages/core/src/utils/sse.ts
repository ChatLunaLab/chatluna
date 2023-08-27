import * as fetchType from 'undici/types/fetch';
import { ChatHubError, ChatHubErrorCode } from './error';

export async function* sseIterable(response: fetchType.Response) {
    if (!response.ok) {
        const error = await response.json().catch(() => ({}))

        throw new ChatHubError(ChatHubErrorCode.NETWORK_ERROR, new Error(`${response.status} ${response.statusText} ${error}`))
    }

    const reader = response.body.getReader()

    const decoder = new TextDecoder('utf-8')

    try {
        while (true) {
            const { value, done } = await reader.read()

            if (done) {
                return
            }

            let decodeValue = decoder.decode(value)

            if (decodeValue.startsWith('data: ')) {
                decodeValue = decodeValue.substring(6)
            }

            yield decodeValue
        }
    } finally {
        reader.releaseLock()
    }
}