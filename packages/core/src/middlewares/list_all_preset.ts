import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { Pagination } from '../utils/pagination'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const pagination = new Pagination<string>({
        formatItem: (value) => value,
        formatString: {
            top: '以下是目前可用的预设列表：\n',
            bottom: '\n你可以使用 chathub.room.set -p <preset> 来设置默认使用的预设'
        }
    })

    chain
        .middleware('list_all_preset', async (session, context) => {
            const {
                command,
                options: { page, limit }
            } = context
            const preset = ctx.chathub.preset

            if (command !== 'list_preset') return ChainMiddlewareRunStatus.SKIPPED

            const presets = await preset.getAllPreset()

            await pagination.push(presets)

            context.message = await pagination.getFormattedPage(page, limit)

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        list_all_preset: never
    }
}
