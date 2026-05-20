import type { Tiktoken } from 'js-tiktoken/lite'
import { Logger } from 'koishi'
import { getEncoding } from '../utils/tiktoken'

const logger = new Logger('chatluna')
const ENCODING = 'cl100k_base'

let encoder: Tiktoken | null = null
let warmupPromise: Promise<void> | null = null
let initFailed = false

export function warmupTokenEncoder(): Promise<void> {
    if (encoder != null || initFailed) return Promise.resolve()
    if (warmupPromise != null) return warmupPromise
    warmupPromise = getEncoding(ENCODING)
        .then((e) => {
            encoder = e
        })
        .catch((e) => {
            initFailed = true
            logger.warn('tiktoken init failed; falling back to heuristic', e)
        })
        .finally(() => {
            warmupPromise = null
        })
    return warmupPromise
}

function heuristic(text: string): number {
    let count = 0
    for (const char of text) {
        count += char.charCodeAt(0) <= 0x7f ? 0.25 : 2 / 3
    }
    return Math.ceil(count)
}

export async function estimateTextTokens(
    input: string | string[]
): Promise<number> {
    const text = Array.isArray(input) ? input.join('\n') : input
    if (encoder == null && !initFailed) await warmupTokenEncoder()
    if (encoder != null) {
        try {
            return encoder.encode(text).length
        } catch {
            // fall through to heuristic
        }
    }
    return heuristic(text)
}
