import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { Pagination } from '../utils/pagination'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const pagination = new Pagination<string>({
        formatItem: (value) => formatPreset(ctx, value),
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

            if (command !== 'list_preset')
                return ChainMiddlewareRunStatus.SKIPPED

            const presets = await preset.getAllPreset(false)

            await pagination.push(presets)

            context.message = await pagination.getFormattedPage(page, limit)

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

async function formatPreset(ctx: Context, presetName: string) {
    const buffer = []

    const preset = await ctx.chathub.preset.getPreset(presetName)

    const previewContent = preset.messages
        .map((value) => value.content)
        .join('\n\n')
        .substring(0, 130)
        .concat('......')

    buffer.push(`预设关键词： ${preset.triggerKeyword.join(', ')}`)
    buffer.push(`预设内容： ${previewContent}\n`)

    return buffer.join('\n')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        list_all_preset: never
    }
}
