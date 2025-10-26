import {
    BaseMessage,
    MessageContent,
    MessageContentComplex,
    MessageContentImageUrl,
    MessageContentText
} from '@langchain/core/messages'
import type { HandlerResult, PostHandler } from './types'
import { Context, h, Session } from 'koishi'
import type {} from '@koishijs/censor'
import { Config, ConversationRoom } from 'koishi-plugin-chatluna'
import { gunzip, gzip } from 'zlib'
import { promisify } from 'util'
import { chatLunaFetch } from 'koishi-plugin-chatluna/utils/request'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import crypto from 'node:crypto'

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

export function isMessageContentImageUrl(
    message: MessageContentComplex
): message is MessageContentImageUrl {
    return message.type === 'image_url' && message['image_url'] != null
}

export function isMessageContentText(
    message: MessageContentComplex
): message is MessageContentText {
    return message.type === 'text' && message.text != null
}

export function transformMessageContentToElements(content: MessageContent) {
    if (typeof content === 'string') {
        return [h.text(content)]
    }

    return content.map((message) => {
        if (isMessageContentImageUrl(message)) {
            const imageUrl = message.image_url
            return typeof imageUrl === 'string'
                ? h.image(imageUrl)
                : h.image(imageUrl.url)
        } else {
            // TODO: support other message types (audio)
            return h.text(message.text)
        }
    })
}

export function getImageMimeType(ext?: string): string {
    switch (ext) {
        case 'png':
            return 'image/png'
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg'
        case 'gif':
            return 'image/gif'
        case 'webp':
            return 'image/webp'
        case 'svg':
            return 'image/svg+xml'
        case 'bmp':
            return 'image/bmp'
        case 'ico':
            return 'image/x-icon'
        default:
            return 'image/jpeg'
    }
}

export function getImageType(
    buffer: Buffer,
    pure: boolean = false,
    checkIsImage: boolean = true
): string {
    if (buffer.length < 12) {
        return checkIsImage ? undefined : pure ? 'jpg' : 'image/jpeg'
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        return pure ? 'png' : 'image/png'
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return pure ? 'jpg' : 'image/jpeg'
    }

    // GIF: 47 49 46 38 (GIF8)
    if (
        buffer[0] === 0x47 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x38
    ) {
        return pure ? 'gif' : 'image/gif'
    }

    // WebP: 52 49 46 46 ... 57 45 42 50 (RIFF....WEBP)
    if (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
    ) {
        return pure ? 'webp' : 'image/webp'
    }

    if (checkIsImage) {
        return undefined
    }

    return pure ? 'jpg' : 'image/jpeg'
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
    const hash = await crypto.webcrypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(text)
    )
    const hashArray = Array.from(new Uint8Array(hash))
    const hashString = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return hashString.substring(0, length)
}

export function getSystemPromptVariables(
    session: Session,
    config: Config,
    room: ConversationRoom
) {
    return {
        name: config.botNames[0],
        date: new Date().toLocaleString(),
        bot_id: session.bot.selfId,
        is_group: !session.isDirect,
        is_private: session.isDirect,
        group_id: session.guildId ?? session.event?.guild?.id,
        group_name: session.event?.guild?.name || session.guildId,
        user_id:
            session.author?.user?.id ??
            session.event?.user?.id ??
            session.userId ??
            '0',
        user: getNotEmptyString(
            session.author?.nick,
            session.author?.name,
            session.event.user?.name,
            session.username
        ),
        built: {
            preset: room.preset,
            conversationId: room.conversationId
        },
        noop: '',
        time: new Date().toLocaleTimeString(),
        weekday: getCurrentWeekday(),
        idle_duration: getTimeDiffFormat(
            new Date().getTime(),
            room.updatedTime.getTime()
        )
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatToolCall(tool: string, arg: any, log: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any

    let rawArg = arg

    if (Object.keys(rawArg).length === 1) {
        rawArg = rawArg?.input ?? rawArg?.arguments ?? rawArg
    }

    if (typeof rawArg !== 'string') {
        rawArg = JSON.stringify(rawArg, null, 2) || ''
    }

    return `{\n  tool: '${tool}',\n  arg: '${rawArg}',\n  log: '${log}'\n}`
}

export async function formatUserPromptString(
    config: Config,
    presetTemplate: PresetTemplate,
    session: Session,
    prompt: string,
    room: ConversationRoom
) {
    return await session.app.chatluna.promptRenderer.renderTemplate(
        presetTemplate.formatUserPromptString,
        {
            sender_id:
                session.author?.user?.id ?? session.event?.user?.id ?? '0',

            sender: getNotEmptyString(
                session.author?.nick,
                session.author?.name,
                session.event.user?.name,
                session.username
            ),
            prompt,
            ...getSystemPromptVariables(session, config, room)
        },
        {
            configurable: {
                session
            }
        }
    )
}
