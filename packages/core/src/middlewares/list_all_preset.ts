import { Context, Session } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { Pagination } from 'koishi-plugin-chatluna/utils/pagination'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const pagination = new Pagination<string>({
        formatItem: (value) => value,
        formatString: {
            top: '',
            bottom: '',
            pages: ''
        }
    })

    chain
        .middleware('list_all_preset', async (session, context) => {
            const {
                command,
                options: { page, limit }
            } = context
            const preset = ctx.chatluna.preset

            if (command !== 'list_preset')
                return ChainMiddlewareRunStatus.SKIPPED

            pagination.updateFormatString({
                top: session.text('.header') + '\n',
                bottom: '\n' + session.text('.footer'),
                pages: '\n' + session.text('.pages')
            })

            pagination.updateFormatItem((value) =>
                formatPreset(ctx, session, value)
            )

            const presets = await preset.getAllPreset(false)

            await pagination.push(presets)

            context.message = await pagination.getFormattedPage(page, limit)

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

async function formatPreset(
    ctx: Context,
    session: Session,
    presetName: string
) {
    const buffer = []

    const preset = await ctx.chatluna.preset.getPreset(presetName)

    const previewContent = preset.messages
        .map((value) => value.content)
        .join('\n\n')
        .substring(0, 130)
        .concat('......')

    buffer.push(
        session.text('.preset_keyword', [preset.triggerKeyword.join(', ')])
    )
    buffer.push(session.text('.preset_content', [previewContent]))

    return buffer.join('\n')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        list_all_preset: never
    }
}
