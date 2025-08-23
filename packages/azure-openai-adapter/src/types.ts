import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'

export interface AzureOpenAIClientConfig extends ClientConfig {
    supportModels: Record<
        string,
        {
            model: string
            modelType: string
            modelVersion: string
            contextSize: number
        }
    >
}
