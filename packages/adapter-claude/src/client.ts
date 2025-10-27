import { Context } from 'koishi'
import { PlatformModelClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelCapabilities,
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { Config } from '.'
import { ClaudeRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export class ClaudeClient extends PlatformModelClient<ClientConfig> {
    platform = 'claude'

    private _requester: ClaudeRequester

    constructor(
        ctx: Context,
        private _config: Config,
        public plugin: ChatLunaPlugin
    ) {
        super(ctx, plugin.platformConfigPool)

        this._requester = new ClaudeRequester(
            ctx,
            plugin.platformConfigPool,
            _config,
            plugin
        )
    }

    async refreshModels(): Promise<ModelInfo[]> {
        return [
            'claude-3-5-sonnet-20240620',
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-5-sonnet-20241022',
            'claude-3-7-sonnet-20250219',
            'claude-3-7-sonnet-thinking-20250219',
            'claude-opus-4-20250514',
            'claude-sonnet-4-20250514',
            'claude-sonnet-4-5-20250929',
            'claude-opus-4-1-20250805',
            'claude-3-5-haiku-20241022',
            'claude-3-haiku-20240307'
        ].map((model) => {
            return {
                name: model,
                maxTokens: 200_000,
                capabilities: [
                    ModelCapabilities.ToolCall,
                    ModelCapabilities.ImageInput
                ],
                type: ModelType.llm
            }
        })
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
            llmType: model,
            isThinkModel: model.includes('thinking')
        })
    }
}
