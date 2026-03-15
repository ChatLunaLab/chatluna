import { Context } from 'koishi'
import {
    FileHandlingConfig,
    PlatformModelClient
} from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelCapabilities,
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { Config, logger } from '.'
import { ClaudeRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export class ClaudeClient extends PlatformModelClient<ClientConfig> {
    platform = 'claude'

    private static readonly _fileHandlingConfig: FileHandlingConfig = {
        supportedMimeTypes: new Set<string>([
            'text/html',
            'text/css',
            'text/plain',
            'text/markdown',
            'text/xml',
            'text/csv',
            'text/rtf',
            'text/javascript',
            'application/json',
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp'
        ]),
        maxTotalSizeBytes: 32 * 1024 * 1024,
        maxFileSizeBytes: 32 * 1024 * 1024,
        maxFileSizeBytesOverrides: {
            'image/jpeg': 5 * 1024 * 1024,
            'image/png': 5 * 1024 * 1024,
            'image/gif': 5 * 1024 * 1024,
            'image/webp': 5 * 1024 * 1024
        }
    }

    private _requester: ClaudeRequester

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin
    ) {
        super(ctx, plugin.platformConfigPool)
        this.platform = _config.platform

        this._requester = new ClaudeRequester(
            ctx,
            plugin.platformConfigPool,
            _config,
            plugin
        )
    }

    getFileHandlingConfig(): FileHandlingConfig {
        return ClaudeClient._fileHandlingConfig
    }

    async refreshModels(): Promise<ModelInfo[]> {
        const additionalModels = this._config.additionalModels.map(
            ({ model, contextSize, modelCapabilities }) =>
                ({
                    name: model,
                    type: ModelType.llm,
                    capabilities: modelCapabilities,
                    maxTokens: contextSize ?? 200_000
                }) as ModelInfo
        )

        if (!this._config.pullModels) {
            return additionalModels
        }

        const fallbackModels = [
            'claude-3-5-sonnet-20241022',
            'claude-3-7-sonnet-20250219',
            'claude-3-7-sonnet-thinking-20250219',
            'claude-opus-4-20250514',
            'claude-sonnet-4-20250514',
            'claude-sonnet-4-5-20250929',
            'claude-opus-4-5-20251101',
            'claude-opus-4-6',
            'claude-sonnet-4-6',
            'claude-opus-4-1-20250805',
            'claude-haiku-4-5-20251001',
            'claude-3-5-haiku-20241022'
        ]

        let fetchedModels: ModelInfo[] = []

        try {
            // Anthropic lists newer models first; we keep the API order.
            const modelIds: string[] = []
            let afterId: string | undefined

            // Page through /v1/models until has_more is false.
            while (true) {
                const resp = await this._requester.listModels({
                    afterId,
                    limit: 100
                })

                for (const item of resp.data ?? []) {
                    if (item?.id) modelIds.push(item.id)
                }

                if (!resp.has_more || !resp.last_id) break
                afterId = resp.last_id
            }

            const uniqueModels = Array.from(new Set(modelIds))
            if (uniqueModels.length > 0) {
                fetchedModels = uniqueModels.map((model) => ({
                    name: model,
                    // Use a fixed max context length (200K) for Claude models.
                    maxTokens: 200_000,
                    capabilities: [
                        ModelCapabilities.ToolCall,
                        ModelCapabilities.ImageInput,
                        ModelCapabilities.FileInput
                    ],
                    type: ModelType.llm
                }))
            }
        } catch (e) {
            logger.warn(
                'Failed to fetch model list from /v1/models, falling back to the built-in list: %s',
                (e as Error)?.message ?? String(e)
            )
        }

        if (fetchedModels.length === 0) {
            fetchedModels = fallbackModels.map((model) => ({
                name: model,
                // Use a fixed max context length (200K) for Claude models.
                maxTokens: 200_000,
                capabilities: [
                    ModelCapabilities.ToolCall,
                    ModelCapabilities.ImageInput,
                    ModelCapabilities.FileInput
                ],
                type: ModelType.llm
            }))
        }

        return additionalModels.concat(
            fetchedModels.filter(
                (model) => !additionalModels.some((m) => m.name === model.name)
            )
        )
    }

    protected _createModel(model: string): ChatLunaChatModel {
        const info = this._modelInfos[model]
        const modelMaxContextSize = info.maxTokens ?? 128000
        return new ChatLunaChatModel({
            requester: this._requester,
            modelInfo: info,
            model,
            maxTokenLimit: Math.floor(
                (info.maxTokens || modelMaxContextSize) *
                    this._config.maxContextRatio
            ),
            modelMaxContextSize,
            timeout: this._config.timeout,
            maxRetries: this._config.maxRetries,
            fileHandlingConfig: this.getFileHandlingConfig(),
            llmType: model,
            isThinkModel: model.includes('thinking')
        })
    }
}
