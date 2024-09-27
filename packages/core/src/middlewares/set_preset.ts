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

            if (!preset) {
                await context.send(session.text('.not_found'))
                return ChainMiddlewareRunStatus.STOP
            }

            if (preset.messages.length > 1) {
                await context.send(session.text('.not_support', [presetName]))

                return ChainMiddlewareRunStatus.STOP
            }

            await context.send(session.text('.enter_content'))

            const result = await session.prompt(1000 * 30)

            if (!result) {
                await context.send(session.text('.timeout'))
                return ChainMiddlewareRunStatus.STOP
            }

            const presetObject = load(preset.rawText) as RawPreset

            presetObject.prompts[0].content = result

            await fs.writeFile(preset.path, dump(presetObject))

            await context.send(session.text('.success', [presetName]))

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
