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

    ctx.plugin(ChatLunaLongMemoryService, config)

    ctx.inject(['chatluna_long_memory'], (ctx) => {
        ctx.on('ready', async () => {
            await plugins(ctx, config, plugin)
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
    hippoIEEnabled?: boolean
    hippoBridgeThreshold?: number
    hippoReinforceTopK?: number
    hippoAliasThreshold?: number
    hippoKGPersist?: boolean
    // EMgas
    emgasExtractModel: string
    emgasDecayRate: number
    emgasPruneThreshold: number
    emgasFiringThreshold: number
    emgasPropagationDecay: number
    emgasMaxIterations: number
    emgasTopN: number
    // Layers
    enabledLayers: string[]
    layerEngines: {
        layer: 'Global' | 'Preset' | 'User' | 'Guild'
        engine: 'Basic' | 'HippoRAG' | 'Emgas'
    }[]
    longMemoryExtractModel: string
    longMemoryExtractInterval?: number
    longMemoryQueryRewrite?: boolean
    // Memory extraction model (for chat history -> memory)
    hippoExtractModel: string
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        enabledLayers: Schema.array(
            Schema.union([
                Schema.const('Global'),
                Schema.const('Preset'),
                Schema.const('Guild'),
                Schema.const('User')
            ])
        )
            .role('checkbox')
            .default(['Global', 'Guild', 'User']),
        layerEngines: Schema.array(
            Schema.object({
                layer: Schema.union([
                    Schema.const('Global'),
                    Schema.const('Preset'),
                    Schema.const('Guild'),
                    Schema.const('User')
                ]),
                engine: Schema.union([
                    Schema.const('Basic'),
                    Schema.const('HippoRAG').experimental(),
                    Schema.const('Emgas').experimental()
                ])
            })
        )
            .role('table')
            .default([
                {
                    layer: 'User',
                    engine: 'HippoRAG'
                },
                {
                    layer: 'Global',
                    engine: 'Basic'
                },
                {
                    layer: 'Guild',
                    engine: 'HippoRAG'
                },
                {
                    layer: 'Preset',
                    engine: 'HippoRAG'
                }
            ]),
        longMemoryExtractModel: Schema.dynamic('model').default('无'),
        longMemoryExtractInterval: Schema.number().default(3).min(1).max(10),
        longMemoryQueryRewrite: Schema.boolean().default(true)
    }),
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
        hippoIEEnabled: Schema.boolean().default(true),
        hippoExtractModel: Schema.dynamic('model').default('无')
    }),
    Schema.object({
        emgasExtractModel: Schema.dynamic('model').default('无'),
        emgasDecayRate: Schema.number()
            .min(0.001)
            .max(0.1)
            .step(0.001)
            .default(0.01),
        emgasPruneThreshold: Schema.number()
            .min(0.001)
            .max(0.5)
            .step(0.001)
            .default(0.05),
        emgasFiringThreshold: Schema.number()
            .min(0.01)
            .max(1.0)
            .step(0.01)
            .default(0.1),
        emgasPropagationDecay: Schema.number()
            .min(0.1)
            .max(1.0)
            .step(0.01)
            .default(0.85),
        emgasMaxIterations: Schema.number().min(1).max(20).step(1).default(5),
        emgasTopN: Schema.number().min(5).max(100).step(1).default(20)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as unknown as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-long-memory'

export * from './types'
export * from './service/memory'
export * from './utils/layer'
