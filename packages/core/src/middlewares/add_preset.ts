import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { dump } from 'js-yaml'
import fs from 'fs/promises'

export function apply(ctx: Context, _: Config, chain: ChatChain) {
    chain
        .middleware('add_preset', async (session, context) => {
            const { command } = context

            if (command !== 'add_preset')
                return ChainMiddlewareRunStatus.SKIPPED

            const presetName = context.options.addPreset

            const preset = ctx.chatluna.preset

            try {
                await preset.getPreset(presetName)

                await context.send(session.text('.conflict'))

                return ChainMiddlewareRunStatus.STOP
            } catch (e) {}

            await context.send(session.text('.prompt'))

            const result = await session.prompt(1000 * 30)

            if (!result) {
                context.message = session.text('.timeout', [presetName])
                return ChainMiddlewareRunStatus.STOP
            }

            const presetObject = {
                keywords: [presetName],
                prompts: [
                    {
                        role: 'system',
                        content: result
                    }
                ]
            }

            const yamlText = dump(presetObject)

            await fs.writeFile(
                preset.resolvePresetDir() + `/${presetName}.yml`,
                yamlText
            )

            context.message = session.text('.success', [presetName])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        add_preset: string
    }

    interface ChainMiddlewareContextOptions {
        addPreset?: string
    }
}
