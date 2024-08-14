/* eslint-disable max-len */
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Schema } from 'koishi'
import { plugin as plugins } from './plugin'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, 'plugin-common', false)

    ctx.on('ready', async () => {
        await plugin.registerToService()
        await plugins(ctx, config, plugin)
    })
}

export interface Config extends ChatLunaPlugin.Config {
    request: boolean
    requestMaxOutputLength: number

    fs: boolean
    fsScopePath: string

    bilibili: boolean
    bilibiliTempTimeout: number

    memory: boolean

    group: boolean
    groupScopeSelector: string[]

    command: boolean

    chat: boolean

    think: boolean

    cron: boolean

    draw: boolean

    drawPrompt: string

    drawCommand: string
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        request: Schema.boolean()
            .description('启用 request 插件（为模型提供 get/post 请求接口）')
            .default(true),
        fs: Schema.boolean()
            .description('启用 fs 插件（为模型提供文件读写接口）')
            .default(false),

        group: Schema.boolean()
            .description('启用群管插件（为模型提供群管能力）')
            .default(false),

        command: Schema.boolean()
            .description('启用后用可让模型辅助执行 koishi 机器人上的指令')
            .default(false),
        chat: Schema.boolean()
            .description(
                '启用后用可让模型在执行某些复杂操作时询问发送者（注意这会导致总是重建工具链）'
            )
            .default(false),
        think: Schema.boolean()
            .description(
                '启用后可让模型多思考一下，但是也可能没有什么用（调用 think 插件）'
            )
            .default(true),
        cron: Schema.boolean()
            .description(
                '启用后可让模型提供定时提醒能力（调用 schedule 插件，如需发送消息则需要 echo 插件)'
            )
            .default(false),
        draw: Schema.boolean()
            .description(
                '启用后可让模型支持文生图（调用 Koishi 上的文生图插件）'
            )
            .default(false),
        memory: Schema.boolean()
            .description('启用后可让模型支持调用记忆插件')
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
        Schema.object({})
    ]),

    Schema.union([
        Schema.object({
            fs: Schema.const(true).required(),
            fsScopePath: Schema.string()
                .description(
                    'fs 插件的作用域路径 (为空则为整个电脑上的任意路径）'
                )
                .default('')
        }).description('fs 插件配置'),
        Schema.object({})
    ]),

    Schema.union([
        Schema.object({
            group: Schema.const(true).required(),
            groupScopeSelector: Schema.array(Schema.string()).description(
                '允许使用的成员（ID）'
            )
        }).description('群管插件配置'),
        Schema.object({})
    ]),

    Schema.union([
        Schema.object({
            draw: Schema.const(true).required(),
            drawPrompt: Schema.string()
                .description('画图插件的提示 prompt')
                .role('textarea')
                .default(
                    `1girl, solo, female only, full body, masterpiece, highly detailed, game CG, spring, cherry blossoms, floating sakura, beautiful sky, park, extremely delicate and beautiful girl, high school girl, black blazer jacket, plaid skirt\nshort_hair, blunt_bangs, white_hair/pink_eyes, two-tone hair, gradient hair, by Masaaki Sasamoto, best quality, masterpiece, highres, red-eyeshadow, lipstick.`
                ),
            drawCommand: Schema.string()
                .description('绘图实际执行的指令，{prompt} 为调用时的 prompt')
                .default('nai {prompt}')
        }).description('画图插件配置'),
        Schema.object({})
    ])
]) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-plugin-common'
