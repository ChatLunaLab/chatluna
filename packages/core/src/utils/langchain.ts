import type {
    MessageContentComplex,
    MessageContentImageUrl,
    MessageContentText
} from '@langchain/core/messages'

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
