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

        bilibili: Schema.boolean()
            .description(
                '是否启用 bilibili 插件（为模型提供 bilibili 视频的阅读能力）'
            )
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
            bilibili: Schema.const(true).required(),
            bilibiliTempTimeout: Schema.number()
                .min(60)
                .max(60 * 24)
                .description('bilibili 插件的临时存储超时时间（单位：分钟）')
        }),
        Schema.object({})
    ])
]) as Schema<Config>

export const using = ['chathub']

export const name = 'chathub-plugin-common'
