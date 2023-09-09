import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { CacheMap } from '../utils/queue'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const cacheMap = new CacheMap<string[]>()

    chain
        .middleware('list_all_preset', async (session, context) => {
            const {
                command,
                options: { page, limit }
            } = context
            const preset = ctx.chathub.preset

            if (command !== 'list_preset') return ChainMiddlewareRunStatus.SKIPPED

            const buffer: string[] = ['以下是目前可用的预设列表：\n']

            let presets = await preset.getAllPreset()

            await cacheMap.set('default', presets, (a, b) => {
                if (a.length !== b.length) return false
                const sortedA = a.sort()
                const sortedB = b.sort()

                return sortedA.every((value, index) => value === sortedB[index])
            })

            presets = await cacheMap.get('default')

            const rangePresets = presets.slice(
                (page - 1) * limit,
                Math.min(presets.length, page * limit)
            )

            for (const model of rangePresets) {
                buffer.push(model)
            }

            buffer.push('\n你也可以使用 chathub.room.set -p <preset> 来设置预设喵')

            buffer.push(`\n当前为第 ${page} / ${Math.ceil(presets.length / limit)} 页`)

            context.message = buffer.join('\n')

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        list_all_preset: never
    }
}
