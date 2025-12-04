import {
    BaseMessage,
    MessageContent,
    MessageContentComplex,
    MessageContentImageUrl,
    MessageContentText
} from '@langchain/core/messages'
import type { HandlerResult, PostHandler } from './types'
import { Context, h, Session } from 'koishi'
import { Config, ConversationRoom } from 'koishi-plugin-chatluna'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
type Encoding = 'buffer' | 'base64' | 'hex'
type BufferType<T extends Encoding> = T extends 'buffer'
    ? Buffer
    : T extends 'base64'
      ? string
      : T extends 'hex'
        ? string
        : never
export declare function fuzzyQuery(source: string, keywords: string[]): boolean
export declare function isMessageContentImageUrl(
    message: MessageContentComplex
): message is MessageContentImageUrl
export declare function isMessageContentText(
    message: MessageContentComplex
): message is MessageContentText
export declare function transformMessageContentToElements(
    content: MessageContent
): h[]
export declare function getImageMimeType(ext?: string): string
export declare function getImageType(
    buffer: Buffer,
    pure?: boolean,
    checkIsImage?: boolean
): string
export declare function getMessageContent(
    message: BaseMessage['content']
): string
export declare function getNotEmptyString(
    ...texts: (string | undefined)[]
): string
export declare function getCurrentWeekday(): string
export declare const getTimeInUTC: (offset: number) => string
export declare const getTimeDiffFormat: (time1: number, time2: number) => string
export declare const getTimeDiff: (time1: string, time2: string) => string
export declare const selectFromList: (args: string, isPick: boolean) => string
export declare const rollDice: (formula: string) => number
export declare const fetchUrl: (
    url: string,
    method?: string,
    body?: string | null,
    textLength?: number
) => Promise<string>
export declare class PresetPostHandler implements PostHandler {
    private ctx
    private config
    prefix: string
    postfix: string
    variables: Record<string, string>
    censor?: boolean
    compiledVariables: Record<string, RegExp>
    constructor(
        ctx: Context,
        config: Config,
        object: Omit<PostHandler, 'handler'>
    )

    handler(session: Session, data: string): Promise<HandlerResult>
    private _compileVariables
}
export declare function gzipEncode<T extends Encoding = 'buffer'>(
    text: string,
    encoding?: T
): Promise<BufferType<T>>
export declare function gzipDecode(
    data: ArrayBuffer | Buffer | string,
    inputEncoding?: Encoding
): Promise<string>
export declare function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer
export declare function hashString(
    text: string,
    length?: number
): Promise<string>
export declare function getSystemPromptVariables(
    session: Session,
    config: Config,
    room: ConversationRoom
): {
    name: string
    date: string
    bot_id: string
    is_group: boolean
    is_private: boolean
    group_id: string
    group_name: string
    user_id: string
    user: string
    built: {
        preset: string
        conversationId: string
    }
    noop: string
    time: string
    weekday: string
    idle_duration: string
}
export declare function formatToolCall(
    tool: string,
    arg: any,
    log: string
): string
export declare function formatUserPromptString(
    config: Config,
    presetTemplate: PresetTemplate,
    session: Session,
    prompt: string,
    room: ConversationRoom
): Promise<import('@chatluna/shared-prompt-renderer').RenderResult>
export {}
