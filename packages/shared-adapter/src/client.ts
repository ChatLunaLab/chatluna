import { ModelInfo } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { getModelContextSize } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'

export type OpenAIReasoningEffort =
    | 'none'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'

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
        /-(none|minimal|low|medium|high|xhigh|tiny)-thinking$/
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

export function isRerankerModel(modelName: string): boolean {
    return modelName.includes('rerank')
}

export function getModelMaxContextSize(info: ModelInfo): number {
    const maxTokens = info.maxTokens

    if (maxTokens != null) {
        return maxTokens
    }

    const modelName = normalizeOpenAIModelName(info.name)

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
        claude: 2000000,
        'gemini-1.5-pro': 1048576,
        'gemini-1.5-flash': 2097152,
        'gemini-1.0-pro': 30720,
        'gemini-2.0-flash': 1048576,
        'gemini-2.0-pro': 2097152,
        'gemini-2.5': 2097152,
        'gemini-3.0-pro': 1_097_152,
        'gemini-3.1-pro': 1_097_152,
        'gemini-2.0': 2097152,
        deepseek: 128000,
        'llama3.1': 128000,
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

    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    return (text: string) => regex.test(text)
}

const imageModelMatchers = [
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
    'kimi-k2.5',
    'step3',
    'grok-4'
].map((pattern) => createGlobMatcher(pattern))

export function supportImageInput(modelName: string) {
    const lowerModel = normalizeOpenAIModelName(modelName).toLowerCase()
    return imageModelMatchers.some((matcher) => matcher(lowerModel))
}
