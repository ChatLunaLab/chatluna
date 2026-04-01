import { Context, Session } from 'koishi'
import { Config } from '../../config'

import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../../chains/chain'
import { createHash } from 'crypto'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('chat_time_limit_save', async (session, context) => {
            return await oldChatLimitSave(session, context)
        })
        .after('render_message')

    async function oldChatLimitSave(
        session: Session,
        context: ChainMiddlewareContext
    ) {
        const { chatLimit, chatLimitCache } = context.options
        const conversationId = context.options.conversationId

        if (conversationId == null) {
            throw new Error('chat_time_limit_save missing conversationId')
        }

        if (chatLimit == null) {
            throw new Error('chat_time_limit_save missing chatLimit')
        }

        if (chatLimitCache == null) {
            throw new Error('chat_time_limit_save missing chatLimitCache')
        }

        let key = conversationId + '-' + session.userId

        key = createHash('md5').update(key).digest('hex')

        chatLimit.count++

        // 先保存一次
        await chatLimitCache.set(key, chatLimit)

        return ChainMiddlewareRunStatus.CONTINUE
    }
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        chat_time_limit_save: never
    }
}
