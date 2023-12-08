import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import fs from 'fs/promises'
import { dump, load } from 'js-yaml'
import { RawPreset } from '../llm-core/prompt'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('clone_preset', async (session, context) => {
            const { command } = context

            if (command !== 'clone_preset') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const { newName, name } = context.options.clonePreset

            const presetService = ctx.chatluna.preset

            const oldPreset = await presetService.getPreset(name)

            try {
                await presetService.getPreset(newName)

                await context.send(
                    '该预设关键词已经和其他预设关键词冲突，请更换其他关键词重试哦。'
                )

                return ChainMiddlewareRunStatus.STOP
            } catch (e) {}

            await context.send(
                `你确定要克隆预设 ${name} 吗？如果你确定要克隆，请输入 Y 来确认。`
            )

            const result = await session.prompt(1000 * 30)

            if (result == null) {
                context.message = '操作超时未确认，已自动取消。'
                return ChainMiddlewareRunStatus.STOP
            } else if (result !== 'Y') {
                context.message = '已为你取消操作。'
                return ChainMiddlewareRunStatus.STOP
            }

            const loaded = load(oldPreset.rawText) as RawPreset

            loaded.keywords.push(newName)

            await fs.writeFile(
                presetService.resolvePresetDir() + `/${newName}_clone.yml`,
                dump(loaded)
            )

            context.message = `预设克隆成功，预设名称为: ${newName}。 请调用预设列表命令查看。`

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        clone_preset: string
    }

    interface ChainMiddlewareContextOptions {
        clonePreset?: {
            name: string
            newName: string
        }
    }
}
