import { Context } from 'koishi'
import { logger } from 'koishi-plugin-chatluna'
import { ChainMiddlewareRunStatus } from 'koishi-plugin-chatluna/chains'
import { Config, MemoryRetrievalLayerType, MemoryType } from '../index'
import { randomUUID } from 'crypto'
import { getMemoryScope } from '../utils/conversation'

export function apply(ctx: Context, config: Config) {
    const chain = ctx.chatluna.chatChain

    chain
        .middleware(
            'add_memory',
            async (session, context) => {
                const {
                    command,
                    options: { type, content, view, conversationId, presetLane }
                } = context

                if (command !== 'add_memory')
                    return ChainMiddlewareRunStatus.SKIPPED

                let parsedLayerType = MemoryRetrievalLayerType.USER

                if (view != null) {
                    parsedLayerType =
                        MemoryRetrievalLayerType[view.toUpperCase()]

                    if (parsedLayerType == null) {
                        context.message = session.text('.invalid_view', [
                            ['global', 'preset', 'user', 'preset_user'].join(
                                ', '
                            )
                        ])
                        return ChainMiddlewareRunStatus.STOP
                    }
                }

                try {
                    const scope = await getMemoryScope(ctx, session, {
                        conversationId,
                        presetLane,
                        type
                    })

                    if (scope == null) {
                        context.message = session.text('.add_failed')
                        return ChainMiddlewareRunStatus.STOP
                    }

                    const layers =
                        await ctx.chatluna_long_memory.initMemoryLayers(
                            scope.info,
                            scope.conversation.id,
                            parsedLayerType
                        )

                    await Promise.all(
                        layers.map((layer) =>
                            layer.addMemories([
                                {
                                    content,
                                    id: randomUUID(),
                                    type: MemoryType.PREFERENCE,
                                    importance: 10,
                                    // 10 years
                                    expirationDate: new Date(
                                        Date.now() +
                                            1000 * 60 * 60 * 24 * 365 * 10
                                    )
                                }
                            ])
                        )
                    )

                    await ctx.chatluna.clearCache(scope.conversation)

                    context.message = session.text('.add_success')
                } catch (error) {
                    logger?.error(error)
                    context.message = session.text('.add_failed')
                }

                return ChainMiddlewareRunStatus.STOP
            },
            ctx
        )
        .after('lifecycle-handle_command')
}

declare module 'koishi-plugin-chatluna/chains' {
    interface ChainMiddlewareName {
        add_memory: never
    }

    interface ChainMiddlewareContextOptions {
        content?: string
    }
}
