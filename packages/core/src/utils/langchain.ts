import type {
    MessageContent,
    MessageContentComplex,
    MessageContentImageUrl,
    MessageContentText
} from '@langchain/core/messages'

type MessageContentUrlPart =
    | MessageContentImageUrl
    | MessageContentFileUrl
    | MessageContentAudio
    | MessageContentVideo

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

export function isMessageContentFileUrl(
    message: MessageContentComplex
): message is MessageContentFileUrl {
    return message.type === 'file_url' && message['file_url'] != null
}

export function isMessageContentAudio(
    message: MessageContentComplex
): message is MessageContentAudio {
    return message.type === 'audio_url' && message['audio_url'] != null
}

export function isMessageContentVideo(
    message: MessageContentComplex
): message is MessageContentVideo {
    return message.type === 'video_url' && message['video_url'] != null
}

export function isMessageContentComplex(
    value: unknown
): value is MessageContentComplex {
    if (value == null || typeof value !== 'object') {
        return false
    }
    const item = value as MessageContentComplex
    return (
        isMessageContentText(item) ||
        isMessageContentImageUrl(item) ||
        isMessageContentFileUrl(item) ||
        isMessageContentAudio(item) ||
        isMessageContentVideo(item)
    )
}

function isMessageContentUrlPart(
    message: MessageContentComplex
): message is MessageContentUrlPart {
    return (
        isMessageContentImageUrl(message) ||
        isMessageContentFileUrl(message) ||
        isMessageContentAudio(message) ||
        isMessageContentVideo(message)
    )
}

function getMessageContentPartUrl(message: MessageContentUrlPart): string {
    if (isMessageContentImageUrl(message)) {
        return typeof message.image_url === 'string'
            ? message.image_url
            : message.image_url.url
    }

    if (isMessageContentFileUrl(message)) {
        return typeof message.file_url === 'string'
            ? message.file_url
            : message.file_url.url
    }

    if (isMessageContentAudio(message)) {
        return typeof message.audio_url === 'string'
            ? message.audio_url
            : message.audio_url.url
    }

    return typeof message.video_url === 'string'
        ? message.video_url
        : message.video_url.url
}

function setMessageContentPartUrl(message: MessageContentUrlPart, url: string) {
    if (isMessageContentImageUrl(message)) {
        if (typeof message.image_url === 'string') {
            message.image_url = url
            return
        }

        message.image_url.url = url
        return
    }

    if (isMessageContentFileUrl(message)) {
        if (typeof message.file_url === 'string') {
            message.file_url = url
            return
        }

        message.file_url.url = url
        return
    }

    if (isMessageContentAudio(message)) {
        if (typeof message.audio_url === 'string') {
            message.audio_url = url
            return
        }

        message.audio_url.url = url
        return
    }

    if (typeof message.video_url === 'string') {
        message.video_url = url
        return
    }

    message.video_url.url = url
}

export function truncateMessageContentUrls(
    content: MessageContent,
    maxLength: number = 100
): MessageContent {
    if (!Array.isArray(content)) {
        return content
    }

    return content.map((part) => {
        if (!isMessageContentUrlPart(part)) {
            return part
        }

        const url = getMessageContentPartUrl(part)
        if (url.startsWith('http') || url.length <= maxLength) {
            return part
        }

        setMessageContentPartUrl(
            part,
            url.substring(0, maxLength) + ' ...' + url.length + ' chars'
        )
        return part
    })
}

export type MessageContentFileUrl = {
    type: 'file_url'
    file_url:
        | string
        | {
              url: string
              mimeType?: string
          }
}

export type MessageContentAudio = {
    type: 'audio_url'
    audio_url:
        | string
        | {
              url: string
              mimeType?: string
          }
}

export type MessageContentVideo = {
    type: 'video_url'
    video_url:
        | string
        | {
              url: string
              mimeType?: string
          }
}
