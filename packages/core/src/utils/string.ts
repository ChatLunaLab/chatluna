import { BaseMessage } from '@langchain/core/messages'
import type { HandlerResult, PostHandler } from './types'
import { Context, h, Session } from 'koishi'
import type {} from '@koishijs/censor'
import { Config } from 'koishi-plugin-chatluna'
import { gunzip, gzip } from 'zlib'
import { promisify } from 'util'
import { chatLunaFetch } from 'koishi-plugin-chatluna/utils/request'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

type Encoding = 'buffer' | 'base64' | 'hex'
type BufferType<T extends Encoding> = T extends 'buffer'
    ? Buffer
    : T extends 'base64'
      ? string
      : T extends 'hex'
        ? string
        : never

export function fuzzyQuery(source: string, keywords: string[]): boolean {
    for (const keyword of keywords) {
        const match = source.includes(keyword)
        if (match) {
            return true
        }
    }
    return false
}

export function getMessageContent(message: BaseMessage['content']) {
    if (typeof message === 'string') {
        return message
    }

    if (message == null) {
        return ''
    }

    const buffer: string[] = []
    for (const part of message) {
        if (part.type === 'text') {
            buffer.push(part.text as string)
        }
    }
    return buffer.join('')
}

export function getNotEmptyString(...texts: (string | undefined)[]): string {
    for (const text of texts) {
        if (text && text?.length > 0) {
            return text
        }
    }
}

export function getCurrentWeekday() {
    const daysOfWeek = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday'
    ]
    const currentDate = new Date()
    return daysOfWeek[currentDate.getDay()]
}

export const getTimeInUTC = (offset: number): string => {
    const date = new Date()
    date.setMinutes(date.getMinutes() + offset * 60)
    return date.toISOString().substring(11, 8)
}

export const getTimeDiffFormat = (time1: number, time2: number): string => {
    const diff = Math.abs(time1 - time2)
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    const parts = []
    if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`)
    if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`)
    if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`)

    return parts.join(', ') || 'now'
}
export const getTimeDiff = (time1: string, time2: string): string => {
    return getTimeDiffFormat(
        new Date(time1).getTime(),
        new Date(time2).getTime()
    )
}

export const selectFromList = (args: string, isPick: boolean): string => {
    const items = args.split(',').map((item) => item.trim())
    if (isPick) {
        // TODO: Implement stable selection for 'pick'
        return items[Math.floor(Math.random() * items.length)]
    }
    return items[Math.floor(Math.random() * items.length)]
}

export const rollDice = (formula: string): number => {
    const parts = formula.split('d')
    let count = 1
    if (parts.length > 1 && !isNaN(Number(parts[0]))) {
        count = parseInt(parts[0], 10)
    }

    const lastPart = parts[parts.length - 1].split('+')
    let add = 0
    if (lastPart.length > 1 && !isNaN(Number(lastPart[1]))) {
        add = parseInt(lastPart[1], 10)
    }

    const range = !isNaN(Number(lastPart[0])) ? parseInt(lastPart[0], 10) : 1

    return Math.floor(Math.random() * (count * range - count + 1)) + count + add
}

export const fetchUrl = async (
    url: string,
    method: string = 'GET',
    body: string | null = null,
    textLength: number = 1000
): Promise<string> => {
    const response = await chatLunaFetch(url, {
        method,
        body
    })
    const text = await response.text()
    if (text.length > textLength) {
        return text.substring(0, textLength)
    }
    return text
}

export class PresetPostHandler implements PostHandler {
    prefix: string
    postfix: string
    variables: Record<string, string>
    censor?: boolean

    compiledVariables: Record<string, RegExp>

    constructor(
        private ctx: Context,
        private config: Config,
        object: Omit<PostHandler, 'handler'>
    ) {
        this.prefix = object.prefix
        this.postfix = object.postfix
        this.variables = object.variables ?? {}
        this.censor = object.censor

        this._compileVariables()
    }

    async handler(session: Session, data: string): Promise<HandlerResult> {
        let content = data

        const variables: Record<string, string> = {}

        if (this.compiledVariables) {
            for (const [key, value] of Object.entries(this.compiledVariables)) {
                const match = content.match(value)
                if (!match) {
                    continue
                }
                variables[key] = match[1]
            }
        }

        const censor = this.ctx.censor

        if (censor && (this.config.censor || this.censor)) {
            // See https://github.com/koishijs/censor/blob/2e3cd521bf35cb724bf464d9dd8269e4d9da53a2/packages/core/src/index.ts#L21
            // Parse the content to text
            content = await censor
                .transform([h.text(content)], session)
                .then((element) => element.join(''))
        }

        let displayContent = content

        if (this.prefix) {
            const startIndex = content.indexOf(this.prefix)
            if (startIndex !== -1) {
                displayContent = content.substring(
                    startIndex + this.prefix.length
                )
            }
        }

        if (this.postfix) {
            const endIndex = displayContent.lastIndexOf(this.postfix)
            if (endIndex !== -1) {
                displayContent = displayContent.substring(0, endIndex)
            }
        }

        return { content, variables, displayContent }
    }

    private _compileVariables() {
        if (!this.variables) {
            return
        }

        this.compiledVariables = {}
        for (const [key, value] of Object.entries(this.variables)) {
            this.compiledVariables[key] = new RegExp(value)
        }
    }
}

// GZIP 编码
export async function gzipEncode<T extends Encoding = 'buffer'>(
    text: string,
    encoding: T = 'buffer' as T
): Promise<BufferType<T>> {
    const buffer = await gzipAsync(text)
    return encoding === 'buffer'
        ? (buffer as BufferType<T>)
        : (buffer.toString(encoding) as BufferType<T>)
}

// GZIP 解码
export async function gzipDecode(
    data: ArrayBuffer | Buffer | string,
    inputEncoding: Encoding = 'base64'
): Promise<string> {
    const buffer =
        typeof data === 'string'
            ? Buffer.from(data, inputEncoding as 'base64')
            : data
    return (await gunzipAsync(buffer)).toString('utf8')
}

export function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
    const arrayBuffer = new ArrayBuffer(buffer.length)
    const view = new Uint8Array(arrayBuffer)
    for (let i = 0; i < buffer.length; i++) {
        view[i] = buffer[i]
    }
    return arrayBuffer
}

export async function hashString(
    text: string,
    length: number = 8
): Promise<string> {
    const hash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(text)
    )
    const hashArray = Array.from(new Uint8Array(hash))
    const hashString = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return hashString.substring(0, length)
}
