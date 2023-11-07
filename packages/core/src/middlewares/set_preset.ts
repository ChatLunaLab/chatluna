import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import fs from 'fs/promises'
import { dump, load } from 'js-yaml'
import { RawPreset } from '../llm-core/prompt'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('set_preset', async (session, context) => {
            const { command } = context

            if (command !== 'set_preset') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const presetName = context.options.setPreset

            const presetService = ctx.chatluna.preset

            const preset = await presetService.getPreset(presetName)

            if (preset.messages.length > 1) {
                await context.send(
                    `不支持修改 ${presetName} 预设！该预设自定义了多条消息，属于复杂预设，无法使用此命令修改，请自行前往控制面板里的资源管理器编辑此预设。`
                )

                return ChainMiddlewareRunStatus.STOP
            }

            await context.send('请发送你的预设内容。')

            const result = await session.prompt(1000 * 30)

            if (!result) {
                context.message = `添加预设超时，已取消添加预设: ${presetName}`
                return ChainMiddlewareRunStatus.STOP
            }

            const presetObject = load(preset.rawText) as RawPreset

            presetObject.prompts[0].content = result

            await fs.writeFile(preset.path, dump(presetObject))

            context.message = `预设修改成功，预设名称为: ${presetName}。 请调用预设列表命令查看。`

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        set_preset: string
    }

    interface ChainMiddlewareContextOptions {
        setPreset?: string
    }
}
