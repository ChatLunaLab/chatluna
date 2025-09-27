import { ModelInfo } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { getModelContextSize } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'

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
    return ['whisper', 'tts', 'dall-e', 'image', 'rerank'].some((keyword) =>
        modelName.includes(keyword)
    )
}

export function getModelMaxContextSize(info: ModelInfo): number {
    const maxTokens = info.maxTokens

    if (maxTokens != null) {
        return maxTokens
    }

    const modelName = info.name

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
        'gemini-2.5-pro': 2097152,
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

    return getModelContextSize('o1-mini')
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
    'qwen*-omni',
    'qwen-omni',
    'qwen*-vl',
    'qvq',
    'o1',
    'o3',
    'o4',
    'gpt-4.1',
    'gpt-5',
    'glm-*v',
    'step3',
    'grok-4'
].map((pattern) => createGlobMatcher(pattern))

export function supportImageInput(modelName: string) {
    const lowerModel = modelName.toLowerCase()
    return imageModelMatchers.some((matcher) => matcher(lowerModel))
}
