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
import {
    getModelMaxContextSizeByName,
    supportImageInput
} from '@chatluna/v1-shared-adapter'

import type { ModelUsageReporter } from 'koishi-plugin-chatluna/llm-core/platform/usage'

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
            this._requester.setModels(
                additionalModels.map((model) => model.name)
            )
            return additionalModels
        }

        let fetchedModels: ModelInfo[] = []

        try {
            // Anthropic lists newer models first; we keep the API order.
            const models = new Set<string>()
            let afterId: string | undefined

            // Page through /v1/models until has_more is false.
            while (true) {
                const resp = await this._requester.listModels({
                    afterId,
                    limit: 100
                })

                for (const item of resp.data ?? []) {
                    if (item?.id) models.add(item.id)
                }

                if (!resp.has_more || !resp.last_id) break
                afterId = resp.last_id
            }

            if (models.size > 0) {
                fetchedModels = Array.from(models).map(createModelInfo)
            }
        } catch (e) {
            logger.warn(
                'Failed to fetch model list from /v1/models, falling back to the built-in list: %s',
                (e as Error)?.message ?? String(e)
            )
        }

        if (fetchedModels.length === 0) {
            fetchedModels = FALLBACK_MODELS.map(createModelInfo)
        }

        this._requester.setModels(
            additionalModels
                .map((model) => model.name)
                .concat(fetchedModels.map((model) => model.name))
        )

        const fetchedNames = new Set(fetchedModels.map((model) => model.name))
        const names = new Set(additionalModels.map((model) => model.name))

        return additionalModels.concat(
            fetchedModels
                .flatMap((model) => {
                    if (
                        model.name.includes('thinking') ||
                        !THINKING_MODELS.some((name) =>
                            model.name.startsWith(name)
                        ) ||
                        fetchedNames.has(`${model.name}-thinking`)
                    ) {
                        return [model]
                    }

                    return [model, { ...model, name: `${model.name}-thinking` }]
                })
                .filter((model) => {
                    if (names.has(model.name)) {
                        return false
                    }

                    names.add(model.name)
                    return true
                })
        )
    }

    protected _createModel(
        model: string,
        report: ModelUsageReporter
    ): ChatLunaChatModel {
        const info = this._modelInfos[model]
        const modelMaxContextSize = info.maxTokens ?? 128000
        return new ChatLunaChatModel({
            usageReporter: report,
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

const THINKING_MODELS = [
    'claude-opus-4-5',
    'claude-opus-4-6',
    'claude-sonnet-4-5',
    'claude-haiku-4-5'
]

const CLAUDE_1M_MODELS = [
    'claude-fable-5',
    'claude-mythos-5',
    'claude-mythos-preview',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-5',
    'claude-sonnet-4-6'
]

const FALLBACK_MODELS = [
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-sonnet-5',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001'
]

function createModelInfo(name: string): ModelInfo {
    if (!name.toLowerCase().includes('claude')) {
        const capabilities = [ModelCapabilities.ToolCall]
        if (supportImageInput(name)) {
            capabilities.push(ModelCapabilities.ImageInput)
        }
        return {
            name,
            type: ModelType.llm,
            maxTokens: getModelMaxContextSizeByName(name),
            capabilities
        }
    }

    return {
        name,
        type: ModelType.llm,
        maxTokens: CLAUDE_1M_MODELS.some((item) => name.includes(item))
            ? 1_000_000
            : 200_000,
        capabilities: [
            ModelCapabilities.ToolCall,
            ModelCapabilities.ImageInput,
            ModelCapabilities.FileInput
        ]
    }
}
