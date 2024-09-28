import { MessageType } from '@langchain/core/messages'
import { type TiktokenModel } from 'js-tiktoken/lite'
import { encodingForModel } from './tiktoken'
import { getModelContextSize } from '@langchain/core/language_models/base'

// https://www.npmjs.com/package/js-tiktoken

const tiktokenModels = [
    'text-davinci-003',
    'text-davinci-002',
    'text-davinci-001',
    'text-curie-001',
    'text-babbage-001',
    'text-ada-001',
    'davinci',
    'curie',
    'babbage',
    'ada',
    'code-davinci-002',
    'code-davinci-001',
    'code-cushman-002',
    'code-cushman-001',
    'davinci-codex',
    'cushman-codex',
    'gpt2',
    'gpt-3.5-turbo',
    'gpt-35-turbo',
    'gpt-3.5-turbo-0301',
    'gpt-3.5-turbo-0613',
    'gpt-3.5-turbo-1106',
    'gpt-3.5-turbo-16k',
    'gpt-3.5-turbo-16k-0613',
    'gpt-4',
    'gpt-4-0314',
    'gpt-4-0613',
    'gpt-4-32k',
    'gpt-4-32k-0314',
    'gpt-4-32k-0613',
    'gpt-4-1106-preview',
    'gpt-4-vision-preview',
    'gpt-4-0125-preview',
    'gpt-4o',
    'gpt-4o-2024-05-13'
]
export const getModelNameForTiktoken = (modelName: string): TiktokenModel => {
    if (modelName.startsWith('gpt-3.5-turbo-16k')) {
        return 'gpt-3.5-turbo-16k'
    }

    if (modelName.startsWith('gpt-3.5-turbo-')) {
        return 'gpt-3.5-turbo'
    }

    if (modelName.startsWith('gpt-4-32k')) {
        return 'gpt-4-32k'
    }

    if (modelName.startsWith('gpt-4-')) {
        return 'gpt-4'
    }

    if (modelName.startsWith('gpt-4o')) {
        return 'gpt-4o'
    }

    if (tiktokenModels.includes(modelName)) {
        return modelName as TiktokenModel
    }

    return 'gpt-3.5-turbo'
}

export const getEmbeddingContextSize = (modelName?: string): number => {
    switch (modelName) {
        case 'text-embedding-3-large':
        case 'text-embedding-3-small':
        case 'text-embedding-ada-002':
            return 8191
        default:
            return 2046
    }
}

interface CalculateMaxTokenProps {
    prompt: string
    modelName: TiktokenModel
}

export const calculateMaxTokens = async ({
    prompt,
    modelName
}: CalculateMaxTokenProps) => {
    // fallback to approximate calculation if tiktoken is not available
    let numTokens = Math.ceil(prompt.length / 4)

    try {
        numTokens = (await encodingForModel(modelName)).encode(prompt).length
    } catch (error) {}

    const maxTokens = getModelContextSize(modelName)
    return maxTokens - numTokens
}

export function messageTypeToOpenAIRole(type: MessageType): string {
    switch (type) {
        case 'system':
            return 'system'
        case 'ai':
            return 'assistant'
        case 'human':
            return 'user'
        case 'function':
            return 'function'
        case 'tool':
            return 'tool'
        default:
            throw new Error(`Unknown message type: ${type}`)
    }
}

export { getModelContextSize } from '@langchain/core/language_models/base'

export function parseRawModelName(modelName: string): [string, string] {
    return modelName.split(/(?<=^[^\/]+)\//) as [string, string]
}
