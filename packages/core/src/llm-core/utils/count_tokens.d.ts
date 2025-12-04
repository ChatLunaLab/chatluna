import { MessageType } from '@langchain/core/messages'
import { type TiktokenModel } from 'js-tiktoken/lite'
export declare const getModelNameForTiktoken: (
    modelName: string
) => TiktokenModel
export declare const getEmbeddingContextSize: (modelName?: string) => number
interface CalculateMaxTokenProps {
    prompt: string
    modelName: TiktokenModel
}
export declare const calculateMaxTokens: ({
    prompt,
    modelName
}: CalculateMaxTokenProps) => Promise<number>
export declare function messageTypeToOpenAIRole(type: MessageType): string
export declare const getModelContextSize: (modelName: string) => number
export declare function parseRawModelName(modelName: string): [string, string]
export {}
