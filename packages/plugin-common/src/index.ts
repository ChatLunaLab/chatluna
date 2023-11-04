import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'

import { Context, Schema } from 'koishi'
import { plugin as plugins } from './plugin'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatHubPlugin(ctx, config, 'plugin-common', false)

    ctx.on('ready', async () => {
        await plugin.registerToService()
        await plugins(ctx, config, plugin)
    })
}

export interface Config extends ChatHubPlugin.Config {
    request: boolean
    requestMaxOutputLength: number

    fs: boolean
    fsScopePath: string

    bilibili: boolean
    bilibiliTempTimeout: number

    group: boolean
    groupScopeSelector: string[]
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        request: Schema.boolean()
            .description(
                '是否启用 request 插件（为模型提供 get/post 请求接口）'
            )
            .default(true),
        fs: Schema.boolean()
            .description('是否启用 fs 插件（为模型提供文件读写接口）')
            .default(false),

        group: Schema.boolean()
            .description('是否启用群管插件（为模型提供群管能力）')
            .default(false)
    }).description('插件列表'),

    Schema.union([
        Schema.object({
            request: Schema.const(true).required(),
            requestMaxOutputLength: Schema.number()
                .min(500)
                .max(8600)
                .default(2000)
                .description('request 插件最大输出长度')
        }).description('request 插件配置'),
        Schema.object({
            fs: Schema.const(true).required(),
            fsScopePath: Schema.string()
                .description(
                    'fs 插件的作用域路径 (为空则为整个电脑上的任意路径）'
                )
                .default('')
        }),
        Schema.object({
            group: Schema.const(true).required(),
            groupScopeSelector: Schema.array(Schema.string()).description(
                '允许使用的成员（ID）'
            )
        }),
        Schema.object({})
    ])
]) as Schema<Config>

export const inject = ['chathub']

export const name = 'chathub-plugin-common'
