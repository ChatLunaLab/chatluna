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

                await context.send(session.text('.conflict'))

                return ChainMiddlewareRunStatus.STOP
            } catch (e) {}

            await context.send(session.text('.confirm', [name]))

            const result = await session.prompt(1000 * 30)

            if (result == null) {
                context.message = session.text('.timeout')
                return ChainMiddlewareRunStatus.STOP
            } else if (result !== 'Y') {
                context.message = session.text('.cancelled')
                return ChainMiddlewareRunStatus.STOP
            }

            const loaded = load(oldPreset.rawText) as RawPreset

            loaded.keywords.push(newName)

            await fs.writeFile(
                presetService.resolvePresetDir() + `/${newName}_clone.yml`,
                dump(loaded)
            )

            context.message = session.text('.success', [newName])

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
