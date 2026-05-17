import { MessageContentComplex } from '@langchain/core/messages'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'

export const MIMO_BASE64_AUDIO_BYTES = 50 * 1024 * 1024
export const MIMO_BASE64_IMAGE_BYTES = 50 * 1024 * 1024

const mimoModels = new Set(['mimo-v2.5', 'mimo-v2-omni'])

const mimoAudioMimes = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/flac',
    'audio/mp4',
    'audio/ogg'
])

const mimoImageMimes = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp'
])

export function isMimoAudioModel(model?: string): boolean {
    if (!model) return false
    return mimoModels.has(model.split('/').pop()?.toLowerCase() ?? '')
}

export function isMimoImageModel(model?: string): boolean {
    if (!model) return false
    return mimoModels.has(model.split('/').pop()?.toLowerCase() ?? '')
}

export function isMimoAudioMime(mime: string): boolean {
    return mimoAudioMimes.has(mime.toLowerCase())
}

export function isMimoImageMime(mime: string): boolean {
    return mimoImageMimes.has(mime.toLowerCase())
}

export function modelCanReadAudio(
    info:
        | {
              value?: {
                  capabilities?: ModelCapabilities[]
              }
          }
        | undefined,
    model?: string
): boolean {
    return (
        isMimoAudioModel(model) ||
        info?.value?.capabilities?.includes(ModelCapabilities.AudioInput) ===
            true
    )
}

export function modelCanReadImage(
    info:
        | {
              value?: {
                  capabilities?: ModelCapabilities[]
              }
          }
        | undefined,
    model?: string
): boolean {
    return (
        isMimoImageModel(model) ||
        info?.value?.capabilities?.includes(ModelCapabilities.ImageInput) ===
            true
    )
}

export function buildAudioContent(
    model: string | undefined,
    data: string,
    mime: string
): MessageContentComplex {
    if (isMimoAudioModel(model)) {
        return {
            type: 'input_audio',
            input_audio: {
                data: `data:${mime};base64,${data}`
            }
        } as unknown as MessageContentComplex
    }

    return {
        type: 'audio_url',
        audio_url: {
            url: `data:${mime};base64,${data}`,
            mimeType: mime
        }
    } as unknown as MessageContentComplex
}

export function buildImageContent(
    data: string,
    mime: string
): MessageContentComplex {
    return {
        type: 'image_url',
        image_url: {
            url: `data:${mime};base64,${data}`
        }
    } as unknown as MessageContentComplex
}
