import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import type {} from '@koishijs/censor'
import { isMessageContentText } from 'koishi-plugin-chatluna/utils/string'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('censor', async (session, context) => {
            const message = context.options.responseMessage

            if (!config.censor || message == null) {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const baseContent = message.content

            if (typeof baseContent === 'string') {
                message.content = await ctx.censor.transform(
                    baseContent,
                    session
                )

                return ChainMiddlewareRunStatus.CONTINUE
            }

            message.content = await Promise.all(
                baseContent.map((content) => {
                    if (!isMessageContentText(content)) {
                        return content
                    }

                    return {
                        type: 'text',
                        text: ctx.censor.transform(content.text, session)
                    }
                })
            )
        })
        .before('lifecycle-send')
        .after('request_model')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        censor: never
    }
}
