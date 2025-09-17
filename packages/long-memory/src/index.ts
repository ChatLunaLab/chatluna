/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Logger, Schema } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { plugins } from './plugin'
import { ChatLunaLongMemoryService } from './service/memory'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-long-memory')
    const plugin = new ChatLunaPlugin<ClientConfig, Config>(
        ctx,
        config,
        'long-memory',
        false
    )

    ctx.on('ready', async () => {
        ctx.plugin(ChatLunaLongMemoryService, config)

        ctx.inject(['chatluna_long_memory'], (ctx) => {
            ctx.on('ready', async () => {
                await plugins(ctx, config, plugin)
            })
        })
    })
}

export interface Config extends ChatLunaPlugin.Config {
    // HippoRAG core knobs
    hippoSimilarityThreshold: number
    hippoPPRAlpha: number
    hippoTopEntities: number
    hippoMaxCandidates: number
    hippoHybridWeight: number
    hippoQueryRewrite?: boolean
    hippoInterval?: number
    hippoIEEnabled?: boolean
    hippoBridgeThreshold?: number
    hippoReinforceTopK?: number
    hippoAliasThreshold?: number
    hippoKGPersist?: boolean
    // Layers
    hippoLayer: string[]
    // Memory extraction model (for chat history -> memory)
    hippoExtractModel: string
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        hippoSimilarityThreshold: Schema.percent()
            .min(0)
            .max(1)
            .step(0.01)
            .default(0.35),
        hippoPPRAlpha: Schema.number().min(0).max(1).step(0.01).default(0.15),
        hippoTopEntities: Schema.number().min(1).max(50).step(1).default(10),
        hippoMaxCandidates: Schema.number()
            .min(10)
            .max(2000)
            .step(10)
            .default(200),
        hippoHybridWeight: Schema.number()
            .min(0)
            .max(1)
            .step(0.01)
            .default(0.8),
        hippoQueryRewrite: Schema.boolean().default(false),
        hippoInterval: Schema.number().default(3).min(1).max(10),
        hippoIEEnabled: Schema.boolean().default(false),
        hippoBridgeThreshold: Schema.percent()
            .min(0)
            .max(1)
            .step(0.01)
            .default(0.6),
        hippoReinforceTopK: Schema.number().min(1).max(100).step(1).default(10),
        hippoAliasThreshold: Schema.percent()
            .min(0)
            .max(1)
            .step(0.01)
            .default(0.85),
        hippoKGPersist: Schema.boolean().default(true),
        hippoLayer: Schema.array(
            Schema.union([
                Schema.const('Global'),
                Schema.const('Preset'),
                Schema.const('Preset_User'),
                Schema.const('User')
            ])
        )
            .role('checkbox')
            .default(['Preset_User']),
        hippoExtractModel: Schema.dynamic('model').default('无')
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-long-memory'

export * from './types'
export * from './service/memory'
