import { FileHandlingConfig } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ModelInfo } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { getModelContextSize } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'

export const DEFAULT_AUDIO_MAX_BASE64_BYTES = 50 * 1024 * 1024
export const DEFAULT_IMAGE_MAX_BASE64_BYTES = 50 * 1024 * 1024

export type OpenAIReasoningEffort =
    'none' | 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'

export const reasoningEffortModelSuffixes = [
    'non-thinking',
    'minimal-thinking',
    'low-thinking',
    'medium-thinking',
    'high-thinking',
    'xhigh-thinking',
    'thinking'
] as const

export function expandReasoningEffortModelVariants(
    model: string,
    suffixes: readonly string[] = reasoningEffortModelSuffixes
): string[] {
    return suffixes.map((suffix) => `${model}-${suffix}`)
}

export function parseOpenAIModelNameWithReasoningEffort(modelName: string): {
    model: string
    reasoningEffort?: OpenAIReasoningEffort
} {
    let model = modelName
    let reasoningEffort: OpenAIReasoningEffort | undefined

    const explicitMatch = model.match(
        /-(none|minimal|low|medium|high|max|xhigh|tiny)-thinking$/
    )

    if (explicitMatch?.[1]) {
        const level = explicitMatch[1]
        model = model.replace(`-${level}-thinking`, '')
        reasoningEffort =
            level === 'tiny' ? 'minimal' : (level as OpenAIReasoningEffort)
        return { model, reasoningEffort }
    }

    if (model.endsWith('-non-thinking')) {
        model = model.slice(0, -'-non-thinking'.length)
        reasoningEffort = 'none'
        return { model, reasoningEffort }
    }

    if (model.endsWith('-thinking')) {
        model = model.slice(0, -'-thinking'.length)
        reasoningEffort = 'medium'
        return { model, reasoningEffort }
    }

    return { model }
}

export function normalizeOpenAIModelName(modelName: string): string {
    return parseOpenAIModelNameWithReasoningEffort(modelName).model
}

export function isEmbeddingModel(modelName: string): boolean {
    return (
        modelName.includes('embed') ||
        modelName.includes('bge') ||
        modelName.includes('instructor-large') ||
        modelName.includes('m3e')
    )
}

export function isNonLLMModel(modelName: string): boolean {
    if (modelName.includes('gemini') && modelName.includes('image')) {
        return false
    }
    return ['whisper', 'tts', 'dall-e', 'image'].some((keyword) =>
        modelName.includes(keyword)
    )
}

export function isImageGenerationModel(modelName: string): boolean {
    return (
        isNonLLMModel(modelName) &&
        ['dall-e', 'image'].some((keyword) => modelName.includes(keyword))
    )
}

export function isRerankerModel(modelName: string): boolean {
    return modelName.includes('rerank')
}

export function getModelMaxContextSize(info: ModelInfo): number {
    if (info.maxTokens != null) return info.maxTokens
    return getModelMaxContextSizeByName(info.name)
}

export function getModelMaxContextSizeByName(name: string): number {
    const modelName = normalizeOpenAIModelName(name)

    if (
        modelName.startsWith('gpt') ||
        modelName.startsWith('o1') ||
        modelName.startsWith('o3') ||
        modelName.startsWith('o4')
    ) {
        return getModelContextSize(modelName)
    }

    // compatible with Anthropic, Google, ...
    const modelMaxContextSizeTable: { [key: string]: number } = {
        'claude-fable-5': 1_000_000,
        'claude-opus-4-8': 1_000_000,
        'claude-opus-4-7': 1_000_000,
        'claude-opus-4-6': 1_000_000,
        'claude-sonnet-5': 1_000_000,
        'claude-sonnet-4-6': 1_000_000,
        claude: 200_000,
        'gemini-1.5-pro': 1048576,
        'gemini-1.5-flash': 2097152,
        'gemini-1.0-pro': 30720,
        'gemini-2.0-flash': 1048576,
        'gemini-2.0-pro': 2097152,
        'gemini-2.5': 2097152,
        'gemini-3.0-pro': 1_097_152,
        'gemini-3.1-pro': 1_097_152,
        'gemini-2.0': 2097152,
        deepseek: 1_000_000,
        'grok-4.5': 500_000,
        'grok-4.6': 500_000,
        'grok-4.3': 1_000_000,
        'llama3.1': 128000,
        'glm-5.2': 1_000_000,
        'command-r-plus': 128000,
        'moonshot-v1-8k': 8192,
        'moonshot-v1-32k': 32000,
        'moonshot-v1-128k': 128000,
        qwen2: 32000,
        'qwen2.5': 128000,
        qwen3: 128000
    }

    for (const key in modelMaxContextSizeTable) {
        if (modelName.toLowerCase().includes(key)) {
            return modelMaxContextSizeTable[key]
        }
    }

    return 200_000
}

function createGlobMatcher(pattern: string): (text: string) => boolean {
    if (!pattern.includes('*')) {
        return (text: string) => text.includes(pattern)
    }

    const source = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
    const regex = new RegExp(`(^|[:/_-])${source}($|[:/_-])`)
    return (text: string) => regex.test(text)
}

function createRegexMatcher(regex: RegExp): (text: string) => boolean {
    return (text: string) => regex.test(text)
}

const imageModelMatchers: ((text: string) => boolean)[] = [
    'vision',
    'vl',
    'gpt-4o',
    'claude',
    'gemini',
    'qwen-vl',
    'omni',
    'gemma',
    'qwen*-omni',
    'qwen-omni',
    'qwen*-vl',
    'qwen-3.5',
    'qwen3.5',
    'qvq',
    'o1',
    'o3',
    'o4',
    'gpt-4.1',
    'gpt-5',
    'glm-*v',
    'kimi-k2.*',
    'step3',
    'grok-4',
    'grok-4.1',
    'grok-4.5',
    'grok-4.6',
    'agnes',
    'ocr'
].map(createGlobMatcher)

// mimo-v2.5 supports image/audio; mimo-v2.5-pro does NOT (text only).
imageModelMatchers.push(createRegexMatcher(/mimo-v2\.5(?!-pro)/))

// qwen3.6/3.7 plus/flash are multimodal; the -max snapshots are text-only.
imageModelMatchers.push(createRegexMatcher(/qwen[-.]?3\.[67](?!-max)/))

// qwen3.8 flash/max are multimodal image+text models.
imageModelMatchers.push(createRegexMatcher(/qwen[-.]?3\.8/))

export function supportImageInput(modelName: string) {
    const lowerModel = normalizeOpenAIModelName(modelName).toLowerCase()
    return imageModelMatchers.some((matcher) => matcher(lowerModel))
}

const audioModelMatchers: ((text: string) => boolean)[] = [
    'gpt-4o-audio',
    'gpt-4o-mini-audio',
    'gpt-audio',
    'mimo-v2-omni'
].map(createGlobMatcher)

audioModelMatchers.push(createRegexMatcher(/mimo-v2\.5(?!-pro)/))

export function supportAudioInput(modelName: string) {
    const lowerModel = normalizeOpenAIModelName(modelName).toLowerCase()
    return audioModelMatchers.some((matcher) => matcher(lowerModel))
}

const openAIImageMimeTypes = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/bmp'
]

const openAIAudioMimeTypes = [
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/flac',
    'audio/mp4',
    'audio/ogg'
]

export function getOpenAIFileHandlingConfig(
    modelName: string
): FileHandlingConfig | undefined {
    const image = supportImageInput(modelName)
    const audio = supportAudioInput(modelName)
    if (!image && !audio) return undefined

    const supportedMimeTypes = new Set<string>()
    const overrides: Record<string, number> = {}

    if (image) {
        for (const mime of openAIImageMimeTypes) {
            supportedMimeTypes.add(mime)
            overrides[mime] = DEFAULT_IMAGE_MAX_BASE64_BYTES
        }
    }

    if (audio) {
        for (const mime of openAIAudioMimeTypes) {
            supportedMimeTypes.add(mime)
            overrides[mime] = DEFAULT_AUDIO_MAX_BASE64_BYTES
        }
    }

    return {
        supportedMimeTypes,
        maxTotalSizeBytes: 100 * 1024 * 1024,
        maxFileSizeBytes: 100 * 1024 * 1024,
        maxFileSizeBytesOverrides: overrides
    }
}
