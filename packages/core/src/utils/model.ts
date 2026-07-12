import {
    ModelCapabilities,
    ModelInfo
} from 'koishi-plugin-chatluna/llm-core/platform/types'

export function parseRawModelName(
    modelName: string
): [string | undefined, string | undefined] {
    if (modelName == null || modelName.trim().length < 1) {
        return [undefined, undefined]
    }

    const value = modelName.trim()
    const index = value.indexOf('/')

    if (index === -1) {
        return [undefined, value]
    }

    if (index === 0 || index === value.length - 1) {
        return [undefined, undefined]
    }

    return [value.slice(0, index), value.slice(index + 1)]
}

export function modelInfoSupportsElement(
    info: ModelInfo | undefined,
    type: 'img' | 'file' | 'video' | 'audio'
) {
    if (info == null) return false

    switch (type) {
        case 'img':
            return info.capabilities.includes(ModelCapabilities.ImageInput)
        case 'audio':
            return info.capabilities.includes(ModelCapabilities.AudioInput)
        case 'video':
            return info.capabilities.includes(ModelCapabilities.VideoInput)
        default:
            return info.capabilities.includes(ModelCapabilities.FileInput)
    }
}
